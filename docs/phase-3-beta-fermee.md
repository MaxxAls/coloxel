# Phase 3 : beta fermée

## Objectif

Les créations des joueurs prennent de la valeur : on peut les mettre en vente, les acheter, les échanger, et leur créateur touche une part des reventes. Le VIP Atelier donne un premier revenu réel. Le tout est ouvert à un groupe fermé de testeurs adultes.

Porte de sortie de la phase : des testeurs paient le VIP, et le marché tient sans inflation (voir « Mesures de la porte »).

## Avant de commencer

La phase 3 ne s'ouvre que si la phase 2 a franchi sa porte (`docs/phase-2-multijoueur.md`). À vérifier, car certains points sont encore ouverts :

- [ ] Aucune faille de duplication ou de triche connue. Le marché et l'échange déplacent des objets de valeur : relire les transferts avant d'en ajouter.
- [ ] Modération testée en conditions réelles avec de vrais testeurs (signalements, sanctions, journal de chat). Le marché multiplie les arnaques possibles, il faut un staff rodé.
- [ ] Générateur testé en vrai avec une clé `ANTHROPIC_API_KEY` (`docs/tests-generateur.md`). Une rareté n'a de sens que si la qualité des créations est connue.
- [ ] Interface vérifiée dans un navigateur par de vrais joueurs, pas seulement par `typecheck` et les tests serveur.
- [ ] Choix des prix, de la commission et des royalties (voir « Valeurs provisoires »). Les noter dans `docs/contexte-projet.md` dès qu'ils sont tranchés.

## Principes

1. **Le serveur décide de tout.** Prix, commission, royalties et soldes sont calculés et vérifiés côté serveur, jamais lus dans une requête client.
2. **Chaque mouvement de valeur est une transaction PostgreSQL atomique et journalisée.** Un objet change de propriétaire et l'argent change de main dans la même transaction, ou rien ne bouge.
3. **Les Coloxs ne se reconvertissent jamais en euros.** Pas de retrait, pas de rachat par l'éditeur, pas de conversion Pixels vers Coloxs (règle 6 de `CLAUDE.md` et `docs/contexte-projet.md`).
4. **Aucun hasard payant.** Ni loot box, ni tirage, ni enchère à mise perdue. Une série limitée se vend à un prix affiché, jamais tirée au sort.
5. **Seules les créations s'échangent et se vendent.** Les objets de base, les vêtements et les compagnons restent hors marché dans cette phase.
6. **Adultes uniquement.** Pas de comptes mineurs, pas de messages privés. Les achats en euros sont réservés aux comptes dont l'âge adulte est déclaré.

## Valeurs provisoires

Décisions encore ouvertes dans `docs/contexte-projet.md`. À mettre en configuration (variables ou table `settings`), pas en dur dans le code, pour pouvoir les ajuster pendant la beta.

| Sujet | Valeur de départ | Remarque |
| --- | --- | --- |
| Commission du marché | 5 % du prix, **détruite** | Anti inflation : elle sort de l'économie, personne ne l'encaisse |
| Royalties du créateur | 5 % du prix à chaque revente | Versées en Coloxs, en plus de la commission |
| Prix minimum d'une annonce | 1 Colox | Évite les ventes à zéro qui servent à contourner l'échange |
| Prix maximum d'une annonce | 100 000 Coloxs | Plafond de sécurité contre les erreurs de saisie |
| Durée d'une annonce | 7 jours, renouvelable | Pas d'annonce fantôme |
| Annonces actives par joueur | 20 | Limite le spam du marché |
| Séries limitées | 1, 5 ou 10 exemplaires | Déjà prévu dans la conception |

Arrondi : tout montant est un entier de Coloxs. Commission et royalties arrondies à l'entier inférieur, le reste revient au vendeur.

## Périmètre à construire

Dans cet ordre, une étape par session de travail. Proposer un plan court avant chaque étape.

1. **Coloxs et registre**
   - Deuxième monnaie à côté des Pixels : solde par joueur, jamais négatif (contrainte en base), registre `colox_ledger` sur le modèle de `pixel_ledger` (la somme du registre égale le solde, vérifié par un test).
   - Chaque ligne du registre porte un motif : achat, vente, royalties, commission détruite, remboursement, geste du staff.
   - Aucune route ne permet d'écrire un solde directement. Tout passe par une fonction de transaction unique.
   - Affichage du solde dans la barre en haut à gauche, à côté des Pixels.
