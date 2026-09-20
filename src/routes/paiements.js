const express = require('express');
const { pool, query, one, audit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { normalizePhone } = require('../services/sms');
const { renderRecu } = require('../services/recu-pdf');
const { TYPES_ASSURANCE, MODES_AVANCE, MODES_RESTE } = require('../constants');
const config = require('../config');
const cmi = require('../services/cmi');
const caisse = require('../services/caisse');
const { clean, toCents, centsToDecimal, isValidDate, referenceFromId, wrap } = require('../util');
const crypto = require('crypto');
const newOid = () => 'AAK' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();

const router = express.Router();
router.use(requireAuth);
const canSaisir = requireRole('admin', 'agent');
const adminOnly = requireRole('admin');

const todayCasablanca = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());

/**
 * Valide la saisie et recalcule le reste à payer côté serveur.
 * Retourne { data } ou { errors: { champ: message } }.
 */
function validate(body) {
  const errors = {};
  const souscripteur = clean(body.souscripteur, 150);
  const ttc = toCents(body.totalTtc);
  const avance = body.avance === '' || body.avance == null ? 0 : toCents(body.avance);
  const date = String(body.datePaiement || '');
  const numPolice = clean(body.numPolice, 40).toUpperCase();
  const typeAssurance = Object.hasOwn(TYPES_ASSURANCE, body.typeAssurance) ? body.typeAssurance : null;
  const telRaw = clean(body.telephone, 25);
  const telephone = telRaw ? normalizePhone(telRaw) : null;

  if (souscripteur.length < 3) errors.souscripteur = 'Saisissez le nom du souscripteur (3 caractères minimum).';
  if (telRaw && !telephone) errors.telephone = 'Numéro invalide (ex. 06 61 23 45 67).';
  if (numPolice.length < 3) errors.numPolice = 'Saisissez le numéro de police.';
  else if (!/^[A-Z0-9\/\-. ]+$/.test(numPolice)) errors.numPolice = 'Lettres, chiffres, espaces et / - . uniquement.';
  if (!typeAssurance) errors.typeAssurance = 'Choisissez le type d\'assurance.';
  if (ttc === null || ttc <= 0) errors.totalTtc = 'Saisissez un Total TTC valide, supérieur à 0.';
  if (avance === null) errors.avance = 'Saisissez une avance valide (0 si aucune).';
  else if (ttc && avance > ttc) errors.avance = 'L\'avance ne peut pas dépasser le Total TTC.';
  if (!isValidDate(date)) errors.datePaiement = 'Saisissez une date valide.';
  else if (date > todayCasablanca()) errors.datePaiement = 'La date ne peut pas être dans le futur.';

  let modeAvance = null;
  if (avance > 0) {
    modeAvance = Object.hasOwn(MODES_AVANCE, body.modeAvance) ? body.modeAvance : null;
    if (!modeAvance) errors.modeAvance = 'Choisissez le mode de l\'avance.';
  }
  const reste = ttc !== null && avance !== null ? ttc - avance : null;
  let modeReste = null, refVirement = null;
  if (reste !== null && reste > 0) {
    modeReste = Object.hasOwn(MODES_RESTE, body.modeReste) ? body.modeReste : null;
    if (!modeReste) errors.modeReste = 'Choisissez le mode de paiement du reste.';
    if (modeReste === 'virement') {
      refVirement = clean(body.refVirement, 60).toUpperCase();
      if (refVirement.length < 3) errors.refVirement = 'Saisissez la référence du virement.';
    }
  }
  if (Object.keys(errors).length) return { errors };
  return { data: { souscripteur, telephone, numPolice, typeAssurance, totalTtc: centsToDecimal(ttc), avance: centsToDecimal(avance), modeAvance, reste: centsToDecimal(reste),
    modeReste, refVirement, datePaiement: date } };
}

