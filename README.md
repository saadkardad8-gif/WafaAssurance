# Ahl Al Khair Pay — Encaissements

Application web de saisie et de suivi des paiements des souscripteurs (Assurances Ahl Al Khair — Wafa Assurance).

**Fonctionnalités**
- Connexion sécurisée : e-mail + mot de passe, puis code de vérification — par **SMS réel** (Twilio ou Infobip) ou par **application d'authentification** sur le téléphone (gratuit, hors ligne).
- Formulaire de paiement interactif : Souscripteur, Téléphone (facultatif, repris automatiquement pour un souscripteur connu), N° police, Type d'assurance, Total TTC, Avance, **Reste à payer calculé automatiquement**, mode du reste (Virement / Espèce), date (aujourd'hui par défaut, modifiable), **référence virement affichée uniquement si Virement**.
- **Paiement par carte Visa / Mastercard** via la page sécurisée du CMI, pour l'avance comme pour le reste, avec simulateur intégré tant que le contrat CMI n'est pas signé.
- **Reçu PDF** téléchargeable (A4, logo, signatures, filigrane « ANNULÉ » si besoin) et reçu imprimable, avec référence unique (AAK-2026-000001).
- Liste des paiements : recherche par référence / souscripteur / n° police / téléphone / réf. virement, filtres statut, type d'assurance, mode, période, totaux, export Excel (CSV).
- Validation et annulation (avec motif) par l'administrateur, modification tant que le paiement est en attente.
- **Caisse de l'agence** : entrées et sorties d'espèces (avance en espèce ajoutée automatiquement, encaissement du reste, approvisionnement, remboursement client, dépôt en banque, dépenses), solde calculé en temps réel, refus des sorties supérieures au solde, bon de caisse PDF.
- **Clôture journalière** : comptage billet par billet (billetage), calcul automatique de l'écart (manque / excédent), commentaire obligatoire en cas d'écart, validation ou rejet par l'administrateur, procès-verbal PDF. Une journée clôturée est verrouillée.
- Souscripteurs regroupés (téléphone, polices), statistiques (dont répartition par type d'assurance), gestion des utilisateurs (Administrateur / Agent / Auditeur), journal d'audit.

**Sécurité intégrée** : reste à payer recalculé côté serveur (jamais pris du navigateur), montants en centimes (pas d'erreur d'arrondi), contrôle des doublons et des références de virement déjà utilisées, mots de passe bcrypt, blocage après 5 échecs, OTP haché et limité (5 min, 5 essais), cookie de session httpOnly, protection CSRF, en-têtes Helmet/CSP, limitation de débit.

---

## 1. Installation en local (Windows, macOS ou Linux)

Prérequis : **Node.js 18+** et **MySQL 8** (ou MariaDB 10.6+). Sous Windows, XAMPP ou MySQL Installer conviennent.

```bash
# 1. Installer les dépendances
npm install

# 2. Créer le fichier .env et la base (assistant : secrets générés automatiquement)
npm run setup

# 3. Créer les tables
npm run db:init

# 4. Créer le premier administrateur (son téléphone reçoit les codes SMS)
npm run admin:create -- "Votre Nom" admin@votre-domaine.ma 0661234567 "MotDePasse123"

# 5. Démarrer
npm start
```

> **Windows** : ouvrez le terminal *dans le dossier du projet* (clic droit dans le dossier → « Ouvrir dans le terminal »). Si vous créez `.env` à la main avec le Bloc-notes, choisissez « Tous les fichiers » à l'enregistrement, sinon Windows l'enregistre en `.env.txt` et il est ignoré.

Ouvrez **http://localhost:3000**. Avec `SMS_PROVIDER=console`, le code SMS s'affiche dans le terminal : pratique pour tester sans payer de SMS.

Pour générer JWT_SECRET et OTP_SECRET :
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Mise à jour d'une installation existante
Si vous aviez déjà installé la version précédente, relancez simplement :
```bash
npm install
npm run db:init
```
Les nouvelles tables et colonnes (caisse, mode de l'avance, téléphone, n° police, type d'assurance) sont ajoutées sans toucher aux données existantes.

### En cas de blocage de connexion
- **« Trop de tentatives de connexion »** : limite par adresse IP. Redémarrez le serveur (`Ctrl + C` puis `npm start`) ou attendez 15 minutes. La limite se règle avec `LOGIN_RATE_LIMIT` dans `.env` (100 en développement, 20 conseillé en production).
- **« Compte temporairement bloqué »** : 5 mots de passe erronés. Débloquez avec :
```bash
npm run admin:unlock                     # tous les comptes
npm run admin:unlock -- admin@domaine.ma # un seul compte
```

## 2. Vérification en deux étapes : SMS ou application d'authentification

Chaque utilisateur choisit sa méthode dans **Mon compte → Vérification en deux étapes** :

- **Code par SMS** (par défaut) : nécessite un fournisseur SMS (section suivante).
- **Application d'authentification** (gratuit, hors ligne, recommandé pour démarrer) : le code à 6 chiffres est généré par le téléphone et change toutes les 30 secondes. Aucun SMS, aucun frais, aucun fournisseur à configurer.

Pour l'activer : **Mon compte → Utiliser une application**, puis scannez le QR code avec :
- **iPhone** : Réglages → Mots de passe → l'entrée du site → *Configurer le code de vérification* → Scanner le QR code (ou appareil photo sur le QR).
- **Android / autre** : Google Authenticator, Microsoft Authenticator, Authy…

Saisissez ensuite le code affiché pour confirmer. À la connexion suivante, l'app demandera ce code au lieu du SMS. Un code ne peut être utilisé qu'une seule fois ; si vous venez d'activer, attendez le code suivant (30 secondes).

Pour revenir au SMS : **Mon compte → Revenir au SMS** (mot de passe demandé).

> L'iPhone ne peut pas servir de passerelle pour *envoyer* des SMS depuis l'application : iOS l'interdit. L'application d'authentification remplace le SMS sans aucun coût.

## 3. Activer les vrais SMS

### Option A — Twilio
1. Créez un compte sur twilio.com, récupérez **Account SID** et **Auth Token**.
2. Achetez un numéro ou créez un **Messaging Service** (recommandé pour le Maroc, avec Sender ID alphanumérique).
3. Dans `.env` :
```
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_FROM=MGxxxxxxxx
```

### Option B — Infobip
```
SMS_PROVIDER=infobip
INFOBIP_BASE_URL=https://xxxxx.api.infobip.com
INFOBIP_API_KEY=xxxxxxxx
SMS_SENDER=AhlAlKhair
```
L'enregistrement d'un Sender ID auprès des opérateurs marocains peut prendre quelques jours : demandez-le tôt au fournisseur.

## 4. Mise en ligne (serveur VPS Ubuntu)

> **Le plus simple : le dossier `deploy/`.** Il contient des scripts qui installent et configurent tout automatiquement (Node, MySQL, Nginx, HTTPS, PM2, sauvegardes), y compris pour héberger une deuxième application sur le même serveur. Voir **`deploy/GUIDE-DEPLOIEMENT.md`**. Les étapes manuelles ci-dessous restent valables si vous préférez tout faire à la main.

Hébergeurs possibles : OVH, Hostinger, Contabo, Genious (Maroc)… Un VPS 2 Go de RAM suffit.

```bash
# Sur le serveur
sudo apt update && sudo apt install -y nginx mysql-server
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm install -g pm2

# Copier le projet dans /var/www/aak-pay, puis :
cd /var/www/aak-pay && npm install --omit=dev
# Créer la base (étape 2 ci-dessus), le .env avec NODE_ENV=production et APP_URL=https://paiement.votre-domaine.ma
npm run db:init
npm run admin:create -- "Nom" admin@domaine.ma 0661234567 "MotDePasse123"
pm2 start src/server.js --name aak-pay && pm2 save && pm2 startup
```

Configuration Nginx (`/etc/nginx/sites-available/aak-pay`) :
```nginx
server {
  server_name paiement.votre-domaine.ma;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/aak-pay /etc/nginx/sites-enabled/
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d paiement.votre-domaine.ma
```

En production, l'application **refuse de démarrer** si : SMS en mode console, secrets trop courts, ou APP_URL sans HTTPS.

**Sauvegardes** : programmez un `mysqldump` quotidien (cron) vers un stockage externe.

## 5. Paiement par carte (Visa / Mastercard)

Le mode **Carte bancaire** est disponible pour l'avance et pour le reste. Après l'enregistrement du paiement, un bouton ouvre la **page de paiement sécurisée du CMI** ; le titulaire y saisit sa carte, puis revient dans l'application. Le résultat (accepté / refusé, réseau, numéro masqué, code d'autorisation) est enregistré et figure sur le reçu PDF.

