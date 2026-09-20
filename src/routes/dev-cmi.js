/**
 * SIMULATEUR de la page de paiement CMI — développement et démonstration uniquement.
 * Reproduit le parcours réel : saisie de la carte, vérification 3-D Secure, « paiement validé ».
 * Aucune donnée n'est enregistrée : les champs servent uniquement à la démonstration.
 * Ce module est automatiquement désactivé dès que CMI_CLIENT_ID et CMI_STORE_KEY sont renseignés,
 * et n'est jamais monté en production (voir src/server.js).
 */
const express = require('express');
const crypto = require('crypto');
const cmi = require('../services/cmi');
const { wrap } = require('../util');

const router = express.Router();
router.use(express.urlencoded({ extended: false }));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hidden = o => Object.entries(o).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');

const STYLE = `
 *{box-sizing:border-box}
 body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#EEF1F6;color:#101828;padding:20px 14px;line-height:1.5}
 .box{max-width:470px;margin:3vh auto;background:#fff;border-radius:16px;box-shadow:0 14px 44px rgba(16,24,40,.14);overflow:hidden}
 .top{background:#0B1F3A;color:#fff;padding:16px 22px;display:flex;justify-content:space-between;align-items:center;font-size:14px}
 .top b{font-size:15px}
 .warn{background:#FFF4D6;color:#7A5200;font-size:12.5px;padding:9px 22px;font-weight:600}
 .body{padding:22px}
 h2{font-size:21px;margin:0 0 4px}
 .sub{color:#667085;font-size:13.5px;margin:0 0 18px}
 .brands{display:flex;gap:8px;align-items:center;margin:10px 0 16px}
 .brand{height:26px;padding:0 9px;border:1px solid #E4E7EC;border-radius:5px;display:flex;align-items:center;font-size:12px;font-weight:800;font-style:italic;color:#1A1F71;background:#fff}
 .brand.mc{font-style:normal;color:#EB001B;letter-spacing:-.04em}
 .lock{margin-left:auto;color:#667085;font-size:12px}
 label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
 input{width:100%;padding:12px 13px;border:1px solid #D0D5DD;border-radius:9px;font-size:16px;font-variant-numeric:tabular-nums;background:#fff}
 input:focus{outline:none;border-color:#0B7B3E;box-shadow:0 0 0 3px rgba(11,123,62,.14)}
 .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
 .amount{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #E4E7EC;padding-top:16px;margin-top:20px}
 .amount b{font-size:24px}
 button{width:100%;padding:14px;border:0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-top:14px}
 .pay{background:#0B7B3E;color:#fff}
 .no{background:#fff;color:#B42318;border:1px solid #F0C4BE;font-size:13.5px;padding:10px;margin-top:8px}
 .err{color:#B42318;font-size:13px;min-height:18px;margin-top:8px}
 .foot{font-size:11.5px;color:#98A2B3;text-align:center;margin-top:16px}
 .ok{text-align:center;padding:12px 0}
 .tick{width:74px;height:74px;border-radius:50%;background:#E7F6EC;color:#0B7B3E;font-size:38px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px}
 .ok h2{color:#0B7B3E}
 .recap{background:#F9FAFB;border-radius:10px;padding:14px;margin:18px 0;font-size:14px}
 .recap div{display:flex;justify-content:space-between;gap:10px;padding:3px 0}
 .ko .tick{background:#FEE4E2;color:#B42318}
 .ko h2{color:#B42318}
`;
const page = body => `<!doctype html><html lang="fr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Paiement sécurisé</title>
<style>${STYLE}</style>${body}</html>`;