2. **Paiement (Stripe)**
   - Packs de Coloxs achetés en euros avec Stripe Checkout. Les prix des packs sont lus côté serveur.
   - Les Coloxs sont crédités uniquement à la réception du webhook Stripe signé, jamais sur le retour du navigateur. Un identifiant d'événement ne peut être traité qu'une fois (contrainte unique, rejouable sans effet).
   - Remboursement ou litige Stripe : les Coloxs correspondants sont retirés et le compte peut être suspendu par le staff. Un solde négatif causé par un remboursement est autorisé uniquement dans ce cas, et bloque les achats tant qu'il n'est pas apuré.
   - Secrets Stripe en variables d'environnement uniquement (`.env.example`). Mode test par défaut en développement.
   - Données de paiement : rien n'est stocké côté Coloxel sauf l'identifiant du client et des paiements Stripe.
3. **Marché**
   - **Mettre en vente** : le propriétaire d'une création verrouillée choisit un prix en Coloxs. L'objet est mis sous séquestre (retiré de ses placements, non échangeable, non déplaçable) tant que l'annonce est active.
   - **Acheter** : une seule transaction verrouille l'annonce et le compte de l'acheteur, vérifie le solde, déplace l'objet (`owner_id`), débite l'acheteur, crédite le vendeur, verse les royalties au créateur, détruit la commission, écrit le registre et l'historique de propriété. Deux acheteurs en même temps : un seul gagne, l'autre reçoit une erreur claire.
   - **Retirer une annonce** : possible à tout moment par le vendeur, l'objet revient dans son inventaire.
   - **Parcourir** : page du marché avec recherche par nom, filtres (prix, série, créateur, récent), tri. Chaque annonce affiche le sprite, le nom, le numéro, le créateur, l'édition et le prix. Le sprite vient de `packages/render`, comme partout.
   - **Historique de propriété** visible sur la fiche de l'objet : créateur, propriétaires successifs, prix des reventes.
   - Un objet masqué par signalement ou dont le propriétaire est suspendu ne peut être ni vendu ni acheté.
   - Le créateur qui s'achète son propre objet ne touche pas de royalties sur cette vente. Une vente entre deux comptes du même appareil ou de la même IP est signalée à la modération (voir étape 8).
