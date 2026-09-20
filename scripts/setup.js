// Assistant d'installation : crée le fichier .env avec des secrets générés automatiquement.
//   npm run setup
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q, def) => {
    process.stdout.write(`${q}${def !== undefined && def !== '' ? ` [${def}]` : ''} : `);
    const { value, done } = await lines.next();
    if (!process.stdin.isTTY) process.stdout.write('\n');
    return (done ? '' : String(value).trim()) || def || '';
  };

  if (fs.existsSync(ENV_FILE)) {
    const r = await ask('Un fichier .env existe déjà. Le remplacer ? (o/n)', 'n');
    if (!/^o/i.test(r)) { console.log('Rien n\'a été modifié.'); rl.close(); return; }
  }
  if (fs.existsSync(ENV_FILE + '.txt')) console.log('ℹ️  Un fichier .env.txt a été trouvé : il sera ignoré, vous pouvez le supprimer.');

  console.log('\n=== Base de données MySQL ===');
  const dbHost = await ask('Hôte MySQL', 'localhost');
  const dbPort = await ask('Port MySQL', '3306');
  const dbUser = await ask('Utilisateur MySQL', 'root');
  const dbPass = await ask('Mot de passe MySQL (vide si XAMPP par défaut)', '');
  const dbName = await ask('Nom de la base', 'aak_pay');
  const port = await ask('\nPort de l\'application', '3000');
  rl.close();

  const secret = () => crypto.randomBytes(48).toString('hex');
  const env = `# Généré par npm run setup le ${new Date().toLocaleString('fr-FR')}
NODE_ENV=development
PORT=${port}
APP_URL=http://localhost:${port}
JWT_SECRET=${secret()}
OTP_SECRET=${secret()}

DB_HOST=${dbHost}
DB_PORT=${dbPort}
DB_USER=${dbUser}
DB_PASSWORD=${dbPass}
DB_NAME=${dbName}

# Tentatives de connexion par 15 min et par IP (mettre 20 en production)
LOGIN_RATE_LIMIT=100

# console = le code SMS s'affiche dans le terminal (tests). En production : twilio ou infobip
SMS_PROVIDER=console
SMS_SENDER=AhlAlKhair
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
INFOBIP_BASE_URL=
INFOBIP_API_KEY=
`;
  fs.writeFileSync(ENV_FILE, env, 'utf8');
  console.log(`\n✅ Fichier .env créé : ${ENV_FILE}`);

  // Création de la base si elle n'existe pas
  try {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({ host: dbHost, port: Number(dbPort), user: dbUser, password: dbPass });
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.end();
    console.log(`✅ Base « ${dbName} » prête.`);
    console.log('\nÉtapes suivantes :\n  npm run db:init\n  npm run admin:create -- "Votre Nom" email 06XXXXXXXX "MotDePasse123"\n  npm start\n');
  } catch (e) {
    console.log(`\n⚠️  Connexion à MySQL impossible : ${e.message}`);
    console.log('   Vérifiez que MySQL est démarré (XAMPP : bouton Start sur MySQL) et le mot de passe, puis relancez npm run setup.\n');
  }
})();
