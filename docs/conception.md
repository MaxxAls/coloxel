# Coloxel, document de conception

Version du 7 octobre 2026. Source vivante : le doc Claude « Coloxel, document de conception ». Ce fichier en est la copie de travail pour le repo.

## Vision et pitch

Coloxel est un jeu social en pixel art où chaque objet est inventé par un joueur : tu le décris, il naît en exemplaire unique et numéroté, tu le poses chez toi, tu le montres, tu l'échanges.

- **Pour qui** : les 18 à 35 ans nostalgiques de Habbo et des retros, plus créatifs que compétitifs. Le jeu est ouvert aux mineurs, ce qui impose les protections décrites plus bas.
- **L'accroche connue** : un appart à décorer, des voisins, des rares, du trade, des groupes.
- **Ce que personne ne fait** : les rares ne sont pas décidés par l'éditeur, ils naissent de la créativité des joueurs. Chaque objet a un créateur, un numéro, une histoire.
- **La promesse** : « Tout ce que tu imagines peut exister chez toi. »

## Univers et direction artistique

Une ville d'immeubles vus en coupe, comme des maisons de poupée : chaque joueur a son appart, chaque immeuble est une communauté.

- **L'immeuble** : vue de côté, étages empilés, cage d'escalier, hall, toit. On voit ses voisins vivre à travers la coupe.
- **L'appart** : vue intérieure en isométrique 2:1 pour décorer et placer les objets sur une grille.
- **Espaces communs** : hall, toit terrasse, cave, plus tard café, marché, galerie des créations.
- **Style** : pixel art chaleureux, contour sombre d'un pixel, palette saturée mais douce, avatars ronds et expressifs. Formes plus rondes et couleurs plus pastel que Habbo, pas d'hôtel.
- **Les Coloxels** : le nom des habitants.

À produire : une bible graphique d'une page (palette, contour, angle, échelle des avatars) qui sert aussi de consigne au générateur.

## Boucles de jeu

Boucle centrale : imaginer, créer, montrer, échanger.

| Horizon | Ce que fait le joueur | Ce qui le fait revenir |
| --- | --- | --- |
| Une session | Crée un objet, le place, visite ses voisins, discute, like des apparts | Surprise à chaque création, réactions des autres |
| Une semaine | Récupère ses charges de création, participe à un event, vend ou achète au marché | Charges qui se rechargent, events réguliers, ventes en attente |
| Une saison | Crée des objets du thème du mois, monte au classement des créateurs | Objets de saison introuvables ensuite, reconnaissance |
| Long terme | Devient créateur reconnu, gère son immeuble, touche des royalties | Statut, revenus en jeu, communauté construite |

Règle de design : le premier objet est créé dans les deux premières minutes.

## Création d'objets

1. Le joueur écrit sa description et dépense une charge de création.
2. Filtre du texte avant toute génération (sexuel, haineux, gore, personnes réelles, marques et personnages protégés).
3. Le modèle produit la recette : nom, formes, couleurs.
4. Le serveur valide la recette et dessine le sprite avec le moteur de rendu partagé.
5. Second filtre sur l'image. Un objet signalé part en revue humaine avant d'être visible des autres.
6. L'objet reçoit numéro, date, créateur, édition (1/1 par défaut) et arrive dans l'inventaire.

Ensuite : relancer une variante (une charge), renommer, verrouiller. Verrouillé, l'objet ne change plus jamais.

Évolutions : objets animés (2 à 4 images), objets interactifs (porte, interrupteur, siège), objets sur plusieurs cases, retouche au pixel près.

Garde fou : un objet trop proche d'un objet existant est signalé au créateur.

## Économie

| Ressource | Obtention | Usage |
| --- | --- | --- |
| Charges de création | Recharge gratuite régulière, events, VIP | Créer ou relancer un objet |
| Pixels (monnaie gratuite) | Jouer, events, likes reçus | Catalogue de base, déco simple |
| Coloxs (monnaie premium) | Achat en euros, ventes au marché, royalties | Marché, séries limitées, immeubles premium |
| Objets créés | Création ou achat au marché | Décorer, collectionner, revendre |

Anti inflation : commission détruite sur chaque vente, séries plafonnées à 1, 5 ou 10 exemplaires, objets de saison non recréables, pas de conversion Pixels vers Coloxs.

Anti duplication : objets uniquement côté serveur avec identifiant unique, transferts atomiques et journalisés, historique de propriété visible.

Pas de casino, de dés ni de loot boxes payantes.

## Monétisation