const select = `SELECT p.*, c.full_name AS agent, v.full_name AS validateur, a.full_name AS annule_par,
  (SELECT COALESCE(SUM(m.montant),0) FROM caisse_mouvements m WHERE m.paiement_id = p.id AND m.categorie = 'encaissement_reste' AND m.statut = 'valide') AS reste_encaisse_caisse,
  (SELECT COALESCE(SUM(c.montant),0) FROM paiements_carte c WHERE c.paiement_id = p.id AND c.cible = 'reste' AND c.statut = 'paye') AS reste_encaisse_carte,
  (SELECT COALESCE(SUM(c.montant),0) FROM paiements_carte c WHERE c.paiement_id = p.id AND c.cible = 'avance' AND c.statut = 'paye') AS avance_carte_payee,
  (SELECT m.reference FROM caisse_mouvements m WHERE m.paiement_id = p.id AND m.categorie = 'encaissement_avance' AND m.statut = 'valide' LIMIT 1) AS mouvement_avance
  FROM paiements p JOIN users c ON c.id = p.created_by LEFT JOIN users v ON v.id = p.validated_by LEFT JOIN users a ON a.id = p.cancelled_by`;
const pub = p => ({ reference: p.reference, souscripteur: p.souscripteur, telephone: p.telephone, numPolice: p.num_police,
  typeAssurance: p.type_assurance, typeAssuranceLabel: TYPES_ASSURANCE[p.type_assurance], totalTtc: p.total_ttc, avance: p.avance, modeAvance: p.mode_avance,
  resteEncaisse: Number(p.reste_encaisse_caisse || 0) + Number(p.reste_encaisse_carte || 0),
  resteEncaisseCaisse: p.reste_encaisse_caisse, resteEncaisseCarte: p.reste_encaisse_carte,
  avanceCartePayee: p.avance_carte_payee, mouvementAvance: p.mouvement_avance,
  reste: p.reste_a_payer, modeReste: p.mode_reste, refVirement: p.ref_virement, datePaiement: p.date_paiement, statut: p.statut,
  motifAnnulation: p.motif_annulation, agent: p.agent, agentId: p.created_by, validateur: p.validateur, validatedAt: p.validated_at,
  annulePar: p.annule_par, cancelledAt: p.cancelled_at, createdAt: p.created_at });

async function refVirementTaken(ref, excludeId = 0) {
  if (!ref) return null;
  return one(`SELECT reference FROM paiements WHERE ref_virement = ? AND statut <> 'annule' AND id <> ?`, [ref, excludeId]);
}

