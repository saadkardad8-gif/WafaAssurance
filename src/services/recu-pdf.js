/** Génère le reçu de paiement au format PDF (A4). */
const path = require('path');
const PDFDocument = require('pdfkit');
const { TYPES_ASSURANCE, MODES_AVANCE, MODES_RESTE } = require('../constants');

const GREEN = '#1D4A2C', GOLD = '#F2B233', LIGHT = '#F5F7F2', MUTED = '#62707D', INK = '#1B2733', RED = '#C2412D';
const LOGO = path.join(__dirname, '..', '..', 'public', 'logo.jpeg');

// Format « 12 500,00 DH » avec des espaces simples (compatibles avec les polices PDF standard)
const money = n => {
  const [i, d] = Number(n || 0).toFixed(2).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d} DH`;
};
const dateFr = s => {
  const m = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const [y, mo, d] = String(s).slice(0, 10).split('-');
  return `${Number(d)} ${m[Number(mo) - 1]} ${y}`;
};
const dateTime = d => new Date(d).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const phoneFr = p => p ? p.replace(/^\+212(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '0$1 $2 $3 $4 $5') : '—';
const STATUT = { en_attente: ['EN ATTENTE DE VALIDATION', '#9A6512'], valide: ['VALIDÉ', '#2F7D32'], annule: ['ANNULÉ', RED] };

function renderRecu(p, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Reçu ${p.reference}`, Author: 'Assurances Ahl Al Khair' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="recu-${p.reference}.pdf"`);
  doc.pipe(res);

  const L = 50, R = doc.page.width - 50, W = R - L;

  // En-tête
  try { doc.image(LOGO, L, 45, { height: 60 }); } catch { /* logo absent */ }
  doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('REÇU DE PAIEMENT', L, 52, { width: W, align: 'right' });
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(18).text(p.reference, L, 66, { width: W, align: 'right' });
  const [stLabel, stColor] = STATUT[p.statut];
  doc.fillColor(stColor).fontSize(9).text(stLabel, L, 90, { width: W, align: 'right' });
  doc.moveTo(L, 120).lineTo(R, 120).lineWidth(2).strokeColor(GREEN).stroke();

  // Bloc souscripteur / contrat
  let y = 140;
  const row = (label, value, x, w) => {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(label, x, y, { width: w });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(value || '—', x, y + 12, { width: w });
  };
  const half = (W - 20) / 2;
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(11).text('SOUSCRIPTEUR ET CONTRAT', L, y); y += 22;
  row('Souscripteur', p.souscripteur, L, half); row('Téléphone', phoneFr(p.telephone), L + half + 20, half); y += 40;
  row('N° de police', p.num_police, L, half); row("Type d'assurance", TYPES_ASSURANCE[p.type_assurance], L + half + 20, half); y += 40;
  row('Date du paiement', dateFr(p.date_paiement), L, half);
  row('Mode de paiement du reste', Number(p.reste_a_payer) === 0 ? 'Soldé' : (MODES_RESTE[p.mode_reste] || '—'), L + half + 20, half); y += 40;
  if (p.ref_virement) { row('Référence virement', p.ref_virement, L, W); y += 40; }

  // Montants
  y += 10;
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(11).text('MONTANTS', L, y); y += 20;
  const lines = [['Total TTC', p.total_ttc], ['Avance versée', p.avance], ['Reste à payer', p.reste_a_payer]];
  if (p.mode_avance) lines[1][0] = `Avance versée (${MODES_AVANCE[p.mode_avance]})`;
  lines.forEach(([label, val], i) => {
    const last = i === lines.length - 1, h = last ? 38 : 30;
    doc.rect(L, y, W, h).fill(last ? '#FDF3DC' : (i % 2 ? '#FFFFFF' : LIGHT));
    doc.fillColor(INK).font(last ? 'Helvetica-Bold' : 'Helvetica').fontSize(last ? 13 : 11).text(label, L + 14, y + (h - 12) / 2);
    doc.font('Helvetica-Bold').fontSize(last ? 15 : 11).text(money(val), L, y + (h - (last ? 14 : 12)) / 2, { width: W - 14, align: 'right' });
    y += h;
  });
  doc.rect(L, y - 98, W, 98).lineWidth(0.5).strokeColor('#E2E7DE').stroke();

  // Paiements par carte
  if (p.cartes && p.cartes.length) {
    y += 16;
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(11).text('RÉGLÉ PAR CARTE BANCAIRE', L, y); y += 16;
    p.cartes.forEach(c => {
      doc.fillColor(INK).font('Helvetica').fontSize(10)
        .text(`${c.cible === 'avance' ? 'Avance' : 'Solde'} · ${c.reseau || 'Carte'} ${c.masked_pan || ''} · autorisation ${c.auth_code || '—'}`, L + 12, y)
        .text(money(c.montant), L, y, { width: W - 12, align: 'right' });
      y += 15;
    });
  }

  // Traçabilité
  y += 22;
  doc.fillColor(MUTED).font('Helvetica').fontSize(9)
    .text(`Saisi par ${p.agent} le ${dateTime(p.created_at)}`, L, y);
  if (p.validateur) doc.text(`Validé par ${p.validateur} le ${dateTime(p.validated_at)}`);
  if (p.statut === 'annule') doc.fillColor(RED).text(`Annulé par ${p.annule_par} le ${dateTime(p.cancelled_at)} — Motif : ${p.motif_annulation}`);

  // Signatures
  y = Math.max(doc.y + 50, 600);
  doc.moveTo(L, y + 60).lineTo(L + half, y + 60).moveTo(L + half + 20, y + 60).lineTo(R, y + 60).lineWidth(0.8).strokeColor('#BFC7BC').stroke();
  doc.fillColor(MUTED).fontSize(9).text('Signature du souscripteur', L, y + 66, { width: half })
    .text("Cachet et signature de l'agence", L + half + 20, y + 66, { width: half });

  // Pied de page
  doc.fillColor(MUTED).fontSize(8).text('Assurances Ahl Al Khair — Wafa Assurance · Document généré le ' + dateTime(new Date()),
    L, doc.page.height - 60, { width: W, align: 'center' });

  if (p.statut === 'annule') {
    doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .fillColor(RED).opacity(0.12).font('Helvetica-Bold').fontSize(110)
      .text('ANNULÉ', 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center' }).restore();
  }
  doc.end();
}

/* ---------- Éléments communs ---------- */
function header(doc, title, reference, statusText, statusColor) {
  const L = 50, W = doc.page.width - 100;
  try { doc.image(LOGO, L, 45, { height: 60 }); } catch { /* logo absent */ }
  doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(title, L, 52, { width: W, align: 'right' });
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(18).text(reference, L, 66, { width: W, align: 'right' });
  if (statusText) doc.fillColor(statusColor).fontSize(9).text(statusText, L, 90, { width: W, align: 'right' });
  doc.moveTo(L, 120).lineTo(L + W, 120).lineWidth(2).strokeColor(GREEN).stroke();
}
function footer(doc) {
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Assurances Ahl Al Khair — Wafa Assurance · Document généré le ' + dateTime(new Date()),
    50, doc.page.height - 60, { width: doc.page.width - 100, align: 'center' });
}
function watermark(doc, text) {
  doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] })
    .fillColor(RED).opacity(0.12).font('Helvetica-Bold').fontSize(110)
    .text(text, 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center' }).restore();
}
function start(res, title, filename) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: title, Author: 'Assurances Ahl Al Khair' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}

/* ---------- Bon de caisse (entrée / sortie) ---------- */
function renderBonCaisse(m, res) {
  const doc = start(res, `Bon de caisse ${m.reference}`, `bon-caisse-${m.reference}.pdf`);
  const L = 50, W = doc.page.width - 100, half = (W - 20) / 2;
  const entree = m.sens === 'entree';
  header(doc, entree ? "BON D'ENTRÉE DE CAISSE" : 'BON DE SORTIE DE CAISSE', m.reference,
    m.statut === 'annule' ? 'ANNULÉ' : 'ENREGISTRÉ', m.statut === 'annule' ? RED : '#2F7D32');

  let y = 145;
  doc.rect(L, y, W, 70).fill(entree ? '#E8F3E4' : '#F9E6E2');
  doc.fillColor(entree ? '#2F7D32' : RED).font('Helvetica-Bold').fontSize(12).text(entree ? 'ENTRÉE' : 'SORTIE', L + 16, y + 14);
  doc.fillColor(INK).fontSize(26).text((entree ? '+ ' : '- ') + money(m.montant), L, y + 24, { width: W - 16, align: 'right' });
  y += 95;

  const row = (label, value, x, w) => {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(label, x, y, { width: w });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(value || '—', x, y + 12, { width: w });
  };
  row('Date', dateFr(m.date_mouvement), L, half); row('Catégorie', m.categorie_label, L + half + 20, half); y += 42;
  row(entree ? 'Versé par' : 'Remis à', m.beneficiaire, L, half); row('Paiement lié', m.paiement_ref, L + half + 20, half); y += 42;
  row('Motif', m.motif, L, W); y = doc.y + 18;
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Enregistré par ${m.agent} le ${dateTime(m.created_at)}`, L, y);
  if (m.statut === 'annule') doc.fillColor(RED).text(`Annulé par ${m.annule_par} le ${dateTime(m.cancelled_at)} — Motif : ${m.motif_annulation}`);

  y = Math.max(doc.y + 60, 470);
  doc.moveTo(L, y + 60).lineTo(L + half, y + 60).moveTo(L + half + 20, y + 60).lineTo(L + W, y + 60).lineWidth(0.8).strokeColor('#BFC7BC').stroke();
  doc.fillColor(MUTED).fontSize(9).text(entree ? 'Signature du déposant' : 'Signature du bénéficiaire', L, y + 66, { width: half })
    .text('Signature du caissier', L + half + 20, y + 66, { width: half });
  footer(doc);
  if (m.statut === 'annule') watermark(doc, 'ANNULÉ');
  doc.end();
}

