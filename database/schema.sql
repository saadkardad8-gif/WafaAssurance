-- ============================================================
--  Ahl Al Khair Pay — Encaissements
--  MySQL 8 / MariaDB 10.6+
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE  users (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role            ENUM('admin','agent','auditeur') NOT NULL DEFAULT 'agent',
  full_name       VARCHAR(120) NOT NULL,
  email           VARCHAR(190) NOT NULL UNIQUE,
  phone           VARCHAR(20)  NOT NULL,
  password_hash   VARCHAR(100) NOT NULL,
  totp_secret     VARCHAR(64) NULL,                     -- application d'authentification (TOTP)
  totp_enabled    TINYINT(1) NOT NULL DEFAULT 0,
  totp_last_step  BIGINT UNSIGNED NOT NULL DEFAULT 0,   -- empêche de réutiliser un code
  status          ENUM('active','suspended') NOT NULL DEFAULT 'active',
  failed_logins   INT NOT NULL DEFAULT 0,
  locked_until    DATETIME NULL,
  last_login_at   DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE  otp_challenges (
  id            CHAR(36) PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  method        ENUM('sms','totp') NOT NULL DEFAULT 'sms',
  code_hash     CHAR(64) NOT NULL,
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  sent_count    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  last_sent_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME NOT NULL,
  consumed_at   DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_otp_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un paiement saisi par un agent.
-- reste_a_payer est TOUJOURS recalculé par le serveur (total_ttc - avance), jamais pris du navigateur.
CREATE TABLE  paiements (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference        VARCHAR(30)  NULL UNIQUE,              -- AAK-2026-000123
  souscripteur     VARCHAR(150) NOT NULL,
  telephone        VARCHAR(20)  NULL,                     -- téléphone du souscripteur (format +2126XXXXXXXX)
  num_police       VARCHAR(40)  NOT NULL,                 -- numéro de police d'assurance
  type_assurance   ENUM('automobile','habitation','sante','vie_epargne','voyage','responsabilite_civile','multirisque_pro','autre') NOT NULL,
  total_ttc        DECIMAL(12,2) NOT NULL,
  avance           DECIMAL(12,2) NOT NULL DEFAULT 0,
  mode_avance      ENUM('espece','carte','virement','cheque') NULL, -- NULL si avance = 0, espèce = entrée automatique en caisse
  reste_a_payer    DECIMAL(12,2) NOT NULL,
  mode_reste       ENUM('virement','espece','carte') NULL,        -- NULL si reste = 0
  ref_virement     VARCHAR(60)  NULL,                     -- obligatoire si mode_reste = virement
  date_paiement    DATE NOT NULL,
  statut           ENUM('en_attente','valide','annule') NOT NULL DEFAULT 'en_attente',
  motif_annulation VARCHAR(255) NULL,
  created_by       INT UNSIGNED NOT NULL,
  validated_by     INT UNSIGNED NULL,
  validated_at     DATETIME NULL,
  cancelled_by     INT UNSIGNED NULL,
  cancelled_at     DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pai_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT chk_montants CHECK (total_ttc > 0 AND avance >= 0 AND avance <= total_ttc),
  INDEX idx_pai_date (date_paiement),
  INDEX idx_pai_statut (statut),
  INDEX idx_pai_souscripteur (souscripteur),
  INDEX idx_pai_police (num_police),
  INDEX idx_pai_type (type_assurance)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clôtures journalières de la caisse de l'agence
CREATE TABLE  caisse_clotures (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  date_cloture      DATE NOT NULL UNIQUE,
  solde_ouverture   DECIMAL(12,2) NOT NULL,
  total_entrees     DECIMAL(12,2) NOT NULL,
  total_sorties     DECIMAL(12,2) NOT NULL,
  solde_theorique   DECIMAL(12,2) NOT NULL,
  montant_compte    DECIMAL(12,2) NOT NULL,
  ecart             DECIMAL(12,2) NOT NULL,              -- compté - théorique (négatif = manque)
  billetage         TEXT NOT NULL,                        -- détail des billets et pièces comptés (JSON)
  commentaire       VARCHAR(255) NULL,
  statut            ENUM('en_attente','validee') NOT NULL DEFAULT 'en_attente',
  created_by        INT UNSIGNED NOT NULL,
  validated_by      INT UNSIGNED NULL,
  validated_at      DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_clo_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mouvements de la caisse (espèces) de l'agence
CREATE TABLE caisse_mouvements (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference         VARCHAR(30) NULL UNIQUE,              -- CAI-2026-000001
  sens              ENUM('entree','sortie') NOT NULL,
  categorie         ENUM('encaissement_avance','encaissement_reste','approvisionnement','autre_entree',
                         'remboursement_client','depot_banque','depense_agence','annulation_paiement','autre_sortie') NOT NULL,
  montant           DECIMAL(12,2) NOT NULL,
  motif             VARCHAR(255) NOT NULL,
  beneficiaire      VARCHAR(150) NULL,
  paiement_id       INT UNSIGNED NULL,
  date_mouvement    DATE NOT NULL,
  statut            ENUM('valide','annule') NOT NULL DEFAULT 'valide',
  motif_annulation  VARCHAR(255) NULL,
  created_by        INT UNSIGNED NOT NULL,
  cancelled_by      INT UNSIGNED NULL,
  cancelled_at      DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_mvt_montant CHECK (montant > 0),
  CONSTRAINT fk_mvt_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_mvt_paiement FOREIGN KEY (paiement_id) REFERENCES paiements(id),
  INDEX idx_mvt_date (date_mouvement),
  INDEX idx_mvt_paiement (paiement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Paiements par carte bancaire (Visa / Mastercard) passés par la page sécurisée du CMI.
-- Aucune donnée de carte n'est stockée : seuls le numéro masqué et le code d'autorisation renvoyés par le CMI.
CREATE TABLE  paiements_carte (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference         VARCHAR(30) NULL UNIQUE,              -- CB-2026-000001
  oid               VARCHAR(40) NOT NULL UNIQUE,          -- identifiant de commande envoyé au CMI
  paiement_id       INT UNSIGNED NOT NULL,
  cible             ENUM('avance','reste') NOT NULL,
  montant           DECIMAL(12,2) NOT NULL,
  statut            ENUM('en_cours','paye','echoue','expire') NOT NULL DEFAULT 'en_cours',
  masked_pan        VARCHAR(25) NULL,
  reseau            VARCHAR(20) NULL,                     -- Visa, Mastercard…
  auth_code         VARCHAR(20) NULL,
  trans_id          VARCHAR(64) NULL,
  code_retour       VARCHAR(10) NULL,
  message_erreur    VARCHAR(255) NULL,
  paye_at           DATETIME NULL,
  created_by        INT UNSIGNED NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cb_paiement FOREIGN KEY (paiement_id) REFERENCES paiements(id),
  CONSTRAINT fk_cb_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_cb_paiement (paiement_id),
  INDEX idx_cb_statut (statut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE  audit_logs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id    INT UNSIGNED NULL,
  action      VARCHAR(60) NOT NULL,
  target      VARCHAR(80) NULL,
  details     TEXT NULL,
  ip          VARCHAR(45) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
