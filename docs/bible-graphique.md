# Bible graphique

Une page. Elle fixe le style commun des objets, des appartements et des avatars. Sa version courte est injectée dans le prompt du modèle : `STYLE` dans `packages/generator/src/prompt.ts`. Si l'une change, l'autre aussi.

## Principes

Pixel art chaleureux, formes rondes, couleurs saturées mais douces (plus pastel que sombre). Univers d'immeuble en coupe. Aucune référence graphique à Habbo.

## Angle

Isométrique 2:1. Le spectateur voit le dessus, la face de gauche (y max) et la face de droite (x max). Un point (x, y, z) s'affiche à `dx = x - y`, `dy = (x + y) / 2 - z`.

## Lumière

Elle vient d'en haut. Dessus le plus clair, face gauche plus sombre (-18 %), face droite la plus sombre (-34 %). Le moteur applique ces ombres tout seul sur les pavés et les cylindres, et ombre les sphères (reflet en haut à gauche). Ne pas les forcer sans raison.

## Contour

Un pixel, `#1b1530` (violet très sombre, jamais noir pur). Il est ajouté par le moteur autour de la silhouette : le modèle ne dessine pas de contour.

## Palette

- 3 à 6 teintes cohérentes par objet : une dominante, une ou deux secondaires, un accent.
- Saturées mais douces : éviter le blanc pur et le noir pur (préférer `#f4efe6` et `#2a2140`).
- Les détails (reflets, boutons, lumières) prennent une teinte plus claire de la couleur de base, ou un accent chaud (`#ffc857`).
- Décor de l'appart : parquet `#b88b56` / `#c79a62`, murs `#8a7fc0` et `#6c61a3`. Un objet doit se détacher de ces couleurs sans les copier.

## Échelle

- Une case de sol : 16 x 8 px à l'écran (de -8 à 8 en x et en y). Sprite d'objet : 96 x 112 px, ancre au pixel (48, 88).
- Avatar : 9 x 18 px. Un objet à taille humaine (chaise, lit, porte) se dimensionne par rapport à lui.
- Hauteurs : table ou chaise 9 à 16, armoire ou plante haute 30 à 45, maximum 60.
- Un objet standard tient dans une case (x et y entre -8 et 8). Seuls les objets longs dépassent, jusqu'à 12.

## Lisibilité

- L'objet se reconnaît au premier coup d'oeil, de loin et petit.
- 10 à 40 parties : assez pour du charme (coutures, boutons, reflets), pas de bruit.
- Les objets absurdes ou humoristiques gardent leur idée centrale bien visible.
- Ordre de dessin : de l'arrière et du bas vers l'avant et le haut.
