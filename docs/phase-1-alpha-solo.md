# Phase 1 : alpha solo

## Objectif

Un testeur crée un compte, arrive dans son appart, crée des objets en les décrivant, les place, se déconnecte, revient le lendemain et retrouve tout. Pas d'autres joueurs visibles.

Porte de sortie de la phase : 20 à 30 testeurs reviennent jouer d'eux mêmes, et la majorité des créations donnent envie d'être montrées.

## Déjà fait dans le repo

- `packages/render` : moteur de rendu des recettes (pixels RGBA + masque), extrait du prototype, testé.
- `packages/generator` : prompt du modèle et `validateRecipe`, testés.
- `apps/server` : Fastify avec `/health` et un rendu PNG serveur des objets d'exemple (`/api/seeds/:index.png`).
- `apps/client` : PixiJS qui dessine une chambre 8 x 8 et les objets d'exemple via le moteur partagé.

## Périmètre à construire

Dans cet ordre, une étape par session de travail.

1. **Base de données**
   - PostgreSQL via `docker-compose.yml`, migrations versionnées (outil au choix, léger : node-pg-migrate ou Drizzle).
   - Tables : `users`, `items`, `placements`, `creation_charges` (journal des charges dépensées et rechargées), `item_serial` (séquence de numérotation).
2. **Comptes**
   - Inscription : email, mot de passe (argon2), pseudo, date de naissance.
   - Alpha réservée aux adultes : refus d'inscription sous 18 ans pour l'instant, avec un message clair. Le parcours mineurs arrive avant la beta.
   - Session par cookie httpOnly. Connexion, déconnexion.
3. **Appart**
   - Grille 8 x 8 en isométrique 2:1, style du prototype (murs, parquet, fenêtre).
   - Avatar qui se déplace case par case (pathfinding simple, cases occupées bloquantes).
4. **Création d'objets** (`POST /api/creations`)
   - Corps : `{ description }`, 3 à 200 caractères.
   - Vérifie qu'il reste une charge : 5 charges par jour et par joueur, rechargées à minuit heure de Paris.
   - Filtre texte local (liste de mots interdits) puis appel du modèle (clé `ANTHROPIC_API_KEY`, modèle dans `GENERATOR_MODEL`).
   - `validateRecipe` sur la réponse. Refus du modèle ou recette invalide : la charge est rendue.
   - Dans UNE transaction : débit de la charge, numéro suivant de la séquence, insertion de l'objet (recette, nom, description, créateur, date, édition 1/1).
   - Le sprite est rendu à la demande par `packages/render` (PNG mis en cache), jamais envoyé par le client.
5. **Inventaire et placement**
   - `GET /api/inventory`, `PUT /api/placements` `{ itemId, i, j }`, `DELETE /api/placements/:itemId`.
   - Le serveur vérifie : l'objet appartient au joueur, la case est dans la grille et libre.
6. **Fiche objet** : nom, description d'origine, numéro sur 4 chiffres, édition, créateur, date. Comme dans le prototype.
7. **Bible graphique** : `docs/bible-graphique.md` (palette, contour, angle, échelle) et sa version courte injectée dans le prompt du générateur.

## Hors périmètre

Multijoueur, chat, visites, marché, monnaies, VIP, paiement, animations d'objets, mobile.

## Critères d'acceptation

- [ ] Un nouveau compte crée son premier objet en moins de deux minutes après l'inscription.
- [ ] Recharger la page ou changer de navigateur affiche exactement le même appart.
- [ ] Deux créations simultanées du même joueur ne donnent jamais le même numéro ni ne dépassent ses charges (test d'intégration).
- [ ] Un placement envoyé à la main sur une case occupée ou avec l'objet d'un autre joueur est refusé.
- [ ] Une recette malformée ou hors limites ne fait jamais planter le serveur (tests sur des recettes aléatoires).
- [ ] Le même objet a des pixels identiques côté client et côté serveur (test sur le hash des pixels).
- [ ] `npm run typecheck` et `npm test` passent.
