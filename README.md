# Notre Planning

Petite application web (PWA) pour gérer ses plannings **pro** et **perso** et les **croiser à deux**.

- Vues **Agenda** (liste sur 14 jours, avec le résumé du jour en tête), **Semaine** (grille horaire ; sur téléphone 3 jours, 2 en vue « Ensemble ») et **Mois** (sur téléphone, toucher un jour déplie sa liste)
- Filtres **Moi / Partenaire / Ensemble** et, dans le bouton **Filtres**, **Pro / Perso / Commun**
- Vue croisée : chaque jour est coupé en deux colonnes (une par personne), les événements communs prennent toute la largeur
- Événements **privés** : l'autre voit seulement « Occupé », sans titre, lieu ni notes (garanti par les règles de sécurité de la base)
- Événements **communs** : modifiables par les deux
- Répétitions : tous les jours, du lundi au vendredi, chaque semaine, chaque mois (+ date de fin)
- Synchronisation en temps réel, installable sur téléphone (PWA)
- Barre de navigation flottante « Liquid Glass » (Agenda, Semaine, Mois, Télétravail, Réglages, +) et thème Automatique / Clair / Sombre (⚙ Réglages → Apparence)
- Raccourcis clavier : `←` `→` naviguer, `t` aujourd'hui, `n` nouvel événement, `a` / `s` / `m` changer de vue

Stack : HTML/CSS/JS sans build + [Firebase](https://firebase.google.com) (Authentication + Cloud Firestore, offre gratuite Spark), hébergé sur GitHub Pages.

## Essayer tout de suite (mode démo)

Ouvre `index.html` dans le navigateur. Tant que `config.js` contient `firebase: null`, l'app tourne en **mode démo**
avec des données d'exemple enregistrées dans le navigateur (rien n'est partagé).

## Mise en service (partage réel)

1. Sur [console.firebase.google.com](https://console.firebase.google.com), crée un projet (Google Analytics n'est pas nécessaire).
2. **Build → Authentication → Commencer** : active le fournisseur **Adresse e-mail/Mot de passe**.
3. Dans **Authentication → Paramètres → Domaines autorisés**, ajoute `killerjohn33.github.io`.
4. **Build → Firestore Database → Créer une base de données** : choisis une région en Europe (ex. `eur3`) et le mode production.
5. Dans l'onglet **Règles** de Firestore, remplace tout le contenu par [`firestore.rules`](firestore.rules), puis clique sur **Publier**.
6. **Paramètres du projet (⚙) → Général → Vos applications → Web (`</>`)** : enregistre une app,
   puis copie l'objet `firebaseConfig` dans `config.js` (à la place de `firebase: null`).
7. Pousse sur GitHub. Le site https://killerjohn33.github.io/NotrePlanning/ se met à jour en environ une minute.

En local, il faut un serveur (le mode Firebase ne marche pas en `file://`), par exemple `python -m http.server 8000`.
Pense alors à autoriser aussi `localhost` dans l'étape 3 (il l'est normalement par défaut).

### Relier les deux plannings

1. Chacun crée son compte.
2. L'un ouvre **⚙ Réglages → Créer un code d'invitation** et envoie le code à l'autre.
3. L'autre ouvre **⚙ Réglages**, saisit le code, puis clique sur **Rejoindre**. La liaison se finalise automatiquement
   dès que la première personne a l'app ouverte. Les agendas sont alors croisés.

« Arrêter le partage » délie les deux comptes. Chacun garde ses propres événements.

### Importer son planning de travail (Excel)

**⚙ Réglages → Planning de travail → Importer un fichier Excel**. Le fichier doit contenir, dans l'une de ses feuilles,
une ligne par collaborateur, par jour et par demi-journée, avec les colonnes « Date », « Collaborateur », « Demi-journée » et « Planification ».

