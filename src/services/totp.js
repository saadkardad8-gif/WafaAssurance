/**
 * Codes de vérification à 6 chiffres générés par une application d'authentification
 * (norme TOTP, RFC 6238) : iPhone (Réglages → Mots de passe), Google Authenticator,
 * Microsoft Authenticator, Authy… Gratuit, hors ligne, sans SMS.
 */
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;          // durée d'un code, en secondes
const WINDOW = 1;         // tolérance : ±30 s (décalage d'horloge)

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of String(str).toUpperCase().replace(/[\s=]/g, '')) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('Secret invalide.');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const generateSecret = () => base32Encode(crypto.randomBytes(20));

function codeForStep(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counter.writeUInt32BE(step % 2 ** 32, 4);
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** Vérifie un code. Retourne le pas de temps utilisé (pour empêcher sa réutilisation) ou null. */
function verify(secret, code, lastStep = 0) {
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return null;
  const now = Math.floor(Date.now() / 1000 / STEP);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const step = now + d;
    if (step <= Number(lastStep)) continue;          // code déjà utilisé
    const expected = codeForStep(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)))) return step;
  }
  return null;
}

/** URL à encoder dans le QR code affiché à l'utilisateur. */
const otpauthUrl = (secret, email, issuer = 'Ahl Al Khair Pay') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;

module.exports = { generateSecret, verify, otpauthUrl, codeForStep, base32Encode, base32Decode, STEP };