4. **Échange entre joueurs**
   - Spécifié dans `docs/mecaniques-inspirees.md` (section 2). Deux joueurs dans la même salle, offres des deux côtés, double acceptation, seconde confirmation avec numéro et créateur de chaque objet.
   - Une seule transaction PostgreSQL, verrouillage des lignes dans l'ordre des identifiants. Toute modification d'une offre remet les acceptations à zéro. Journal `trades`.
   - Les offres ne contiennent que des créations (et pas de Coloxs : l'argent passe par le marché).
5. **Séries limitées**
   - À la création, le joueur choisit une édition de 1, 5 ou 10 exemplaires (1 par défaut, déjà le cas). Chaque exemplaire est numéroté `n/N` en plus du numéro de création, dans la même transaction que la création.
   - Le choix est définitif et verrouillé avec l'objet. Les exemplaires d'une série partagent la recette, le créateur, le nom.
   - Le coût en charges de création est plus élevé pour les grandes séries (valeur à fixer).
   - Les exemplaires s'échangent et se vendent chacun séparément.
6. **Royalties**
   - Le pourcentage du créateur est prélevé sur chaque revente (jamais sur la première vente si le créateur est aussi le vendeur) et crédité dans la même transaction que la vente.
   - Page « Mes créations » : nombre de reventes, Coloxs gagnés, objets les plus demandés.
   - Le créateur d'un objet supprimé ou banni ne perd pas ses royalties, sauf décision du staff en cas de fraude (sanction journalisée).
7. **VIP Atelier**
   - Abonnement mensuel via Stripe Billing. Statut `vip` lu côté serveur depuis les événements Stripe signés, avec une date de fin.
   - Avantages de départ : plus de charges de création par jour, badge, palettes exclusives. Les objets animés restent pour plus tard.
   - Aucun avantage VIP ne touche au marché : même commission, mêmes limites, pas de passe-droit. Gagner sur le statut, pas sur le hasard.
   - Fin d'abonnement : les créations faites pendant le VIP restent au joueur, il perd seulement les avantages.
   - Résiliation depuis le portail client Stripe, lien dans la fenêtre Abonnements de la boutique (déjà grisée).
8. **Anti fraude et modération du marché**
   - Limite de débit sur l'achat, la mise en vente et les échanges, par joueur et par IP.
   - Détection simple : va-et-vient d'un même objet entre deux comptes, prix très éloignés du marché, comptes neufs qui achètent beaucoup. Elles ouvrent une entrée dans la file du staff, elles ne bloquent pas seules.
   - Le panel staff gagne : historique de transactions d'un joueur, annulation d'une vente frauduleuse (transaction inverse journalisée, jamais une écriture directe), gel d'un solde, blocage du marché pour un joueur.
   - Signalement possible sur une annonce et sur un échange.
   - Un compte suspendu ou banni ne peut plus acheter, vendre, échanger ni retirer ses annonces sans passage par le staff.
9. **Surveillance de l'économie**
   - Page staff « Économie » : Coloxs en circulation, Coloxs créés (achats) et détruits (commissions), volume et prix médian du marché par jour, nombre de ventes, d'échanges, d'annonces actives.
   - C'est ce tableau qui mesure la porte de sortie. Il doit exister avant l'ouverture aux testeurs.
10. **Communauté Discord**
    - Serveur Discord de la beta avec règles, canal de signalement de bugs et canal marché. Hors du code du jeu.
    - Un lien d'invitation visible depuis le jeu. Pas de connexion Discord ni de compte lié dans cette phase.
    - Charte de la beta (adultes, pas de revente hors jeu, pas de contact privé suspect) montrée à l'inscription.

## Mesures de la porte

À suivre pendant la beta, sur le tableau de l'étape 9.

- **Paiement** : au moins quelques testeurs paient le VIP sans y être poussés, et reconduisent leur abonnement au deuxième mois. Le nombre exact est à fixer avant l'ouverture (par exemple 10 abonnés payants sur 100 testeurs).
- **Marché sain** : les prix médians ne montent pas sans limite d'une semaine à l'autre. Les Coloxs détruits (commissions) compensent une part significative des Coloxs achetés. Pas de concentration anormale (un seul joueur détenant la majorité des objets d'une série).
- **Aucune duplication, aucun solde incohérent** : la somme de `colox_ledger` égale la somme des soldes, en continu, vérifiée par une tâche de contrôle quotidienne.

## Hors périmètre

Retrait de Coloxs en argent réel (jamais), enchères, location, prêts d'objets, mineurs et consentement parental, messages privés, immeubles de groupe et immeubles premium, saisons, objets animés, échange de vêtements et de compagnons, application mobile, lancement public.

Les idées de `docs/mecaniques-inspirees.md` autres que l'échange (mécanismes programmables, compagnons plus vivants, jeux d'équipe) ne font pas partie de cette phase.

## Critères d'acceptation

- [ ] Deux acheteurs qui visent la même annonce au même instant : un seul achète, l'autre reçoit une erreur, aucun solde ni objet incohérent (test de concurrence).
- [ ] Une vente déplace l'objet, débite l'acheteur, crédite le vendeur et le créateur, détruit la commission : tout ou rien, même si le serveur plante au milieu (test avec échec injecté).
- [ ] La somme de `colox_ledger` égale la somme des soldes après une série de ventes, de remboursements et de royalties aléatoires (test).
- [ ] Un client modifié qui envoie un prix, un solde, une commission ou un propriétaire est ignoré ou refusé par le serveur (tests).
- [ ] Un objet en vente ne peut pas être posé, échangé ni mis en vente une seconde fois (tests).
- [ ] Un objet de base, un vêtement, un compagnon ne peuvent être ni vendus ni échangés (tests).
- [ ] Un webhook Stripe rejoué deux fois crédite une seule fois, un webhook à la signature fausse est rejeté (tests).
- [ ] Un remboursement Stripe retire les Coloxs correspondants et bloque les achats si le solde devient négatif (test).
- [ ] Une série de 5 exemplaires crée exactement 5 objets numérotés `1/5` à `5/5`, même avec des créations en parallèle (test).
- [ ] Une revente verse les royalties au créateur au bon montant, arrondi comme prévu (tests sur une liste de cas).
- [ ] Un échange modifié après acceptation remet les deux acceptations à zéro (test).
- [ ] Un compte suspendu ne peut ni acheter, ni vendre, ni échanger, y compris déjà connecté (test).
- [ ] Une vente frauduleuse annulée par le staff rend l'objet et les Coloxs, avec une écriture inverse dans le registre (test).
- [ ] Le VIP s'active et s'éteint uniquement sur événement Stripe signé, et n'a aucun effet sur les règles du marché (tests).
- [ ] Le tableau « Économie » est visible du staff et ne l'est pas des joueurs (test).
- [ ] `npm run typecheck` et `npm test` passent.