**Aucune donnée de carte n'est saisie ni stockée par cette application** : ni numéro, ni date d'expiration, ni CVV. C'est la condition pour ne pas avoir à être certifié PCI-DSS.

### Sans contrat CMI (développement)
Laissez `CMI_CLIENT_ID` et `CMI_STORE_KEY` vides dans `.env` : un **simulateur de page de paiement** s'active (accepter / refuser un paiement) pour essayer tout le parcours. Il est automatiquement désactivé en production.

### Avec contrat CMI (production)
1. Signez le contrat commerçant e-commerce avec votre banque, qui transmet le dossier au CMI.
2. Le CMI fournit un **clientid** et une **clé de magasin (storekey)**, d'abord pour la plateforme de test.
3. Renseignez `.env` :
```
CMI_CLIENT_ID=600000000
CMI_STORE_KEY=votre-cle
CMI_GATEWAY_URL=https://testpayment.cmi.co.ma/fim/est3Dgate
```
4. Communiquez au CMI les URL de retour : `https://votre-domaine/cmi/ok`, `/cmi/fail` et `/cmi/callback`.
5. Après recette, passez en production : `CMI_GATEWAY_URL=https://payment.cmi.co.ma/fim/est3Dgate`.

Le montant est vérifié côté serveur, la signature SHA-512 du CMI est contrôlée à l'aller et au retour, et le `callback` serveur à serveur fait seul foi : un client qui manipulerait la page de retour ne peut pas faire passer un paiement pour accepté.

