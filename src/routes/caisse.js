const express = require('express');
const { pool, query, one, audit } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const caisse = require('../services/caisse');
const { renderBonCaisse, renderPvCloture } = require('../services/recu-pdf');
const { CATEGORIES_CAISSE, COUPURES } = require('../constants');
const { clean, toCents, centsToDecimal, isValidDate, wrap } = require('../util');

const router = express.Router();
router.use(requireAuth);
const canSaisir = requireRole('admin', 'agent');
const adminOnly = requireRole('admin');
const httpError = (status, message, fields) => Object.assign(new Error(message), { status, fields });

const mvtSelect = `SELECT m.*, u.full_name AS agent, a.full_name AS annule_par, p.reference AS paiement_ref
  FROM caisse_mouvements m JOIN users u ON u.id = m.created_by LEFT JOIN users a ON a.id = m.cancelled_by LEFT JOIN paiements p ON p.id = m.paiement_id`;
const mvtPub = m => ({ reference: m.reference, sens: m.sens, categorie: m.categorie, categorieLabel: CATEGORIES_CAISSE[m.categorie].label,
  montant: m.montant, motif: m.motif, beneficiaire: m.beneficiaire, paiementRef: m.paiement_ref, date: m.date_mouvement, statut: m.statut,
  motifAnnulation: m.motif_annulation, agent: m.agent, annulePar: m.annule_par, cancelledAt: m.cancelled_at, createdAt: m.created_at,
  auto: !!CATEGORIES_CAISSE[m.categorie].auto });

/* ---------- Résumé ---------- */
router.get('/resume', wrap(async (req, res) => {
  const d = caisse.today();
  const conn = await pool.getConnection();
  try {
    const soldeActuel = await caisse.solde(conn);
    const ouverture = await caisse.solde(conn, d);
    const jour = await caisse.totauxJour(conn, d);
    const [[clotureJour]] = await conn.execute('SELECT id, statut, ecart FROM caisse_clotures WHERE date_cloture = ?', [d]);
    const [[derniere]] = await conn.execute('SELECT date_cloture, statut, ecart FROM caisse_clotures ORDER BY date_cloture DESC LIMIT 1');
    const [[attente]] = await conn.execute(`SELECT COUNT(*) AS n FROM caisse_clotures WHERE statut = 'en_attente'`);
    const [[nonCloture]] = await conn.execute(`SELECT MIN(m.date_mouvement) AS d FROM caisse_mouvements m
      LEFT JOIN caisse_clotures c ON c.date_cloture = m.date_mouvement WHERE c.id IS NULL AND m.date_mouvement < ?`, [d]);
    res.json({ date: d, soldeActuel, ouverture, jour, clotureJour: clotureJour || null, derniereCloture: derniere || null,
      cloturesEnAttente: attente.n, jourNonCloture: nonCloture.d || null });
  } finally { conn.release(); }
}));

/* ---------- Mouvements ---------- */
router.get('/mouvements', wrap(async (req, res) => {
  const where = [], params = [], q = req.query;
  if (isValidDate(q.du)) { where.push('m.date_mouvement >= ?'); params.push(q.du); }
  if (isValidDate(q.au)) { where.push('m.date_mouvement <= ?'); params.push(q.au); }
  if (['entree', 'sortie'].includes(q.sens)) { where.push('m.sens = ?'); params.push(q.sens); }
  if (Object.hasOwn(CATEGORIES_CAISSE, q.categorie)) { where.push('m.categorie = ?'); params.push(q.categorie); }
  if (['valide', 'annule'].includes(q.statut)) { where.push('m.statut = ?'); params.push(q.statut); }
  const s = clean(q.q, 80);
  if (s) { where.push('(m.reference LIKE ? OR m.motif LIKE ? OR m.beneficiaire LIKE ? OR p.reference LIKE ?)'); params.push(...Array(4).fill(`%${s}%`)); }
  const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await query(`${mvtSelect} ${sql} ORDER BY m.date_mouvement DESC, m.id DESC LIMIT 500`, params);
  const [t] = await query(`SELECT COALESCE(SUM(CASE WHEN m.sens='entree' THEN m.montant END),0) AS entrees,
    COALESCE(SUM(CASE WHEN m.sens='sortie' THEN m.montant END),0) AS sorties, COUNT(*) AS n
    FROM caisse_mouvements m LEFT JOIN paiements p ON p.id = m.paiement_id ${sql ? sql + " AND m.statut='valide'" : "WHERE m.statut='valide'"}`, params);
  res.json({ mouvements: rows.map(mvtPub), totals: t });
}));