/** Formulaire de saisie de la carte. */
router.post('/', (req, res) => {
  const f = req.body;
  if (!cmi.verifyHash(f)) return res.status(400).send(page('<div class="box"><div class="body"><h2>Signature invalide</h2><p class="sub">Le formulaire reçu n\'est pas signé correctement.</p></div></div>'));
  res.send(page(`<div class="box">
    <div class="top"><b>Paiement sécurisé</b><span>🔒 3-D Secure</span></div>
    <div class="warn">⚠️ Simulation : aucune carte n'est débitée. En production, cette page est celle du CMI.</div>
    <div class="body">
      <h2>Mode de paiement</h2>
      <p class="sub">Carte de crédit ou de débit</p>
      <div class="brands"><span class="brand">VISA</span><span class="brand mc">●●</span><span class="lock">🔒 Connexion chiffrée</span></div>
      <form method="post" action="/dev/cmi/decide" autocomplete="off">
        ${hidden(f)}
        <label for="pan">Numéro de carte</label>
        <input id="pan" name="pan" inputmode="numeric" maxlength="23" placeholder="0000 0000 0000 0000" value="4000 0000 0000 0002">
        <div class="row">
          <div><label for="exp">Date d'expiration</label><input id="exp" name="exp" inputmode="numeric" maxlength="5" placeholder="MM/AA" value="12/29"></div>
          <div><label for="cvv">Code de sécurité</label><input id="cvv" name="cvv" inputmode="numeric" maxlength="4" placeholder="CVV" value="123"></div>
        </div>
        <label for="nom">Titulaire</label>
        <input id="nom" name="nom" maxlength="60" value="${esc(f.BillToName || '')}">
        <div class="amount"><span>Montant à payer</span><b>${esc(f.amount)} MAD</b></div>
        <div style="font-size:13px;color:#667085;margin-top:6px">${esc(f.description || '')} · commande ${esc(f.oid)}</div>
        <button class="pay" name="decision" value="ok">Payer ${esc(f.amount)} MAD</button>
        <button class="no" name="decision" value="ko">Simuler un refus de la banque</button>
        <p class="foot">Simulation locale · les champs ci-dessus ne sont ni transmis ni enregistrés</p>
      </form>
    </div></div>`));
});

/** Décision de la « banque », appel du callback, puis écran de confirmation. */
router.post('/decide', wrap(async (req, res) => {
  const { decision, HASH, pan, exp, cvv, nom, ...f } = req.body;
  const digits = String(pan || '').replace(/\D/g, '');
  const ok = decision === 'ok' && digits.length >= 13;
  const masque = digits ? `${digits.slice(0, 6)}***${digits.slice(-4)}` : '400000***0002';

  const cb = {
    oid: f.oid, amount: f.amount, currency: f.currency, clientid: f.clientid,
    ProcReturnCode: ok ? '00' : '51', Response: ok ? 'Approved' : 'Declined', mdStatus: '1',
    TransId: ok ? crypto.randomBytes(6).toString('hex').toUpperCase() : '',
    AuthCode: ok ? String(crypto.randomInt(100000, 999999)) : '',
    MaskedPan: masque, ErrMsg: ok ? '' : 'Paiement refusé par la banque émettrice (simulation)',
    hashAlgorithm: 'ver3', rnd: crypto.randomBytes(8).toString('hex'),
  };
  cb.HASH = cmi.computeHash(cb);
  try {
    await fetch(f.callbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(cb) });
  } catch { /* le serveur reste la source de vérité ; l'écran suivant n'affiche que le résultat */ }

  res.send(page(`<div class="box">
    <div class="top"><b>Paiement sécurisé</b><span>🔒 3-D Secure</span></div>
    <div class="body ${ok ? '' : 'ko'}">
      <div class="ok">
        <div class="tick">${ok ? '✓' : '✕'}</div>
        <h2>${ok ? 'Paiement validé' : 'Paiement refusé'}</h2>
        <p class="sub">${ok ? 'La transaction a été autorisée par la banque.' : cb.ErrMsg}</p>
      </div>
      <div class="recap">
        <div><span>Montant</span><b>${esc(f.amount)} MAD</b></div>
        <div><span>Carte</span><b>${esc(masque)}</b></div>
        ${ok ? `<div><span>Autorisation</span><b>${esc(cb.AuthCode)}</b></div><div><span>Transaction</span><b>${esc(cb.TransId)}</b></div>` : ''}
        <div><span>Commande</span><b>${esc(f.oid)}</b></div>
      </div>
      <form method="post" action="${esc(ok ? f.okUrl : f.failUrl)}">
        ${hidden({ oid: f.oid, ProcReturnCode: cb.ProcReturnCode })}
        <button class="pay">Retourner sur Ahl Al Khair Pay</button>
      </form>
    </div></div>`));
}));

module.exports = router;