## 6. Rôles

| Rôle | Peut faire |
|---|---|
| Administrateur | Tout : saisir, modifier, valider, annuler, valider ou rejeter les clôtures de caisse, statistiques, utilisateurs, journal |
| Agent | Saisir des paiements, modifier ses propres paiements en attente, entrées / sorties de caisse, clôture journalière |
| Auditeur | Consulter paiements, caisse, clôtures, souscripteurs et statistiques (lecture seule) |

### Règles de la caisse
- Une avance en **espèce** crée automatiquement une entrée de caisse. Si le paiement est annulé, l'entrée est annulée ; si sa journée est déjà clôturée, une **sortie de régularisation** datée du jour est créée à la place.
- Une sortie ne peut jamais dépasser le solde de caisse.
- Les journées se clôturent **dans l'ordre** : impossible de clôturer un jour si un jour précédent avec des mouvements n'est pas clôturé.
- Après une clôture, la caisse repart du **montant réellement compté** (l'écart est intégré au solde).
- L'administrateur peut **rejeter** une clôture en attente : la journée est rouverte pour un nouveau comptage.

## 7. Structure

```
database/schema.sql        Tables MySQL
src/server.js              Serveur Express
src/routes/auth.js         Connexion + OTP SMS
src/routes/paiements.js    Saisie, recherche, validation, annulation, export
src/routes/admin.js        Statistiques, souscripteurs, utilisateurs, audit
src/services/sms.js        Envoi SMS (Twilio / Infobip / console)
src/services/otp.js        Codes à usage unique
src/services/totp.js       Application d'authentification (TOTP, RFC 6238)
src/routes/caisse.js       Caisse : mouvements et clôtures
src/services/caisse.js     Calcul du solde, verrou de caisse
src/services/cmi.js        Paiement par carte (CMI, signature SHA-512)
src/routes/cmi.js          Retours du CMI (callback, ok, fail)
src/services/recu-pdf.js   PDF : reçu, bon de caisse, procès-verbal de clôture
src/constants.js           Types d'assurance (modifiable)
public/                    Interface (HTML, CSS, JavaScript)
deploy/                    Scripts de mise en ligne sur un VPS
```

## 8. API principale

| Méthode | Route | Description |
|---|---|---|
| POST | /api/auth/login | E-mail + mot de passe → envoi SMS |
| POST | /api/auth/verify-otp | Code SMS ou application → session |
| POST | /api/auth/totp/setup · /enable · /disable | Application d'authentification |
| POST | /api/paiements | Créer un paiement |
| PUT | /api/paiements/:reference | Modifier (en attente) |
| GET | /api/paiements?q=&statut=&mode=&du=&au= | Rechercher |
| GET | /api/paiements/export.csv | Export Excel |
| GET | /api/paiements/:reference/recu.pdf | Reçu PDF |
| POST | /api/paiements/:reference/valider | Valider (admin) |
| POST | /api/paiements/:reference/annuler | Annuler avec motif (admin) |
| POST | /api/paiements/:reference/carte | Démarrer un paiement par carte |
| GET | /api/paiements/:reference/cartes | État des paiements par carte |
| GET | /api/admin/stats | Statistiques |
| GET | /api/caisse/resume | Solde et situation de la caisse |
| GET / POST | /api/caisse/mouvements | Lister / enregistrer une entrée ou une sortie |
| POST | /api/caisse/mouvements/:reference/annuler | Annuler un mouvement (admin) |
| GET | /api/caisse/mouvements/:reference/bon.pdf | Bon de caisse PDF |
| GET / POST | /api/caisse/clotures | Lister / clôturer une journée |
| POST | /api/caisse/clotures/:id/valider · /rejeter | Validation ou rejet (admin) |
| GET | /api/caisse/clotures/:id/pv.pdf | Procès-verbal de clôture PDF |

## 9. Ajouter ou renommer un type d'assurance

1. Modifiez la liste dans `src/constants.js` et dans `public/app.js` (constante `TYPES`).
2. Ajoutez la nouvelle valeur dans l'`ENUM` de `type_assurance` :
```sql
ALTER TABLE paiements MODIFY type_assurance ENUM('automobile','habitation','sante','vie_epargne','voyage','responsabilite_civile','multirisque_pro','autre','nouveau_type') NOT NULL;
```
