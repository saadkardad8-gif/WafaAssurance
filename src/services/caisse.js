/** Logique commune de la caisse (utilisée par les routes caisse et paiements). */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
const refCaisse = (id, date) => `CAI-${String(date).slice(0, 4)}-${String(id).padStart(6, '0')}`;
const round2 = n => Math.round(Number(n) * 100) / 100;

/** Verrou applicatif : une seule opération de caisse à la fois (évite deux sorties simultanées). */
async function withCaisseLock(conn, fn) {
  const [[{ ok }]] = await conn.query("SELECT GET_LOCK('aak_caisse', 10) AS ok");
  if (!ok) throw Object.assign(new Error('La caisse est occupée, réessayez dans quelques secondes.'), { status: 409 });
  try { return await fn(); } finally { await conn.query("SELECT RELEASE_LOCK('aak_caisse')"); }
}

async function isClosed(conn, date) {
  const [[row]] = await conn.execute('SELECT id FROM caisse_clotures WHERE date_cloture = ?', [date]);
  return !!row;
}

/**
 * Solde réel de la caisse : entrées - sorties (hors annulés) + écarts constatés aux clôtures
 * (après une clôture, la caisse repart du montant réellement compté).
 * Avec `beforeDate`, solde à l'ouverture de ce jour.
 */
async function solde(conn, beforeDate) {
  const params = beforeDate ? [beforeDate, beforeDate] : [];
  const [[r]] = await conn.execute(
    `SELECT (SELECT COALESCE(SUM(CASE WHEN sens='entree' THEN montant ELSE -montant END),0)
               FROM caisse_mouvements WHERE statut='valide' ${beforeDate ? 'AND date_mouvement < ?' : ''})
          + (SELECT COALESCE(SUM(ecart),0) FROM caisse_clotures ${beforeDate ? 'WHERE date_cloture < ?' : ''}) AS s`, params);
  return round2(r.s);
}

async function totauxJour(conn, date) {
  const [[r]] = await conn.execute(
    `SELECT COALESCE(SUM(CASE WHEN sens='entree' THEN montant END),0) AS entrees,
            COALESCE(SUM(CASE WHEN sens='sortie' THEN montant END),0) AS sorties, COUNT(*) AS n
       FROM caisse_mouvements WHERE statut='valide' AND date_mouvement = ?`, [date]);
  return { entrees: round2(r.entrees), sorties: round2(r.sorties), n: r.n };
}

/** Insère un mouvement et lui attribue sa référence. `conn` doit être dans une transaction. */
async function insertMouvement(conn, m) {
  const [r] = await conn.execute(
    `INSERT INTO caisse_mouvements (sens, categorie, montant, motif, beneficiaire, paiement_id, date_mouvement, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [m.sens, m.categorie, m.montant, m.motif, m.beneficiaire || null, m.paiementId || null, m.date, m.userId]);
  const reference = refCaisse(r.insertId, m.date);
  await conn.execute('UPDATE caisse_mouvements SET reference = ? WHERE id = ?', [reference, r.insertId]);
  return { id: r.insertId, reference };
}

module.exports = { today, round2, withCaisseLock, isClosed, solde, totauxJour, insertMouvement };
