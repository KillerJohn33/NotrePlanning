# Notre Planning

Petite application web (PWA) pour gérer ses plannings **pro** et **perso** et les **croiser à deux**.

- Vues **Agenda** (liste sur 14 jours), **Semaine** (grille horaire, 3 jours sur mobile) et **Mois**
- Filtres **Moi / Partenaire / Ensemble** et **Pro / Perso / Commun**
- Vue croisée : chaque jour est coupé en deux colonnes (une par personne), les événements communs prennent toute la largeur
- **« Libres ensemble »** : créneaux où aucun des deux n'a rien de prévu (7h–23h, 1 h minimum)
- Événements **privés** : l'autre voit seulement « Occupé », sans titre, lieu ni notes (masquage fait côté serveur)
- Événements **communs** : modifiables par les deux
- Répétitions : tous les jours, du lundi au vendredi, chaque semaine, chaque mois (+ date de fin)
- Synchronisation en temps réel, thème clair/sombre automatique, installable sur téléphone
- Raccourcis clavier : `←` `→` naviguer, `t` aujourd'hui, `n` nouvel événement, `a` / `s` / `m` changer de vue

Stack : HTML/CSS/JS sans build + [Supabase](https://supabase.com) (auth, Postgres, RLS, realtime).

## Essayer tout de suite (mode démo)

Ouvre `index.html` dans le navigateur. Tant que `config.js` est vide, l'app tourne en **mode démo**
avec des données d'exemple enregistrées dans le navigateur (rien n'est partagé).

## Mise en service (partage réel)

1. Crée un projet gratuit sur [supabase.com](https://supabase.com).
2. **SQL Editor** → colle le contenu de [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. **Project Settings → API** : copie la *Project URL* et la clé *anon public* dans `config.js`.
4. **Authentication → URL Configuration** : mets l'adresse où l'app est hébergée dans *Site URL*
   (et dans *Redirect URLs*), pour que les liens de confirmation et de mot de passe oublié fonctionnent.
5. Héberge le dossier sur n'importe quel hébergement statique (GitHub Pages, Netlify, Vercel…).
   En local, un simple serveur suffit : `python -m http.server 8000` puis http://localhost:8000.

### Relier les deux plannings

1. Chacun crée son compte.
2. L'un ouvre **⚙ Réglages → Créer un code d'invitation** et envoie le code à l'autre.
3. L'autre ouvre **⚙ Réglages**, saisit le code, puis clique sur **Rejoindre**. Les agendas sont maintenant croisés.

« Arrêter le partage » délie les comptes. Chacun garde ses propres événements.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page, dialogues |
| `styles.css` | Styles (variables clair/sombre, responsive) |
| `app.js` | Interface : vues, récurrences, créneaux libres, formulaires |
| `store.js` | Accès aux données : Supabase ou mode démo (même interface) |
| `config.js` | Clés Supabase |
| `supabase/schema.sql` | Tables, sécurité RLS, fonctions (`list_events`, `create/join/leave_household`) |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | PWA (installation et hors-ligne) |

## Limites actuelles

- Modifier un événement répété modifie **toute la série**. On ne peut pas encore modifier une seule occurrence.
- Les événements « Toute la journée » ne bloquent pas les créneaux « Libres ensemble ».
- Un planning commun relie au maximum deux personnes.
