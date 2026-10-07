# Coloxel

Jeu social en pixel art où chaque objet est inventé par un joueur : il le décrit en texte, un modèle IA produit une recette de formes, le moteur de rendu du jeu la dessine, et l'objet naît en exemplaire unique et numéroté.

- Conception complète du jeu : `docs/conception.md`
- **Phase en cours : phase 2, multijoueur.** Spec : `docs/phase-2-multijoueur.md`. Commence par sa section « Avant de commencer » (vérification de la phase 1). Ne construis rien qui appartient à une phase suivante (marché, monnaies, VIP, paiement, messages privés, comptes mineurs) sans qu'on te le demande.
- Phase précédente, terminée : `docs/phase-1-alpha-solo.md`
- Ajout demandé en cours de phase 2 : éditeur de personnage, boutique en Pixels et compagnons, sans paiement réel (`docs/personnage-boutique.md`). Crédits payants, Coloxs, VIP et marché restent à faire.
- Mécaniques ajoutées en phase 2 (défis, lumières, sonnette) et idées retenues pour la suite (mécanismes programmables, échange, compagnons) : `docs/mecaniques-inspirees.md`. Ne rien construire de la liste « À faire » sans qu'on le demande.
- Prototype d'origine (référence visuelle et comportementale) : `prototype/atelier-pixel.html`

## Stack

| Brique | Choix |
| --- | --- |
| Langage | TypeScript strict partout |
| Client | Vite + PixiJS v8 (`apps/client`) |
| Serveur | Node.js + Fastify (`apps/server`), temps réel Colyseus dans le même processus (`apps/server/src/realtime`, port 2567) |
| Données | PostgreSQL, Redis (présence temps réel) |
| Moteur de rendu des objets | `packages/render`, pur TypeScript, sans DOM, utilisé par le client ET le serveur |
| Générateur | `packages/generator` : prompt du modèle + validation des recettes |
| Tests | Vitest |

## Structure

```
apps/client        client de jeu (navigateur)
apps/server        API + rendu serveur des objets
packages/render    recette -> pixels (RGBA), identique partout
packages/world     grille des salles et pathfinding, partagés client/serveur
packages/generator prompt du modèle, validation et nettoyage des recettes
docs/              conception, spec de phase, bible graphique
prototype/         prototype Atelier Pixel, ne pas modifier
```

Les packages sont consommés directement en source TypeScript (`exports` pointe sur `src/index.ts`), pas de build intermédiaire.

## Commandes

```
npm install
npm run dev          # client (http://localhost:5173) + serveur (http://localhost:3000)
npm test             # tests Vitest de tous les packages
npm run typecheck    # tsc --noEmit sur chaque workspace
```

Avant de considérer une tâche finie : `npm run typecheck` et `npm test` passent.

## Règles non négociables

1. **Le serveur décide de tout.** Le client affiche et envoie des intentions (« je veux poser l'objet X en (3,4) »), jamais des résultats. Toute création, tout placement, tout transfert est validé côté serveur.
2. **Un objet est unique et immuable une fois verrouillé.** Son identifiant, son numéro, son créateur et sa recette ne changent plus. Numérotation et transferts dans des transactions PostgreSQL atomiques.
3. **Une seule source de rendu.** Tout sprite d'objet sort de `packages/render`. Le client ne redessine jamais un objet à sa façon, sinon l'objet ne serait plus le même partout.
4. **Aucune recette du modèle n'est rendue sans passer par `validateRecipe`** (`packages/generator`). La sortie du modèle est une donnée non fiable.
5. **Aucun asset, nom ou terme repris de Habbo** (pas de « mobis », pas d'hôtel, pas de sprites d'origine). Univers : immeubles en coupe, apparts en isométrique 2:1.
6. **Pas de jeux d'argent** : pas de casino, de dés, ni de loot boxes payantes.
7. **Mineurs** : le jeu les accepte à terme. Ne jamais exposer d'info personnelle, filtrer tout texte libre, garder les messages privés hors périmètre tant que la modération n'existe pas.
8. Secrets uniquement par variables d'environnement (`.env`, voir `.env.example`), jamais commités.

## Conventions

- Code, noms de variables et commentaires en anglais. Textes visibles par le joueur en français.
- Repère des recettes : x et y au sol (une case va de -8 à 8), z vers le haut. Projection écran : `dx = x - y`, `dy = (x + y) / 2 - z`. Sprite de 192 x 224 (une unité de recette = 2 px), ancre au pixel (96, 176) = centre de la case.
- Toute nouvelle primitive de rendu : ajout dans `types.ts`, rendu dans `render.ts`, nettoyage dans `validate.ts`, mention dans le prompt, et un test.
- Petits commits, un sujet par commit.
