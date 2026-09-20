// Crée le premier compte Super admin :
//   npm run admin:create -- "Nom Prénom" admin@domaine.ma 0661234567 "MotDePasse123"
const bcrypt = require('bcryptjs');
const { query, one, pool } = require('../src/db');
const { normalizePhone } = require('../src/services/sms');

(async () => {
  const [name, email, phoneRaw, password] = process.argv.slice(2);
  const phone = normalizePhone(phoneRaw);
  if (!name || !email || !phone || !password || password.length < 8) {
    console.log('Usage : npm run admin:create -- "Nom Prénom" email téléphone "motdepasse(8+ caractères)"');
    process.exit(1);
  }
  if (await one('SELECT id FROM users WHERE email = ?', [email.toLowerCase()])) {
    console.log('❌ Un compte existe déjà avec cet e-mail.'); process.exit(1);
  }
  await query(`INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('admin',?,?,?,?,'active')`,
    [name, email.toLowerCase(), phone, await bcrypt.hash(password, 12)]);
  console.log(`✅ Super admin créé : ${email} (les codes SMS seront envoyés au ${phone})`);
  await pool.end();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
