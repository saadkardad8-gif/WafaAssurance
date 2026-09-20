const TYPES_ASSURANCE = {
  automobile: 'Automobile',
  habitation: 'Habitation',
  sante: 'Santé',
  vie_epargne: 'Vie / Épargne',
  voyage: 'Voyage / Assistance',
  responsabilite_civile: 'Responsabilité civile',
  multirisque_pro: 'Multirisque professionnelle',
  autre: 'Autre',
};
const MODES_AVANCE = { espece: 'Espèce', carte: 'Carte bancaire', virement: 'Virement', cheque: 'Chèque' };
const MODES_RESTE = { espece: 'Espèce', carte: 'Carte bancaire', virement: 'Virement' };

const CATEGORIES_CAISSE = {
  // entrées
  encaissement_avance: { sens: 'entree', label: 'Encaissement avance', auto: true },
  encaissement_reste: { sens: 'entree', label: 'Encaissement du reste' },
  approvisionnement: { sens: 'entree', label: 'Approvisionnement de caisse' },
  autre_entree: { sens: 'entree', label: 'Autre entrée' },
  // sorties
  remboursement_client: { sens: 'sortie', label: 'Remboursement client' },
  depot_banque: { sens: 'sortie', label: 'Dépôt en banque' },
  depense_agence: { sens: 'sortie', label: 'Dépense agence' },
  annulation_paiement: { sens: 'sortie', label: 'Annulation de paiement', auto: true },
  autre_sortie: { sens: 'sortie', label: 'Autre sortie' },
};

// Billets et pièces en circulation au Maroc (en DH)
const COUPURES = ['200', '100', '50', '20', '10', '5', '2', '1', '0.5', '0.2', '0.1'];

module.exports = { TYPES_ASSURANCE, MODES_AVANCE, MODES_RESTE, CATEGORIES_CAISSE, COUPURES };
