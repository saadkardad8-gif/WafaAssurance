const config = require('../config');

/** Normalise un numéro marocain au format international E.164 (+2126XXXXXXXX). */
function normalizePhone(input) {
  let p = String(input || '').replace(/[\s.\-()]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (/^0[5-7]\d{8}$/.test(p)) p = '+212' + p.slice(1);
  if (/^212\d{9}$/.test(p)) p = '+' + p;
  return /^\+\d{10,15}$/.test(p) ? p : null;
}

async function sendViaTwilio(to, text) {
  const { sid, token, from } = config.sms.twilio;
  if (!sid || !token || !from) throw new Error('Twilio non configuré (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM).');
  const body = new URLSearchParams({ To: to, Body: text });
  if (from.startsWith('MG')) body.set('MessagingServiceSid', from); else body.set('From', from);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Twilio a refusé l'envoi (${res.status}) : ${await res.text()}`);
}

async function sendViaInfobip(to, text) {
  const { baseUrl, apiKey } = config.sms.infobip;
  if (!baseUrl || !apiKey) throw new Error('Infobip non configuré (INFOBIP_BASE_URL / INFOBIP_API_KEY).');
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/sms/2/text/advanced`, {
    method: 'POST',
    headers: { Authorization: `App ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ messages: [{ destinations: [{ to: to.replace('+', '') }], from: config.sms.sender, text }] }),
  });
  if (!res.ok) throw new Error(`Infobip a refusé l'envoi (${res.status}) : ${await res.text()}`);
}

async function sendSms(phone, text) {
  const to = normalizePhone(phone);
  if (!to) throw new Error(`Numéro de téléphone invalide : ${phone}`);
  switch (config.sms.provider) {
    case 'twilio': return sendViaTwilio(to, text);
    case 'infobip': return sendViaInfobip(to, text);
    case 'console':
      console.log(`\n📱 [SMS DEV → ${to}] ${text}\n`);
      return;
    default: throw new Error(`SMS_PROVIDER inconnu : ${config.sms.provider}`);
  }
}

module.exports = { sendSms, normalizePhone };
