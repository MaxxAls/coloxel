# Bible graphique

Une page. Elle fixe le style commun des objets, des appartements et des avatars. Sa version courte est injectée dans le prompt du modèle : `STYLE` dans `packages/generator/src/prompt.ts`. Si l'une change, l'autre aussi.

## Principes

Pixel art chaleureux, formes rondes, couleurs saturées mais douces (plus pastel que sombre). Univers d'immeuble en coupe. Aucune référence graphique à Habbo.

## Angle

Isométrique 2:1. Le spectateur voit le dessus, la face de gauche (y max) et la face de droite (x max). Un point (x, y, z) s'affiche à `dx = x - y`, `dy = (x + y) / 2 - z`.

## Lumière

Elle vient d'en haut. Dessus le plus clair, face gauche plus sombre (-18 %), face droite la plus sombre (-34 %). Le moteur applique ces ombres tout seul sur les pavés et les cylindres, et ombre les sphères (reflet en haut à gauche). Il ajoute aussi un grain léger sur les surfaces, un liseré clair sur les arêtes du dessus, un trait sombre sur les coins verticaux, un dégradé vers le sol (les faces s'assombrissent en bas) et une ombre douce tramée sur le sol, du côté droit de l'objet. Rien de tout cela n'est à dessiner dans une recette.

## Contour

Un pixel, `#1b1530` (violet très sombre, jamais noir pur). Il est ajouté par le moteur autour de la silhouette : le modèle ne dessine pas de contour.

## Palette

- 3 à 6 teintes cohérentes par objet : une dominante, une ou deux secondaires, un accent.
- Saturées mais douces : éviter le blanc pur et le noir pur (préférer `#f4efe6` et `#2a2140`).
- Les détails (reflets, boutons, lumières) prennent une teinte plus claire de la couleur de base, ou un accent chaud (`#ffc857`).
- Décor de l'appart : parquet `#b88b56` / `#c79a62`, murs `#8a7fc0` et `#6c61a3`. Un objet doit se détacher de ces couleurs sans les copier.

## Échelle

- Les objets sont dessinés en double résolution : une unité de recette vaut 2 pixels. Une case de sol : 64 x 32 px dans la salle (de -8 à 8 en x et en y). Sprite d'objet : 192 x 224 px, ancre au pixel (96, 176).
- Avatar : 30 x 58 px, proportions de petit personnage (tête ronde d'environ 15 px, cou, torse, bras et jambes, yeux simples, joues roses). Le joueur compose son apparence dans une garde-robe (coiffures, hauts, bas, chaussures, chapeaux, lunettes, extras, couleurs) ; voir docs/personnage-boutique.md. Un objet à taille humaine (chaise, lit, porte) se dimensionne par rapport à lui.
- Hauteurs : table ou chaise 9 à 16, armoire ou plante haute 30 à 45, maximum 60.
- Un objet standard tient dans une case (x et y entre -8 et 8). Seuls les objets longs dépassent, jusqu'à 12.

## Lisibilité

- L'objet se reconnaît au premier coup d'oeil, de loin et petit.
- 10 à 40 parties : assez pour du charme (coutures, boutons, reflets), pas de bruit.
- Les objets absurdes ou humoristiques gardent leur idée centrale bien visible.
- Ordre de dessin : de l'arrière et du bas vers l'avant et le haut.

## Matières et lumière (niveau de détail)

- Une recette peut avoir jusqu'à 200 parties. Un objet riche se compose en couches : structure, matières, objets posés dessus, petits détails, lumière.
- `box` et `quad` acceptent `tex` : wood, planks, logs, stone, brick, tile, fabric, weave, thatch, grass, leaves, metal, stripes, checker, dots, marble, glass, water. Le motif suit les couleurs et l'éclairage de la recette.
- `glow` : halo de lumière (lampe, bougie, écran, feu) en bandes pixel art. Il éclaircit les formes déjà dessinées et ne change pas la silhouette.
- Aperçu des matières : `npx tsx apps/server/scripts/preview-textures.ts out.png`.

## Pièces plus grandes, murales et animées

- **Plusieurs cases** : `size: [largeur, profondeur]` (jusqu'à 3 x 3) ; l'origine (0, 0) reste le centre de la première case, la suivante est à +16. Le sprite grandit avec la taille (`frameFor`), la rotation se fait autour du centre de l'empreinte.
- **Pièces murales** (`wall: true` au catalogue) : la recette est dessinée contre le plan `x = -8` (mur de gauche), le jeu la tourne une fois pour le mur de droite. Elles ne prennent pas la case du sol (`placements.layer` : 0 sol, 1 mur gauche, 2 mur droit) et se posent derrière la première case de leur rangée ou colonne (`wallBehind` dans `packages/world`). Aperçu : `npx tsx apps/server/scripts/preview-walls.ts out.png`.
- **Pièces animées** (`frames` et `frameMs` au catalogue) : d'autres apparences jouées en boucle par le client ; le serveur dessine l'image `k` avec `?f=k`. Toutes ont la même taille que la recette. Aperçu : `npx tsx apps/server/scripts/preview-big.ts out.png frames`.