router.post('/mouvements', canSaisir, wrap(async (req, res) => {
  const b = req.body, fields = {};
  const sens = ['entree', 'sortie'].includes(b.sens) ? b.sens : null;
  const cat = CATEGORIES_CAISSE[b.categorie];
  const cents = toCents(b.montant);
  const motif = clean(b.motif, 255), beneficiaire = clean(b.beneficiaire, 150);
  const date = String(b.date || caisse.today());
  const paiementRef = clean(b.paiementRef, 30).toUpperCase();

  if (!sens) fields.sens = 'Choisissez entrée ou sortie.';
  if (!cat || cat.sens !== sens || cat.auto) fields.categorie = 'Choisissez une catégorie valide.';
  if (cents === null || !(cents > 0)) fields.montant = 'Saisissez un montant supérieur à 0.';
  if (motif.length < 3) fields.motif = 'Indiquez le motif (3 caractères minimum).';
  if (!isValidDate(date)) fields.date = 'Date invalide.';
  else if (date > caisse.today()) fields.date = 'La date ne peut pas être dans le futur.';
  if (b.categorie === 'remboursement_client' && beneficiaire.length < 3) fields.beneficiaire = 'Indiquez le nom du client remboursé.';
  if (b.categorie === 'encaissement_reste' && !paiementRef) fields.paiementRef = 'Indiquez la référence du paiement (AAK-…).';
  if (Object.keys(fields).length) throw httpError(400, 'Vérifiez les champs signalés.', fields);
  const montant = centsToDecimal(cents);

  const conn = await pool.getConnection();
  let created;
  try {
    created = await caisse.withCaisseLock(conn, async () => {
      if (await caisse.isClosed(conn, date)) throw httpError(409, `La caisse du ${date} est clôturée.`, { date: 'Caisse clôturée pour cette date.' });

      let paiementId = null, benef = beneficiaire || null;
      if (paiementRef) {
        const [[p]] = await conn.execute(`SELECT p.*, (SELECT COALESCE(SUM(montant),0) FROM caisse_mouvements
          WHERE paiement_id = p.id AND categorie = 'encaissement_reste' AND statut = 'valide') AS deja FROM paiements p WHERE reference = ?`, [paiementRef]);
        if (!p) throw httpError(404, 'Aucun paiement avec cette référence.', { paiementRef: 'Référence introuvable.' });
        if (p.statut === 'annule') throw httpError(409, 'Ce paiement est annulé.', { paiementRef: 'Paiement annulé.' });
        if (b.categorie === 'encaissement_reste') {
          const restant = Math.round((Number(p.reste_a_payer) - Number(p.deja)) * 100);
          if (restant <= 0) throw httpError(409, 'Le reste de ce paiement est déjà entièrement encaissé.', { paiementRef: 'Reste déjà encaissé.' });
          if (cents > restant) throw httpError(400, `Le montant dépasse le reste à encaisser (${centsToDecimal(restant).replace('.', ',')} DH).`, { montant: 'Montant supérieur au reste.' });
        }
        paiementId = p.id; benef = benef || p.souscripteur;
      }
      if (sens === 'sortie') {
        const solde = await caisse.solde(conn);
        if (Number(montant) > solde) throw httpError(409, `Solde de caisse insuffisant : ${solde.toFixed(2).replace('.', ',')} DH disponibles.`, { montant: 'Supérieur au solde de caisse.' });
      }
      await conn.beginTransaction();
      const m = await caisse.insertMouvement(conn, { sens, categorie: b.categorie, montant, motif, beneficiaire: benef, paiementId, date, userId: req.user.id });
      await conn.commit();
      return m;
    });
  } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
  await audit(req.user.id, 'caisse_mouvement', `caisse:${created.reference}`, { sens, categorie: b.categorie, montant }, req.ip);
  res.status(201).json({ mouvement: mvtPub(await one(`${mvtSelect} WHERE m.id = ?`, [created.id])) });
}));

router.get('/mouvements/:reference', wrap(async (req, res) => {
  const m = await one(`${mvtSelect} WHERE m.reference = ?`, [clean(req.params.reference, 30)]);
  if (!m) throw httpError(404, 'Mouvement introuvable.');
  const closed = await one('SELECT id FROM caisse_clotures WHERE date_cloture = ?', [m.date_mouvement]);
  res.json({ mouvement: { ...mvtPub(m), jourCloture: !!closed } });
}));

router.get('/mouvements/:reference/bon.pdf', wrap(async (req, res) => {
  const m = await one(`${mvtSelect} WHERE m.reference = ?`, [clean(req.params.reference, 30)]);
  if (!m) return res.status(404).type('text').send('Mouvement introuvable.');
  renderBonCaisse({ ...m, categorie_label: CATEGORIES_CAISSE[m.categorie].label }, res);
}));

