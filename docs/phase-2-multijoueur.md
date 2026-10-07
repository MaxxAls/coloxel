# Phase 2 : multijoueur

## Objectif

Plusieurs joueurs vivent dans le même immeuble : ils se voient bouger, se parlent, visitent les apparts des autres et regardent leurs créations. Tout ce qui est dit ou créé peut être signalé et modéré.

Porte de sortie de la phase : aucune faille de duplication ou de triche connue, et la modération a été testée en conditions réelles avec les testeurs.

## Avant de commencer

La phase 2 repose entièrement sur la phase 1. Vérifier d'abord, et corriger si besoin :

- [ ] Tous les critères d'acceptation de `docs/phase-1-alpha-solo.md` sont cochés, tests à l'appui.
- [ ] Un test d'intégration prouve que deux créations simultanées ne partagent jamais un numéro et ne dépassent jamais les charges.
- [ ] Aucune route ne fait confiance à un identifiant de joueur envoyé par le client : l'identité vient toujours de la session.

## Périmètre à construire

Dans cet ordre, une étape par session de travail.

1. **Serveur temps réel**
   - Colyseus dans `apps/realtime` (ou intégré à `apps/server` si plus simple), Redis pour la présence et les sessions (`docker-compose.yml`).
   - Authentification de la connexion WebSocket par la même session que l'API. Pas de session valide, pas de connexion.
   - Une salle Colyseus par appart ouvert et une par espace commun (hall).
   - Le serveur fait autorité sur les positions : le client envoie « je veux aller en (i,j) », le serveur calcule le chemin et diffuse les déplacements.
2. **L'immeuble**
   - Vue en coupe de côté : étages empilés, un appart par joueur, hall au rez de chaussée.
   - Premier immeuble unique pour tous les testeurs, 30 apparts. L'attribution d'un appart se fait à l'inscription.
   - Cliquer sur un appart depuis la coupe permet d'y entrer (vue isométrique de la phase 1).
3. **Visites**
   - Entrer chez un voisin : on voit sa déco et les autres visiteurs présents.
   - Seul le propriétaire peut placer, déplacer ou ranger des objets chez lui. Le serveur refuse tout le reste.
   - Le propriétaire peut fermer son appart (personne), l'ouvrir à ses amis, ou à tout l'immeuble.
   - Fiche objet consultable sur les objets des autres (nom, numéro, créateur, date).
4. **Chat**
   - Bulles au dessus des avatars dans la salle courante, 120 caractères maximum, limite de débit par joueur.
   - Filtre serveur avant diffusion : insultes, liens, numéros de téléphone, emails, pseudos de réseaux sociaux. Message bloqué : l'auteur est prévenu, les autres ne voient rien.
   - Tous les messages sont journalisés côté serveur (auteur, salle, date, texte, bloqué ou non).
   - Pas de messages privés dans cette phase.
5. **Amis**
   - Demande, acceptation, suppression. Liste d'amis avec présence (en ligne, dans quel appart).
6. **Signalements**
   - Bouton signaler sur un joueur, un message, un objet ou un appart, avec un motif à choisir.
   - Un objet signalé par plusieurs joueurs différents est masqué pour tous sauf son propriétaire, en attendant une revue.
7. **Panel staff**
   - Rôle `staff` en base, attribué à la main.
   - Pages : file des signalements, journal de chat filtrable, fiche joueur (historique, créations, sanctions).
   - Sanctions : avertissement, sourdine (durée), suspension (durée), bannissement. Chaque sanction est journalisée avec son auteur et son motif.
   - Une sourdine ou une suspension prend effet immédiatement, y compris pour un joueur déjà connecté.

## Hors périmètre

Marché, monnaies, VIP, paiement, messages privés, immeubles de groupe, comptes mineurs (l'alpha reste réservée aux adultes), mobile.

## Critères d'acceptation

- [ ] Deux navigateurs connectés avec deux comptes se voient bouger et se parlent dans le hall et dans un appart.
- [ ] Un client modifié qui envoie une position, un placement ou un message au nom d'un autre joueur est refusé par le serveur (tests).
- [ ] Un client modifié qui envoie des messages en rafale est limité, sans faire tomber la salle.
- [ ] Un visiteur ne peut ni placer ni ranger d'objet chez quelqu'un d'autre (test).
- [ ] Un appart fermé est inaccessible, même en forçant l'URL ou le message de connexion.
- [ ] Les messages contenant un lien, un email ou un numéro sont bloqués (tests sur une liste de cas).
- [ ] Une sanction posée dans le panel s'applique en moins de quelques secondes à un joueur connecté.
- [ ] Le serveur supporte au moins 30 joueurs connectés en même temps dans l'immeuble (test de charge simple avec des clients simulés).
- [ ] `npm run typecheck` et `npm test` passent.
