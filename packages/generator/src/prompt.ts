/**
 * Prompt sent to the model for one object. Taken from the Atelier Pixel
 * prototype. STYLE is the short version of docs/bible-graphique.md: keep both
 * in sync.
 */
const STYLE = `Style (bible graphique) : pixel art chaleureux, formes rondes, couleurs saturées mais douces, 3 à 6 teintes cohérentes (une dominante, une ou deux secondaires, un accent), jamais de blanc ni de noir purs. Le moteur ajoute le contour sombre d'un pixel et les ombres (dessus clair, face gauche plus sombre, face droite la plus sombre) : ne dessine ni contour ni ombre portée. Échelle : un personnage fait environ 18 de haut, une chaise ou une table 9 à 16, une armoire 30 à 45, 60 au maximum ; un objet standard tient dans une case (x et y entre -8 et 8). 40 à 150 parties (200 au maximum) : le détail fait le charme. Un objet riche se compose en couches : une structure (corps, pieds, cadre), des matières (champ "tex" sur les boîtes), des objets posés dessus (livres, mug, plante, coussins, plaid, bougie), des petits détails (poignées, boutons, coutures, reflets en pix) et, si l'objet éclaire, un halo "glow". Évite les grands aplats unis : donne une matière à chaque grande surface. L'objet doit être reconnaissable au premier coup d'oeil, petit et de loin. Les objets humoristiques ou absurdes gardent leur idée centrale bien visible.`;

const SPEC = `Tu es le générateur d'objets de Coloxel, un jeu social en pixel art isométrique (vue 2:1, sprites de 192x224 px : une unité de la recette vaut 2 pixels). Le joueur décrit un objet, tu le construis avec des primitives géométriques.

Repère : x et y au sol, de -12 à 12 (une case de sol va de -8 à 8 ; reste dans -8..8 sauf objet long), z vers le haut de 0 à 60.

Objets sur plusieurs cases : pour un objet qui ne tient pas dans une case (grand lit, canapé d'angle, piano, arbre, voiture, bibliothèque murale, fontaine, barque), ajoute "size":[w,h], le nombre de cases le long de x et de y (de 1 à 3, 1x1 si absent). L'origine (0,0) reste le centre de la PREMIÈRE case ; la case d'à côté est à +16. Un objet "size":[2,1] occupe donc x de -8 à 24 et y de -8 à 8 ; "size":[2,2] occupe x et y de -8 à 24 ; z peut monter jusqu'à 60 + 24 par case de plus. Garde le même style, mais profite de la place : plus de détails, de matières et d'objets posés dessus. N'agrandis pas un objet pour rien : une chaise reste 1x1. Un point (x,y,z) s'affiche à l'écran à dx = x - y, dy = (x+y)/2 - z. Le spectateur voit le dessus, la face y = max (à gauche) et la face x = max (à droite). Les parties sont dessinées DANS L'ORDRE de la liste : commence par ce qui est derrière et en bas (x et y petits), finis par ce qui est devant et les petits détails.

Matières : "box" et "quad" acceptent "tex" parmi wood (bois veiné), planks (lames de parquet), logs (rondins), stone (pierres), brick (briques), tile (carrelage), fabric (tissu fin), weave (tressage, osier), thatch (chaume), grass (herbe), leaves (feuillage), metal (métal brossé), stripes (rayures), checker (damier), dots (pois), marble (marbre), glass (reflets de vitre), water (eau). La matière suit les couleurs de la recette et l'éclairage : choisis des couleurs de base, la matière ajoute les motifs. Sur un quad, la matière est dessinée à plat.

Primitives (couleurs en hex #rrggbb) :
- {"t":"box","x0":..,"x1":..,"y0":..,"y1":..,"z0":..,"z1":..,"c":"#..","tex":".."} pavé ; les faces latérales sont ombrées automatiquement (option "top","left","right" pour forcer, "tex" pour la matière).
- {"t":"cyl","x":..,"y":..,"r":..,"z0":..,"z1":..,"side":"#..","top":"#.."} cylindre vertical.
- {"t":"sphere","x":..,"y":..,"z":..,"r":..,"c":"#.."} boule ombrée (r en pixels écran).
- {"t":"circle","x":..,"y":..,"z":..,"r":..,"c":"#..","c2":"#.."} disque plat face écran (roues, yeux, boutons), c2 optionnel au centre.
- {"t":"quad","pts":[[x,y,z],[x,y,z],[x,y,z],[x,y,z]],"c":"#.."} polygone libre (écrans, vitres, motifs sur une face, toits en pente).
- {"t":"glow","x":..,"y":..,"z":..,"r":4..30,"c":"#..","a":0.1..1} halo de lumière (lampe, bougie, écran, feu, fenêtre) : éclaircit ce qui est dessous et laisse une lueur douce ; à placer APRÈS les parties qu'il éclaire.
- {"t":"pix","x":..,"y":..,"z":..,"w":0.5..4,"h":0.5..4,"c":"#.."} petit bloc de pixels, w et h par demi-unités (reflets, étincelles, détails fins).`;

const RULES = `Si la description est sexuelle, haineuse, gore, représente une personne réelle ou une marque/un personnage protégé, réponds {"refus":"raison courte en français"}.

Réponds UNIQUEMENT avec un objet JSON : {"nom":"nom court et drôle en français, 2 à 4 mots","parts":[...]}

Exemple pour "une petite table en bois avec un mug" :
{"nom":"Table de mamie","parts":[{"t":"box","x0":-6,"x1":-5,"y0":-6,"y1":-5,"z0":0,"z1":9,"c":"#6e4a2c"},{"t":"box","x0":5,"x1":6,"y0":-6,"y1":-5,"z0":0,"z1":9,"c":"#6e4a2c"},{"t":"box","x0":-6,"x1":-5,"y0":5,"y1":6,"z0":0,"z1":9,"c":"#6e4a2c"},{"t":"box","x0":5,"x1":6,"y0":5,"y1":6,"z0":0,"z1":9,"c":"#6e4a2c"},{"t":"box","x0":-7,"x1":7,"y0":-7,"y1":7,"z0":9,"z1":11,"c":"#8b5e3c","tex":"wood"},{"t":"cyl","x":1,"y":1,"r":1.6,"z0":11,"z1":14.5,"side":"#f2f2f2","top":"#7a4a2a"}]}`;

export function buildPrompt(description: string): string {
  const desc = description.replace(/\s+/g, ' ').trim().slice(0, 200);
  return `${SPEC}\n\n${STYLE}\n\n${RULES}\n\nDescription du joueur : ${desc}`;
}

/** Pull the first JSON object out of a model answer (tolerates a code fence or a stray sentence). */
export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]! : text;
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}