router.post('/mouvements/:reference/annuler', adminOnly, wrap(async (req, res) => {
  const motif = clean(req.body.motif, 255);
  if (motif.length < 5) throw httpError(400, 'Indiquez le motif de l\'annulation (5 caractères minimum).');
  const conn = await pool.getConnection();
  try {
    await caisse.withCaisseLock(conn, async () => {
      const [[m]] = await conn.execute('SELECT * FROM caisse_mouvements WHERE reference = ?', [clean(req.params.reference, 30)]);
      if (!m || m.statut === 'annule') throw httpError(409, 'Mouvement introuvable ou déjà annulé.');
      if (CATEGORIES_CAISSE[m.categorie].auto) throw httpError(409, 'Ce mouvement est lié à un paiement : annulez ou modifiez le paiement.');
      if (await caisse.isClosed(conn, m.date_mouvement)) throw httpError(409, `La caisse du ${m.date_mouvement} est clôturée : ce mouvement ne peut plus être annulé.`);
      if (m.sens === 'entree') {
        const solde = await caisse.solde(conn);
        if (solde - Number(m.montant) < 0) throw httpError(409, 'Annuler cette entrée rendrait le solde de caisse négatif.');
      }
      await conn.execute(`UPDATE caisse_mouvements SET statut='annule', motif_annulation=?, cancelled_by=?, cancelled_at=NOW() WHERE id=?`, [motif, req.user.id, m.id]);
    });
  } finally { conn.release(); }
  await audit(req.user.id, 'caisse_annulation', `caisse:${req.params.reference}`, { motif }, req.ip);
  res.json({ ok: true });
}));

/* ---------- Clôtures ---------- */
const cloSelect = `SELECT c.*, u.full_name AS agent, v.full_name AS validateur FROM caisse_clotures c
  JOIN users u ON u.id = c.created_by LEFT JOIN users v ON v.id = c.validated_by`;
const cloPub = c => ({ id: c.id, date: c.date_cloture, soldeOuverture: c.solde_ouverture, totalEntrees: c.total_entrees, totalSorties: c.total_sorties,
  soldeTheorique: c.solde_theorique, montantCompte: c.montant_compte, ecart: c.ecart, billetage: JSON.parse(c.billetage || '{}'),
  commentaire: c.commentaire, statut: c.statut, agent: c.agent, validateur: c.validateur, validatedAt: c.validated_at, createdAt: c.created_at });

// Chiffres attendus pour une date (avant comptage)
router.get('/clotures/preparation', wrap(async (req, res) => {
  const date = isValidDate(req.query.date) ? req.query.date : caisse.today();
  const conn = await pool.getConnection();
  try {
    const ouverture = await caisse.solde(conn, date);
    const jour = await caisse.totauxJour(conn, date);
    const [[deja]] = await conn.execute('SELECT id FROM caisse_clotures WHERE date_cloture = ?', [date]);
    const [[avant]] = await conn.execute(`SELECT MIN(m.date_mouvement) AS d FROM caisse_mouvements m
      LEFT JOIN caisse_clotures c ON c.date_cloture = m.date_mouvement WHERE c.id IS NULL AND m.date_mouvement < ?`, [date]);
    res.json({ date, ouverture, ...jour, theorique: caisse.round2(ouverture + jour.entrees - jour.sorties),
      dejaCloturee: deja ? deja.id : null, jourPrecedentNonCloture: avant.d || null, coupures: COUPURES });
  } finally { conn.release(); }
}));

router.get('/clotures', wrap(async (req, res) => {
  res.json({ clotures: (await query(`${cloSelect} ORDER BY c.date_cloture DESC LIMIT 200`)).map(cloPub) });
}));

