/**
 * Routes appelées par le CMI.
 *  - POST /cmi/callback : appel serveur à serveur, source de vérité du paiement.
 *  - POST /cmi/ok, /cmi/fail : retour du navigateur du client ; on n'y fait confiance à rien, on lit la base.
 */
const express = require('express');
const { pool, one, audit } = require('../db');
const cmi = require('../services/cmi');
const { clean, wrap } = require('../util');

const router = express.Router();
router.use(express.urlencoded({ extended: false, limit: '50kb' }));

router.post('/callback', wrap(async (req, res) => {
  const b = req.body;
  res.type('text/plain');
  if (!cmi.verifyHash(b)) {
    await audit(null, 'cmi_signature_invalide', `oid:${clean(b.oid, 40)}`, null, req.ip);
    return res.send('FAILURE');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.execute('SELECT * FROM paiements_carte WHERE oid = ? FOR UPDATE', [clean(b.oid, 40)]);
    if (!t) { await conn.rollback(); return res.send('FAILURE'); }
    if (t.statut === 'paye') { await conn.commit(); return res.send('ACTION=POSTAUTH'); }  // rappel déjà traité

    const accepte = b.ProcReturnCode === '00' && String(b.Response).toLowerCase() === 'approved';
    const montantOk = Math.abs(Number(b.amount) - Number(t.montant)) < 0.005;

    if (accepte && montantOk) {
      await conn.execute(`UPDATE paiements_carte SET statut='paye', paye_at=NOW(), trans_id=?, auth_code=?, code_retour=?,
        masked_pan=?, reseau=?, message_erreur=NULL WHERE id=?`,
        [clean(b.TransId, 64) || null, clean(b.AuthCode, 20) || null, clean(b.ProcReturnCode, 10),
          clean(b.MaskedPan, 25) || null, cmi.reseau(b.MaskedPan), t.id]);
      await conn.commit();
      await audit(t.created_by, 'carte_payee', `carte:${t.reference}`, { transId: b.TransId }, req.ip);
      return res.send('ACTION=POSTAUTH');
    }
    await conn.execute(`UPDATE paiements_carte SET statut='echoue', code_retour=?, message_erreur=? WHERE id=?`,
      [clean(b.ProcReturnCode, 10) || null,
        clean(montantOk ? (b.ErrMsg || b.mdErrorMsg || 'Paiement refusé par la banque') : 'Montant incohérent', 255), t.id]);
    await conn.commit();
    await audit(t.created_by, 'carte_echouee', `carte:${t.reference}`, { code: b.ProcReturnCode }, req.ip);
    return res.send('APPROVED');
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally { conn.release(); }
}));

// Retour du navigateur : page intermédiaire pour que la navigation reparte de notre domaine (le cookie de session suit)
async function retour(req, res) {
  const t = await one(`SELECT p.reference FROM paiements_carte c JOIN paiements p ON p.id = c.paiement_id WHERE c.oid = ?`,
    [clean(req.body.oid, 40)]);
  const cible = t ? `/#/paiement/${encodeURIComponent(t.reference)}?carte=1` : '/#/paiements';
  res.type('html').send(`<!doctype html><html lang="fr"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="0;url=${cible}"><title>Retour…</title>
    <p style="font-family:system-ui,sans-serif;text-align:center;margin-top:18vh">Retour vers Ahl Al Khair Pay…<br>
    <a href="${cible}">Continuer</a></p></html>`);
}
router.post('/ok', wrap(retour));
router.post('/fail', wrap(retour));

module.exports = router;