/* ---------- Procès-verbal de clôture de caisse ---------- */
function renderPvCloture(c, mouvements, res) {
  const doc = start(res, `Clôture de caisse ${c.date}`, `cloture-caisse-${c.date}.pdf`);
  const L = 50, W = doc.page.width - 100;
  const ecart = Number(c.ecart);
  header(doc, 'PROCÈS-VERBAL DE CLÔTURE DE CAISSE', dateFr(c.date),
    c.statut === 'validee' ? 'VALIDÉE' : 'EN ATTENTE DE VALIDATION', c.statut === 'validee' ? '#2F7D32' : '#9A6512');

  let y = 140;
  const lines = [['Solde d\'ouverture', c.soldeOuverture], ['+ Entrées du jour', c.totalEntrees], ['- Sorties du jour', c.totalSorties],
    ['= Solde théorique', c.soldeTheorique], ['Montant compté', c.montantCompte]];
  lines.forEach(([label, val], i) => {
    const bold = i >= 3;
    doc.rect(L, y, W, 26).fill(i % 2 ? '#FFFFFF' : LIGHT);
    doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).text(label, L + 14, y + 8);
    doc.font('Helvetica-Bold').text(money(val), L, y + 8, { width: W - 14, align: 'right' });
    y += 26;
  });
  const ecColor = ecart === 0 ? '#2F7D32' : RED;
  doc.rect(L, y, W, 34).fill(ecart === 0 ? '#E8F3E4' : '#F9E6E2');
  doc.fillColor(ecColor).font('Helvetica-Bold').fontSize(13)
    .text(ecart === 0 ? 'Écart : aucun' : ecart < 0 ? 'Écart : MANQUE' : 'Écart : EXCÉDENT', L + 14, y + 11)
    .text((ecart > 0 ? '+ ' : '') + money(ecart), L, y + 11, { width: W - 14, align: 'right' });
  y += 50;
  if (c.commentaire) { doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Commentaire', L, y); doc.fillColor(INK).fontSize(10).text(c.commentaire, L, y + 12, { width: W }); y = doc.y + 14; }

  // Billetage
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(11).text('BILLETAGE', L, y); y += 18;
  const entries = Object.entries(c.billetage).sort((a, b) => Number(b[0]) - Number(a[0]));
  if (!entries.length) { doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Caisse vide (aucune coupure comptée).', L, y); y += 20; }
  entries.forEach(([coupure, n]) => {
    const label = Number(coupure) >= 20 ? `Billet de ${coupure} DH` : `Pièce de ${String(coupure).replace('.', ',')} DH`;
    doc.fillColor(INK).font('Helvetica').fontSize(10).text(`${label}  x ${n}`, L + 14, y)
      .text(money(Number(coupure) * n), L, y, { width: W - 14, align: 'right' });
    y += 16;
  });

  // Mouvements du jour
  y += 14;
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(11).text(`MOUVEMENTS DU JOUR (${mouvements.length})`, L, y); y += 18;
  mouvements.forEach(m => {
    if (y > doc.page.height - 190) { footer(doc); doc.addPage(); y = 60; }
    const label = `${m.categorieLabel} — ${m.motif}`.slice(0, 120);
    doc.font('Helvetica').fontSize(9);
    const h = Math.max(15, doc.heightOfString(label, { width: W - 210 }) + 5);
    doc.fillColor(MUTED).text(m.reference, L, y, { width: 95 });
    doc.fillColor(INK).text(label, L + 100, y, { width: W - 210 });
    doc.fillColor(m.sens === 'entree' ? '#2F7D32' : RED).font('Helvetica-Bold')
      .text((m.sens === 'entree' ? '+ ' : '- ') + money(m.montant), L, y, { width: W, align: 'right' });
    y += h;
  });

  y = Math.max(y + 30, doc.page.height - 190);
  if (y > doc.page.height - 130) { footer(doc); doc.addPage(); y = 80; }
  const half = (W - 20) / 2;
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Comptage par ${c.agent} le ${dateTime(c.createdAt)}`, L, y);
  if (c.validateur) doc.text(`Validé par ${c.validateur} le ${dateTime(c.validatedAt)}`, L + half + 20, y, { width: half });
  doc.moveTo(L, y + 60).lineTo(L + half, y + 60).moveTo(L + half + 20, y + 60).lineTo(L + W, y + 60).lineWidth(0.8).strokeColor('#BFC7BC').stroke();
  doc.fillColor(MUTED).fontSize(9).text('Signature du caissier', L, y + 66, { width: half }).text('Signature du responsable', L + half + 20, y + 66, { width: half });
  footer(doc);
  doc.end();
}

module.exports = { renderRecu, renderBonCaisse, renderPvCloture };
