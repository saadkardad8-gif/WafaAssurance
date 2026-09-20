// Crée ou met à jour les tables : npm run db:init
const config = require('../src/config');
const { migrate } = require('../src/migrate');

migrate()
  .then(() => console.log('✅ Base de données à jour :', config.db.database))
  .catch(e => { console.error('❌', e.message); process.exit(1); });