/* ---------- Créer ---------- */
router.post('/', canSaisir, wrap(async (req, res) => {
  const { data, errors } = validate(req.body);
  if (errors) return res.status(400).json({ error: 'Vérifiez les champs signalés.', fields: errors });

  const taken = await refVirementTaken(data.refVirement);
  if (taken) return res.status(409).json({ error: `Cette référence de virement est déjà utilisée (${taken.reference}).`, fields: { refVirement: 'Référence déjà utilisée.' } });

  if (!req.body.confirmDuplicate) {
    const dup = await one(`SELECT reference FROM paiements WHERE souscripteur = ? AND num_police = ? AND total_ttc = ? AND avance = ? AND date_paiement = ?
      AND statut <> 'annule' AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)`, [data.souscripteur, data.numPolice, data.totalTtc, data.avance, data.datePaiement]);
    if (dup) return res.status(409).json({ duplicate: dup.reference, error: `Un paiement identique vient d'être enregistré (${dup.reference}).` });
  }

  const conn = await pool.getConnection();
  try {
    const reference = await caisse.withCaisseLock(conn, async () => {
      if (data.modeAvance === 'espece' && await caisse.isClosed(conn, data.datePaiement))
        throw Object.assign(new Error(`La caisse du ${data.datePaiement} est déjà clôturée : une avance en espèce ne peut plus y être ajoutée.`), { status: 409, fields: { datePaiement: 'Caisse clôturée pour cette date.' } });
      await conn.beginTransaction();
      const [r] = await conn.execute(`INSERT INTO paiements (souscripteur, telephone, num_police, type_assurance, total_ttc, avance, mode_avance, reste_a_payer, mode_reste, ref_virement, date_paiement, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [data.souscripteur, data.telephone, data.numPolice, data.typeAssurance, data.totalTtc, data.avance, data.modeAvance, data.reste, data.modeReste, data.refVirement, data.datePaiement, req.user.id]);
      const ref = referenceFromId(r.insertId, data.datePaiement);
      await conn.execute('UPDATE paiements SET reference = ? WHERE id = ?', [ref, r.insertId]);
      if (data.modeAvance === 'espece') {
        await caisse.insertMouvement(conn, { sens: 'entree', categorie: 'encaissement_avance', montant: data.avance,
          motif: `Avance ${ref} — police ${data.numPolice}`, beneficiaire: data.souscripteur, paiementId: r.insertId, date: data.datePaiement, userId: req.user.id });
      }
      await conn.commit();
      return ref;
    });
    const r = { insertId: (await one('SELECT id FROM paiements WHERE reference = ?', [reference])).id };
    await audit(req.user.id, 'paiement_creation', `paiement:${reference}`, data, req.ip);
    res.status(201).json({ paiement: pub(await one(`${select} WHERE p.id = ?`, [r.insertId])) });
  } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
}));

/* ---------- Modifier (tant qu'il est en attente) ---------- */
router.put('/:reference', canSaisir, wrap(async (req, res) => {
  const p = await one('SELECT * FROM paiements WHERE reference = ?', [clean(req.params.reference, 30)]);
  if (!p) return res.status(404).json({ error: 'Paiement introuvable.' });
  if (p.statut !== 'en_attente') return res.status(409).json({ error: 'Seul un paiement en attente peut être modifié.' });
  if (req.user.role === 'agent' && p.created_by !== req.user.id) return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres saisies.' });
  const { data, errors } = validate(req.body);
  if (errors) return res.status(400).json({ error: 'Vérifiez les champs signalés.', fields: errors });
  const taken = await refVirementTaken(data.refVirement, p.id);
  if (taken) return res.status(409).json({ error: `Cette référence de virement est déjà utilisée (${taken.reference}).`, fields: { refVirement: 'Référence déjà utilisée.' } });
  const conn = await pool.getConnection();
  try {
    await caisse.withCaisseLock(conn, async () => {
      const [[mvt]] = await conn.execute(`SELECT * FROM caisse_mouvements WHERE paiement_id = ? AND categorie = 'encaissement_avance' AND statut = 'valide'`, [p.id]);
      const caisseChange = !!mvt !== (data.modeAvance === 'espece') || (mvt && (Number(mvt.montant) !== Number(data.avance) || mvt.date_mouvement !== data.datePaiement));
      if (caisseChange) {
        if (mvt && await caisse.isClosed(conn, mvt.date_mouvement))
          throw Object.assign(new Error(`L'avance est déjà comptée dans la caisse clôturée du ${mvt.date_mouvement} : montant, mode et date de l'avance ne peuvent plus changer.`), { status: 409 });
        if (data.modeAvance === 'espece' && await caisse.isClosed(conn, data.datePaiement))
          throw Object.assign(new Error(`La caisse du ${data.datePaiement} est déjà clôturée.`), { status: 409, fields: { datePaiement: 'Caisse clôturée pour cette date.' } });
      }
      await conn.beginTransaction();
      await conn.execute(`UPDATE paiements SET souscripteur=?, telephone=?, num_police=?, type_assurance=?, total_ttc=?, avance=?, mode_avance=?, reste_a_payer=?, mode_reste=?, ref_virement=?, date_paiement=? WHERE id=?`,
        [data.souscripteur, data.telephone, data.numPolice, data.typeAssurance, data.totalTtc, data.avance, data.modeAvance, data.reste, data.modeReste, data.refVirement, data.datePaiement, p.id]);
      if (caisseChange) {
        if (mvt) await conn.execute(`UPDATE caisse_mouvements SET statut='annule', motif_annulation='Paiement modifié', cancelled_by=?, cancelled_at=NOW() WHERE id=?`, [req.user.id, mvt.id]);
        if (data.modeAvance === 'espece') await caisse.insertMouvement(conn, { sens: 'entree', categorie: 'encaissement_avance', montant: data.avance,
          motif: `Avance ${p.reference} — police ${data.numPolice}`, beneficiaire: data.souscripteur, paiementId: p.id, date: data.datePaiement, userId: req.user.id });
      }
      await conn.commit();
    });
  } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
  await audit(req.user.id, 'paiement_modification', `paiement:${p.reference}`, { avant: pub(p), apres: data }, req.ip);
  res.json({ paiement: pub(await one(`${select} WHERE p.id = ?`, [p.id])) });
}));

/* ---------- Liste / recherche ---------- */
function filters(q) {
  const where = [], params = [];
  const s = clean(q.q, 80);
  if (s) {
    const tel = normalizePhone(s);
    where.push('(p.reference LIKE ? OR p.souscripteur LIKE ? OR p.ref_virement LIKE ? OR p.num_police LIKE ?' + (tel ? ' OR p.telephone = ?' : '') + ')');
    params.push(`%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`, ...(tel ? [tel] : []));
  }
  if (Object.hasOwn(TYPES_ASSURANCE, q.type)) { where.push('p.type_assurance = ?'); params.push(q.type); }
  if (['en_attente', 'valide', 'annule'].includes(q.statut)) { where.push('p.statut = ?'); params.push(q.statut); }
  if (['virement', 'espece'].includes(q.mode)) { where.push('p.mode_reste = ?'); params.push(q.mode); }
  if (q.mode === 'solde') where.push('p.reste_a_payer = 0');
  if (isValidDate(q.du)) { where.push('p.date_paiement >= ?'); params.push(q.du); }
  if (isValidDate(q.au)) { where.push('p.date_paiement <= ?'); params.push(q.au); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

router.get('/', wrap(async (req, res) => {
  const f = filters(req.query);
  const rows = await query(`${select} ${f.sql} ORDER BY p.date_paiement DESC, p.id DESC LIMIT 500`, f.params);
  const totals = await one(`SELECT COUNT(*) AS n, COALESCE(SUM(total_ttc),0) AS ttc, COALESCE(SUM(avance),0) AS avance,
    COALESCE(SUM(reste_a_payer),0) AS reste FROM paiements p ${f.sql ? f.sql + " AND p.statut <> 'annule'" : "WHERE p.statut <> 'annule'"}`, f.params);
  res.json({ paiements: rows.map(pub), totals });
}));

router.get('/export.csv', wrap(async (req, res) => {
  const f = filters(req.query);
  const rows = await query(`${select} ${f.sql} ORDER BY p.date_paiement DESC, p.id DESC`, f.params);
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const num = v => Number(v || 0).toFixed(2).replace('.', ',');
  const lines = [['Référence', 'Date', 'Souscripteur', 'Téléphone', 'N° police', "Type d'assurance", 'Total TTC', 'Avance', "Mode de l'avance", 'Reste à payer', 'Mode du reste', 'Réf. virement', 'Statut', 'Agent', 'Validé par'].map(cell).join(';')];
  rows.forEach(p => lines.push([cell(p.reference), cell(p.date_paiement), cell(p.souscripteur), cell(p.telephone), cell(p.num_police), cell(TYPES_ASSURANCE[p.type_assurance]), num(p.total_ttc), num(p.avance), cell(MODES_AVANCE[p.mode_avance] || ''), num(p.reste_a_payer),
    cell(Number(p.reste_a_payer) === 0 ? 'Soldé' : MODES_RESTE[p.mode_reste] || '—'), cell(p.ref_virement),
    cell({ en_attente: 'En attente', valide: 'Validé', annule: 'Annulé' }[p.statut]), cell(p.agent), cell(p.validateur)].join(';')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="paiements-${todayCasablanca()}.csv"`);
  res.send('\uFEFF' + lines.join('\r\n'));
}));

/* ---------- Paiement par carte (Visa / Mastercard via le CMI) ---------- */
const cartePub = c => ({ reference: c.reference, cible: c.cible, montant: c.montant, statut: c.statut,
  maskedPan: c.masked_pan, reseau: c.reseau, authCode: c.auth_code, transId: c.trans_id,
  erreur: c.message_erreur, payeAt: c.paye_at, createdAt: c.created_at });

router.get('/:reference/cartes', wrap(async (req, res) => {
  const p = await one('SELECT id FROM paiements WHERE reference = ?', [clean(req.params.reference, 30)]);
  if (!p) return res.status(404).json({ error: 'Paiement introuvable.' });
  const rows = await query('SELECT * FROM paiements_carte WHERE paiement_id = ? ORDER BY id DESC', [p.id]);
  res.json({ cartes: rows.map(cartePub), disponible: !config.cmi.simulator || !config.isProd, simulateur: config.cmi.simulator });
}));

// Démarre un paiement par carte : crée la transaction et renvoie le formulaire à poster vers le CMI
router.post('/:reference/carte', canSaisir, wrap(async (req, res) => {
  if (config.cmi.simulator && config.isProd)
    return res.status(503).json({ error: 'Le paiement par carte n\'est pas configuré (contrat CMI).' });
  const cible = req.body.cible === 'reste' ? 'reste' : 'avance';
  const p = await one(`${select} WHERE p.reference = ?`, [clean(req.params.reference, 30)]);
  if (!p) return res.status(404).json({ error: 'Paiement introuvable.' });
  if (p.statut === 'annule') return res.status(409).json({ error: 'Ce paiement est annulé.' });

  let montant;
  if (cible === 'avance') {
    if (p.mode_avance !== 'carte') return res.status(409).json({ error: 'L\'avance de ce paiement n\'est pas réglée par carte.' });
    montant = Number(p.avance) - Number(p.avance_carte_payee || 0);
  } else {
    if (p.mode_reste !== 'carte') return res.status(409).json({ error: 'Le reste de ce paiement n\'est pas réglé par carte.' });
    montant = Number(p.reste_a_payer) - Number(p.reste_encaisse_caisse || 0) - Number(p.reste_encaisse_carte || 0);
  }
  if (!(montant > 0)) return res.status(409).json({ error: 'Ce montant est déjà réglé.' });

  // une seule tentative à la fois
  await query(`UPDATE paiements_carte SET statut='expire' WHERE paiement_id=? AND cible=? AND statut='en_cours'
    AND created_at < DATE_SUB(NOW(), INTERVAL 20 MINUTE)`, [p.id, cible]);
  const encours = await one(`SELECT reference FROM paiements_carte WHERE paiement_id=? AND cible=? AND statut='en_cours'`, [p.id, cible]);
  if (encours) return res.status(409).json({ error: `Une tentative de paiement par carte est déjà en cours (${encours.reference}). Patientez ou réessayez dans 20 minutes.` });

  const oid = newOid();
  const r = await query(`INSERT INTO paiements_carte (oid, paiement_id, cible, montant, created_by) VALUES (?,?,?,?,?)`,
    [oid, p.id, cible, montant.toFixed(2), req.user.id]);
  const reference = `CB-${String(p.date_paiement).slice(0, 4)}-${String(r.insertId).padStart(6, '0')}`;
  await query('UPDATE paiements_carte SET reference = ? WHERE id = ?', [reference, r.insertId]);

  const form = cmi.buildPaymentForm({ oid, montant,
    client: { nom: p.souscripteur, tel: p.telephone || '' },
    libelle: `${cible === 'avance' ? 'Avance' : 'Solde'} ${p.reference} — police ${p.num_police}` });
  await audit(req.user.id, 'carte_initiee', `carte:${reference}`, { paiement: p.reference, cible, montant }, req.ip);
  res.json({ reference, montant: montant.toFixed(2), form, simulateur: config.cmi.simulator });
}));

router.get('/:reference/recu.pdf', wrap(async (req, res) => {
  const p = await one(`${select} WHERE p.reference = ?`, [clean(req.params.reference, 30)]);
  if (!p) return res.status(404).type('text').send('Paiement introuvable.');
  p.cartes = await query(`SELECT * FROM paiements_carte WHERE paiement_id = ? AND statut = 'paye' ORDER BY id`, [p.id]);
  await audit(req.user.id, 'recu_pdf', `paiement:${p.reference}`, null, req.ip);
  renderRecu(p, res);
}));

router.get('/:reference', wrap(async (req, res) => {
  const p = await one(`${select} WHERE p.reference = ?`, [clean(req.params.reference, 30)]);
  if (!p) return res.status(404).json({ error: 'Aucun paiement avec cette référence.' });
  res.json({ paiement: pub(p) });
}));

/* ---------- Validation / annulation ---------- */
router.post('/:reference/valider', adminOnly, wrap(async (req, res) => {
  const r = await query(`UPDATE paiements SET statut='valide', validated_by=?, validated_at=NOW() WHERE reference=? AND statut='en_attente'`,
    [req.user.id, clean(req.params.reference, 30)]);
  if (!r.affectedRows) return res.status(409).json({ error: 'Seul un paiement en attente peut être validé.' });
  await audit(req.user.id, 'paiement_validation', `paiement:${req.params.reference}`, null, req.ip);
  res.json({ ok: true });
}));

router.post('/:reference/annuler', adminOnly, wrap(async (req, res) => {
  const motif = clean(req.body.motif, 255);
  if (motif.length < 5) return res.status(400).json({ error: 'Indiquez le motif de l\'annulation (5 caractères minimum).' });
  const p = await one('SELECT * FROM paiements WHERE reference = ?', [clean(req.params.reference, 30)]);
  if (!p || p.statut === 'annule') return res.status(409).json({ error: 'Ce paiement est déjà annulé ou introuvable.' });

  const conn = await pool.getConnection();
  let compensations = [];
  try {
    await caisse.withCaisseLock(conn, async () => {
      const [mvts] = await conn.execute(`SELECT * FROM caisse_mouvements WHERE paiement_id = ? AND sens = 'entree' AND statut = 'valide'`, [p.id]);
      const d = caisse.today();
      const needCompensation = [];
      for (const m of mvts) if (await caisse.isClosed(conn, m.date_mouvement)) needCompensation.push(m);
      if (needCompensation.length && await caisse.isClosed(conn, d))
        return Promise.reject(Object.assign(new Error('Des espèces de ce paiement sont dans une caisse clôturée et la caisse d\'aujourd\'hui est aussi clôturée : annulation impossible avant demain.'), { status: 409 }));
      await conn.beginTransaction();
      await conn.execute(`UPDATE paiements SET statut='annule', motif_annulation=?, cancelled_by=?, cancelled_at=NOW() WHERE id=?`, [motif, req.user.id, p.id]);
      for (const m of mvts) {
        if (needCompensation.includes(m)) {
          // Jour déjà clôturé : on ne touche pas au passé, on rend l'argent par une sortie datée d'aujourd'hui
          const c = await caisse.insertMouvement(conn, { sens: 'sortie', categorie: 'annulation_paiement', montant: m.montant,
            motif: `Annulation ${p.reference} (${m.reference}) — ${motif}`.slice(0, 255), beneficiaire: p.souscripteur, paiementId: p.id, date: d, userId: req.user.id });
          compensations.push(c.reference);
        } else {
          await conn.execute(`UPDATE caisse_mouvements SET statut='annule', motif_annulation=?, cancelled_by=?, cancelled_at=NOW() WHERE id=?`,
            [`Paiement annulé : ${motif}`.slice(0, 255), req.user.id, m.id]);
        }
      }
      await conn.commit();
    });
  } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
  await audit(req.user.id, 'paiement_annulation', `paiement:${p.reference}`, { motif, compensations }, req.ip);
  res.json({ ok: true, compensations });
}));

module.exports = router;