router.post('/clotures', canSaisir, wrap(async (req, res) => {
  const date = String(req.body.date || caisse.today());
  if (!isValidDate(date) || date > caisse.today()) throw httpError(400, 'Date de clôture invalide.', { date: 'Date invalide ou future.' });
  // Montant compté recalculé à partir du billetage (en centimes)
  const billetage = {};
  let compteCents = 0;
  for (const c of COUPURES) {
    const n = Number(req.body.billetage?.[c] || 0);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw httpError(400, `Quantité invalide pour ${c} DH.`);
    if (n) { billetage[c] = n; compteCents += Math.round(Number(c) * 100) * n; }
  }
  const commentaire = clean(req.body.commentaire, 255);

  const conn = await pool.getConnection();
  let cloture;
  try {
    cloture = await caisse.withCaisseLock(conn, async () => {
      if (await caisse.isClosed(conn, date)) throw httpError(409, `La caisse du ${date} est déjà clôturée.`);
      const [[avant]] = await conn.execute(`SELECT MIN(m.date_mouvement) AS d FROM caisse_mouvements m
        LEFT JOIN caisse_clotures c ON c.date_cloture = m.date_mouvement WHERE c.id IS NULL AND m.date_mouvement < ?`, [date]);
      if (avant.d) throw httpError(409, `Clôturez d'abord la journée du ${avant.d}.`);
      const ouverture = await caisse.solde(conn, date);
      const jour = await caisse.totauxJour(conn, date);
      const theoCents = Math.round((ouverture + jour.entrees - jour.sorties) * 100);
      const ecartCents = compteCents - theoCents;
      if (ecartCents !== 0 && commentaire.length < 5) throw httpError(400, 'Un écart est constaté : expliquez-le dans le commentaire.', { commentaire: 'Commentaire obligatoire en cas d\'écart.' });
      const [r] = await conn.execute(`INSERT INTO caisse_clotures (date_cloture, solde_ouverture, total_entrees, total_sorties, solde_theorique,
          montant_compte, ecart, billetage, commentaire, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [date, ouverture.toFixed(2), jour.entrees.toFixed(2), jour.sorties.toFixed(2), centsToDecimal(theoCents),
          centsToDecimal(compteCents), (ecartCents / 100).toFixed(2), JSON.stringify(billetage), commentaire || null, req.user.id]);
      return { id: r.insertId, ecart: ecartCents / 100 };
    });
  } finally { conn.release(); }
  await audit(req.user.id, 'caisse_cloture', `cloture:${date}`, { ecart: cloture.ecart }, req.ip);
  res.status(201).json({ cloture: cloPub(await one(`${cloSelect} WHERE c.id = ?`, [cloture.id])) });
}));

router.get('/clotures/:id', wrap(async (req, res) => {
  const c = await one(`${cloSelect} WHERE c.id = ?`, [Number(req.params.id)]);
  if (!c) throw httpError(404, 'Clôture introuvable.');
  const mouvements = await query(`${mvtSelect} WHERE m.date_mouvement = ? ORDER BY m.id`, [c.date_cloture]);
  res.json({ cloture: cloPub(c), mouvements: mouvements.map(mvtPub) });
}));

router.get('/clotures/:id/pv.pdf', wrap(async (req, res) => {
  const c = await one(`${cloSelect} WHERE c.id = ?`, [Number(req.params.id)]);
  if (!c) return res.status(404).type('text').send('Clôture introuvable.');
  const mouvements = await query(`${mvtSelect} WHERE m.date_mouvement = ? AND m.statut = 'valide' ORDER BY m.id`, [c.date_cloture]);
  renderPvCloture(cloPub(c), mouvements.map(mvtPub), res);
}));

router.post('/clotures/:id/valider', adminOnly, wrap(async (req, res) => {
  const r = await query(`UPDATE caisse_clotures SET statut='validee', validated_by=?, validated_at=NOW() WHERE id=? AND statut='en_attente'`, [req.user.id, Number(req.params.id)]);
  if (!r.affectedRows) throw httpError(409, 'Seule une clôture en attente peut être validée.');
  await audit(req.user.id, 'caisse_cloture_validation', `cloture:${req.params.id}`, null, req.ip);
  res.json({ ok: true });
}));

// Rejet : la clôture est supprimée, la journée est rouverte pour un nouveau comptage
router.post('/clotures/:id/rejeter', adminOnly, wrap(async (req, res) => {
  const motif = clean(req.body.motif, 255);
  if (motif.length < 5) throw httpError(400, 'Indiquez le motif du rejet.');
  const c = await one('SELECT * FROM caisse_clotures WHERE id = ?', [Number(req.params.id)]);
  if (!c || c.statut !== 'en_attente') throw httpError(409, 'Seule une clôture en attente peut être rejetée.');
  const later = await one('SELECT date_cloture FROM caisse_clotures WHERE date_cloture > ? LIMIT 1', [c.date_cloture]);
  if (later) throw httpError(409, `La journée du ${later.date_cloture} est déjà clôturée après celle-ci : rejetez d'abord les clôtures plus récentes.`);
  await query('DELETE FROM caisse_clotures WHERE id = ?', [c.id]);
  await audit(req.user.id, 'caisse_cloture_rejet', `cloture:${c.date_cloture}`, { motif, cloture: cloPub(c) }, req.ip);
  res.json({ ok: true });
}));

module.exports = router;
