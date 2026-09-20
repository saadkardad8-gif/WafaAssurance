const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { query, one, audit } = require('../db');
const otp = require('../services/otp');
const totp = require('../services/totp');
const QRCode = require('qrcode');
const { setSession, clearSession, requireAuth } = require('../middleware/auth');
const { clean, isStrongPassword, wrap } = require('../util');

const router = express.Router();
// Protection contre les essais de mots de passe. En développement la limite est plus large
// (100 par défaut) ; réglable avec LOGIN_RATE_LIMIT dans .env, et remise à zéro au redémarrage.
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.loginRateLimit, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes ou redémarrez le serveur.' } });
const DUMMY_HASH = bcrypt.hashSync('compte-inexistant', 12); // temps de réponse identique si l'e-mail n'existe pas
const hint = p => p.slice(0, 6) + '••••' + p.slice(-2);

// Étape 1 : e-mail + mot de passe → envoi d'un code SMS
router.post('/login', limiter, wrap(async (req, res) => {
  const email = clean(req.body.email, 190).toLowerCase(), password = String(req.body.password || '');
  const user = await one('SELECT *, (locked_until > NOW()) AS locked FROM users WHERE email = ?', [email]);
  const generic = { error: 'E-mail ou mot de passe incorrect.' };
  if (!user) { await bcrypt.compare(password, DUMMY_HASH); return res.status(401).json(generic); }
  if (user.locked) return res.status(423).json({ error: 'Compte bloqué 15 minutes après plusieurs échecs.' });
  if (!(await bcrypt.compare(password, user.password_hash))) {
    await query(`UPDATE users SET failed_logins = failed_logins + 1,
      locked_until = IF(failed_logins >= 5, DATE_ADD(NOW(), INTERVAL 15 MINUTE), locked_until) WHERE id = ?`, [user.id]);
    await audit(user.id, 'login_echec', `user:${user.id}`, null, req.ip);
    return res.status(401).json(generic);
  }
  if (user.status !== 'active') return res.status(403).json({ error: 'Ce compte est désactivé. Contactez l\'administrateur.' });
  await query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', [user.id]);
  if (user.totp_enabled) {
    // Code généré par l'application d'authentification du téléphone : aucun SMS n'est envoyé
    return res.json({ challengeId: await otp.createTotpChallenge(user), method: 'totp' });
  }
  const challengeId = await otp.createChallenge(user);
  res.json({ challengeId, method: 'sms', phoneHint: hint(user.phone) });
}));

// Étape 2 : code SMS → session
router.post('/verify-otp', limiter, wrap(async (req, res) => {
  const r = await otp.verify(clean(req.body.challengeId, 36), clean(req.body.code, 6));
  if (r.error) return res.status(400).json({ error: r.error });
  const user = await one('SELECT id, role, full_name, email, status FROM users WHERE id = ?', [r.userId]);
  if (!user || user.status !== 'active') return res.status(403).json({ error: 'Ce compte est désactivé.' });
  await query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  setSession(res, user);
  await audit(user.id, 'login', `user:${user.id}`, null, req.ip);
  res.json({ ok: true });
}));

router.post('/resend-otp', limiter, wrap(async (req, res) => {
  const r = await otp.resend(clean(req.body.challengeId, 36));
  if (r.error) return res.status(400).json(r);
  res.json({ ok: true });
}));

router.post('/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({ user: { id: u.id, role: u.role, fullName: u.full_name, email: u.email, phone: u.phone,
    lastLoginAt: u.last_login_at, method: u.totp_enabled ? 'totp' : 'sms' } });
});

/* ---------- Application d'authentification (TOTP) ---------- */
// Étape 1 : génère un secret (pas encore actif) et le QR code à scanner
router.post('/totp/setup', requireAuth, limiter, wrap(async (req, res) => {
  const secret = totp.generateSecret();
  await query('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', [secret, req.user.id]);
  const url = totp.otpauthUrl(secret, req.user.email);
  res.json({ secret, url, qr: await QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: '#1D4A2C', light: '#FFFFFF' } }) });
}));

// Étape 2 : l'utilisateur saisit un code de son application pour confirmer
router.post('/totp/enable', requireAuth, limiter, wrap(async (req, res) => {
  const u = await one('SELECT totp_secret, totp_last_step FROM users WHERE id = ?', [req.user.id]);
  if (!u.totp_secret) return res.status(400).json({ error: 'Commencez par afficher le QR code.' });
  const step = totp.verify(u.totp_secret, clean(req.body.code, 6), u.totp_last_step);
  if (!step) return res.status(400).json({ error: 'Code incorrect. Vérifiez l\'heure de votre téléphone et réessayez.' });
  await query('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?', [step, req.user.id]);
  await audit(req.user.id, 'totp_active', `user:${req.user.id}`, null, req.ip);
  res.json({ ok: true });
}));

// Retour au code par SMS (mot de passe exigé)
router.post('/totp/disable', requireAuth, limiter, wrap(async (req, res) => {
  const u = await one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body.password || ''), u.password_hash)))
    return res.status(400).json({ error: 'Mot de passe incorrect.' });
  await query('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [req.user.id]);
  await audit(req.user.id, 'totp_desactive', `user:${req.user.id}`, null, req.ip);
  res.json({ ok: true });
}));

router.post('/password', requireAuth, limiter, wrap(async (req, res) => {
  const u = await one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body.current || ''), u.password_hash))) return res.status(400).json({ error: 'Le mot de passe actuel est incorrect.' });
  if (!isStrongPassword(req.body.next)) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères, avec lettres et chiffres.' });
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(req.body.next, 12), req.user.id]);
  await audit(req.user.id, 'mot_de_passe', `user:${req.user.id}`, null, req.ip);
  res.json({ ok: true });
}));

module.exports = router;