| Offre | Contenu |
| --- | --- |
| VIP Atelier (mensuel) | Plus de charges, objets animés, séries limitées, palettes exclusives, badge |
| Royalties créateurs | Un pourcentage de chaque revente revient au créateur, en Coloxs |
| Saisons | Thème mensuel, objets créables uniquement pendant la saison |
| Packs de Coloxs | Monnaie premium |
| Immeubles premium | Un groupe loue un immeuble personnalisé, base de la future franchise |

Règles : les Coloxs ne se reconvertissent jamais en euros. Achats des mineurs plafonnés, confirmation parentale sous 15 ans. Prix fixés après la beta.

## Social et communauté

- Immeubles publics de départ avec places libres.
- Immeubles de groupe (amis, streamers, Discord, roleplay) : nom, façade, règles, staff.
- Rôles : propriétaire, gérants, résidents, visiteurs.
- Outils de roleplay : uniformes, badges, salles réservées, grades.
- Events : concours de déco, défis de création, enchères, soirées sur le toit.
- Galerie publique, profil créateur, classement de saison.

## Sécurité, mineurs et modération

- Date de naissance à l'inscription, consentement parental sous 15 ans, réglages protégés par défaut pour les mineurs.
- Chat public filtré, pas de messages privés adulte et mineur non amis, blocage des échanges de contacts.
- Double filtre sur les créations, signalement en un clic, masquage après plusieurs signalements.
- Staff avec panel (journaux, historique, sanctions graduées), gérants d'immeuble pour la modération locale, file prioritaire pour les signalements impliquant un mineur.
- Légal : CGU, confidentialité, mentions légales, contact autorités, procédure DSA, relecture par un avocat avant ouverture publique.

## Architecture technique

Toute la logique vit sur le serveur ; le client affiche et envoie des intentions.

- **Site web** (inscription, boutique, galerie) et **client de jeu** (rendu pixel, chat, déco) parlent à l'**API du jeu** (comptes, inventaire, marché, paiements Stripe, modération).
- Le client parle aussi au **serveur temps réel** (salles, positions, chat, WebSocket), qui s'appuie sur l'API et sur **Redis** (présence, sessions, cache).
- Le client envoie les descriptions au **service de création** (filtres, génération, rendu, mint), qui appelle le **modèle IA** et enregistre l'objet dans **PostgreSQL** (objets, propriété, transactions) via l'API.

| Brique | Choix | Pourquoi |
| --- | --- | --- |
| Client | TypeScript + PixiJS | Rendu pixel rapide, navigateur d'abord |
| Temps réel | Node.js + Colyseus | Salles et synchro prêtes à l'emploi |
| API | Node.js + TypeScript | Code partagé avec le client et le moteur de rendu |
| Données | PostgreSQL + Redis | Transactions fiables, cache rapide |
| Génération | API d'un modèle IA, JSON validé | Coût faible, style contrôlé par le moteur |
| Paiement | Stripe | Abonnements, achats |
| Hébergement | OVH ou Scaleway | Données en Europe, RGPD |

## Roadmap

Chaque étape ne s'ouvre que si la précédente a franchi sa porte.

0. **Prototype Atelier Pixel** (fait) : création par description, chambre solo, sauvegarde locale.
   Porte : les créations donnent envie d'être montrées.
1. **Alpha solo** : comptes, sauvegarde serveur, bible graphique, moteur de rendu partagé, filtres de création.
   Porte : 20 à 30 testeurs reviennent jouer d'eux mêmes.
2. **Multijoueur** : premier immeuble, apparts, chat filtré, visites, signalements, panel staff.
   Porte : aucune faille de duplication connue, modération testée.
3. **Beta fermée** : marché, VIP Atelier, royalties, communauté Discord.
   Porte : des testeurs paient le VIP, le marché tient sans inflation.
4. **Lancement public** : site, saisons, immeubles de groupe, CGU et conformité DSA et RGPD relues.

Ensuite : immeubles premium, puis franchise.

## Risques

| Risque | Réponse |
| --- | --- |
| Qualité des créations inégale | Tests massifs du générateur, bible graphique, consignes ajustées |
| Monde vide au lancement | Immeubles de départ peuplés, beta avec communauté Discord |
| Contenu inapproprié | Double filtre, signalement, revue humaine |
| Coût de génération | Charges limitées, recette géométrique, modèle rapide pour les variantes |
| Faille économique | Logique serveur, transactions atomiques, journal de propriété |
| Charge d'animation | Staff bénévole, outils pour gérants |
| Confusion avec Habbo | Univers immeuble, style propre, aucun asset repris |
