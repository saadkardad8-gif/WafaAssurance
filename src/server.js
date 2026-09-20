const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { pool } = require('./db');
const { csrfGuard } = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1); // derrière Nginx

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:'],
      // le formulaire de paiement est envoyé vers la passerelle du CMI
      'form-action': ["'self'", new URL(config.cmi.gatewayUrl).origin],
      'upgrade-insecure-requests': config.isProd ? [] : null,
    },
  },
}));
app.use(cookieParser());

// Retours du CMI (formulaires, appelés par le CMI : pas d'en-tête CSRF)
app.use('/cmi', require('./routes/cmi'));
if (config.cmi.simulator && !config.isProd) app.use('/dev/cmi', require('./routes/dev-cmi'));

app.use('/api', express.json({ limit: '100kb' }), csrfGuard);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/paiements', require('./routes/paiements'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/caisse', require('./routes/caisse'));
app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});
app.get('/api/config', (req, res) => res.json({ smsDev: config.sms.provider === 'console' }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Route introuvable.' }));

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '1h' : 0 }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error('[erreur]', err);
  if (res.headersSent) return next(err);
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, ...(err.fields ? { fields: err.fields } : {}) });
  const smsIssue = /SMS|Twilio|Infobip|Numéro/.test(err.message);
  res.status(500).json({ error: smsIssue
    ? (config.isProd ? 'Le SMS n\'a pas pu être envoyé. Réessayez dans quelques instants.' : err.message)
    : (config.isProd ? 'Une erreur interne est survenue. Réessayez.' : `Erreur interne : ${err.message}`) });
});

// Mise à jour automatique de la base au démarrage, puis lancement du serveur
require('./migrate').migrate()
  .then(() => app.listen(config.port, () => console.log(`✅ Ahl Al Khair Pay : ${config.appUrl} (SMS : ${config.sms.provider})`)))
  .catch(e => {
    console.error('\n❌ Impossible de préparer la base de données :', e.message);
    if (/ECONNREFUSED/.test(e.message)) console.error('   → MySQL n\'est pas démarré (XAMPP : bouton Start sur MySQL).');
    if (/Access denied|Accès refusé/i.test(e.message)) console.error('   → Utilisateur ou mot de passe MySQL incorrect dans .env (relancez npm run setup).');
    if (/Unknown database|inconnue/i.test(e.message)) console.error('   → La base n\'existe pas : relancez npm run setup.');
    process.exit(1);
  });
