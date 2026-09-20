const clean = (v, max = 200) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isEmail = v => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v);
const isStrongPassword = v => typeof v === 'string' && v.length >= 8 && /\d/.test(v) && /[a-zA-Z]/.test(v);

/** Convertit "12 500,50" / "12500.5" en centimes entiers (évite les erreurs d'arrondi). null si invalide. */
function toCents(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/[\s\u00A0\u202F]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [int, dec = ''] = s.split('.');
  const cents = Number(int) * 100 + Number((dec + '00').slice(0, 2));
  return cents <= 100_000_000_00 ? cents : null;
}
const centsToDecimal = c => (c / 100).toFixed(2);

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

const referenceFromId = (id, date) => `AAK-${String(date).slice(0, 4)}-${String(id).padStart(6, '0')}`;
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { clean, isEmail, isStrongPassword, toCents, centsToDecimal, isValidDate, referenceFromId, wrap };
