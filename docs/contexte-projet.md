# Coloxel : contexte du projet et décisions

À lire en premier par toute personne (ou tout agent) qui reprend le projet. Ce fichier résume d'où vient Coloxel, ce qui a été décidé, pourquoi, et ce qui a été écarté. Le détail du jeu est dans `docs/conception.md`, le travail en cours dans la spec de la phase courante.

Dernière mise à jour : 7 octobre 2026.

## D'où vient le projet

Maxime, le fondateur, jouait aux « retros » Habbo : des serveurs pirates qui faisaient tourner une copie de Habbo avec leurs propres équipes, events et objets. Ce qui rendait ces serveurs vivants : une communauté qui possède son hôtel, des objets rares, le trade, les groupes de roleplay.

L'idée de départ était de relancer ce type de jeu, rentable, puis d'en faire une franchise. Elle a évolué en un jeu original, Coloxel, pour trois raisons :

1. **Juridique** : un retro utilise les assets et la marque de Sulake, éditeur de Habbo. Interdit et attaquable. Coloxel n'en reprend rien.
2. **Différenciation** : une copie modernisée de Habbo serait perçue comme « un faux Habbo » et plafonnerait.
3. **Une mécanique jamais vue** : la création d'objets par description, que le fondateur sait construire grâce à son expérience des LLM.

## Le concept en une phrase

Un jeu social en pixel art où chaque objet est inventé par un joueur : il le décrit en texte, l'objet naît en exemplaire unique et numéroté, il le pose chez lui, le montre, l'échange.

Promesse : « Tout ce que tu imagines peut exister chez toi. »

## Décisions prises

| Sujet | Décision | Pourquoi |
| --- | --- | --- |
| Nom | Coloxel (coloc + pixel). Habitants : les Coloxels | Court, prononçable en français et en anglais, .com libre, déposable |
| Univers | Ville d'immeubles vus en coupe. Un appart par joueur, un immeuble = une communauté | Différent de l'hôtel Habbo, très partageable en capture, prépare la franchise (un immeuble par communauté) |
| Vue de l'appart | Isométrique 2:1, grille de cases | Lisible pour décorer, prototype validé dans ce style |
| Style | Pixel art chaleureux, formes rondes, couleurs saturées mais douces, contour d'un pixel `#1b1530`. Voir `docs/bible-graphique.md` | Identité propre, jamais confondue avec Habbo |
| Création d'objets | Le modèle produit une **recette de formes géométriques** en JSON, le moteur du jeu (`packages/render`) la dessine | Style constant, coût par objet très bas, rendu identique partout, sortie du modèle validable |
| Rareté | Chaque création est unique (1/1) et numérotée. Plus tard, séries limitées de 1, 5 ou 10 exemplaires choisies par le créateur | Les rares naissent des joueurs, pas de l'éditeur. C'est le cœur du concept |
| Immuabilité | Un objet verrouillé ne change plus jamais, seul son propriétaire peut changer | Sa valeur repose dessus |
| Limite de création | Charges quotidiennes (5 par jour en alpha) | Coût du modèle maîtrisé, rareté réelle |
| Cible | 18 à 35 ans nostalgiques de Habbo, créatifs plutôt que compétitifs | Public qui a connu le genre et qui paie pour du statut |
| Mineurs | Acceptés à terme, avec protections conçues dès le départ. **L'alpha est réservée aux adultes** | Obligations DSA et RGPD, consentement parental sous 15 ans en France, risque historique (scandale Habbo de 2012) |
| Monétisation | VIP Atelier (abonnement), royalties créateurs, saisons mensuelles, packs de monnaie premium, immeubles premium pour les groupes | Gagner sur le statut et la créativité, jamais sur le hasard |
| Monnaies | Pixels (gratuite, gagnée en jouant) et Coloxs (premium, achetée). **Les Coloxs ne se reconvertissent jamais en euros** | Pas de statut de plateforme financière, moins de fraude |
| Jeux d'argent | Aucun : pas de casino, dés, ni loot boxes payantes | Illégal en France dès qu'une valeur réelle est en jeu |
| Mobilier de base | Catalogue de basiques (sols, murs, lit, chaise, table, lampe, plante) **gratuit et illimité** en phase 2, avec un kit de départ. Ces objets ne sont ni numérotés ni échangeables. Ils passent en Pixels en phase 3 | Un appart neuf ne doit pas être vide, et seules les créations des joueurs doivent avoir de la valeur |
| Navigation | Coupe de l'immeuble + navigateur d'apparts (mon appart, amis, apparts ouverts, hall) | Sans navigation, les visites ne servent à rien |
| Technique | TypeScript partout, PixiJS, Fastify, Colyseus, PostgreSQL, Redis, Stripe, hébergement européen (OVH ou Scaleway) | Code partagé client et serveur, transactions fiables, données en Europe |
| Autorité | Le serveur décide de tout, le client envoie des intentions | Anti duplication, anti triche |

