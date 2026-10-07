# Phase 2 : multijoueur

## Objectif

Plusieurs joueurs vivent dans le même immeuble : ils se voient bouger, se parlent, circulent d'appart en appart et regardent les créations des autres. Chaque nouvel appart est meublé dès la première minute grâce à un catalogue de base gratuit. Tout ce qui est dit ou créé peut être signalé et modéré.

Porte de sortie de la phase : aucune faille de duplication ou de triche connue, et la modération a été testée en conditions réelles avec les testeurs.

## Avant de commencer

La phase 1 a été relue le 7 octobre 2026 : 52 tests passent contre PostgreSQL, numérotation et charges sûres en concurrence, objets immuables par trigger, placements arbitrés par contrainte unique.

- [x] Sprites servis aux visiteurs d'un appart accessible (`apartment_access`).
- [x] **Limite de débit** sur `/api/auth/login`, `/api/auth/register` et `/api/creations` (`@fastify/rate-limit`, par IP et par compte). Indispensable dès que le jeu est en ligne : aujourd'hui un mot de passe peut être deviné sans limite et le générateur peut être spammé.
- [ ] **Générateur testé en vrai** : créer au moins 20 objets variés avec une vraie clé `ANTHROPIC_API_KEY` et noter ceux qui ratent dans `docs/tests-generateur.md` (description, résultat, problème). Les tests automatiques utilisent un modèle simulé.

## Avancement

Les 9 étapes sont construites (étapes 6 à 9 : chat, amis, signalements, panel staff). Voir `git log` pour le détail.

- Staff : le rôle se donne à la main, `npm run staff:grant -- <pseudo>` (et `staff:revoke`). Le bouton « Staff » n'apparaît dans la barre que pour ces comptes.
- Un objet signalé par 3 joueurs différents est masqué (`REPORT_HIDE_THRESHOLD`, `apps/server/src/moderation/masking.ts`). Il garde sa case, qui reste occupée pour les visiteurs, mais sans sprite.
- Restent à faire avec de vrais testeurs : l'interface n'a été vérifiée que par `typecheck` et les tests serveur, pas dans un navigateur ; le test du générateur avec une vraie clé ; la revue de la modération « en conditions réelles » demandée par la porte de sortie.

## Périmètre à construire

Dans cet ordre, une étape par session de travail.

1. **Serveur temps réel**
   - Colyseus dans `apps/realtime` (ou intégré à `apps/server` si plus simple), Redis pour la présence et les sessions (`docker-compose.yml`).
   - Authentification de la connexion WebSocket par la même session que l'API. Pas de session valide, pas de connexion.
   - Une salle Colyseus par appart ouvert et une par espace commun (hall).
   - Le serveur fait autorité sur les positions : le client envoie « je veux aller en (i,j) », le serveur calcule le chemin et diffuse les déplacements.
2. **L'immeuble**
   - Vue en coupe de côté : étages empilés, un appart par joueur, hall au rez de chaussée. On voit des silhouettes dans les apparts occupés.
   - Premier immeuble unique pour tous les testeurs, 30 apparts. L'attribution d'un appart se fait à l'inscription.
   - Cliquer sur un appart depuis la coupe permet d'y entrer (vue isométrique de la phase 1), s'il est accessible.
3. **Navigation**
   - Barre permanente en bas de l'écran : immeuble, mon appart, navigateur, inventaire, catalogue, amis.
   - Navigateur d'apparts en trois onglets : « Mes amis » (où ils sont, rejoindre en un clic), « Apparts ouverts » (triés par nombre de visiteurs présents, avec le nom de l'appart et son propriétaire), « Lieux » (hall).
   - Chaque appart a un nom choisi par son propriétaire (filtré comme le chat) et un statut d'ouverture.
   - Changer d'appart quitte proprement la salle Colyseus courante et rejoint la nouvelle. Le retour à « mon appart » est toujours possible en un clic.
