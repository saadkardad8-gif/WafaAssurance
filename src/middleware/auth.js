const jwt = require('jsonwebtoken');
const config = require('../config');
const { one } = require('../db');

const COOKIE = 'aak_session';

function setSession(res, user) {
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: '8h' });
  res.cookie(COOKIE, token, { httpOnly: true, secure: config.isProd, sameSite: 'strict', maxAge: 8 * 3600 * 1000, path: '/' });
}
const clearSession = res => res.clearCookie(COOKIE, { path: '/' });

async function requireAuth(req, res, next) {
  try {
    const { sub } = jwt.verify(req.cookies[COOKIE] || '', config.jwtSecret);
    const user = await one('SELECT id, role, full_name, email, phone, status, totp_enabled, last_login_at, created_at FROM users WHERE id = ?', [sub]);
    if (!user || user.status !== 'active') { clearSession(res); return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' }); }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Vous n\'avez pas les droits pour cette action.' });

function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'AAKPay') return res.status(403).json({ error: 'Requête refusée.' });
  next();
}

module.exports = { setSession, clearSession, requireAuth, requireRole, csrfGuard };
