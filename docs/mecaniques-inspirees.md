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

## À faire, dans l'ordre conseillé

### 1. Mécanismes (déclencheurs programmables)

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

### 5. Idées issues du site web

- **Profil public** : pseudo, avatar, nombre de créations, nom et état de l'appart. Aucune donnée personnelle (règle 7).
- **Annonces de l'équipe** : table `announcements` écrite depuis le panel staff, affichée à la connexion.
- **Classement** : créateurs les plus prolifiques, apparts les plus visités, sur des données publiques et pseudonymes.
- **État et maintenance** : `GET /api/status` et un mode maintenance (variable `MAINTENANCE`) qui répond 503 aux joueurs, mais laisse passer le staff.

### Non retenu

- **Groupes avec forums** : immeubles de groupe, hors périmètre de la phase 2.
- **Messages privés** : interdits tant que la modération n'a pas fait ses preuves (règle 7).
- **Dés, roues, œufs à ouvrir contre paiement** : jeux d'argent et loot boxes, interdits (règle 6).
- **Commandes de triche** (donner des crédits, invisibilité…) : ce sont des outils d'administration, pas de gameplay.
