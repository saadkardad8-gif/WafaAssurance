// Crée les tables manquantes et ajoute les colonnes des nouvelles versions.
// Appelé automatiquement au démarrage du serveur et par « npm run db:init ». Ne supprime jamais de données.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');

const MIGRATIONS = [
  ['paiements', 'telephone', "ALTER TABLE paiements ADD COLUMN telephone VARCHAR(20) NULL AFTER souscripteur"],
  ['paiements', 'num_police', "ALTER TABLE paiements ADD COLUMN num_police VARCHAR(40) NOT NULL DEFAULT '' AFTER telephone, ADD INDEX idx_pai_police (num_police)"],
  ['paiements', 'type_assurance', "ALTER TABLE paiements ADD COLUMN type_assurance ENUM('automobile','habitation','sante','vie_epargne','voyage','responsabilite_civile','multirisque_pro','autre') NOT NULL DEFAULT 'autre' AFTER num_police, ADD INDEX idx_pai_type (type_assurance)"],
  ['users', 'totp_secret', "ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64) NULL, ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN totp_last_step BIGINT UNSIGNED NOT NULL DEFAULT 0"],
  ['otp_challenges', 'method', "ALTER TABLE otp_challenges ADD COLUMN method ENUM('sms','totp') NOT NULL DEFAULT 'sms' AFTER user_id"],
  ['paiements', 'mode_avance', "ALTER TABLE paiements ADD COLUMN mode_avance ENUM('espece','virement','cheque') NULL AFTER avance"],
];

// Instructions rejouables à chaque démarrage (élargissement d'ENUM : sans effet si déjà fait)
const AJUSTEMENTS = [
  "ALTER TABLE paiements MODIFY mode_avance ENUM('espece','carte','virement','cheque') NULL",
  "ALTER TABLE paiements MODIFY mode_reste ENUM('virement','espece','carte') NULL",
];

// Erreurs « ça existe déjà » : sans danger, on continue
const DEJA = new Set([
  1050, // table déjà existante
  1060, // colonne déjà existante
  1061, // index déjà existant
  1022, 1826, 1827, // clé ou contrainte en double
  3822, // contrainte CHECK déjà existante
]);

/** Découpe le fichier SQL en instructions, sans couper à l'intérieur d'une chaîne. */
function statements(sql) {
  return sql
    .replace(/--[^\n]*/g, '')   // commentaires SQL (ils peuvent contenir des « ; »)
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

async function migrate({ silent = false } = {}) {
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: false });
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
    for (const stmt of statements(sql)) {
      try {
        await conn.query(stmt);
      } catch (e) {
        if (DEJA.has(e.errno)) continue;                       // déjà en place, rien à faire
        const nom = (stmt.match(/CREATE TABLE(?: IF NOT EXISTS)? (\w+)/i) || [])[1];
        throw new Error(`${e.message}${nom ? ` (table ${nom})` : ''}`);
      }
    }
    for (const [table, column, alter] of MIGRATIONS) {
      const [rows] = await conn.execute(
        'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [config.db.database, table, column]);
      if (rows.length) continue;
      try {
        await conn.query(alter);
        if (!silent) console.log(`  + colonne ajoutée : ${table}.${column}`);
      } catch (e) {
        if (!DEJA.has(e.errno)) throw e;
      }
    }
    for (const sql of AJUSTEMENTS) {
      try { await conn.query(sql); } catch (e) { if (!DEJA.has(e.errno)) throw e; }
    }
  } finally { await conn.end(); }
}

module.exports = { migrate };
