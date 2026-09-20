const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  timezone: 'Z',
  dateStrings: ['DATE'],
});

const query = async (sql, params = []) => (await pool.execute(sql, params))[0];
const one = async (sql, params = []) => (await query(sql, params))[0] || null;

async function audit(actorId, action, target, details, ip) {
  try {
    await query('INSERT INTO audit_logs (actor_id, action, target, details, ip) VALUES (?,?,?,?,?)',
      [actorId || null, action, target || null, details ? JSON.stringify(details) : null, ip || null]);
  } catch (e) { console.error('[audit]', e.message); }
}

module.exports = { pool, query, one, audit };
