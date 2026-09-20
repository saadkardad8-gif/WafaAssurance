/**
 * Paiement par carte bancaire (Visa / Mastercard) via le CMI — Centre Monétique Interbancaire.
 * Mode 3D_PAY_HOSTING, signature « ver3 » (SHA-512).
 *
 * Le titulaire saisit sa carte sur la page sécurisée du CMI : aucun numéro de carte,
 * aucune date d'expiration et aucun CVV ne transitent par ce serveur ni ne sont stockés.
 * Vérifiez ces paramètres avec la documentation remise par le CMI à la signature du contrat.
 */
const crypto = require('crypto');
const config = require('../config');

const escapeValue = v => String(v ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

/** Hash ver3 : paramètres triés sans tenir compte de la casse, « hash » et « encoding » exclus, puis clé du magasin. */
function computeHash(params, storeKey = config.cmi.storeKey) {
  const keys = Object.keys(params)
    .filter(k => !['hash', 'encoding'].includes(k.toLowerCase()))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'));
  const plain = keys.map(k => escapeValue(params[k])).join('|') + '|' + escapeValue(storeKey);
  return crypto.createHash('sha512').update(plain, 'utf8').digest('base64');
}

function verifyHash(posted, storeKey = config.cmi.storeKey) {
  const received = posted.HASH || posted.hash;
  if (!received || !storeKey) return false;
  const a = Buffer.from(String(received)), b = Buffer.from(computeHash(posted, storeKey));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Formulaire à poster vers la page de paiement du CMI. */
function buildPaymentForm({ oid, montant, client, libelle }) {
  const base = config.appUrl;
  const fields = {
    clientid: config.cmi.clientId,
    storetype: '3D_PAY_HOSTING',
    TranType: 'PreAuth',
    amount: Number(montant).toFixed(2),
    currency: '504',                    // dirham marocain
    oid,
    okUrl: `${base}/cmi/ok`,
    failUrl: `${base}/cmi/fail`,
    callbackUrl: `${base}/cmi/callback`,
    shopurl: `${base}/`,
    lang: 'fr',
    rnd: crypto.randomBytes(10).toString('hex'),
    hashAlgorithm: 'ver3',
    encoding: 'UTF-8',
    AutoRedirect: 'true',
    CallbackResponse: 'true',
    BillToName: String(client.nom || '').slice(0, 60),
    tel: client.tel || '',
    description: String(libelle || '').slice(0, 100),
  };
  fields.HASH = computeHash(fields);
  return { action: config.cmi.gatewayUrl, fields };
}

/** Réseau de la carte d'après le numéro masqué renvoyé par le CMI. */
function reseau(maskedPan) {
  const p = String(maskedPan || '').replace(/\D/g, '');
  if (p.startsWith('4')) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(p)) return 'Mastercard';
  if (/^3[47]/.test(p)) return 'American Express';
  return 'Carte bancaire';
}

module.exports = { computeHash, verifyHash, buildPaymentForm, reseau };
