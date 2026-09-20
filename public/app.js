/* Ahl Al Khair Pay — frontend (JavaScript sans framework, compatible CSP stricte : aucun gestionnaire inline) */
(() => {
'use strict';

/* ================= Utilitaires ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = n => nf.format(Number(n || 0));
const dh = n => `${fmt(n)} DH`;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
const dateFr = s => s ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const dateTimeFr = s => s ? new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** "12 500,5" → 1250050 centimes ; null si invalide ; '' → null */
function toCents(v) {
  const s = String(v ?? '').replace(/[\s\u00A0\u202F]/g, '').replace(',', '.');
  if (!s) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  const [i, d = ''] = s.split('.');
  return Number(i) * 100 + Number((d + '00').slice(0, 2));
}
const centsStr = c => (c / 100).toFixed(2);

const TYPES = { automobile: 'Automobile', habitation: 'Habitation', sante: 'Santé', vie_epargne: 'Vie / Épargne', voyage: 'Voyage / Assistance',
  responsabilite_civile: 'Responsabilité civile', multirisque_pro: 'Multirisque professionnelle', autre: 'Autre' };
const MODES_AVANCE = { espece: 'Espèce', carte: 'Carte bancaire', virement: 'Virement', cheque: 'Chèque' };
const MODES_RESTE = { espece: 'Espèce', carte: 'Carte bancaire', virement: 'Virement' };
const ICO_MODE = { espece: '💵', carte: '💳', virement: '🏦', cheque: '🧾' };
const CB_STATUT = { en_cours: ['En cours', 'b-pending'], paye: ['Payé', 'b-paid'], echoue: ['Échoué', 'b-failed'], expire: ['Expiré', 'b-slate'] };
const CATS = {
  encaissement_avance: ['entree', 'Encaissement avance', true], encaissement_reste: ['entree', 'Encaissement du reste'],
  approvisionnement: ['entree', 'Approvisionnement de caisse'], autre_entree: ['entree', 'Autre entrée'],
  remboursement_client: ['sortie', 'Remboursement client'], depot_banque: ['sortie', 'Dépôt en banque'],
  depense_agence: ['sortie', 'Dépense agence'], annulation_paiement: ['sortie', 'Annulation de paiement', true], autre_sortie: ['sortie', 'Autre sortie'],
};
const sensBadge = sens => sens === 'entree' ? '<span class="badge b-in">Entrée</span>' : '<span class="badge b-out">Sortie</span>';
const mvtStatut = st => st === 'annule' ? '<span class="badge b-cancelled">Annulé</span>' : '<span class="badge b-paid">Enregistré</span>';
const signed = m => `<span class="${m.sens === 'entree' ? 'amt-in' : 'amt-out'} num">${m.sens === 'entree' ? '+' : '−'} ${fmt(m.montant)}</span>`;
const phoneFr = p => p ? String(p).replace(/^\+212(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '0$1 $2 $3 $4 $5') : '';
const validPhone = v => {
  let x = String(v || '').replace(/[\s.\-()]/g, '');
  if (x.startsWith('00')) x = '+' + x.slice(2);
  return /^0[5-7]\d{8}$/.test(x) || /^\+?212[5-7]\d{8}$/.test(x) || /^\+\d{10,15}$/.test(x);
};
const ROLE = { admin: 'Administrateur', agent: 'Agent', auditeur: 'Auditeur' };
const STATUT = { en_attente: ['En attente', 'b-pending'], valide: ['Validé', 'b-paid'], annule: ['Annulé', 'b-cancelled'] };
const badge = s => `<span class="badge ${STATUT[s][1]}">${STATUT[s][0]}</span>`;
const modeLabel = p => Number(p.reste) === 0 ? '<span class="badge b-paid">Soldé</span>'
  : `${ICO_MODE[p.modeReste] || ''} ${MODES_RESTE[p.modeReste] || '—'}`;

let me = null, cfg = {};

async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'X-Requested-With': 'AAKPay', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* réponse vide */ }
  if (res.status === 401 && !url.startsWith('/api/auth/')) { me = null; location.hash = '#/connexion'; throw Object.assign(new Error(data.error || 'Session expirée'), { silent: true }); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erreur réseau. Réessayez.'), { status: res.status, data });
  return data;
}

function toast(msg, type) {
  const t = $('#toast');
  t.textContent = msg; t.className = type === 'error' ? 'error' : '';
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 3800);
}
const fail = e => { if (!e.silent) toast(e.message, 'error'); };

function modal(html, onMount) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-bg" data-close-bg><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  $('[data-close-bg]', root).addEventListener('click', e => { if (e.target.hasAttribute('data-close-bg')) closeModal(); });
  $$('[data-close]', root).forEach(b => b.addEventListener('click', closeModal));
  onMount && onMount(root);
  const f = $('input,select,button.btn:not(.ghost)', root); f && f.focus();
}
const closeModal = () => { $('#modalRoot').innerHTML = ''; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Patientez…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

/* ================= Navigation ================= */
const NAV = [
  { g: 'Encaissements' },
  { h: '#/tableau-de-bord', ico: '🏠', label: 'Tableau de bord', roles: ['admin', 'agent', 'auditeur'] },
  { h: '#/nouveau', ico: '➕', label: 'Nouveau paiement', roles: ['admin', 'agent'] },
  { h: '#/paiements', ico: '📋', label: 'Paiements', roles: ['admin', 'agent', 'auditeur'] },
  { h: '#/souscripteurs', ico: '👥', label: 'Souscripteurs', roles: ['admin', 'agent', 'auditeur'] },
  { g: 'Caisse' },
  { h: '#/caisse', ico: '💰', label: 'Caisse', roles: ['admin', 'agent', 'auditeur'] },
  { h: '#/caisse/clotures', ico: '🔒', label: 'Clôtures', roles: ['admin', 'agent', 'auditeur'] },
  { g: 'Administration', roles: ['admin', 'auditeur'] },
  { h: '#/statistiques', ico: '📊', label: 'Statistiques', roles: ['admin', 'auditeur'] },
  { h: '#/utilisateurs', ico: '🛡️', label: 'Utilisateurs', roles: ['admin'] },
  { h: '#/journal', ico: '🧾', label: 'Journal d\'audit', roles: ['admin'] },
  { g: 'Compte' },
  { h: '#/compte', ico: '👤', label: 'Mon compte', roles: ['admin', 'agent', 'auditeur'] },
];
const allowed = item => !item.roles || item.roles.includes(me.role);

function shell(title, content) {
  const hash = location.hash.split('?')[0];
  const active = h => hash === h || (h === '#/paiements' && hash.startsWith('#/paiement/'))
    || (h === '#/caisse' && /^#\/caisse\/(mouvement|nouveau)/.test(hash)) || (h === '#/caisse/clotures' && /^#\/caisse\/cloture(\/|$)/.test(hash));
  $('#root').innerHTML = `
    ${cfg.smsDev ? '<div class="devbar">Mode développement : les codes SMS s\'affichent dans le terminal du serveur (SMS_PROVIDER=console).</div>' : ''}
    <div class="shell">
      <aside>
        <div class="logo-plate"><img src="/logo.jpeg" alt="Assurances Ahl Al Khair — Wafa Assurance"></div>
        <nav aria-label="Navigation principale">
          ${NAV.filter(allowed).map(i => i.g ? `<div class="nav-group">${i.g}</div>`
            : `<a href="${i.h}" ${active(i.h) ? 'aria-current="page"' : ''}><span class="ico" aria-hidden="true">${i.ico}</span><span>${i.label}</span></a>`).join('')}
        </nav>
        <div class="aside-foot"><b>${esc(me.fullName)}</b><br><small>${ROLE[me.role]}</small>
          <button type="button" data-logout>Se déconnecter</button></div>
      </aside>
      <main>
        <div class="topbar"><h1>${esc(title)}</h1><button class="btn ghost sm mobile-only" data-logout>Déconnexion</button></div>
        <div id="view">${content}</div>
      </main>
    </div>`;
  $$('[data-logout]').forEach(b => b.addEventListener('click', logout));
  return $('#view');
}

async function logout() {
  try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ }
  me = null; location.hash = '#/connexion'; toast('Vous êtes déconnecté.');
}

const ROUTES = [
  [/^#\/connexion$/, viewLogin, true],
  [/^#\/tableau-de-bord$/, viewDashboard],
  [/^#\/nouveau$/, () => viewForm(null), false, ['admin', 'agent']],
  [/^#\/modifier\/([\w-]+)$/, m => viewForm(m[1]), false, ['admin', 'agent']],
  [/^#\/paiements$/, viewList],
  [/^#\/paiement\/([\w-]+)$/, m => viewDetail(m[1])],
  [/^#\/souscripteurs$/, viewSouscripteurs],
  [/^#\/caisse$/, viewCaisse],
  [/^#\/caisse\/nouveau$/, viewMouvementForm, false, ['admin', 'agent']],
  [/^#\/caisse\/mouvement\/([\w-]+)$/, m => viewMouvement(m[1])],
  [/^#\/caisse\/clotures$/, viewClotures],
  [/^#\/caisse\/cloture$/, viewClotureForm, false, ['admin', 'agent']],
  [/^#\/caisse\/cloture\/(\d+)$/, m => viewCloture(m[1])],
  [/^#\/statistiques$/, viewStats, false, ['admin', 'auditeur']],
  [/^#\/utilisateurs$/, viewUsers, false, ['admin']],
  [/^#\/journal$/, viewAudit, false, ['admin']],
  [/^#\/compte$/, viewAccount],
];

async function route() {
  closeModal();
  const hash = location.hash.split('?')[0] || '#/tableau-de-bord';
  const r = ROUTES.map(([re, fn, pub, roles]) => ({ m: hash.match(re), fn, pub, roles })).find(x => x.m);
  if (!r) { location.hash = '#/tableau-de-bord'; return; }
  if (!r.pub && !me) {
    try { me = (await api('GET', '/api/auth/me')).user; } catch { sessionStorageSafe('set', hash); location.hash = '#/connexion'; return; }
  }
  if (r.pub && me) { location.hash = '#/tableau-de-bord'; return; }
  if (r.roles && !r.roles.includes(me.role)) { location.hash = '#/tableau-de-bord'; return; }
  try { await r.fn(r.m); } catch (e) { fail(e); }
  window.scrollTo({ top: 0 });
}
function sessionStorageSafe(op, v) {
  try { if (op === 'set') sessionStorage.setItem('aak-next', v); else { const x = sessionStorage.getItem('aak-next'); sessionStorage.removeItem('aak-next'); return x; } } catch { return null; }
}
const query = () => new URLSearchParams(location.hash.split('?')[1] || '');

/* ================= Connexion ================= */
function viewLogin() {
  $('#root').innerHTML = `
  ${cfg.smsDev ? '<div class="devbar">Mode développement : le code SMS s\'affiche dans le terminal du serveur.</div>' : ''}
  <div class="auth">
    <div class="auth-art">
      <div class="tile" aria-hidden="true"><div class="t"></div><div class="b"></div><div class="c"></div><div class="d"></div></div>
      <div class="ar" lang="ar" dir="rtl">تأمينات أهل الخير</div>
      <h1>Encaissements, simples et traçables.</h1>
      <p>Saisissez les paiements des souscripteurs, suivez les restes à payer et validez les virements depuis un seul espace sécurisé.</p>
    </div>
    <div class="auth-panel"><div class="auth-box" id="authBox"></div></div>
  </div>`;
  stepPassword();
}

function stepPassword() {
  $('#authBox').innerHTML = `
    <div class="logo-plate"><img src="/logo.jpeg" alt="Assurances Ahl Al Khair — Wafa Assurance"></div>
    <h2>Connexion sécurisée</h2>
    <p class="sub">Un code de vérification vous sera envoyé par SMS.</p>
    <form id="fLogin" novalidate>
      <label for="lEmail">Adresse e-mail</label>
      <input id="lEmail" type="email" autocomplete="username" required>
      <label for="lPass">Mot de passe</label>
      <input id="lPass" type="password" autocomplete="current-password" required>
      <div class="err" id="lErr" role="alert"></div>
      <button class="btn block" type="submit">Continuer</button>
    </form>`;
  $('#lEmail').focus();
  $('#fLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#lEmail').value.trim(), password = $('#lPass').value, btn = e.submitter || $('#fLogin button');
    if (!email || !password) { $('#lErr').textContent = 'Saisissez votre e-mail et votre mot de passe.'; return; }
    busy(btn, true, 'Envoi du code…');
    try {
      const r = await api('POST', '/api/auth/login', { email, password });
      stepOtp(r.challengeId, r.phoneHint, r.method);
    } catch (err) { $('#lErr').textContent = err.message; busy(btn, false); }
  });
}

function stepOtp(challengeId, phoneHint, method) {
  const totp = method === 'totp';
  $('#authBox').innerHTML = `
    <div class="logo-plate"><img src="/logo.jpeg" alt="Assurances Ahl Al Khair"></div>
    <h2>Code de vérification</h2>
    <p class="sub">${totp ? 'Ouvrez votre application d\'authentification sur votre téléphone et saisissez le code à 6 chiffres affiché pour <b>Ahl Al Khair Pay</b>.'
      : `Saisissez le code à 6 chiffres envoyé par SMS au <b>${esc(phoneHint)}</b>.`}</p>
    <form id="fOtp" novalidate>
      <label for="oCode">${totp ? 'Code de votre application' : 'Code reçu par SMS'}</label>
      <input id="oCode" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">
      <div class="err" id="oErr" role="alert"></div>
      <button class="btn block" type="submit">Se connecter</button>
    </form>
    <div class="foot-link">${totp ? '' : 'Pas reçu ? <button class="linkbtn" id="oResend" type="button">Renvoyer le code</button> · '}<button class="linkbtn" id="oBack" type="button">Retour</button></div>`;
  const code = $('#oCode');
  code.focus();
  code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); if (code.value.length === 6) $('#fOtp').requestSubmit(); });
  $('#oBack').addEventListener('click', stepPassword);
  const resend = $('#oResend');
  resend && resend.addEventListener('click', async () => {
    try { await api('POST', '/api/auth/resend-otp', { challengeId }); toast('Nouveau code envoyé.'); } catch (e) { $('#oErr').textContent = e.message; }
  });
  $('#fOtp').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#fOtp button');
    if (!/^\d{6}$/.test(code.value)) { $('#oErr').textContent = 'Le code doit contenir 6 chiffres.'; return; }
    busy(btn, true, 'Vérification…');
    try {
      await api('POST', '/api/auth/verify-otp', { challengeId, code: code.value });
      me = (await api('GET', '/api/auth/me')).user;
      toast(`Bienvenue ${me.fullName.split(' ')[0]} !`);
      location.hash = sessionStorageSafe('get') || '#/tableau-de-bord';
    } catch (err) { $('#oErr').textContent = err.message; busy(btn, false); code.select(); }
  });
}

/* ================= Tableau de bord ================= */
async function viewDashboard() {
  const v = shell('Tableau de bord', '<div class="empty">Chargement…</div>');
  const [{ kpis: k }, { paiements }, cz] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/paiements'), api('GET', '/api/caisse/resume')]);
  const canSaisir = ['admin', 'agent'].includes(me.role);
  v.innerHTML = `
  <div class="hero">
    <div class="hero-main">
      <div class="lab">Avances encaissées aujourd'hui</div>
      <div class="amt num">${fmt(k.avanceJour)}<small>DH</small></div>
      <div class="muted">${k.nbJour || 0} paiement(s) saisi(s) le ${dateFr(today())}</div>
      <div class="acts">
        ${canSaisir ? '<a class="btn" href="#/nouveau">➕ Nouveau paiement</a>' : ''}
        <a class="btn gold" href="#/paiements?statut=en_attente">⏳ En attente (${k.enAttente || 0})</a>
      </div>
    </div>
    <div class="hero-mark" aria-hidden="true"><div class="t"></div><div class="b"></div><div class="c"></div><div class="d"></div>
      <div class="stat">Reste à recouvrer<b class="num">${dh(k.resteTotal)}</b></div></div>
  </div>
  <div class="kpis" style="margin-top:18px">
    <div class="kpi"><span>Avances ce mois</span><b class="num">${dh(k.avanceMois)}</b></div>
    <div class="kpi"><span>Total TTC ce mois</span><b class="num">${dh(k.ttcMois)}</b></div>
    <div class="kpi"><span>Reste en virement</span><b class="num">${dh(k.resteVirement)}</b></div>
    <div class="kpi"><span>Reste en espèce</span><b class="num">${dh(k.resteEspece)}</b></div>
  </div>
  ${cz.jourNonCloture ? `<div class="alert warn"><span>⚠️ La caisse du <b>${dateFr(cz.jourNonCloture)}</b> n'est pas clôturée.</span>${['admin', 'agent'].includes(me.role) ? `<a class="btn sm gold" href="#/caisse/cloture?date=${cz.jourNonCloture}">Clôturer</a>` : ''}</div>` : ''}
  <section class="panel">
    <div class="panel-head"><h2>💰 Caisse : <span class="num">${dh(cz.soldeActuel)}</span></h2><a class="btn sm ghost" href="#/caisse">Ouvrir la caisse</a></div>
    <div class="muted">Aujourd'hui : <span class="amt-in">+ ${fmt(cz.jour.entrees)}</span> · <span class="amt-out">− ${fmt(cz.jour.sorties)}</span> · ${cz.clotureJour ? 'journée clôturée' : 'journée ouverte'}</div>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Derniers paiements</h2><a class="btn sm ghost" href="#/paiements">Tout afficher</a></div>
    ${table(paiements.slice(0, 8))}
  </section>`;
  bindRows(v);
}

function table(list) {
  if (!list.length) return '<div class="empty">Aucun paiement pour le moment.</div>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Référence</th><th>Date</th><th>Souscripteur</th><th>Police</th><th class="r">Total TTC</th><th class="r">Avance</th><th class="r">Reste</th><th>Mode du reste</th><th>Statut</th></tr></thead>
    <tbody>${list.map(p => `<tr class="clickable" data-ref="${esc(p.reference)}" tabindex="0">
      <td class="ref">${esc(p.reference)}</td><td>${dateFr(p.datePaiement)}</td><td><b>${esc(p.souscripteur)}</b>${p.telephone ? `<br><small>${esc(phoneFr(p.telephone))}</small>` : ''}</td>
      <td>${esc(p.numPolice)}<br><small>${esc(TYPES[p.typeAssurance] || '')}</small></td>
      <td class="r num">${fmt(p.totalTtc)}</td><td class="r num">${fmt(p.avance)}</td>
      <td class="r num"><b>${fmt(p.reste)}</b></td>
      <td>${modeLabel(p)}${p.refVirement ? `<br><small>${esc(p.refVirement)}</small>` : ''}</td><td>${badge(p.statut)}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function bindRows(root) {
  $$('tr[data-ref]', root).forEach(tr => {
    const go = () => { location.hash = `#/paiement/${tr.dataset.ref}`; };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
}

/* ================= Formulaire de paiement ================= */
async function viewForm(ref) {
  let existing = null;
  if (ref) {
    existing = (await api('GET', `/api/paiements/${encodeURIComponent(ref)}`)).paiement;
    if (existing.statut !== 'en_attente') { toast('Seul un paiement en attente peut être modifié.', 'error'); location.hash = `#/paiement/${ref}`; return; }
  }
  const e = existing || {};
  const v = shell(existing ? `Modifier ${existing.reference}` : 'Nouveau paiement', `
  <div class="form-layout">
    <section class="panel">
      <form id="fPay" novalidate autocomplete="off">
        <div class="row2">
          <div class="field" data-f="souscripteur">
            <label for="souscripteur">Souscripteur</label>
            <input id="souscripteur" list="dlSous" placeholder="Nom et prénom ou raison sociale" value="${esc(e.souscripteur || '')}" maxlength="150">
            <datalist id="dlSous"></datalist>
            <div class="ferr"></div>
          </div>
          <div class="field" data-f="telephone">
            <label for="telephone">Téléphone <span class="muted" style="font-weight:400">(facultatif)</span></label>
            <input id="telephone" type="tel" inputmode="tel" placeholder="06 61 23 45 67" value="${esc(phoneFr(e.telephone))}" maxlength="20">
            <div class="ferr"></div>
          </div>
        </div>
        <div class="row2">
          <div class="field" data-f="numPolice">
            <label for="numPolice">N° police</label>
            <input id="numPolice" placeholder="Ex. AUTO-2026-104587" value="${esc(e.numPolice || '')}" maxlength="40">
            <div class="ferr"></div>
          </div>
          <div class="field" data-f="typeAssurance">
            <label for="typeAssurance">Type d'assurance</label>
            <select id="typeAssurance">
              <option value="">Choisir…</option>
              ${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${e.typeAssurance === k ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            <div class="ferr"></div>
          </div>
        </div>
        <div class="row2">
          <div class="field" data-f="totalTtc">
            <label for="totalTtc">Total TTC</label>
            <div class="input-unit"><input id="totalTtc" inputmode="decimal" placeholder="0,00" value="${e.totalTtc != null ? fmt(e.totalTtc) : ''}"><span>DH</span></div>
            <div class="ferr"></div>
          </div>
          <div class="field" data-f="avance">
            <label for="avance">Avance</label>
            <div class="input-unit"><input id="avance" inputmode="decimal" placeholder="0,00" value="${e.avance != null ? fmt(e.avance) : ''}"><span>DH</span></div>
            <div class="ferr"></div>
          </div>
        </div>

        <div class="field reveal" data-f="modeAvance" id="modeAvBlock">
          <label id="modeAvLab">Mode de l'avance</label>
          <div class="choices" role="radiogroup" aria-labelledby="modeAvLab" style="grid-template-columns:repeat(4,1fr)">
            ${Object.entries(MODES_AVANCE).map(([k, l]) => `<label class="choice"><input type="radio" name="modeAvance" value="${k}" ${e.modeAvance === k ? 'checked' : ''}><span><i aria-hidden="true">${ICO_MODE[k]}</i>${l}</span></label>`).join('')}
          </div>
          <div class="hint" id="modeAvHint"></div>
          <div class="ferr"></div>
        </div>

        <div class="reste" id="resteBox" aria-live="polite">
          <div><span class="lab" id="resteLab">Reste à payer</span><span class="auto">Calculé automatiquement : Total TTC − Avance</span></div>
          <div class="val" id="resteVal">0,00 DH</div>
        </div>

        <div id="modeBlock">
          <div class="field" data-f="modeReste">
            <label id="modeLab">Mode de paiement du reste</label>
            <div class="choices" role="radiogroup" aria-labelledby="modeLab" style="grid-template-columns:repeat(3,1fr)">
              ${Object.entries(MODES_RESTE).map(([k, l]) => `<label class="choice"><input type="radio" name="modeReste" value="${k}" ${e.modeReste === k ? 'checked' : ''}><span><i aria-hidden="true">${ICO_MODE[k]}</i>${l}</span></label>`).join('')}
            </div>
            <div class="ferr"></div>
          </div>
          <div class="field reveal" data-f="refVirement" id="refBlock">
            <label for="refVirement">Référence virement</label>
            <input id="refVirement" placeholder="Ex. VIR-2026-004512" value="${esc(e.refVirement || '')}" maxlength="60">
            <div class="ferr"></div>
          </div>
        </div>

        <div class="field" data-f="datePaiement">
          <label for="datePaiement">Date</label>
          <div class="date-row">
            <input id="datePaiement" type="date" max="${today()}" value="${esc(e.datePaiement || today())}">
            <button class="btn ghost" type="button" id="btnToday">Aujourd'hui</button>
          </div>
          <div class="ferr"></div>
        </div>

        <div class="form-actions">
          <button class="btn" type="submit">${existing ? 'Enregistrer les modifications' : 'Enregistrer le paiement'}</button>
          <button class="btn ghost" type="button" id="btnReset">${existing ? 'Annuler' : 'Effacer'}</button>
        </div>
      </form>
    </section>

    <section class="panel recap" aria-label="Récapitulatif">
      <h2>Récapitulatif</h2>
      <div class="line"><span>Souscripteur</span><b id="rSous">—</b></div>
      <div class="line"><span>Téléphone</span><b id="rTel">—</b></div>
      <div class="line"><span>N° police</span><b id="rPol">—</b></div>
      <div class="line"><span>Type d'assurance</span><b id="rType">—</b></div>
      <div class="line"><span>Date</span><b id="rDate">—</b></div>
      <div class="line"><span>Total TTC</span><b class="num" id="rTtc">—</b></div>
      <div class="line"><span>Avance</span><b class="num" id="rAv">—</b></div>
      <div class="progress" aria-hidden="true"><i id="rBar" style="width:0%"></i></div>
      <div class="muted" style="font-size:13px" id="rPct">0 % réglé</div>
      <div class="line"><span>Mode du reste</span><b id="rMode">—</b></div>
      <div class="line" id="rRefLine"><span>Réf. virement</span><b id="rRef">—</b></div>
      <div class="line big"><span>Reste à payer</span><b class="num" id="rReste">—</b></div>
    </section>
  </div>`);

  const f = $('#fPay', v);
  const el = id => $('#' + id, v);
  const mode = () => ($('input[name=modeReste]:checked', f) || {}).value || '';
  const modeAv = () => ($('input[name=modeAvance]:checked', f) || {}).value || '';

  function setErr(name, msg) {
    const box = $(`.field[data-f="${name}"]`, f);
    if (!box) return;
    box.classList.toggle('invalid', !!msg);
    $('.ferr', box).textContent = msg || '';
  }

  /** Recalcule le reste et met à jour l'affichage. Retourne l'état courant. */
  function compute() {
    const ttc = toCents(el('totalTtc').value), av = toCents(el('avance').value);
    const ttcOk = Number.isFinite(ttc) && ttc > 0, avOk = av === null || Number.isFinite(av);
    const avance = av === null ? 0 : av;
    const reste = ttcOk && avOk ? ttc - avance : null;

    const box = el('resteBox');
    box.classList.remove('solde', 'neg');
    if (reste === null) { el('resteVal').textContent = '— DH'; el('resteLab').textContent = 'Reste à payer'; }
    else if (reste < 0) { box.classList.add('neg'); el('resteVal').textContent = dh(centsStr(reste)); el('resteLab').textContent = 'Avance supérieure au Total TTC'; }
    else if (reste === 0) { box.classList.add('solde'); el('resteVal').textContent = '0,00 DH'; el('resteLab').textContent = '✓ Réglé en totalité'; }
    else { el('resteVal').textContent = dh(centsStr(reste)); el('resteLab').textContent = 'Reste à payer'; }

    // Mode de l'avance : seulement s'il y a une avance
    const hasAvance = avOk && avance > 0;
    el('modeAvBlock').classList.toggle('hidden', !hasAvance);
    el('modeAvHint').textContent = modeAv() === 'espece' ? '💰 L\'avance sera ajoutée automatiquement à la caisse.'
      : modeAv() === 'carte' ? '💳 Après l\'enregistrement, un bouton ouvrira la page de paiement sécurisée.' : '';
    el('modeAvHint').className = 'hint' + (modeAv() === 'espece' ? ' cash' : '');
    // Mode du reste : utile seulement s'il reste quelque chose à payer
    const needMode = reste === null || reste > 0;
    el('modeBlock').classList.toggle('hidden', !needMode);
    // Référence virement : visible uniquement si « Virement » est choisi
    const showRef = needMode && mode() === 'virement';
    el('refBlock').classList.toggle('hidden', !showRef);

    // Récapitulatif
    el('rSous').textContent = el('souscripteur').value.trim() || '—';
    el('rTel').textContent = el('telephone').value.trim() || '—';
    el('rPol').textContent = el('numPolice').value.trim() || '—';
    el('rType').textContent = TYPES[el('typeAssurance').value] || '—';
    el('rDate').textContent = el('datePaiement').value ? dateFr(el('datePaiement').value) : '—';
    el('rTtc').textContent = ttcOk ? dh(centsStr(ttc)) : '—';
    el('rAv').textContent = avOk ? dh(centsStr(avance)) + (hasAvance && modeAv() ? ` (${MODES_AVANCE[modeAv()]})` : '') : '—';
    const pct = ttcOk && avOk ? Math.max(0, Math.min(100, Math.round(avance / ttc * 100))) : 0;
    el('rBar').style.width = pct + '%';
    el('rPct').textContent = `${pct} % réglé`;
    el('rMode').textContent = reste === 0 ? 'Soldé' : (MODES_RESTE[mode()] || '—');
    el('rRefLine').classList.toggle('hidden', !showRef);
    el('rRef').textContent = el('refVirement').value.trim() || '—';
    el('rReste').textContent = reste === null ? '—' : dh(centsStr(Math.max(reste, 0)));
    return { ttc, av, avance, reste, needMode, showRef, hasAvance };
  }

  function validate() {
    const s = compute(), errs = {};
    if (el('souscripteur').value.trim().length < 3) errs.souscripteur = 'Saisissez le nom du souscripteur (3 caractères minimum).';
    if (el('telephone').value.trim() && !validPhone(el('telephone').value)) errs.telephone = 'Numéro invalide (ex. 06 61 23 45 67).';
    if (el('numPolice').value.trim().length < 3) errs.numPolice = 'Saisissez le numéro de police.';
    else if (!/^[A-Z0-9\/\-. ]+$/i.test(el('numPolice').value.trim())) errs.numPolice = 'Lettres, chiffres, espaces et / - . uniquement.';
    if (!el('typeAssurance').value) errs.typeAssurance = 'Choisissez le type d\'assurance.';
    if (!Number.isFinite(s.ttc) || s.ttc <= 0) errs.totalTtc = 'Saisissez un Total TTC valide, supérieur à 0.';
    if (s.av !== null && !Number.isFinite(s.av)) errs.avance = 'Montant invalide (ex. 1 500,00).';
    else if (Number.isFinite(s.ttc) && s.avance > s.ttc) errs.avance = 'L\'avance ne peut pas dépasser le Total TTC.';
    if (s.hasAvance && !modeAv()) errs.modeAvance = 'Choisissez le mode de l\'avance.';
    if (s.reste > 0 && !mode()) errs.modeReste = 'Choisissez le mode de paiement du reste.';
    if (s.showRef && el('refVirement').value.trim().length < 3) errs.refVirement = 'Saisissez la référence du virement.';
    const d = el('datePaiement').value;
    if (!d) errs.datePaiement = 'Saisissez une date.';
    else if (d > today()) errs.datePaiement = 'La date ne peut pas être dans le futur.';
    ['souscripteur', 'telephone', 'numPolice', 'typeAssurance', 'totalTtc', 'avance', 'modeAvance', 'modeReste', 'refVirement', 'datePaiement'].forEach(k => setErr(k, errs[k]));
    return { ok: !Object.keys(errs).length, s, errs };
  }

  // Événements
  f.addEventListener('input', ev => { if (ev.target.id) setErr(ev.target.id, ''); if (ev.target.name === 'modeReste') setErr('modeReste', ''); if (ev.target.name === 'modeAvance') setErr('modeAvance', ''); compute(); });
  f.addEventListener('change', compute);
  ['totalTtc', 'avance'].forEach(id => {
    el(id).addEventListener('input', () => { el(id).value = el(id).value.replace(/[^\d\s,.]/g, ''); });
    el(id).addEventListener('blur', () => { const c = toCents(el(id).value); if (Number.isFinite(c)) el(id).value = fmt(centsStr(c)); });
    el(id).addEventListener('focus', () => { const c = toCents(el(id).value); if (Number.isFinite(c) && c !== null) el(id).value = centsStr(c).replace('.', ','); el(id).select(); });
  });
  el('refVirement').addEventListener('input', () => { const p = el('refVirement').selectionStart; el('refVirement').value = el('refVirement').value.toUpperCase(); el('refVirement').setSelectionRange(p, p); });
  el('numPolice').addEventListener('input', () => { const p = el('numPolice').selectionStart; el('numPolice').value = el('numPolice').value.toUpperCase(); el('numPolice').setSelectionRange(p, p); });
  el('telephone').addEventListener('blur', () => { if (validPhone(el('telephone').value)) { const d = el('telephone').value.replace(/\D/g, ''); const n = d.startsWith('212') ? '+' + d : d.length === 10 ? '+212' + d.slice(1) : '+' + d; el('telephone').value = phoneFr(n); compute(); } });
  el('btnToday').addEventListener('click', () => { el('datePaiement').value = today(); setErr('datePaiement', ''); compute(); });
  el('btnReset').addEventListener('click', () => {
    if (existing) { location.hash = `#/paiement/${existing.reference}`; return; }
    f.reset(); el('datePaiement').value = today(); $$('.field', f).forEach(b => { b.classList.remove('invalid'); $('.ferr', b).textContent = ''; }); compute(); el('souscripteur').focus();
  });

  // Suggestions de souscripteurs déjà connus
  let tSug, known = [];
  // Souscripteur déjà connu : on reprend son téléphone s'il n'est pas saisi
  el('souscripteur').addEventListener('change', () => {
    const k = known.find(x => x.souscripteur.toLowerCase() === el('souscripteur').value.trim().toLowerCase());
    if (k && k.telephone && !el('telephone').value.trim()) { el('telephone').value = phoneFr(k.telephone); setErr('telephone', ''); compute(); }
  });
  el('souscripteur').addEventListener('input', () => {
    clearTimeout(tSug);
    const q = el('souscripteur').value.trim();
    if (q.length < 2) return;
    tSug = setTimeout(async () => {
      try {
        const { souscripteurs } = await api('GET', `/api/admin/souscripteurs?suggest=1&q=${encodeURIComponent(q)}`);
        known = souscripteurs;
        el('dlSous').innerHTML = souscripteurs.map(s => `<option value="${esc(s.souscripteur)}">${s.telephone ? esc(phoneFr(s.telephone)) : ''}</option>`).join('');
      } catch { /* suggestions facultatives */ }
    }, 250);
  });

  f.addEventListener('submit', ev => {
    ev.preventDefault();
    const { ok, s, errs } = validate();
    if (!ok) { const first = Object.keys(errs)[0]; const inp = $(`.field[data-f="${first}"] input, .field[data-f="${first}"] select`, f); inp && inp.focus(); return; }
    const payload = {
      souscripteur: el('souscripteur').value.trim(),
      telephone: el('telephone').value.trim() || null,
      numPolice: el('numPolice').value.trim(),
      typeAssurance: el('typeAssurance').value,
      totalTtc: centsStr(s.ttc), avance: centsStr(s.avance), modeAvance: s.hasAvance ? modeAv() : null,
      modeReste: s.reste > 0 ? mode() : null,
      refVirement: s.showRef ? el('refVirement').value.trim() : null,
      datePaiement: el('datePaiement').value,
    };
    confirmSave(payload, s.reste);
  });

  function confirmSave(payload, reste) {
    modal(`<h3>${existing ? 'Confirmer les modifications' : 'Confirmer l\'enregistrement'}</h3>
      <div class="summary">
        <div><span>Souscripteur</span><b>${esc(payload.souscripteur)}</b></div>
        ${payload.telephone ? `<div><span>Téléphone</span><b>${esc(payload.telephone)}</b></div>` : ''}
        <div><span>N° police</span><b>${esc(payload.numPolice.toUpperCase())}</b></div>
        <div><span>Type d'assurance</span><b>${esc(TYPES[payload.typeAssurance])}</b></div>
        <div><span>Date</span><b>${dateFr(payload.datePaiement)}</b></div>
        <div><span>Total TTC</span><b class="num">${dh(payload.totalTtc)}</b></div>
        <div><span>Avance</span><b class="num">${dh(payload.avance)}${payload.modeAvance ? ` · ${MODES_AVANCE[payload.modeAvance]}` : ''}</b></div>
        ${payload.modeAvance === 'espece' ? '<div><span>Caisse</span><b class="amt-in">+ entrée automatique</b></div>' : ''}
        ${reste > 0 ? `<div><span>Mode du reste</span><b>${esc(MODES_RESTE[payload.modeReste] || '')}</b></div>` : ''}
        ${payload.refVirement ? `<div><span>Réf. virement</span><b>${esc(payload.refVirement)}</b></div>` : ''}
        <div class="total"><span>Reste à payer</span><b class="num">${dh(centsStr(reste))}</b></div>
      </div>
      <div class="err" id="mErr" role="alert"></div>
      <div class="acts"><button class="btn ghost" data-close>Corriger</button><button class="btn" id="mSave">Confirmer</button></div>`,
    root => $('#mSave', root).addEventListener('click', () => save(payload, $('#mSave', root))));
  }

  async function save(payload, btn) {
    busy(btn, true, 'Enregistrement…');
    try {
      const r = existing
        ? await api('PUT', `/api/paiements/${encodeURIComponent(existing.reference)}`, payload)
        : await api('POST', '/api/paiements', payload);
      closeModal();
      toast(existing ? 'Modifications enregistrées.' : `Paiement ${r.paiement.reference} enregistré.`);
      location.hash = `#/paiement/${r.paiement.reference}?nouveau=1`;
    } catch (err) {
      busy(btn, false);
      if (err.data && err.data.duplicate) {
        modal(`<h3>Paiement en double ?</h3><p>${esc(err.message)}</p><p class="muted">Voulez-vous vraiment enregistrer un second paiement identique ?</p>
          <div class="acts"><button class="btn ghost" data-close>Non, annuler</button><button class="btn gold" id="mForce">Oui, enregistrer</button></div>`,
        root => $('#mForce', root).addEventListener('click', () => save({ ...payload, confirmDuplicate: true }, $('#mForce', root))));
        return;
      }
      if (err.data && err.data.fields) { closeModal(); Object.entries(err.data.fields).forEach(([k, m]) => setErr(k, m)); }
      const m = $('#mErr'); if (m) m.textContent = err.message; else toast(err.message, 'error');
    }
  }

  compute();
  el('souscripteur').focus();
}

/* ================= Détail / reçu ================= */
async function viewDetail(ref) {
  const [{ paiement: p }, cb] = await Promise.all([
    api('GET', `/api/paiements/${encodeURIComponent(ref)}`),
    api('GET', `/api/paiements/${encodeURIComponent(ref)}/cartes`).catch(() => ({ cartes: [] })),
  ]);
  const cartes = cb.cartes || [];
  const resteRestant = Number(p.reste) - Number(p.resteEncaisse);
  const avanceRestante = Number(p.avance) - Number(p.avanceCartePayee || 0);
  const peutPayer = ['admin', 'agent'].includes(me.role) && p.statut !== 'annule';
  const carteAvance = peutPayer && p.modeAvance === 'carte' && avanceRestante > 0;
  const carteReste = peutPayer && p.modeReste === 'carte' && resteRestant > 0;
  const isNew = query().get('nouveau') === '1';
  const canEdit = p.statut === 'en_attente' && (me.role === 'admin' || (me.role === 'agent' && p.agentId === me.id));
  const v = shell(`Paiement ${p.reference}`, `
  <div class="no-print" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:4px">
    <a class="btn ghost" href="#/paiements">← Paiements</a>
    <a class="btn" href="/api/paiements/${encodeURIComponent(p.reference)}/recu.pdf" target="_blank" rel="noopener">📄 Reçu PDF</a>
    <button class="btn ghost" id="bPrint">🖨️ Imprimer</button>
    ${canEdit ? `<a class="btn ghost" href="#/modifier/${esc(p.reference)}">✏️ Modifier</a>` : ''}
    ${me.role === 'admin' && p.statut === 'en_attente' ? '<button class="btn" id="bValider">✓ Valider</button>' : ''}
    ${me.role === 'admin' && p.statut !== 'annule' ? '<button class="btn danger" id="bAnnuler">Annuler le paiement</button>' : ''}
    ${carteAvance ? `<button class="btn" data-carte="avance">💳 Payer l'avance par carte · ${dh(avanceRestante)}</button>` : ''}
    ${carteReste ? `<button class="btn" data-carte="reste">💳 Encaisser le reste par carte · ${dh(resteRestant)}</button>` : ''}
    ${['admin', 'agent'].includes(me.role) && p.statut !== 'annule' && p.modeReste === 'espece' && Number(p.reste) - Number(p.resteEncaisse) > 0
      ? `<a class="btn gold" href="#/caisse/nouveau?sens=entree&categorie=encaissement_reste&paiement=${esc(p.reference)}&montant=${(Number(p.reste) - Number(p.resteEncaisse)).toFixed(2)}">💵 Encaisser le reste</a>` : ''}
    ${isNew && ['admin', 'agent'].includes(me.role) ? '<a class="btn gold" href="#/nouveau">➕ Saisir un autre paiement</a>' : ''}
  </div>
  <section class="panel receipt">
    <div class="receipt-head">
      <img src="/logo.jpeg" alt="Assurances Ahl Al Khair — Wafa Assurance">
      <div class="rt"><span class="muted">Reçu de paiement</span><b class="ref">${esc(p.reference)}</b>${badge(p.statut)}</div>
    </div>
    <dl>
      <dt>Souscripteur</dt><dd>${esc(p.souscripteur)}</dd>
      ${p.telephone ? `<dt>Téléphone</dt><dd>${esc(phoneFr(p.telephone))}</dd>` : ''}
      <dt>N° police</dt><dd>${esc(p.numPolice)}</dd>
      <dt>Type d'assurance</dt><dd>${esc(TYPES[p.typeAssurance])}</dd>
      <dt>Date du paiement</dt><dd>${dateFr(p.datePaiement)}</dd>
      ${Number(p.avance) > 0 ? `<dt>Mode de l'avance</dt><dd>${MODES_AVANCE[p.modeAvance] || '—'}${p.modeAvance === 'carte' && Number(p.avanceCartePayee) > 0 ? ' · réglée' : ''}${p.mouvementAvance ? ` · <a class="no-print" href="#/caisse/mouvement/${esc(p.mouvementAvance)}">${esc(p.mouvementAvance)}</a>` : ''}</dd>` : ''}
      <dt>Mode de paiement du reste</dt><dd>${Number(p.reste) === 0 ? 'Soldé' : (MODES_RESTE[p.modeReste] || '—')}</dd>
      ${p.refVirement ? `<dt>Référence virement</dt><dd>${esc(p.refVirement)}</dd>` : ''}
      <dt>Saisi par</dt><dd>${esc(p.agent)} · ${dateTimeFr(p.createdAt)}</dd>
      ${p.validateur ? `<dt>Validé par</dt><dd>${esc(p.validateur)} · ${dateTimeFr(p.validatedAt)}</dd>` : ''}
      ${p.statut === 'annule' ? `<dt>Annulé par</dt><dd>${esc(p.annulePar)} · ${dateTimeFr(p.cancelledAt)}</dd><dt>Motif</dt><dd>${esc(p.motifAnnulation)}</dd>` : ''}
    </dl>
    <div class="amounts">
      <div><span>Total TTC</span><b class="num">${dh(p.totalTtc)}</b></div>
      <div><span>Avance versée</span><b class="num">${dh(p.avance)}</b></div>
      <div><span>Reste à payer</span><b class="num">${dh(p.reste)}</b></div>
    </div>
    ${cartes.length ? `<div class="no-print" style="margin-top:18px">
      <h3 style="font-size:15px;margin:0 0 8px">Paiements par carte</h3>
      <div class="table-wrap"><table><thead><tr><th>Référence</th><th>Objet</th><th class="r">Montant</th><th>Carte</th><th>Autorisation</th><th>Statut</th></tr></thead>
      <tbody>${cartes.map(c => `<tr><td class="ref">${esc(c.reference)}</td><td>${c.cible === 'avance' ? 'Avance' : 'Reste'}</td>
        <td class="r num">${fmt(c.montant)}</td><td>${esc(c.maskedPan ? `${c.reseau} ${c.maskedPan}` : '—')}</td>
        <td>${esc(c.authCode || c.erreur || '—')}</td>
        <td><span class="badge ${CB_STATUT[c.statut][1]}">${CB_STATUT[c.statut][0]}</span></td></tr>`).join('')}</tbody></table></div></div>` : ''}
    ${Number(p.resteEncaisse) > 0 ? `<p class="muted" style="margin:10px 0 0">Reste déjà encaissé : <b class="num">${dh(p.resteEncaisse)}</b> · restant : <b class="num">${dh(Number(p.reste) - Number(p.resteEncaisse))}</b></p>` : ''}
    <div class="signs"><div>Signature du souscripteur</div><div>Cachet et signature de l'agence</div></div>
  </section>`);

  $('#bPrint', v).addEventListener('click', () => window.print());
  $$('[data-carte]', v).forEach(b => b.addEventListener('click', () => payerParCarte(p, b.dataset.carte, b)));
  if (query().get('carte') === '1') {
    const derniere = cartes[0];
    if (derniere && derniere.statut === 'paye') toast(`Paiement par carte accepté — autorisation ${derniere.authCode}.`);
    else if (derniere && derniere.statut === 'echoue') toast(derniere.erreur || 'Paiement par carte refusé.', 'error');
  }
  const bV = $('#bValider', v);
  bV && bV.addEventListener('click', () => modal(`<h3>Valider ${esc(p.reference)} ?</h3>
    <p class="muted">Confirmez que l'avance a bien été encaissée${p.modeReste === 'virement' ? ' et que le virement ' + esc(p.refVirement) + ' est conforme' : ''}.</p>
    <div class="acts"><button class="btn ghost" data-close>Retour</button><button class="btn" id="mOk">Valider</button></div>`,
  root => $('#mOk', root).addEventListener('click', async () => {
    busy($('#mOk', root), true);
    try { await api('POST', `/api/paiements/${encodeURIComponent(p.reference)}/valider`); toast('Paiement validé.'); route(); } catch (e) { busy($('#mOk', root), false); fail(e); }
  })));
  const bA = $('#bAnnuler', v);
  bA && bA.addEventListener('click', () => modal(`<h3>Annuler ${esc(p.reference)} ?</h3>
    <p class="muted">Le paiement restera visible dans l'historique avec le statut « Annulé ».</p>
    <label for="mMotif">Motif de l'annulation</label><input id="mMotif" maxlength="255" placeholder="Ex. Erreur de saisie du montant">
    <div class="err" id="mErr" role="alert"></div>
    <div class="acts"><button class="btn ghost" data-close>Retour</button><button class="btn danger" id="mOk">Annuler le paiement</button></div>`,
  root => $('#mOk', root).addEventListener('click', async () => {
    const motif = $('#mMotif', root).value.trim();
    if (motif.length < 5) { $('#mErr', root).textContent = 'Indiquez le motif (5 caractères minimum).'; return; }
    busy($('#mOk', root), true);
    try {
      const r = await api('POST', `/api/paiements/${encodeURIComponent(p.reference)}/annuler`, { motif });
      toast(r.compensations && r.compensations.length ? `Paiement annulé. Sortie de caisse créée : ${r.compensations.join(', ')}` : 'Paiement annulé.'); route();
    }
    catch (e) { busy($('#mOk', root), false); $('#mErr', root).textContent = e.message; }
  })));
}

/** Ouvre la page de paiement sécurisée (CMI) en y postant le formulaire signé. */
async function payerParCarte(p, cible, btn) {
  busy(btn, true, 'Préparation…');
  try {
    const r = await api('POST', `/api/paiements/${encodeURIComponent(p.reference)}/carte`, { cible });
    modal(`<h3>Paiement par carte</h3>
      <div class="summary">
        <div><span>Souscripteur</span><b>${esc(p.souscripteur)}</b></div>
        <div><span>Objet</span><b>${cible === 'avance' ? 'Avance' : 'Solde'} ${esc(p.reference)}</b></div>
        <div class="total"><span>Montant</span><b class="num">${dh(r.montant)}</b></div>
      </div>
      <p class="muted" style="font-size:13px">Le titulaire saisit sa carte sur la page sécurisée de la banque. Aucun numéro de carte n'est saisi ni conservé dans cette application.${r.simulateur ? '<br><b>Mode simulation :</b> aucune carte ne sera débitée.' : ''}</p>
      <div class="acts"><button class="btn ghost" data-close>Annuler</button><button class="btn" id="cbGo">Ouvrir la page de paiement</button></div>`,
    root => $('#cbGo', root).addEventListener('click', () => {
      const f = document.createElement('form');
      f.method = 'POST'; f.action = r.form.action;
      Object.entries(r.form.fields).forEach(([k, val]) => {
        const i = document.createElement('input');
        i.type = 'hidden'; i.name = k; i.value = val;
        f.appendChild(i);
      });
      document.body.appendChild(f);
      f.submit();
    }));
  } catch (e) { fail(e); }
  busy(btn, false);
}

/* ================= Liste / recherche ================= */
async function viewList() {
  const q = query();
  const v = shell('Paiements', `
  <section class="panel">
    <form class="filters" id="fFilt" style="margin-bottom:14px">
      <input name="q" placeholder="Référence, souscripteur, n° police, téléphone ou réf. virement" value="${esc(q.get('q') || '')}" aria-label="Rechercher" style="flex:1;min-width:220px">
      <select name="statut" aria-label="Statut"><option value="">Tous les statuts</option>
        ${Object.entries(STATUT).map(([k, [l]]) => `<option value="${k}" ${q.get('statut') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select name="type" aria-label="Type d'assurance"><option value="">Tous les types</option>
        ${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${q.get('type') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select name="mode" aria-label="Mode du reste"><option value="">Tous les modes</option>
        <option value="virement" ${q.get('mode') === 'virement' ? 'selected' : ''}>Virement</option>
        <option value="espece" ${q.get('mode') === 'espece' ? 'selected' : ''}>Espèce</option>
        <option value="solde" ${q.get('mode') === 'solde' ? 'selected' : ''}>Soldé (reste = 0)</option></select>
      <input type="date" name="du" value="${esc(q.get('du') || '')}" aria-label="Du">
      <input type="date" name="au" value="${esc(q.get('au') || '')}" aria-label="Au">
      <a class="btn ghost" id="bCsv" href="#">⬇️ Export Excel (CSV)</a>
    </form>
    <div id="lRes"><div class="empty">Chargement…</div></div>
  </section>`);
  const form = $('#fFilt', v);
  const params = () => new URLSearchParams([...new FormData(form)].filter(([, val]) => val)).toString();
  async function load() {
    const ps = params();
    $('#bCsv', v).href = `/api/paiements/export.csv?${ps}`;
    history.replaceState(null, '', `#/paiements${ps ? '?' + ps : ''}`);
    try {
      const { paiements, totals: t } = await api('GET', `/api/paiements?${ps}`);
      $('#lRes', v).innerHTML = `<div class="totals-bar"><span>${t.n} paiement(s) hors annulés</span><span>Total TTC : <b>${dh(t.ttc)}</b></span>
        <span>Avances : <b>${dh(t.avance)}</b></span><span>Reste à payer : <b>${dh(t.reste)}</b></span></div>` + table(paiements);
      bindRows(v);
    } catch (e) { fail(e); }
  }
  let t;
  form.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  form.addEventListener('submit', e => e.preventDefault());
  load();
}

/* ================= Souscripteurs ================= */
async function viewSouscripteurs() {
  const v = shell('Souscripteurs', `<section class="panel">
    <div class="panel-head"><h2>Souscripteurs</h2><input id="sQ" placeholder="Rechercher un nom" style="width:auto;min-width:240px" aria-label="Rechercher"></div>
    <div id="sRes"><div class="empty">Chargement…</div></div></section>`);
  async function load() {
    const { souscripteurs: list } = await api('GET', `/api/admin/souscripteurs?q=${encodeURIComponent($('#sQ', v).value.trim())}`);
    $('#sRes', v).innerHTML = !list.length ? '<div class="empty">Aucun souscripteur trouvé.</div> ' : `<div class="table-wrap"><table>
      <thead><tr><th>Souscripteur</th><th>Téléphone</th><th>Polices</th><th class="r">Paiements</th><th class="r">Total TTC</th><th class="r">Avances</th><th class="r">Reste à payer</th><th>Dernier paiement</th></tr></thead>
      <tbody>${list.map(s => `<tr class="clickable" data-name="${esc(s.souscripteur)}" tabindex="0"><td><b>${esc(s.souscripteur)}</b></td><td>${esc(phoneFr(s.telephone)) || '—'}</td>
        <td style="white-space:normal;max-width:240px"><small>${esc(s.polices || '—')}</small></td><td class="r num">${s.n}</td>
        <td class="r num">${fmt(s.ttc)}</td><td class="r num">${fmt(s.avance)}</td><td class="r num"><b>${fmt(s.reste)}</b></td><td>${dateFr(s.dernier)}</td></tr>`).join('')}</tbody></table></div>`;
    $$('tr[data-name]', v).forEach(tr => tr.addEventListener('click', () => { location.hash = `#/paiements?q=${encodeURIComponent(tr.dataset.name)}`; }));
  }
  let t; $('#sQ', v).addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 250); });
  await load();
}


/* ================= Caisse ================= */
function mvtTable(list) {
  if (!list.length) return '<div class="empty">Aucun mouvement.</div>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Référence</th><th>Date</th><th>Sens</th><th>Catégorie</th><th>Motif</th><th class="r">Montant (DH)</th><th>Statut</th></tr></thead>
    <tbody>${list.map(m => `<tr class="clickable" data-mvt="${esc(m.reference)}" tabindex="0">
      <td class="ref">${esc(m.reference)}</td><td>${new Date(m.date + 'T12:00:00').toLocaleDateString('fr-FR')}</td><td>${sensBadge(m.sens)}</td>
      <td>${esc(m.categorieLabel)}${m.paiementRef ? `<br><small>${esc(m.paiementRef)}</small>` : ''}</td>
      <td style="white-space:normal;min-width:180px">${esc(m.motif)}${m.beneficiaire ? `<br><small>${esc(m.beneficiaire)}</small>` : ''}</td>
      <td class="r">${m.statut === 'annule' ? `<s class="num">${fmt(m.montant)}</s>` : signed(m)}</td><td>${mvtStatut(m.statut)}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function bindMvtRows(root) {
  $$('tr[data-mvt]', root).forEach(tr => {
    const go = () => { location.hash = `#/caisse/mouvement/${tr.dataset.mvt}`; };
    tr.addEventListener('click', go); tr.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
}

async function viewCaisse() {
  const q = query();
  const canSaisir = ['admin', 'agent'].includes(me.role);
  const v = shell('Caisse', '<div class="empty">Chargement…</div>');
  const cz = await api('GET', '/api/caisse/resume');
  v.innerHTML = `
  ${cz.jourNonCloture ? `<div class="alert warn"><span>⚠️ La caisse du <b>${dateFr(cz.jourNonCloture)}</b> n'a pas été clôturée.</span>${canSaisir ? `<a class="btn sm gold" href="#/caisse/cloture?date=${cz.jourNonCloture}">Clôturer cette journée</a>` : ''}</div>` : ''}
  ${cz.cloturesEnAttente && me.role === 'admin' ? `<div class="alert warn"><span>🔒 ${cz.cloturesEnAttente} clôture(s) en attente de validation.</span><a class="btn sm ghost" href="#/caisse/clotures">Voir</a></div>` : ''}
  <div class="hero">
    <div class="hero-main">
      <div class="lab">Solde de caisse</div>
      <div class="amt num">${fmt(cz.soldeActuel)}<small>DH</small></div>
      <div class="muted">Ouverture du jour : ${dh(cz.ouverture)} · ${cz.clotureJour ? `journée clôturée (${cz.clotureJour.statut === 'validee' ? 'validée' : 'en attente'})` : 'journée ouverte'}</div>
      <div class="acts">
        ${canSaisir && !cz.clotureJour ? `<a class="btn" href="#/caisse/nouveau?sens=entree">➕ Entrée</a><a class="btn danger" href="#/caisse/nouveau?sens=sortie">➖ Sortie</a>
          <a class="btn gold" href="#/caisse/cloture">🔒 Clôturer la journée</a>` : ''}
        ${cz.clotureJour ? `<a class="btn ghost" href="#/caisse/cloture/${cz.clotureJour.id}">Voir la clôture du jour</a>` : ''}
      </div>
    </div>
    <div class="hero-mark" aria-hidden="true"><div class="t"></div><div class="b"></div><div class="c"></div><div class="d"></div>
      <div class="stat">Aujourd'hui<b class="num">+${fmt(cz.jour.entrees)} / −${fmt(cz.jour.sorties)}</b></div></div>
  </div>
  <section class="panel">
    <form class="filters" id="fMvt" style="margin-bottom:14px">
      <input name="q" placeholder="Référence, motif, bénéficiaire, n° paiement" value="${esc(q.get('q') || '')}" style="flex:1;min-width:200px" aria-label="Rechercher">
      <select name="sens" aria-label="Sens"><option value="">Entrées et sorties</option><option value="entree" ${q.get('sens') === 'entree' ? 'selected' : ''}>Entrées</option><option value="sortie" ${q.get('sens') === 'sortie' ? 'selected' : ''}>Sorties</option></select>
      <select name="categorie" aria-label="Catégorie"><option value="">Toutes catégories</option>${Object.entries(CATS).map(([k, [, l]]) => `<option value="${k}" ${q.get('categorie') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input type="date" name="du" value="${esc(q.get('du') || cz.date)}" aria-label="Du">
      <input type="date" name="au" value="${esc(q.get('au') || cz.date)}" aria-label="Au">
    </form>
    <div id="mRes"><div class="empty">Chargement…</div></div>
  </section>`;
  const form = $('#fMvt', v);
  async function load() {
    const ps = new URLSearchParams([...new FormData(form)].filter(([, x]) => x)).toString();
    history.replaceState(null, '', `#/caisse${ps ? '?' + ps : ''}`);
    try {
      const { mouvements, totals: t } = await api('GET', `/api/caisse/mouvements?${ps}`);
      $('#mRes', v).innerHTML = `<div class="totals-bar"><span>${t.n} mouvement(s) enregistrés</span><span>Entrées : <b class="amt-in">${dh(t.entrees)}</b></span>
        <span>Sorties : <b class="amt-out">${dh(t.sorties)}</b></span><span>Net : <b>${dh(Number(t.entrees) - Number(t.sorties))}</b></span></div>` + mvtTable(mouvements);
      bindMvtRows(v);
    } catch (e) { fail(e); }
  }
  let t; form.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  form.addEventListener('submit', e => e.preventDefault());
  load();
}

async function viewMouvementForm() {
  const q = query(), sens = q.get('sens') === 'sortie' ? 'sortie' : 'entree';
  const cz = await api('GET', '/api/caisse/resume');
  const cats = Object.entries(CATS).filter(([, [s, , auto]]) => s === sens && !auto);
  const preCat = q.get('categorie') && CATS[q.get('categorie')] && CATS[q.get('categorie')][0] === sens ? q.get('categorie') : cats[0][0];
  const v = shell(sens === 'entree' ? 'Nouvelle entrée de caisse' : 'Nouvelle sortie de caisse', `
  <div class="form-layout">
    <section class="panel">
      <div class="sens-switch">
        <a href="#/caisse/nouveau?sens=entree" class="in" aria-current="${sens === 'entree'}">➕ Entrée</a>
        <a href="#/caisse/nouveau?sens=sortie" class="out" aria-current="${sens === 'sortie'}">➖ Sortie</a>
      </div>
      <form id="fM" novalidate autocomplete="off">
        <div class="field" data-f="categorie"><label for="mCat">Catégorie</label>
          <select id="mCat">${cats.map(([k, [, l]]) => `<option value="${k}" ${k === preCat ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="ferr"></div></div>
        <div class="row2">
          <div class="field" data-f="montant"><label for="mMontant">Montant</label>
            <div class="input-unit"><input id="mMontant" inputmode="decimal" placeholder="0,00" value="${q.get('montant') ? fmt(q.get('montant')) : ''}"><span>DH</span></div><div class="ferr"></div></div>
          <div class="field" data-f="date"><label for="mDate">Date</label><input id="mDate" type="date" max="${cz.date}" value="${cz.date}"><div class="ferr"></div></div>
        </div>
        <div class="field" data-f="paiementRef" id="mPayBlock"><label for="mPay">Référence du paiement</label>
          <input id="mPay" placeholder="AAK-2026-000123" value="${esc(q.get('paiement') || '')}"><div class="hint" id="mPayInfo"></div><div class="ferr"></div></div>
        <div class="field" data-f="beneficiaire"><label for="mBenef" id="mBenefLab">${sens === 'entree' ? 'Versé par' : 'Remis à'}</label>
          <input id="mBenef" maxlength="150" placeholder="Nom (facultatif)"><div class="ferr"></div></div>
        <div class="field" data-f="motif"><label for="mMotif">Motif</label>
          <input id="mMotif" maxlength="255" placeholder="${sens === 'entree' ? 'Ex. Fond de caisse du matin' : 'Ex. N° bordereau de dépôt 004512'}"><div class="ferr"></div></div>
        <div class="err" id="mErr" role="alert"></div>
        <div class="form-actions"><button class="btn ${sens === 'sortie' ? 'danger' : ''}" type="submit">Enregistrer ${sens === 'entree' ? "l'entrée" : 'la sortie'}</button><a class="btn ghost" href="#/caisse">Annuler</a></div>
      </form>
    </section>
    <section class="panel recap">
      <h2>Effet sur la caisse</h2>
      <div class="line"><span>Solde actuel</span><b class="num">${dh(cz.soldeActuel)}</b></div>
      <div class="line"><span>${sens === 'entree' ? 'Entrée' : 'Sortie'}</span><b class="num ${sens === 'entree' ? 'amt-in' : 'amt-out'}" id="mEff">—</b></div>
      <div class="line big"><span>Solde après</span><b class="num" id="mApres">${dh(cz.soldeActuel)}</b></div>
      <div class="hint" id="mWarn"></div>
    </section>
  </div>`);
  const el = id => $('#' + id, v), f = $('#fM', v);
  const setErr = (k, m) => { const b = $(`.field[data-f="${k}"]`, f); if (b) { b.classList.toggle('invalid', !!m); $('.ferr', b).textContent = m || ''; } };
  function sync() {
    const cat = el('mCat').value;
    el('mPayBlock').classList.toggle('hidden', cat !== 'encaissement_reste');
    el('mBenef').placeholder = cat === 'remboursement_client' ? 'Nom du client remboursé (obligatoire)' : 'Nom (facultatif)';
    const c = toCents(el('mMontant').value);
    const ok = Number.isFinite(c) && c > 0;
    el('mEff').textContent = ok ? (sens === 'entree' ? '+ ' : '− ') + dh(centsStr(c)) : '—';
    const after = Math.round(cz.soldeActuel * 100) + (ok ? (sens === 'entree' ? c : -c) : 0);
    el('mApres').textContent = dh(centsStr(after));
    el('mApres').className = 'num' + (after < 0 ? ' amt-out' : '');
    el('mWarn').textContent = after < 0 ? '⚠️ Solde de caisse insuffisant pour cette sortie.' : '';
    el('mWarn').className = 'hint' + (after < 0 ? ' overdue' : '');
  }
  async function lookup() {
    const r = el('mPay').value.trim().toUpperCase();
    el('mPayInfo').textContent = '';
    if (!/^AAK-\d{4}-\d{6}$/.test(r)) return;
    try {
      const { paiement: p } = await api('GET', `/api/paiements/${encodeURIComponent(r)}`);
      const restant = Number(p.reste) - Number(p.resteEncaisse);
      el('mPayInfo').innerHTML = `${esc(p.souscripteur)} · police ${esc(p.numPolice)} · reste à encaisser : <b>${dh(restant)}</b>`;
      if (!el('mBenef').value) el('mBenef').value = p.souscripteur;
      if (!el('mMotif').value) el('mMotif').value = `Reste ${p.reference} — police ${p.numPolice}`;
    } catch { el('mPayInfo').textContent = 'Paiement introuvable.'; }
  }
  f.addEventListener('input', e => { if (e.target.id) setErr({ mCat: 'categorie', mMontant: 'montant', mDate: 'date', mPay: 'paiementRef', mBenef: 'beneficiaire', mMotif: 'motif' }[e.target.id], ''); sync(); });
  el('mCat').addEventListener('change', sync);
  el('mPay').addEventListener('change', lookup);
  el('mMontant').addEventListener('blur', () => { const c = toCents(el('mMontant').value); if (Number.isFinite(c)) el('mMontant').value = fmt(centsStr(c)); });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const c = toCents(el('mMontant').value), body = {
      sens, categorie: el('mCat').value, montant: Number.isFinite(c) && c ? centsStr(c) : '', date: el('mDate').value,
      paiementRef: el('mCat').value === 'encaissement_reste' ? el('mPay').value.trim() : '', beneficiaire: el('mBenef').value.trim(), motif: el('mMotif').value.trim(),
    };
    modal(`<h3>Confirmer ${sens === 'entree' ? "l'entrée" : 'la sortie'} ?</h3>
      <div class="summary"><div><span>Catégorie</span><b>${esc(CATS[body.categorie][1])}</b></div><div><span>Date</span><b>${dateFr(body.date)}</b></div>
      ${body.beneficiaire ? `<div><span>${sens === 'entree' ? 'Versé par' : 'Remis à'}</span><b>${esc(body.beneficiaire)}</b></div>` : ''}
      <div><span>Motif</span><b>${esc(body.motif || '—')}</b></div>
      <div class="total"><span>Montant</span><b class="num ${sens === 'entree' ? 'amt-in' : 'amt-out'}">${sens === 'entree' ? '+' : '−'} ${dh(body.montant || 0)}</b></div></div>
      <div class="acts"><button class="btn ghost" data-close>Corriger</button><button class="btn" id="mOk">Confirmer</button></div>`,
    root => $('#mOk', root).addEventListener('click', async () => {
      busy($('#mOk', root), true);
      try { const r = await api('POST', '/api/caisse/mouvements', body); closeModal(); toast(`Mouvement ${r.mouvement.reference} enregistré.`); location.hash = `#/caisse/mouvement/${r.mouvement.reference}`; }
      catch (err) { closeModal(); $('#mErr', v).textContent = err.message; Object.entries((err.data && err.data.fields) || {}).forEach(([k, m]) => setErr(k, m)); }
    }));
  });
  sync(); if (q.get('paiement')) lookup();
  el('mMontant').focus();
}

async function viewMouvement(ref) {
  const { mouvement: m } = await api('GET', `/api/caisse/mouvements/${encodeURIComponent(ref)}`);
  const v = shell(`Mouvement ${m.reference}`, `
  <div class="no-print" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:4px">
    <a class="btn ghost" href="#/caisse">← Caisse</a>
    <a class="btn" href="/api/caisse/mouvements/${encodeURIComponent(m.reference)}/bon.pdf" target="_blank" rel="noopener">📄 Bon de caisse PDF</a>
    ${me.role === 'admin' && m.statut === 'valide' && !m.auto && !m.jourCloture ? '<button class="btn danger" id="bAnn">Annuler le mouvement</button>' : ''}
  </div>
  <section class="panel receipt">
    <div class="receipt-head"><img src="/logo.jpeg" alt="Assurances Ahl Al Khair"><div class="rt"><span class="muted">${m.sens === 'entree' ? "Bon d'entrée" : 'Bon de sortie'}</span><b class="ref">${esc(m.reference)}</b>${mvtStatut(m.statut)}</div></div>
    <div class="ecart ${m.sens === 'entree' ? 'zero' : 'neg'}" style="margin:0 0 16px"><span class="v">${m.sens === 'entree' ? '+' : '−'} ${dh(m.montant)}</span>${esc(m.categorieLabel)}</div>
    <dl>
      <dt>Date</dt><dd>${dateFr(m.date)}${m.jourCloture ? ' · 🔒 clôturée' : ''}</dd>
      ${m.beneficiaire ? `<dt>${m.sens === 'entree' ? 'Versé par' : 'Remis à'}</dt><dd>${esc(m.beneficiaire)}</dd>` : ''}
      ${m.paiementRef ? `<dt>Paiement lié</dt><dd><a href="#/paiement/${esc(m.paiementRef)}">${esc(m.paiementRef)}</a></dd>` : ''}
      <dt>Motif</dt><dd style="white-space:normal">${esc(m.motif)}</dd>
      <dt>Enregistré par</dt><dd>${esc(m.agent)} · ${dateTimeFr(m.createdAt)}</dd>
      ${m.statut === 'annule' ? `<dt>Annulé par</dt><dd>${esc(m.annulePar || '—')} · ${dateTimeFr(m.cancelledAt)}</dd><dt>Motif d'annulation</dt><dd>${esc(m.motifAnnulation)}</dd>` : ''}
    </dl>
    ${m.auto && m.statut === 'valide' ? '<p class="muted" style="font-size:13px;margin-top:14px">Mouvement créé automatiquement à partir d\'un paiement : pour le corriger, modifiez ou annulez le paiement.</p>' : ''}
  </section>`);
  const b = $('#bAnn', v);
  b && b.addEventListener('click', () => modal(`<h3>Annuler ${esc(m.reference)} ?</h3>
    <label for="aMotif">Motif de l'annulation</label><input id="aMotif" maxlength="255" placeholder="Ex. Montant saisi deux fois">
    <div class="err" id="aErr"></div>
    <div class="acts"><button class="btn ghost" data-close>Retour</button><button class="btn danger" id="aOk">Annuler le mouvement</button></div>`,
  root => $('#aOk', root).addEventListener('click', async () => {
    const motif = $('#aMotif', root).value.trim();
    if (motif.length < 5) { $('#aErr', root).textContent = 'Indiquez le motif (5 caractères minimum).'; return; }
    try { await api('POST', `/api/caisse/mouvements/${encodeURIComponent(m.reference)}/annuler`, { motif }); toast('Mouvement annulé.'); route(); }
    catch (e) { $('#aErr', root).textContent = e.message; }
  })));
}

async function viewClotures() {
  const { clotures } = await api('GET', '/api/caisse/clotures');
  const v = shell('Clôtures de caisse', `
  ${['admin', 'agent'].includes(me.role) ? '<div style="margin-bottom:14px"><a class="btn gold" href="#/caisse/cloture">🔒 Nouvelle clôture</a></div>' : ''}
  <section class="panel">${!clotures.length ? '<div class="empty">Aucune clôture pour le moment.</div>' : `<div class="table-wrap"><table>
    <thead><tr><th>Date</th><th class="r">Ouverture</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Théorique</th><th class="r">Compté</th><th class="r">Écart</th><th>Statut</th><th>Caissier</th></tr></thead>
    <tbody>${clotures.map(c => `<tr class="clickable" data-id="${c.id}" tabindex="0"><td><b>${dateFr(c.date)}</b></td>
      <td class="r num">${fmt(c.soldeOuverture)}</td><td class="r amt-in num">${fmt(c.totalEntrees)}</td><td class="r amt-out num">${fmt(c.totalSorties)}</td>
      <td class="r num">${fmt(c.soldeTheorique)}</td><td class="r num"><b>${fmt(c.montantCompte)}</b></td>
      <td class="r num ${Number(c.ecart) < 0 ? 'amt-out' : Number(c.ecart) > 0 ? 'overdue' : 'amt-in'}">${Number(c.ecart) > 0 ? '+' : ''}${fmt(c.ecart)}</td>
      <td>${c.statut === 'validee' ? '<span class="badge b-validee">Validée</span>' : '<span class="badge b-pending">En attente</span>'}</td><td>${esc(c.agent)}</td></tr>`).join('')}</tbody></table></div>`}
  </section>`);
  $$('tr[data-id]', v).forEach(tr => tr.addEventListener('click', () => { location.hash = `#/caisse/cloture/${tr.dataset.id}`; }));
}

async function viewClotureForm() {
  const date = query().get('date') || today();
  const prep = await api('GET', `/api/caisse/clotures/preparation?date=${date}`);
  if (prep.dejaCloturee) { location.hash = `#/caisse/cloture/${prep.dejaCloturee}`; return; }
  const label = c => Number(c) >= 20 ? `Billet ${c} DH` : `Pièce ${String(c).replace('.', ',')} DH`;
  const v = shell('Clôture de caisse', `
  ${prep.jourPrecedentNonCloture ? `<div class="alert bad"><span>La journée du <b>${dateFr(prep.jourPrecedentNonCloture)}</b> doit être clôturée avant celle-ci.</span><a class="btn sm" href="#/caisse/cloture?date=${prep.jourPrecedentNonCloture}">Clôturer le ${dateFr(prep.jourPrecedentNonCloture)}</a></div>` : ''}
  <div class="form-layout">
    <section class="panel">
      <div class="panel-head"><h2>Comptage des espèces</h2><input type="date" id="cDate" value="${esc(prep.date)}" max="${today()}" style="width:auto" aria-label="Date de clôture"></div>
      <p class="muted" style="margin-top:0">Comptez l'argent présent dans la caisse et saisissez le nombre de billets et de pièces.</p>
      <div class="table-wrap"><table class="billetage">
        <thead><tr><th>Coupure</th><th class="r">Nombre</th><th class="r">Montant</th></tr></thead>
        <tbody>${prep.coupures.map(c => `<tr><td>${label(c)}</td><td class="r"><input data-c="${c}" inputmode="numeric" placeholder="0" aria-label="Nombre de ${label(c)}"></td><td class="r num" data-t="${c}">0,00</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Total compté</td><td class="r num" id="cTotal">0,00 DH</td></tr></tfoot>
      </table></div>
      <div class="field" data-f="commentaire"><label for="cCom">Commentaire <span class="muted" style="font-weight:400" id="cComHint">(facultatif)</span></label>
        <input id="cCom" maxlength="255" placeholder="Explication en cas d'écart"><div class="ferr"></div></div>
      <div class="err" id="cErr" role="alert"></div>
      <div class="form-actions"><button class="btn gold" id="cSave" ${prep.jourPrecedentNonCloture ? 'disabled' : ''}>🔒 Clôturer la caisse du ${dateFr(prep.date)}</button><a class="btn ghost" href="#/caisse">Annuler</a></div>
    </section>
    <section class="panel recap">
      <h2>${dateFr(prep.date)}</h2>
      <div class="line"><span>Solde d'ouverture</span><b class="num">${dh(prep.ouverture)}</b></div>
      <div class="line"><span>+ Entrées (${prep.n} mvt)</span><b class="num amt-in">${dh(prep.entrees)}</b></div>
      <div class="line"><span>− Sorties</span><b class="num amt-out">${dh(prep.sorties)}</b></div>
      <div class="line big"><span>Solde théorique</span><b class="num">${dh(prep.theorique)}</b></div>
      <div class="line big"><span>Montant compté</span><b class="num" id="cCompte">0,00 DH</b></div>
      <div class="ecart" id="cEcart"><span class="v" id="cEcartV">—</span><span id="cEcartL"></span></div>
    </section>
  </div>`);
  const theo = Math.round(prep.theorique * 100);
  let counts = {}, compte = 0;
  function calc() {
    counts = {}; compte = 0;
    $$('input[data-c]', v).forEach(i => {
      i.value = i.value.replace(/\D/g, '').slice(0, 7);
      const n = Number(i.value || 0), c = i.dataset.c, cents = Math.round(Number(c) * 100) * n;
      if (n) counts[c] = n;
      compte += cents;
      $(`[data-t="${c}"]`, v).textContent = fmt(cents / 100);
    });
    $('#cTotal', v).textContent = dh(compte / 100);
    $('#cCompte', v).textContent = dh(compte / 100);
    const ec = compte - theo, box = $('#cEcart', v);
    box.className = 'ecart ' + (ec === 0 ? 'zero' : ec < 0 ? 'neg' : 'pos');
    $('#cEcartV', v).textContent = (ec > 0 ? '+ ' : ec < 0 ? '− ' : '') + dh(Math.abs(ec) / 100);
    $('#cEcartL', v).textContent = ec === 0 ? '✓ Caisse juste' : ec < 0 ? 'Manque dans la caisse' : 'Excédent dans la caisse';
    $('#cComHint', v).textContent = ec === 0 ? '(facultatif)' : '(obligatoire : expliquez l\'écart)';
    return ec;
  }
  $$('input[data-c]', v).forEach(i => i.addEventListener('input', calc));
  $('#cDate', v).addEventListener('change', e => { location.hash = `#/caisse/cloture?date=${e.target.value}`; });
  $('#cSave', v).addEventListener('click', () => {
    const ec = calc(), com = $('#cCom', v).value.trim();
    if (ec !== 0 && com.length < 5) { const b = $('.field[data-f="commentaire"]', v); b.classList.add('invalid'); $('.ferr', b).textContent = 'Un écart est constaté : expliquez-le.'; $('#cCom', v).focus(); return; }
    modal(`<h3>Clôturer la caisse du ${dateFr(prep.date)} ?</h3>
      <div class="summary"><div><span>Solde théorique</span><b class="num">${dh(prep.theorique)}</b></div><div><span>Montant compté</span><b class="num">${dh(compte / 100)}</b></div>
      <div class="total"><span>Écart</span><b class="num ${ec < 0 ? 'amt-out' : ec > 0 ? 'overdue' : 'amt-in'}">${ec > 0 ? '+' : ''}${dh(ec / 100)}</b></div></div>
      <p class="muted" style="font-size:13px">Après la clôture, aucun mouvement ne pourra plus être ajouté ou annulé pour cette date.</p>
      <div class="acts"><button class="btn ghost" data-close>Recompter</button><button class="btn gold" id="cOk">Clôturer</button></div>`,
    root => $('#cOk', root).addEventListener('click', async () => {
      busy($('#cOk', root), true);
      try { const r = await api('POST', '/api/caisse/clotures', { date: prep.date, billetage: counts, commentaire: com }); closeModal(); toast('Caisse clôturée.'); location.hash = `#/caisse/cloture/${r.cloture.id}`; }
      catch (err) { closeModal(); $('#cErr', v).textContent = err.message; }
    }));
  });
  calc();
}

async function viewCloture(id) {
  const { cloture: c, mouvements } = await api('GET', `/api/caisse/clotures/${id}`);
  const ec = Number(c.ecart);
  const v = shell(`Clôture du ${dateFr(c.date)}`, `
  <div class="no-print" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <a class="btn ghost" href="#/caisse/clotures">← Clôtures</a>
    <a class="btn" href="/api/caisse/clotures/${c.id}/pv.pdf" target="_blank" rel="noopener">📄 Procès-verbal PDF</a>
    ${me.role === 'admin' && c.statut === 'en_attente' ? '<button class="btn" id="bVal">✓ Valider</button><button class="btn danger" id="bRej">Rejeter (recompter)</button>' : ''}
  </div>
  <div class="grid2">
    <section class="panel">
      <div class="panel-head"><h2>Résultat</h2>${c.statut === 'validee' ? '<span class="badge b-validee">Validée</span>' : '<span class="badge b-pending">En attente de validation</span>'}</div>
      <div class="summary">
        <div><span>Solde d'ouverture</span><b class="num">${dh(c.soldeOuverture)}</b></div>
        <div><span>+ Entrées</span><b class="num amt-in">${dh(c.totalEntrees)}</b></div>
        <div><span>− Sorties</span><b class="num amt-out">${dh(c.totalSorties)}</b></div>
        <div class="total"><span>Solde théorique</span><b class="num">${dh(c.soldeTheorique)}</b></div>
        <div><span>Montant compté</span><b class="num">${dh(c.montantCompte)}</b></div>
      </div>
      <div class="ecart ${ec === 0 ? 'zero' : ec < 0 ? 'neg' : 'pos'}"><span class="v">${ec > 0 ? '+ ' : ec < 0 ? '− ' : ''}${dh(Math.abs(ec))}</span>${ec === 0 ? '✓ Caisse juste' : ec < 0 ? 'Manque' : 'Excédent'}</div>
      ${c.commentaire ? `<p><b>Commentaire :</b> ${esc(c.commentaire)}</p>` : ''}
      <p class="muted" style="font-size:13px">Comptage par ${esc(c.agent)} · ${dateTimeFr(c.createdAt)}${c.validateur ? `<br>Validé par ${esc(c.validateur)} · ${dateTimeFr(c.validatedAt)}` : ''}</p>
    </section>
    <section class="panel"><h2>Billetage</h2>
      ${Object.keys(c.billetage).length ? `<div class="table-wrap"><table><tbody>${Object.entries(c.billetage).sort((a, b) => b[0] - a[0]).map(([k, n]) => `<tr><td>${Number(k) >= 20 ? 'Billet' : 'Pièce'} ${String(k).replace('.', ',')} DH</td><td class="r num">× ${n}</td><td class="r num"><b>${fmt(Number(k) * n)}</b></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Caisse vide.</div>'}
    </section>
  </div>
  <section class="panel"><h2>Mouvements du jour</h2>${mvtTable(mouvements)}</section>`);
  bindMvtRows(v);
  const bV = $('#bVal', v), bR = $('#bRej', v);
  bV && bV.addEventListener('click', async () => { try { await api('POST', `/api/caisse/clotures/${c.id}/valider`); toast('Clôture validée.'); route(); } catch (e) { fail(e); } });
  bR && bR.addEventListener('click', () => modal(`<h3>Rejeter la clôture ?</h3><p class="muted">La journée sera rouverte et le caissier devra recompter.</p>
    <label for="rMotif">Motif</label><input id="rMotif" maxlength="255" placeholder="Ex. Écart non justifié, recompter la caisse"><div class="err" id="rErr"></div>
    <div class="acts"><button class="btn ghost" data-close>Retour</button><button class="btn danger" id="rOk">Rejeter</button></div>`,
  root => $('#rOk', root).addEventListener('click', async () => {
    const motif = $('#rMotif', root).value.trim();
    if (motif.length < 5) { $('#rErr', root).textContent = 'Indiquez le motif.'; return; }
    try { await api('POST', `/api/caisse/clotures/${c.id}/rejeter`, { motif }); toast('Clôture rejetée : la journée est rouverte.'); location.hash = '#/caisse/clotures'; }
    catch (e) { $('#rErr', root).textContent = e.message; }
  })));
}

/* ================= Statistiques ================= */
async function viewStats() {
  const v = shell('Statistiques', '<div class="empty">Chargement…</div>');
  const { kpis: k, daily, topAgents, byType } = await api('GET', '/api/admin/stats');
  const maxType = Math.max(1, ...byType.map(t => Number(t.ttc)));
  const days = [...Array(14)].map((_, i) => {
    const d = new Date(today() + 'T12:00:00'); d.setDate(d.getDate() - 13 + i);
    const key = d.toISOString().slice(0, 10), row = daily.find(x => String(x.jour).slice(0, 10) === key) || {};
    return { d, ttc: Number(row.ttc || 0), avance: Number(row.avance || 0) };
  });
  const max = Math.max(1, ...days.map(x => x.ttc)), W = 560, H = 230, P = 30, bw = (W - P * 2) / 14;
  const resteT = Number(k.resteVirement) + Number(k.resteEspece);
  v.innerHTML = `
  <div class="kpis">
    <div class="kpi"><span>Paiements (hors annulés)</span><b class="num">${k.nb}</b></div>
    <div class="kpi"><span>En attente de validation</span><b class="num">${k.enAttente || 0}</b></div>
    <div class="kpi"><span>Validés</span><b class="num">${k.valides || 0}</b></div>
    <div class="kpi"><span>Annulés</span><b class="num">${k.annules || 0}</b></div>
  </div>
  <div class="grid2">
    <section class="panel chart"><h2>14 derniers jours</h2>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Total TTC et avances par jour">
        <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="currentColor" stroke-opacity=".2"/>
        ${days.map((x, i) => {
          const h1 = (H - P * 2) * x.ttc / max, h2 = (H - P * 2) * x.avance / max, X = P + i * bw;
          return `<rect x="${X + 3}" y="${H - P - h1}" width="${bw - 6}" height="${Math.max(h1, 1)}" rx="3" fill="#F2B233"><title>${x.d.toLocaleDateString('fr-FR')} — TTC ${fmt(x.ttc)} DH</title></rect>
            <rect x="${X + 8}" y="${H - P - h2}" width="${bw - 16}" height="${Math.max(h2, 0)}" rx="2" fill="#4FA544"><title>Avances ${fmt(x.avance)} DH</title></rect>
            ${i % 2 ? `<text x="${X + bw / 2}" y="${H - 10}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".6">${x.d.getDate()}/${x.d.getMonth() + 1}</text>` : ''}`;
        }).join('')}
      </svg>
      <div class="muted" style="font-size:13px">🟨 Total TTC &nbsp; 🟩 Avances encaissées</div>
    </section>
    <section class="panel"><h2>Reste à recouvrer : ${dh(k.resteTotal)}</h2>
      ${[['Virement', k.resteVirement, 'var(--slate)'], ['Espèce', k.resteEspece, 'var(--gold)']].map(([l, val, c]) => `
        <div style="margin:14px 0"><div style="display:flex;justify-content:space-between"><span>${l}</span><b class="num">${dh(val)}</b></div>
        <div class="bar"><i style="width:${resteT ? Number(val) / resteT * 100 : 0}%;background:${c}"></i></div></div>`).join('')}
      <h2 style="margin-top:24px">Agents — 30 derniers jours</h2>
      ${topAgents.length ? topAgents.map(a => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)">
        <span>${esc(a.agent)} <small class="muted">(${a.n})</small></span><b class="num">${dh(a.avance)}</b></div>`).join('') : '<div class="empty">Aucune saisie.</div>'}
    </section>
  </div>
  <section class="panel"><h2>Par type d'assurance</h2>
    ${byType.length ? byType.map(t => `<div style="margin:12px 0"><div style="display:flex;justify-content:space-between;gap:10px">
      <span>${esc(TYPES[t.type])} <small class="muted">(${t.n} paiement${t.n > 1 ? 's' : ''})</small></span><b class="num">${dh(t.ttc)}</b></div>
      <div class="bar"><i style="width:${Number(t.ttc) / maxType * 100}%;background:var(--green)"></i></div></div>`).join('') : '<div class="empty">Aucun paiement.</div>'}
  </section>`;
}

/* ================= Utilisateurs ================= */
async function viewUsers() {
  const { users } = await api('GET', '/api/admin/users');
  const v = shell('Utilisateurs', `
  <div class="grid2" style="grid-template-columns:minmax(0,1.6fr) minmax(280px,1fr)">
    <section class="panel"><h2>Comptes</h2><div class="table-wrap"><table>
      <thead><tr><th>Utilisateur</th><th>Rôle</th><th class="r">Saisies</th><th>2FA</th><th>Dernière connexion</th><th>Accès</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td><b>${esc(u.full_name)}</b><br><small>${esc(u.email)} · ${esc(u.phone)}</small></td>
        <td><select data-role="${u.id}" style="width:auto;padding:6px 8px" ${u.id === me.id ? 'disabled' : ''}>
          ${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td class="r num">${u.nb_saisies}</td>
        <td>${u.totp_enabled ? '<span class="badge b-paid">App</span>' : '<span class="badge b-slate">SMS</span>'}</td>
        <td>${dateTimeFr(u.last_login_at)}</td>
        <td>${u.id === me.id ? '<span class="badge b-active">Vous</span>' : `<button class="btn sm ${u.status === 'active' ? 'ghost' : ''}" data-status="${u.id}" data-next="${u.status === 'active' ? 'suspended' : 'active'}">${u.status === 'active' ? 'Désactiver' : 'Réactiver'}</button>`}</td>
      </tr>`).join('')}</tbody></table></div></section>
    <section class="panel"><h2>Ajouter un utilisateur</h2>
      <form id="fUser" novalidate>
        <div class="field" data-f="fullName"><label for="uName">Nom complet</label><input id="uName" name="fullName"><div class="ferr"></div></div>
        <div class="field" data-f="email"><label for="uMail">E-mail</label><input id="uMail" name="email" type="email"><div class="ferr"></div></div>
        <div class="field" data-f="phone"><label for="uTel">Téléphone (reçoit les codes SMS)</label><input id="uTel" name="phone" placeholder="06 61 23 45 67"><div class="ferr"></div></div>
        <div class="field"><label for="uRole">Rôle</label><select id="uRole" name="role"><option value="agent">Agent</option><option value="auditeur">Auditeur</option><option value="admin">Administrateur</option></select></div>
        <div class="field" data-f="password"><label for="uPass">Mot de passe provisoire</label><input id="uPass" name="password" type="text" autocomplete="off"><div class="ferr"></div></div>
        <div class="err" id="uErr"></div>
        <button class="btn block" type="submit">Créer le compte</button>
      </form>
      <p class="muted" style="font-size:13px"><b>Agent</b> : saisit et modifie ses paiements en attente. <b>Auditeur</b> : consultation et statistiques. <b>Administrateur</b> : validation, annulation, utilisateurs.</p>
    </section>
  </div>`);
  $$('[data-role]', v).forEach(s => s.addEventListener('change', async () => {
    try { await api('PATCH', `/api/admin/users/${s.dataset.role}`, { role: s.value }); toast('Rôle mis à jour.'); } catch (e) { fail(e); route(); }
  }));
  $$('[data-status]', v).forEach(b => b.addEventListener('click', async () => {
    try { await api('PATCH', `/api/admin/users/${b.dataset.status}`, { status: b.dataset.next }); toast(b.dataset.next === 'active' ? 'Accès réactivé.' : 'Accès désactivé.'); route(); } catch (e) { fail(e); }
  }));
  $('#fUser', v).addEventListener('submit', async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target)), btn = $('button', e.target);
    $$('.field', e.target).forEach(f => { f.classList.remove('invalid'); const x = $('.ferr', f); if (x) x.textContent = ''; });
    busy(btn, true);
    try { await api('POST', '/api/admin/users', body); toast('Utilisateur créé.'); route(); }
    catch (err) {
      busy(btn, false); $('#uErr').textContent = err.message;
      Object.entries((err.data && err.data.fields) || {}).forEach(([k, m]) => { const f = $(`.field[data-f="${k}"]`, e.target); if (f) { f.classList.add('invalid'); $('.ferr', f).textContent = m; } });
    }
  });
}

/* ================= Journal ================= */
async function viewAudit() {
  const { logs } = await api('GET', '/api/admin/audit');
  shell('Journal d\'audit', `<section class="panel"><div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Cible</th><th>IP</th></tr></thead>
    <tbody>${logs.map(l => `<tr><td>${dateTimeFr(l.created_at)}</td><td>${esc(l.actor || '—')}</td><td><span class="badge b-slate">${esc(l.action.replace(/_/g, ' '))}</span></td>
      <td class="ref">${esc(l.target || '')}</td><td><small>${esc(l.ip || '')}</small></td></tr>`).join('')}</tbody></table></div></section>`);
}

/* ================= Compte ================= */
function viewAccount() {
  const v = shell('Mon compte', `<div class="grid2">
    <section class="panel"><h2>Informations</h2>
      <div class="summary">
        <div><span>Nom</span><b>${esc(me.fullName)}</b></div><div><span>E-mail</span><b>${esc(me.email)}</b></div>
        <div><span>Téléphone (codes SMS)</span><b>${esc(me.phone)}</b></div><div><span>Rôle</span><b>${ROLE[me.role]}</b></div>
        <div><span>Vérification</span><b>${me.method === 'totp' ? 'Application d\'authentification' : 'SMS'}</b></div>
        <div><span>Dernière connexion</span><b>${dateTimeFr(me.lastLoginAt)}</b></div>
      </div>
      <p class="muted" style="font-size:13px">Pour changer d'e-mail ou de téléphone, contactez un administrateur.</p>
    </section>
    <section class="panel"><h2>Vérification en deux étapes</h2>
      <div class="switch"><div><b>${me.method === 'totp' ? '📱 Application d\'authentification' : '💬 Code par SMS'}</b>
        <small>${me.method === 'totp' ? 'Le code est généré sur votre téléphone, sans SMS et sans frais.' : `Le code est envoyé au ${esc(phoneFr(me.phone))}.`}</small></div>
        <button class="btn sm ${me.method === 'totp' ? 'ghost' : ''}" id="bTotp">${me.method === 'totp' ? 'Revenir au SMS' : 'Utiliser une application'}</button></div>
      <div id="totpZone"></div>
      <p class="muted" style="font-size:13px">Applications compatibles : iPhone (Réglages → Mots de passe → Configurer le code de vérification), Google Authenticator, Microsoft Authenticator, Authy.</p>
    </section>
    <section class="panel"><h2>Changer le mot de passe</h2>
      <form id="fPw" novalidate>
        <label for="pCur">Mot de passe actuel</label><input id="pCur" type="password" autocomplete="current-password">
        <label for="pNew">Nouveau mot de passe</label><input id="pNew" type="password" autocomplete="new-password" placeholder="8 caractères minimum, lettres et chiffres">
        <div class="err" id="pErr" role="alert"></div>
        <button class="btn" type="submit">Mettre à jour</button>
      </form>
    </section></div>`);
  $('#bTotp', v).addEventListener('click', async () => {
    if (me.method === 'totp') {
      modal(`<h3>Revenir au code par SMS ?</h3><p class="muted">Vous recevrez à nouveau les codes par SMS au ${esc(phoneFr(me.phone))}.</p>
        <label for="tPass">Votre mot de passe</label><input id="tPass" type="password" autocomplete="current-password">
        <div class="err" id="tErr"></div>
        <div class="acts"><button class="btn ghost" data-close>Annuler</button><button class="btn danger" id="tOk">Confirmer</button></div>`,
      root => $('#tOk', root).addEventListener('click', async () => {
        try { await api('POST', '/api/auth/totp/disable', { password: $('#tPass', root).value }); me.method = 'sms'; closeModal(); toast('Codes par SMS réactivés.'); route(); }
        catch (e) { $('#tErr', root).textContent = e.message; }
      }));
      return;
    }
    const btn = $('#bTotp', v); busy(btn, true, 'Préparation…');
    try {
      const r = await api('POST', '/api/auth/totp/setup');
      busy(btn, false);
      $('#totpZone', v).innerHTML = `<div class="qr-box" style="margin-top:14px">
        <img class="qr-img" src="${r.qr}" alt="QR code à scanner">
        <p class="muted" style="text-align:center;margin:0;font-size:13px">Scannez ce QR code avec votre téléphone, ou saisissez cette clé à la main :<br>
          <b class="ref" style="font-size:15px;letter-spacing:.06em">${esc(r.secret.replace(/(.{4})/g, '$1 ').trim())}</b></p>
        <div style="width:100%;max-width:260px">
          <label for="tCode">Code affiché par l'application</label>
          <input id="tCode" class="otp" inputmode="numeric" maxlength="6" placeholder="••••••">
          <div class="err" id="tcErr" role="alert"></div>
          <button class="btn block" id="tEnable">Activer</button>
        </div></div>`;
      const code = $('#tCode', v);
      code.focus();
      code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); });
      $('#tEnable', v).addEventListener('click', async () => {
        try { await api('POST', '/api/auth/totp/enable', { code: code.value }); me.method = 'totp';
          toast('Application activée. À la prochaine connexion, saisissez le code affiché à ce moment-là.'); route(); }
        catch (e) { $('#tcErr', v).textContent = e.message; }
      });
    } catch (e) { busy(btn, false); fail(e); }
  });

  $('#fPw', v).addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button', e.target); busy(btn, true);
    try { await api('POST', '/api/auth/password', { current: $('#pCur').value, next: $('#pNew').value }); toast('Mot de passe mis à jour.'); e.target.reset(); $('#pErr').textContent = ''; }
    catch (err) { $('#pErr').textContent = err.message; }
    busy(btn, false);
  });
}

/* ================= Démarrage ================= */
window.addEventListener('hashchange', route);
(async () => {
  try { cfg = await (await fetch('/api/config')).json(); } catch { cfg = {}; }
  if (!location.hash) location.hash = '#/tableau-de-bord'; else route();
})();
})();