4. **Catalogue de base et kit de départ**
   - Une vingtaine d'objets de base dessinés à la main en recettes (`packages/render/src/catalog.ts`) : lit, chaise, table, canapé, lampe, plante, étagère, tapis, armoire, bureau... Même style que la bible graphique, rendus par le même moteur.
   - Sols et papiers peints : une dizaine de styles, réglages de l'appart (pas des objets posés).
   - **Gratuits et illimités** en phase 2 : le joueur prend autant d'exemplaires qu'il veut dans son inventaire.
   - Kit de départ posé automatiquement dans tout nouvel appart : lit, table, chaise, lampe, plante.
   - **Ce ne sont pas des créations** : pas de numéro, pas de créateur, pas d'édition, jamais échangeables, et la séquence `item_serial` ne bouge pas. Stockage séparé des `items` (par exemple une table `furniture` d'exemplaires possédés qui référencent une clé du catalogue). Les placements gèrent les deux sortes d'objets avec la même règle : un seul objet par case, vérifiée par le serveur.
   - Dans l'inventaire et la fiche objet, distinction visible entre « Création n° 0042 » et « Mobilier de base ».
   - En phase 3, ce catalogue passera en Pixels : prévoir un champ prix à zéro, sans logique de paiement.
5. **Visites**
   - Entrer chez un voisin : on voit sa déco et les autres visiteurs présents.
   - Seul le propriétaire peut placer, déplacer ou ranger des objets chez lui. Le serveur refuse tout le reste.
   - Le propriétaire peut fermer son appart (personne), l'ouvrir à ses amis, ou à tout l'immeuble.
   - Fiche objet consultable sur les objets des autres (nom, numéro, créateur, date).
6. **Chat**
   - Bulles au dessus des avatars dans la salle courante, 120 caractères maximum, limite de débit par joueur.
   - Filtre serveur avant diffusion : insultes, liens, numéros de téléphone, emails, pseudos de réseaux sociaux. Message bloqué : l'auteur est prévenu, les autres ne voient rien.
   - Tous les messages sont journalisés côté serveur (auteur, salle, date, texte, bloqué ou non).
   - Pas de messages privés dans cette phase.
7. **Amis**
   - Demande, acceptation, suppression. Liste d'amis avec présence (en ligne, dans quel appart), reliée au navigateur.
8. **Signalements**
   - Bouton signaler sur un joueur, un message, un objet, un nom d'appart ou un appart, avec un motif à choisir.
   - Un objet signalé par plusieurs joueurs différents est masqué pour tous sauf son propriétaire, en attendant une revue.
9. **Panel staff**
   - Rôle `staff` en base, attribué à la main.
   - Pages : file des signalements, journal de chat filtrable, fiche joueur (historique, créations, sanctions).
   - Sanctions : avertissement, sourdine (durée), suspension (durée), bannissement. Chaque sanction est journalisée avec son auteur et son motif.
   - Une sourdine ou une suspension prend effet immédiatement, y compris pour un joueur déjà connecté.

## Hors périmètre

Marché, monnaies (Pixels, Coloxs), prix du catalogue, VIP, paiement, messages privés, immeubles de groupe, comptes mineurs (l'alpha reste réservée aux adultes), mobile.

## Critères d'acceptation

- [ ] Deux navigateurs connectés avec deux comptes se voient bouger et se parlent dans le hall et dans un appart.
- [ ] Depuis n'importe où, un joueur rejoint l'appart d'un ami en ligne en deux clics, et revient chez lui en un clic.
- [x] Un nouveau compte arrive dans un appart déjà meublé par le kit de départ.
- [x] Prendre 50 objets de base ne change ni la séquence des numéros ni le nombre d'items numérotés (test).
- [x] Un objet de base ne peut être ni transféré, ni numéroté, ni confondu avec une création dans l'API (tests).
- [x] Un client modifié qui envoie une position, un placement ou un message au nom d'un autre joueur est refusé par le serveur (tests).
- [x] Un client modifié qui envoie des messages en rafale est limité, sans faire tomber la salle.
- [x] Un visiteur ne peut ni placer ni ranger d'objet chez quelqu'un d'autre (test).
- [x] Un appart fermé est inaccessible, même en forçant l'URL ou le message de connexion.
- [x] Les messages et noms d'appart contenant un lien, un email ou un numéro sont bloqués (tests sur une liste de cas).
- [x] Une sanction posée dans le panel s'applique en moins de quelques secondes à un joueur connecté.
- [x] Le serveur supporte au moins 30 joueurs connectés en même temps dans l'immeuble (test de charge simple avec des clients simulés).
- [x] `npm run typecheck` et `npm test` passent.
