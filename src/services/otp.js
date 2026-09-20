const crypto = require('crypto');
const config = require('../config');
const { query, one } = require('../db');
const { sendSms } = require('./sms');
const totp = require('./totp');

const TTL_MIN = 5, MAX_ATTEMPTS = 5, RESEND_COOLDOWN_S = 60, MAX_SENDS = 4;

const hashCode = (id, code) => crypto.createHmac('sha256', config.otpSecret).update(`${id}:${code}`).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
const message = code => `Ahl Al Khair : votre code de connexion est ${code}. Il expire dans ${TTL_MIN} min. Ne le communiquez a personne.`;

/** Vérification par application d'authentification : aucun code n'est envoyé. */
async function createTotpChallenge(user) {
  const id = crypto.randomUUID();
  await query('UPDATE otp_challenges SET consumed_at = NOW() WHERE user_id = ? AND consumed_at IS NULL', [user.id]);
  await query(`INSERT INTO otp_challenges (id, user_id, method, code_hash, expires_at)
    VALUES (?,?, 'totp', '-', DATE_ADD(NOW(), INTERVAL 10 MINUTE))`, [id, user.id]);
  return id;
}

async function createChallenge(user) {
  const id = crypto.randomUUID(), code = newCode();
  await query('UPDATE otp_challenges SET consumed_at = NOW() WHERE user_id = ? AND consumed_at IS NULL', [user.id]);
  await query('INSERT INTO otp_challenges (id, user_id, code_hash, expires_at) VALUES (?,?,?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
    [id, user.id, hashCode(id, code), TTL_MIN]);
  await sendSms(user.phone, message(code));
  return id;
}

async function resend(id) {
  const ch = await one(`SELECT c.*, u.phone, TIMESTAMPDIFF(SECOND, c.last_sent_at, NOW()) AS since
    FROM otp_challenges c JOIN users u ON u.id = c.user_id WHERE c.id = ?`, [id]);
  if (!ch || ch.consumed_at) return { error: 'Cette vérification a expiré. Reconnectez-vous.' };
  if (ch.method === 'totp') return { error: 'Votre code est affiché dans votre application d\'authentification.' };
  if (ch.since < RESEND_COOLDOWN_S) return { error: `Patientez ${RESEND_COOLDOWN_S - ch.since} s avant de redemander un code.` };
  if (ch.sent_count >= MAX_SENDS) return { error: 'Nombre maximal d\'envois atteint. Reconnectez-vous plus tard.' };
  const code = newCode();
  await query(`UPDATE otp_challenges SET code_hash=?, attempts=0, sent_count=sent_count+1, last_sent_at=NOW(),
    expires_at=DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=?`, [hashCode(id, code), TTL_MIN, id]);
  await sendSms(ch.phone, message(code));
  return { ok: true };
}

async function verify(id, code) {
  if (!/^\d{6}$/.test(String(code || ''))) return { error: 'Le code doit contenir 6 chiffres.' };
  const ch = await one('SELECT *, (expires_at < NOW()) AS expired FROM otp_challenges WHERE id = ?', [id]);
  if (!ch || ch.consumed_at) return { error: 'Cette vérification a expiré. Reconnectez-vous.' };
  if (ch.expired) return { error: 'Le code a expiré. Reconnectez-vous.' };
  if (ch.attempts >= MAX_ATTEMPTS) return { error: 'Trop de tentatives. Reconnectez-vous.' };

  if (ch.method === 'totp') {
    const u = await one('SELECT totp_secret, totp_last_step FROM users WHERE id = ?', [ch.user_id]);
    const step = totp.verify(u && u.totp_secret, code, u && u.totp_last_step);
    if (!step) {
      await query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?', [id]);
      const left = MAX_ATTEMPTS - ch.attempts - 1;
      return { error: left > 0 ? `Code incorrect ou déjà utilisé. ${left} tentative(s) restante(s).` : 'Trop de tentatives. Reconnectez-vous.' };
    }
    await query('UPDATE users SET totp_last_step = ? WHERE id = ?', [step, ch.user_id]);
    await query('UPDATE otp_challenges SET consumed_at = NOW() WHERE id = ?', [id]);
    return { userId: ch.user_id };
  }
  const ok = crypto.timingSafeEqual(Buffer.from(ch.code_hash), Buffer.from(hashCode(id, code)));
  if (!ok) {
    await query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?', [id]);
    const left = MAX_ATTEMPTS - ch.attempts - 1;
    return { error: left > 0 ? `Code incorrect. ${left} tentative(s) restante(s).` : 'Trop de tentatives. Reconnectez-vous.' };
  }
  await query('UPDATE otp_challenges SET consumed_at = NOW() WHERE id = ?', [id]);
  return { userId: ch.user_id };
}

module.exports = { createChallenge, createTotpChallenge, resend, verify };