- Il est lu dans le navigateur. Seuls les créneaux de la personne choisie sont enregistrés, rien d'autre ne quitte l'appareil.
- Correspondances : matin et après-midi travaillés → journée (8h30–17h). « Perm » l'après-midi → permanence (8h30–18h).
  Matin seul → 8h30–12h. Les horaires sont modifiables dans la fenêtre d'import.
- Le jour de repos habituel (absent au moins 80 % du temps, ex. le lundi) est ignoré. Les autres absences sont regroupées en événements « Congés ».
- Réimporter remplace les événements déjà importés sur la période, sans créer de doublons. Les événements saisis à la main ne sont pas touchés.

### Jours de télétravail

Bouton **💻 Télétravail** (sous la barre du haut, ou dans ⚙ Réglages) : un calendrier où l'on coche ou décoche autant de jours que voulu,
sur plusieurs mois, puis on enregistre. Ces jours sont stockés à part des événements (collection `remoteDays`), donc un réimport
du planning Excel ne les efface pas. Ils s'affichent avec une icône 💻 sur la journée, et les créneaux pro de ces jours-là prennent l'icône 💻.
Le partenaire relié les voit aussi.

### Notifications

Chacun active les notifications sur son appareil dans **⚙ Réglages → Notifications**, puis choisit ce qu'il reçoit :
rappel avant ses rendez-vous perso et communs (15 min, 30 min ou 1 h avant), alerte quand l'autre ajoute ou modifie
un événement commun, résumé de la journée à 7h. Sur iPhone, l'app doit d'abord être installée sur l'écran d'accueil.

L'envoi est fait par [`notifier/notify.js`](notifier/notify.js), lancé toutes les 10 minutes par GitHub Actions
([`.github/workflows/notifications.yml`](.github/workflows/notifications.yml)), en Web Push (VAPID). Secrets du dépôt :
`FIREBASE_SERVICE_ACCOUNT` (clé JSON d'un compte de service Firebase), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
La clé publique VAPID figure aussi dans `config.js`.

### Sport à suivre

**⚙ Réglages → Sport à suivre** : coche **FC Barcelone** (matchs de l'équipe masculine, toutes compétitions) et/ou
**Formule 1** (Grands Prix). Les rendez-vous s'ajoutent à l'agenda en discret (contour pointillé, italique), à titre d'info.
Le choix est propre à l'appareil : l'autre personne ne voit rien.

Le calendrier est dans [`sport.json`](sport.json), mis à jour chaque matin par
[`.github/workflows/sport.yml`](.github/workflows/sport.yml) ([`notifier/sport.js`](notifier/sport.js)) à partir
d'ESPN (FC Barcelone) et de l'API Jolpica, successeur d'Ergast (Formule 1). Aucun secret n'est nécessaire.

### Sécurité

Tout est contrôlé par [`firestore.rules`](firestore.rules). Les clés de `config.js` ne sont pas secrètes.
- On ne voit le planning de quelqu'un que si les deux comptes sont reliés **réciproquement**, et la liaison n'est possible que par un code d'invitation.
- Un événement privé est stocké sans titre, lieu ni notes. Ces détails vont dans `eventSecrets`, que seul l'auteur peut lire.
- Seuls les événements « commun » sont modifiables par l'autre personne.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page, dialogues |
| `styles.css` | Styles (variables clair/sombre, responsive) |
| `app.js` | Interface : vues, récurrences, créneaux libres, formulaires |
| `import.js` | Lecture du planning Excel (SheetJS chargé à la demande) et conversion en événements |
| `store.js` | Accès aux données : Firebase (écoute en temps réel) ou mode démo, avec la même interface |
| `config.js` | Configuration web Firebase |
| `firestore.rules` | Règles de sécurité Firestore |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | PWA (installation et hors-ligne) |

## Limites actuelles

- Modifier un événement répété modifie **toute la série**. On ne peut pas encore modifier une seule occurrence.
- Un planning commun relie au maximum deux personnes.
