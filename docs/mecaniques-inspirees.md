# Mécaniques inspirées d'un émulateur de serveur de jeu d'hôtel

Étude faite le 7 octobre 2026 sur un émulateur de serveur (C#, environ 590 fichiers de code) et le site web qui l'accompagne (PHP) trouvés dans `Téléchargements`. **Rien n'est repris** : ni code, ni assets, ni noms, ni termes (règle 5 de `CLAUDE.md`). Seules des idées de mécaniques sont retenues, réécrites pour l'architecture de Coloxel (le serveur décide de tout, un objet est unique, un seul moteur de rendu).

## Ce qui a été lu

- **Le code du serveur** : salles, pathfinding, objets et leurs interactions, déclencheurs programmables, échanges, quêtes et succès, familiers, groupes, navigateur, outils de modération, commandes de salle, jeux d'équipe.
- **Le site web** (`CMS & SWF`) : une vingtaine de pages PHP (accueil, actualités, profil, classement, joueurs en ligne, équipe, état du serveur, maintenance). Les 25 000 fichiers de `swf/` et les images de `web-gallery/` sont des assets du jeu d'origine : **ni ouverts, ni utilisés**. Rien à en tirer, notre moteur de rendu dessine tout lui-même.

## Fait (phase 2, extensions)

| Idée | Réalisation dans Coloxel |
| --- | --- |
| Quêtes et succès à paliers | **Défis** : 7 séries à 2 ou 3 paliers, récompense en Pixels versée une fois dans la transaction (`apps/server/src/quests`). Les événements viennent du serveur (poser, inventer, visiter, discuter, se faire un ami, acheter, s'asseoir). Total des récompenses fini, donc pas de farm. |
| Interrupteurs sur les meubles | **Lumières** : le propriétaire allume ou éteint tout meuble lumineux (`placements.lit`). |
| Accès par sonnette | **Sonnette** : mode « Sur sonnette ». Les amis entrent, les autres sonnent, le propriétaire accepte pour 15 minutes. |
| Commandes de salle (expulser) | **Faire sortir** : le propriétaire exclut un visiteur pour 30 minutes. |
| Tickets d'assistance avec les derniers messages | Les signalements gardent les 8 derniers messages visibles de la salle. |
| Modèles de réponse du support | Modèles de sanctions dans le panel staff. |
| Déplacements et animations | Commandes de chat : `/danse` (animation vue par tous), `/suivre <ami>` (le joueur reste à côté de l'ami qui marche), `/stop`, `/aide`. Elles ne sont ni du chat, ni journalisées. |
| Site web (pages PHP de l'émulateur) | **Site public** servi par le serveur sous `/site` : accueil avec compteurs et nouveautés, actualités, classement (inventeurs, apparts visités), équipe, état du jeu, profils de joueurs, sprites des créations visibles. Aucune donnée privée, rien de masqué, tout est échappé. |
| Annonces de l'équipe | Écrites depuis l'onglet « Annonces » du panel staff (brouillon, épinglée, modification, suppression). La plus récente s'affiche une fois dans le jeu. |
| Rangs du personnel (l'émulateur donne à chaque droit et chaque commande un rang minimum, et interdit d'agir sur un rang égal ou supérieur) | **Rôles du personnel** : animateur, modérateur, super-modérateur, gérant, administrateur (`apps/server/src/staff/roles.ts`). Chaque rôle a ses permissions et ses limites (durée maximale des sourdines et suspensions). Personne n'agit sur un rôle égal ou supérieur, on ne nomme que des rôles strictement inférieurs au sien, tout changement de rôle est journalisé, et le rôle est relu en base à chaque requête (une rétrogradation compte tout de suite). Seuls gérants et administrateurs jouent pendant la maintenance. |
| Classement des animateurs et événements du site | **Événements** organisés par les animateurs, annoncés sur le site (`/site/evenements`) et sur l'accueil, avec le classement des animateurs par événements tenus. |
| « Wired » : déclencheurs, conditions, effets posés par le joueur | **Mécanismes** : jusqu'à 20 règles par appart, « quand… [si…] alors… ». Déclencheurs : quelqu'un entre, marche sur une case, clique sur un bouton, dit un mot, toutes les N secondes (5 au minimum). Conditions : nombre de joueurs, lampe allumée ou éteinte, joueur sur une case. Effets : allumer, éteindre ou inverser un meuble lumineux, téléporter le joueur, lui montrer un message (filtré), le faire danser. Éditeur dans le panneau de l'appart (menu « Mécanismes »), anneaux lumineux sur la case concernée, règles évaluées par le serveur même quand le propriétaire est absent. |
| Meubles d'interaction (plaques, boutons, téléporteurs) | Trois pièces à la boutique : **plaque de pression** et **portail** (on marche dessus), **bouton rouge** (on clique). Les tapis sont désormais praticables. |
| Commandes du personnel (`:ha`, `:hal`, `:ea`, `:ra`, `:kick`, `:mute`…) | **Commandes du staff** tapées dans la barre de chat d'une salle, commençant par `:` (le `/` reste aux commandes des joueurs). Vérifiées contre les droits du rôle ; un rôle qui n'a pas la commande tape simplement du chat, personne ne peut deviner lesquelles existent. Journalisées (onglet « Journal staff », gérants et au-dessus). Liste : `:commandes` (celles de ton rôle), `:ha` et `:hal` (alerte à tout le jeu, avec un lien vers une page du site), `:ea` (événement avec bouton « Rejoindre »), `:ra` (alerte à la salle), `:alert` (à un joueur), `:kick`, `:roommute` et `:roomunmute`, `:warn`, `:mute`, `:suspend`, `:ban`, `:unsanction`, `:info`, `:summon`, `:goto`, `:massdance`, `:stopdance`, `:disco`, `:confetti`, `:freeze` et `:unfreeze`, `:addword` et `:delword` (filtre du chat), `:gift` (Pixels, administrateurs), `:maintenance`. Les commandes de l'émulateur qui sont du harcèlement (pousser, tirer un joueur), de la triche (invisibilité, vitesse) ou des monnaies que nous n'avons pas ne sont pas reprises. |
| Mode maintenance | Interrupteur dans le panel staff : l'API et les salles refusent les joueurs (503), le staff, la connexion et le site restent accessibles. |

## À faire, dans l'ordre conseillé

### 1. Mécanismes (déclencheurs programmables) : fait

La spec ci-dessous a été suivie, avec deux ajouts : le déclencheur « clic sur un bouton » et l'effet « danser ». Les garde-fous sont en place : une règle ne donne jamais de Pixels ni d'objet, 10 effets par seconde au plus par salle, et ce que fait une règle ne déclenche jamais une autre règle (une règle ne peut donc pas se nourrir elle-même).

C'est la mécanique de l'émulateur qui donne le plus de profondeur : un joueur règle des réactions dans son appart (« quand quelqu'un marche sur cette case, allume la lampe »). Elle prolonge l'idée de Coloxel : les joueurs inventent, le jeu fait vivre.

**Règle** : `quand <déclencheur> [si <conditions>] alors <effets>`, stockée en JSON validé (zod) dans `apartment_rules (id, owner_id, position, enabled, rule jsonb)`.

| Déclencheurs (noyau) | Conditions (noyau) | Effets (noyau) |
| --- | --- | --- |
| un joueur entre dans l'appart | nombre de joueurs présents ≥ ou ≤ n | allumer, éteindre ou inverser un meuble lumineux |
| un joueur marche sur la case (i, j) | un meuble donné est allumé ou éteint | téléporter le joueur déclencheur sur une case libre |
| un joueur dit un mot-clé | le joueur déclencheur est sur la case (i, j) | afficher un message au joueur déclencheur |
| toutes les n secondes (5 au minimum) | | |

Garde-fous, non négociables :
- Seul le propriétaire écrit ou modifie ses règles ; n'importe quel visiteur peut les déclencher. Le serveur évalue tout, le client ne fait qu'afficher.
- Maximum 20 règles par appart, 3 conditions et 4 effets par règle.
- Les messages sont filtrés par `filterText` à l'écriture et à l'exécution.
- Une règle ne peut **jamais** donner de Pixels, d'objet ou de Coloxs (pas d'économie programmable, pas de farm).
- Limites d'exécution : 10 effets par seconde et par salle, profondeur de chaînage 3, une règle qui boucle est désactivée et son propriétaire prévenu.
- Une règle qui référence un meuble qui n'est plus posé reste en place mais sans effet.

À construire : migration, validateur, évaluateur dans `ApartmentRoom`, API (`GET/PUT /api/apartment/rules`), éditeur dans le panneau, tests (autorité, limites, filtre, boucle, concurrence).

### 2. Échange entre joueurs (phase 3, avec le marché)

Deux joueurs dans la même salle ouvrent un échange, chacun dépose des créations, les deux acceptent, puis une seconde confirmation affiche numéro et créateur de chaque objet (contre les arnaques).
- Une seule transaction PostgreSQL : verrouillage des lignes dans l'ordre des identifiants, changement de `owner_id`, retrait des placements. Les objets de base ne s'échangent jamais.
- Toute modification d'une offre remet les acceptations à zéro.
- Journal `trades` (qui, quoi, quand). Limite de débit, signalement possible d'un échange.
- **Ne rien construire avant la phase 3.**

### 3. Compagnons plus vivants

Besoins qui descendent avec le temps réel (calculés à la lecture à partir d'une date, sans tâche de fond), commandes simples (« assis », « viens ») avec niveaux d'expérience. Pas de mort ni de faim bloquante : un compagnon négligé est triste, rien de plus. Nourrir coûte quelques Pixels ou rien.

### 4. Jeux d'équipe

Équipes, score, minuteur dans un appart, construits sur les mécanismes (effets « rejoindre une équipe », « marquer un point »). Jamais de mise en Pixels ni de pari (règle 6).

### 5. Suite possible du site web

Le site existe (voir « Fait »). Reste à décider : avatars sur les profils (il faut rendre l'avatar côté serveur), badges, hall d'honneur par saison, page « apparts à visiter » avec miniatures. Chaque ajout doit rester sans donnée personnelle (règle 7).

### Optimisations faites

- Texte compressé (gzip ou brotli) : la page d'accueil du site passe de 21 Ko à 3,6 Ko sur le réseau.
- Styles et scripts du site dans des fichiers versionnés (`?v=…`) gardés un an par le navigateur, au lieu d'être recopiés dans chaque page.
- Client : bibliothèques lourdes (PixiJS, Colyseus) dans des fichiers à part, que les joueurs ne retéléchargent pas à chaque nouvelle version du jeu ; le code du jeu pèse 131 Ko au lieu de 594 Ko ; le panneau staff n'est téléchargé que par le staff.
- Serveur : la disposition d'un appart n'est plus relue en base à chaque clic, mais gardée une seconde et oubliée dès que le décor change.

### Personnages

Les personnages de l'émulateur d'origine sont des créations protégées : ils ne sont ni repris, ni « remixés » (règle 5). Les avatars de Coloxel restent dessinés par notre propre moteur ; leurs visages ont été redessinés (blanc de l'œil, iris coloré, sourire et joues plus doux) et les looks de départ n'ont plus de peau verte ou violette par hasard (ces teintes restent au vestiaire).

### Non retenu

- **Groupes avec forums** : immeubles de groupe, hors périmètre de la phase 2.
- **Messages privés** : interdits tant que la modération n'a pas fait ses preuves (règle 7).
- **Dés, roues, œufs à ouvrir contre paiement** : jeux d'argent et loot boxes, interdits (règle 6).
- **Commandes de triche** (donner des crédits, invisibilité…) : ce sont des outils d'administration, pas de gameplay.
