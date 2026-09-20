const fs = require('fs');
const path = require('path');

// Le fichier .env est cherché à la racine du projet, quel que soit le dossier d'où la commande est lancée.
const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
// En production, les plateformes comme Render fournissent les variables directement.
if (fs.existsSync(ENV_FILE)) require('dotenv').config({ path: ENV_FILE });

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function required(name) {
  if (!env[name]) {
    console.error(`\n❌ Variable d'environnement manquante : ${name}\n   Ajoutez ${name} dans le fichier .env ou dans les variables d'environnement de votre hébergeur.\n`);
    process.exit(1);
  }
  return env[name];
}

const config = {
  isProd,
  port: Number(env.PORT || 3000),
  appUrl: (env.APP_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  jwtSecret: required('JWT_SECRET'),
  otpSecret: required('OTP_SECRET'),
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: env.DB_PASSWORD || '',
    database: required('DB_NAME'),
  },
  // Nombre de tentatives de connexion autorisées par 15 minutes et par adresse IP
  loginRateLimit: Number(env.LOGIN_RATE_LIMIT || (isProd ? 20 : 100)),
  // Paiement par carte (CMI). Sans identifiants en développement, un simulateur local prend le relais.
  cmi: {
    clientId: env.CMI_CLIENT_ID || '',
    storeKey: env.CMI_STORE_KEY || '',
    gatewayUrl: env.CMI_GATEWAY_URL || 'https://testpayment.cmi.co.ma/fim/est3Dgate',
  },
  sms: {
    provider: (env.SMS_PROVIDER || 'console').toLowerCase(),
    sender: env.SMS_SENDER || 'AhlAlKhair',
    twilio: { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM },
    infobip: { baseUrl: env.INFOBIP_BASE_URL, apiKey: env.INFOBIP_API_KEY },
  },
};

if (!Number.isFinite(config.loginRateLimit) || config.loginRateLimit < 5) config.loginRateLimit = isProd ? 20 : 100;

config.cmi.simulator = !config.cmi.clientId || !config.cmi.storeKey;
if (config.cmi.simulator && !isProd) {
  config.cmi.clientId = 'SIMULATEUR';
  config.cmi.storeKey = 'cle-de-simulation-locale';
  config.cmi.gatewayUrl = `${config.appUrl}/dev/cmi`;
}

if (isProd) {
  if (config.jwtSecret.length < 32 || config.otpSecret.length < 32)
    throw new Error('JWT_SECRET et OTP_SECRET doivent faire au moins 32 caractères en production.');
  if (config.sms.provider === 'console')
    throw new Error('SMS_PROVIDER=console est interdit en production : configurez twilio ou infobip.');
  if (config.cmi.simulator)
    console.warn('⚠️  CMI non configuré : le paiement par carte sera indisponible (CMI_CLIENT_ID / CMI_STORE_KEY).');
  if (!config.appUrl.startsWith('https://'))
    throw new Error('APP_URL doit être en HTTPS en production.');
}

module.exports = config;
