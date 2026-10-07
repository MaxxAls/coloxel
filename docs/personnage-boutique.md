# Personnage, boutique et compagnons

Ajouté pendant la phase 2 à la demande du créateur du jeu, d'après la boutique de la vidéo de référence (structure et finition seulement : aucun asset, nom ou terme repris de Habbo). La conception prévoyait les Pixels et le catalogue payant pour la phase 3 ; ils sont là dès maintenant, **sans aucun paiement réel**.

## Ce qui existe

- **Éditeur de personnage** (barre du bas, « Personnage ») : peau, yeux, bouche, 11 coiffures, 10 hauts, 5 bas, 4 chaussures, 9 chapeaux, 5 lunettes, 6 extras, couleurs au choix. Aperçu en direct (tourner, marcher, au hasard). On peut essayer une pièce payante avant de l'acheter.
- **Pixels** : monnaie gratuite. 100 à l'inscription, 50 par jour (« Récompense du jour »), codes à échanger (`BIENVENUE` donne 100 une fois par joueur). Affichés en haut à gauche.
- **Boutique** (barre du bas, « Boutique ») : Accueil (promos, code, récompense), Mobilier (arbre de catégories, recherche, sols et murs gratuits), Vêtements, Animaux, Abonnements (VIP Atelier annoncé, grisé).
- **Compagnons** : chat, chien, lapin, caneton, 4 couleurs chacun, 3 par joueur, un seul suit le joueur. Il se déplace côté client uniquement (purement décoratif) ; le serveur ne stocke que l'espèce, la couleur et le nom.
- **Mobilier** : les 20 pièces de base restent gratuites et illimitées ; 21 pièces nouvelles s'achètent en Pixels.

## Règles côté serveur

- Le client n'envoie que des intentions. Prix lus dans les catalogues du code (`packages/render`), jamais dans la requête.
- Achat et paiement dans la même transaction PostgreSQL ; le solde ne descend jamais sous zéro (contrainte en base). Chaque mouvement est écrit dans `pixel_ledger` (la somme du registre est égale au solde).
- `PUT /api/me/look` refuse tout vêtement payant non possédé (`wardrobe`). L'apparence est validée par `parseLook` (nombres entiers dans les bornes, rien d'autre).
- L'apparence et le compagnon vus par les autres viennent de la base : le message temps réel `refresh` ne porte aucune donnée, le serveur relit tout lui-même.
- Noms de compagnons : même filtre que les noms d'appart et le chat.
- Récompense du jour et codes : une fois (par jour ou par joueur), garantis par la base même en cas de requêtes parallèles.
- Limite de débit par joueur sur toutes les routes de la boutique (`shopPerUser`).

## Où est quoi

| Sujet | Fichiers |
| --- | --- |
| Définition de l'apparence, garde-robe, prix | `packages/render/src/look.ts` |
| Compagnons (espèces, couleurs, prix) | `packages/render/src/pets.ts` |
| Prix du mobilier | `packages/render/src/catalog.ts` (`price`) |
| Pixels, récompense, codes | `apps/server/src/wallet/routes.ts` |
| Apparence (lecture, sauvegarde) | `apps/server/src/avatar/routes.ts` |
| Achats | `apps/server/src/shop/routes.ts` |
| Compagnons | `apps/server/src/pets/routes.ts` |
| Tables | `apps/server/migrations/1700000006000_wardrobe-wallet-pets.sql` |
| Dessin de l'avatar et des compagnons | `apps/client/src/avatar.ts`, `pets.ts` |
| Fenêtres | `apps/client/src/wardrobe.ts`, `shop.ts`, `wallet.ts` (barre de Pixels) |

## Pas encore fait

Crédits payants, Coloxs, VIP (le paiement viendra avec Stripe), marché, échange de vêtements. Les prix sont provisoires.
