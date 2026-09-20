const express = require('express');
const bcrypt = require('bcryptjs');
const { query, audit } = require('../db');
const { normalizePhone } = require('../services/sms');
const { requireAuth, requireRole } = require('../middleware/auth');
const { clean, isEmail, isStrongPassword, wrap } = require('../util');

const router = express.Router();
router.use(requireAuth);
const ROLES = ['admin', 'agent', 'auditeur'];

/* ---------- Tableau de bord & statistiques ---------- */
router.get('/stats', wrap(async (req, res) => {
  const [k] = await query(`SELECT
      COALESCE(SUM(CASE WHEN date_paiement = CURDATE() THEN avance END),0) AS avanceJour,
      SUM(date_paiement = CURDATE()) AS nbJour,
      COALESCE(SUM(CASE WHEN YEAR(date_paiement)=YEAR(CURDATE()) AND MONTH(date_paiement)=MONTH(CURDATE()) THEN avance END),0) AS avanceMois,
      COALESCE(SUM(CASE WHEN YEAR(date_paiement)=YEAR(CURDATE()) AND MONTH(date_paiement)=MONTH(CURDATE()) THEN total_ttc END),0) AS ttcMois,
      COALESCE(SUM(reste_a_payer),0) AS resteTotal,
      COALESCE(SUM(CASE WHEN mode_reste='virement' THEN reste_a_payer END),0) AS resteVirement,
      COALESCE(SUM(CASE WHEN mode_reste='espece' THEN reste_a_payer END),0) AS resteEspece,
      COUNT(*) AS nb
    FROM paiements WHERE statut <> 'annule'`);
  const [s] = await query(`SELECT SUM(statut='en_attente') AS enAttente, SUM(statut='valide') AS valides, SUM(statut='annule') AS annules FROM paiements`);
  const daily = await query(`SELECT date_paiement AS jour, SUM(total_ttc) AS ttc, SUM(avance) AS avance, COUNT(*) AS n FROM paiements
    WHERE statut <> 'annule' AND date_paiement >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) GROUP BY date_paiement ORDER BY date_paiement`);
  const topAgents = await query(`SELECT u.full_name AS agent, COUNT(*) AS n, SUM(p.avance) AS avance FROM paiements p JOIN users u ON u.id=p.created_by
    WHERE p.statut <> 'annule' AND p.date_paiement >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY u.id ORDER BY avance DESC LIMIT 5`);
  const byType = await query(`SELECT type_assurance AS type, COUNT(*) AS n, SUM(total_ttc) AS ttc FROM paiements
    WHERE statut <> 'annule' GROUP BY type_assurance ORDER BY ttc DESC`);
  res.json({ kpis: { ...k, ...s }, daily, topAgents, byType });
}));

/* ---------- Souscripteurs (regroupés à partir des paiements) ---------- */
router.get('/souscripteurs', wrap(async (req, res) => {
  const q = clean(req.query.q, 80);
  const rows = await query(`SELECT souscripteur,
      SUBSTRING_INDEX(GROUP_CONCAT(telephone ORDER BY id DESC SEPARATOR ','), ',', 1) AS telephone,
      GROUP_CONCAT(DISTINCT num_police ORDER BY num_police SEPARATOR ', ') AS polices, COUNT(*) AS n, SUM(total_ttc) AS ttc, SUM(avance) AS avance, SUM(reste_a_payer) AS reste,
      MAX(date_paiement) AS dernier FROM paiements WHERE statut <> 'annule' ${q ? 'AND souscripteur LIKE ?' : ''}
    GROUP BY souscripteur ORDER BY dernier DESC LIMIT ${req.query.suggest ? 8 : 500}`, q ? [`%${q}%`] : []);
  res.json({ souscripteurs: rows });
}));

/* ---------- Utilisateurs ---------- */
router.get('/users', requireRole('admin'), wrap(async (req, res) => {
  res.json({ users: await query(`SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.totp_enabled, u.last_login_at, u.created_at,
    (SELECT COUNT(*) FROM paiements p WHERE p.created_by = u.id) AS nb_saisies FROM users u ORDER BY u.created_at`) });
}));

router.post('/users', requireRole('admin'), wrap(async (req, res) => {
  const fullName = clean(req.body.fullName, 120), email = clean(req.body.email, 190).toLowerCase(), phone = normalizePhone(req.body.phone);
  const role = ROLES.includes(req.body.role) ? req.body.role : 'agent';
  const fields = {};
  if (fullName.length < 3) fields.fullName = 'Nom complet obligatoire.';
  if (!isEmail(email)) fields.email = 'E-mail invalide.';
  if (!phone) fields.phone = 'Téléphone invalide (ex. 0661234567). Les codes de connexion y seront envoyés.';
  if (!isStrongPassword(req.body.password)) fields.password = '8 caractères minimum, lettres et chiffres.';
  if (Object.keys(fields).length) return res.status(400).json({ error: 'Vérifiez les champs signalés.', fields });
  if ((await query('SELECT id FROM users WHERE email = ?', [email])).length) return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.', fields: { email: 'Déjà utilisé.' } });
  const r = await query(`INSERT INTO users (role, full_name, email, phone, password_hash) VALUES (?,?,?,?,?)`,
    [role, fullName, email, phone, await bcrypt.hash(req.body.password, 12)]);
  await audit(req.user.id, 'utilisateur_creation', `user:${r.insertId}`, { email, role }, req.ip);
  res.status(201).json({ id: r.insertId });
}));

router.patch('/users/:id', requireRole('admin'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle ou accès.' });
  const sets = [], params = [];
  if (ROLES.includes(req.body.role)) { sets.push('role = ?'); params.push(req.body.role); }
  if (['active', 'suspended'].includes(req.body.status)) { sets.push('status = ?'); params.push(req.body.status); }
  if (!sets.length) return res.status(400).json({ error: 'Rien à modifier.' });
  const r = await query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  await audit(req.user.id, 'utilisateur_modification', `user:${id}`, req.body, req.ip);
  res.json({ ok: true });
}));

router.get('/audit', requireRole('admin'), wrap(async (req, res) => {
  res.json({ logs: await query(`SELECT a.id, a.action, a.target, a.details, a.ip, a.created_at, u.full_name AS actor
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 300`) });
}));

module.exports = router;