## Idées écartées, à ne pas réintroduire sans discussion

- Reprendre des assets, noms ou termes de Habbo (« mobis », hôtel, crédits).
- Générer des images bitmap avec un modèle d'image : style incontrôlable, coût élevé.
- Une monnaie dès la phase 2 : rien de rare à acheter tant que le marché n'existe pas.
- Retrait en argent réel des gains des créateurs.
- Casino, dés, roulettes, loot boxes payantes, même « pour le fun ».
- Vue de dessus ou 3D low poly : moins de charme ou trop chère à produire.

## Feuille de route

Chaque phase ne s'ouvre que lorsque la précédente a franchi sa porte.

| Phase | Contenu | Porte |
| --- | --- | --- |
| 0. Prototype Atelier Pixel | Création par description, chambre solo, sauvegarde locale (`prototype/`) | Les créations donnent envie d'être montrées |
| 1. Alpha solo | Comptes, appart, création côté serveur, inventaire, placement, fiche objet, bible graphique | 20 à 30 testeurs reviennent jouer d'eux mêmes |
| 2. Multijoueur (construite, à valider avec des testeurs) | Temps réel, immeuble, navigation, visites, catalogue de base gratuit, chat filtré, amis, signalements, panel staff | Aucune faille de duplication connue, modération testée |
| 3. Beta fermée (en cours, spec : `docs/phase-3-beta-fermee.md`) | Marché entre joueurs, Pixels et Coloxs, VIP Atelier, royalties, communauté Discord | Des testeurs paient le VIP, le marché tient sans inflation |
| 4. Lancement public | Site, saisons, immeubles de groupe, parcours mineurs, conformité DSA et RGPD relue | |
| Ensuite | Immeubles premium, franchise | |

## État au 7 octobre 2026

- Phase 1 codée et relue : 52 tests passent contre PostgreSQL. Numérotation et charges sûres en concurrence, objets immuables par trigger, placements arbitrés par contrainte unique, sessions hachées, argon2.
- Sprites visibles par les visiteurs d'un appart accessible : fait.
- Limite de débit sur connexion, inscription et création : faite. Reste un vrai test du générateur avec la clé API (les tests utilisent un modèle simulé).
- La porte de la phase 1 (testeurs qui reviennent) n'a pas encore été franchie : le fondateur a choisi d'avancer sur les phases suivantes en parallèle. Mettre le jeu entre les mains de testeurs reste prioritaire.
- Phase 2 : les 9 étapes sont construites, avec des ajouts (personnage, boutique en Pixels, compagnons, mécaniques inspirées). Reste à valider avec de vrais testeurs : modération en conditions réelles, interface dans un navigateur.
- Le fondateur a décidé de passer en phase 3 (7 octobre 2026) : spec dans `docs/phase-3-beta-fermee.md`, avec des valeurs provisoires pour la commission et les royalties (5 %).

## Décisions encore ouvertes

- Web seul au départ, ou web puis mobile.
- Prix et paliers du VIP et des monnaies (après la beta, sur données réelles).
- Pourcentage des royalties créateurs et de la commission du marché.
- Marque Coloxel à vérifier à l'INPI et à l'EUIPO, domaine coloxel.com à sécuriser.

## Comment travailler sur ce repo

1. Lire `CLAUDE.md`, puis ce fichier, puis la spec de la phase en cours.
2. Une étape de la spec à la fois. Proposer un plan court avant de coder une étape, puis la livrer avec ses tests.
3. `npm run typecheck` et `npm test` doivent passer avant chaque commit. Les tests de base de données tournent contre PostgreSQL (`docker compose up -d`).
4. Si une demande contredit une décision de ce fichier, le signaler avant d'agir plutôt que de trancher seul.
5. Quand une décision change, mettre à jour ce fichier dans le même commit.
