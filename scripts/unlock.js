// Débloque un compte après plusieurs mots de passe erronés :
//   npm run admin:unlock                  → débloque tous les comptes
//   npm run admin:unlock -- email@x.ma    → débloque un seul compte
const { query, pool } = require('../src/db');

(async () => {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const r = email
    ? await query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE email = ?', [email])
    : await query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE failed_logins > 0 OR locked_until IS NOT NULL');
  if (email && !r.affectedRows) console.log(`⚠️  Aucun compte avec l'e-mail ${email}.`);
  else console.log(`✅ ${r.affectedRows} compte(s) débloqué(s). Redémarrez le serveur (npm start) pour remettre aussi le compteur de tentatives à zéro.`);
  await pool.end();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
