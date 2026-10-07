// Look of the website: one stylesheet, one page frame, a few pixel icons. Original artwork, drawn in code.

export const esc = (text: unknown) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// 8x8 icons, drawn with the current text colour.
const ICONS: Record<string, string[]> = {
  wand: ['.....#.#', '......#.', '....#.#.', '...###..', '..###...', '.###....', '###.....', '##......'],
  home: ['...##...', '..####..', '.######.', '########', '.#.##.#.', '.#.##.#.', '.#.##.#.', '.######.'],
  friends: ['.##..##.', '.##..##.', '..#...#.', '####.###', '####.###', '.##..##.', '.##..##.', '.#.#.#.#'],
  shield: ['########', '#.####.#', '#.####.#', '#.####.#', '.#.##.#.', '.#.##.#.', '..#..#..', '...##...'],
  star: ['...##...', '...##...', '########', '.######.', '..####..', '.##..##.', '##....##', '........'],
  gem: ['..####..', '.######.', '########', '.######.', '..####..', '...##...', '........', '........'],
  play: ['##......', '####....', '######..', '########', '######..', '####....', '##......', '........'],
  chat: ['########', '#......#', '#.#.#..#', '#......#', '########', '..##....', '..#.....', '........'],
  lock: ['..####..', '.#....#.', '.#....#.', '########', '########', '###..###', '########', '########'],
};

export function icon(name: string, size = 20): string {
  const rows = ICONS[name] ?? ICONS.star!;
  const rects = rows
    .flatMap((row, y) => [...row].flatMap((ch, x) => (ch === '#' ? [`<rect x="${x}" y="${y}" width="1" height="1"/>`] : [])))
    .join('');
  return `<svg class="icon" viewBox="0 0 8 8" width="${size}" height="${size}" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}

const STYLE = `
:root{--bg:#120c2c;--bg2:#1b1340;--card:#231a4a;--card2:#2c2158;--line:#3f3478;--text:#f6f1ff;--muted:#b3a9dc;--gold:#ffc857;--pink:#ff5a7a;--teal:#6be2a3;--blue:#5ab8ff;--violet:#b78cff;--orange:#ff9a5a;--ink:#2a2140}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 'Nunito',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--gold)}
img{max-width:100%}
.px{font-family:'Press Start 2P',ui-monospace,monospace;font-weight:400;line-height:1.5}
.icon{display:inline-block;vertical-align:-3px}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.muted{color:var(--muted)}.small{font-size:14px}
.ok{color:var(--teal)}.bad{color:#ff8a80}

/* ---- Top bar ---- */
.top{position:sticky;top:0;z-index:20;background:rgba(18,12,44,.88);backdrop-filter:blur(10px);border-bottom:2px solid #0b0720;box-shadow:0 2px 0 var(--line)}
.top .wrap{display:flex;align-items:center;gap:8px 22px;padding-top:10px;padding-bottom:10px;flex-wrap:wrap}
.logo{display:inline-flex;text-decoration:none;font-size:17px;letter-spacing:1px}
.logo span{display:inline-block;text-shadow:2px 2px 0 #0b0720;animation:bob 2.6s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.top nav{display:flex;flex-wrap:wrap;gap:2px 6px;flex:1}
.top nav a{color:var(--muted);text-decoration:none;font-weight:700;padding:6px 12px;border-radius:8px}
.top nav a:hover{color:var(--text);background:var(--card)}
.top nav a.on{color:var(--ink);background:var(--gold)}
.who{display:flex;align-items:center;gap:10px}
.who b{color:var(--gold)}

/* ---- Buttons ---- */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font:inherit;font-weight:800;color:var(--text);text-decoration:none;cursor:pointer;
  padding:10px 20px;border:2px solid #0b0720;border-radius:10px;background:linear-gradient(#5a4aa8,#43388a);
  box-shadow:inset 0 2px 0 rgba(255,255,255,.25),0 4px 0 #0b0720;transition:transform .08s,box-shadow .08s,filter .15s}
.btn:hover{filter:brightness(1.12)}
.btn:active{transform:translateY(4px);box-shadow:inset 0 2px 0 rgba(255,255,255,.25),0 0 0 #0b0720}
.btn:disabled{opacity:.55;cursor:default}
.btn.gold{color:var(--ink);background:linear-gradient(#ffe08a,#ffc857);box-shadow:inset 0 2px 0 rgba(255,255,255,.6),0 4px 0 #9a6f10}
.btn.gold:active{box-shadow:inset 0 2px 0 rgba(255,255,255,.6),0 0 0 #9a6f10}
.btn.pink{background:linear-gradient(#ff8aa3,#ff5a7a);color:#fff;box-shadow:inset 0 2px 0 rgba(255,255,255,.4),0 4px 0 #8f1f3a}
.btn.big{font-size:18px;padding:14px 28px;border-radius:12px}
.btn.small{padding:6px 14px;font-size:14px}
.btn.ghost{background:transparent;box-shadow:none;border-color:var(--line)}
.btn.ghost:hover{background:var(--card)}
.btn.ghost:active{transform:none}

/* ---- Hero ---- */
.hero{position:relative;overflow:hidden;min-height:min(88vh,660px);display:grid;align-items:center;border-bottom:4px solid #0b0720}
.hero canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:right bottom;image-rendering:pixelated}
.hero::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(18,12,44,.94) 0%,rgba(18,12,44,.72) 38%,rgba(18,12,44,0) 70%),linear-gradient(0deg,rgba(18,12,44,.5),transparent 30%)}
.hero-in{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,.75fr);gap:36px;align-items:center;padding-top:56px;padding-bottom:56px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:5px 14px;border-radius:999px;background:rgba(255,200,87,.14);border:1px solid rgba(255,200,87,.5);color:var(--gold);font-weight:800;font-size:14px}
.hero h1{margin:16px 0 14px;font-size:clamp(22px,3.6vw,38px);text-shadow:3px 3px 0 #0b0720}
.hero h1 em{font-style:normal;color:var(--gold)}
.hero .lead{font-size:clamp(16px,1.6vw,19px);color:#e5defa;max-width:560px;margin:0 0 24px;text-shadow:0 1px 0 #0b0720}
.cta{display:flex;flex-wrap:wrap;gap:14px;align-items:center}
.hero .stamp{margin-top:22px;color:var(--muted);font-size:14px}
.panel{backdrop-filter:blur(7px);background:rgba(35,26,74,.9);border:2px solid #0b0720;border-radius:16px;box-shadow:inset 0 0 0 2px #5a4d99,0 18px 40px rgba(5,2,20,.6);padding:22px}
.panel h2{margin:0 0 12px;font-size:12px;color:var(--gold)}
.me-line{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed var(--line)}
.me-line:last-of-type{border-bottom:0}
.me-line strong{color:var(--gold)}

/* ---- Forms ---- */
.form{display:grid;gap:12px}
.field{display:grid;gap:5px;font-weight:700;font-size:14px;color:var(--muted)}
.field input{font:inherit;font-weight:600;color:var(--text);background:#0e0826;border:2px solid var(--line);border-radius:10px;padding:11px 13px;width:100%;transition:border-color .15s,box-shadow .15s}
.field input:focus{outline:0;border-color:var(--gold);box-shadow:0 0 0 3px rgba(255,200,87,.25)}
.field input::placeholder{color:#6f66a3}
.pw{position:relative}
.pw input{padding-right:70px}
.pw button{position:absolute;right:6px;top:50%;transform:translateY(-50%);font:inherit;font-size:13px;font-weight:800;color:var(--muted);background:none;border:0;cursor:pointer;padding:6px 8px}
.form-error{margin:0;min-height:1.4em;color:#ff8a80;font-weight:700;font-size:14px}
.hint{margin:0;color:var(--muted);font-size:13px}
.check{display:flex;align-items:flex-start;gap:10px;font-weight:600;color:var(--text);font-size:14px}
.check input{width:20px;height:20px;margin-top:2px;accent-color:var(--gold)}

/* ---- Strip of numbers ---- */
.stats{position:relative;z-index:2;margin-top:-34px}
.stats-in{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.stat{background:var(--card);border:2px solid #0b0720;border-radius:14px;box-shadow:inset 0 0 0 2px #4a3d8c,0 8px 20px rgba(5,2,20,.5);padding:14px 16px;text-align:center}
.stat strong{display:block;font-family:'Press Start 2P',ui-monospace,monospace;font-weight:400;font-size:20px;color:var(--gold);margin-bottom:6px}
.stat span{color:var(--muted);font-weight:700;font-size:14px}
strong.live{display:flex!important;justify-content:center;align-items:center}
.live{display:inline-flex;align-items:center;gap:7px}
.live i{display:block;width:14px;height:14px;border-radius:50%;background:var(--teal);box-shadow:0 0 0 0 rgba(107,226,163,.7);animation:ping 1.8s infinite}
.live.off i{background:#ff8a80;animation:none}
@keyframes ping{70%{box-shadow:0 0 0 9px rgba(107,226,163,0)}100%{box-shadow:0 0 0 0 rgba(107,226,163,0)}}

/* ---- Sections ---- */
section.block{padding:64px 0 8px}
.head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap}
.head h2{margin:0;font-size:clamp(14px,2vw,20px);color:var(--text);text-shadow:2px 2px 0 #0b0720}
.head h2::before{content:'';display:inline-block;width:14px;height:14px;margin-right:12px;background:var(--gold);box-shadow:4px 4px 0 #9a6f10;transform:rotate(45deg) scale(.7)}
.head p{margin:6px 0 0;color:var(--muted);max-width:620px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.tile{position:relative;background:var(--card);border:2px solid #0b0720;border-radius:16px;box-shadow:inset 0 0 0 2px #4a3d8c;padding:22px 18px 18px;overflow:hidden;transition:transform .2s}
.tile:hover{transform:translateY(-4px)}
.tile::before{content:'';position:absolute;left:0;right:0;top:0;height:6px;background:var(--c)}
.tile .ico{display:grid;place-items:center;width:52px;height:52px;border-radius:14px;background:var(--c);color:var(--ink);margin-bottom:14px;box-shadow:0 4px 0 #0b0720}
.tile h3{margin:0 0 6px;font-size:18px}
.tile p{margin:0;color:var(--muted);font-size:15px}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;counter-reset:s;list-style:none;padding:0;margin:0}
.steps li{counter-increment:s;position:relative;background:linear-gradient(160deg,var(--card2),var(--card));border:2px solid #0b0720;border-radius:16px;padding:44px 18px 18px}
.steps li::before{content:counter(s);position:absolute;left:16px;top:-18px;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:var(--gold);color:var(--ink);font-family:'Press Start 2P',monospace;font-size:16px;box-shadow:0 4px 0 #9a6f10;border:2px solid #0b0720}
.steps b{display:block;margin-bottom:4px;font-size:17px}
.steps span{color:var(--muted);font-size:15px}

/* ---- Creations ---- */
.strip{position:relative}
.strip-row{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px 4px 16px;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
.piece{flex:0 0 190px;scroll-snap-align:start;background:var(--card);border:2px solid #0b0720;border-radius:16px;box-shadow:inset 0 0 0 2px #4a3d8c;padding:12px;text-align:center;text-decoration:none;color:var(--text);transition:transform .2s}
.piece:hover{transform:translateY(-5px) rotate(-1deg)}
.piece .pic{display:grid;place-items:center;height:164px;margin-bottom:10px;border-radius:12px;background:
  conic-gradient(#171034 25%,#1d1642 0 50%,#171034 0 75%,#1d1642 0) 0 0/16px 16px}
.piece img{width:132px;height:154px;object-fit:contain;image-rendering:auto;filter:drop-shadow(0 6px 0 rgba(0,0,0,.35));animation:float 4s ease-in-out infinite}
.piece:nth-child(2n) img{animation-delay:-1.3s}.piece:nth-child(3n) img{animation-delay:-2.4s}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
.piece b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.piece small{color:var(--muted)}
.serial{display:inline-block;margin-bottom:6px;padding:2px 9px;border-radius:999px;background:var(--gold);color:var(--ink);font-weight:800;font-size:12px}
.arrows{display:flex;gap:8px}

/* ---- News ---- */
.news{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.post{display:flex;flex-direction:column;gap:8px;background:var(--card);border:2px solid #0b0720;border-radius:16px;box-shadow:inset 0 0 0 2px #4a3d8c;padding:18px;text-decoration:none;color:var(--text);transition:transform .2s}
.post:hover{transform:translateY(-4px)}
.post h3{margin:0;font-size:18px}
.post p{margin:0;color:var(--muted);font-size:15px}
.chip{align-self:flex-start;padding:2px 10px;border-radius:999px;background:var(--card2);border:1px solid var(--line);color:var(--muted);font-weight:800;font-size:12px}
.chip.gold{background:var(--gold);color:var(--ink);border-color:var(--gold)}
.article{max-width:760px}
.article h1{font-size:clamp(18px,3vw,28px);margin:8px 0 10px}
.article p{font-size:17px}

/* ---- Final call ---- */
.band{margin:72px 0 0;padding:52px 0;background:linear-gradient(120deg,#6a2288,#cf4a8c 55%,#ff9a78);border-top:4px solid #0b0720;border-bottom:4px solid #0b0720;text-align:center;position:relative;overflow:hidden}
.band h2{margin:0 0 10px;font-size:clamp(14px,2.4vw,22px);text-shadow:3px 3px 0 #0b0720}
.band p{margin:0 auto 22px;max-width:560px;color:#fff;font-weight:700;text-shadow:0 1px 0 rgba(0,0,0,.4)}

/* ---- Tables, lists ---- */
.rank{width:100%;border-collapse:separate;border-spacing:0 8px}
.rank td{padding:12px 16px;background:var(--card);border-top:2px solid #0b0720;border-bottom:2px solid #0b0720}
.rank td:first-child{border-left:2px solid #0b0720;border-radius:12px 0 0 12px;width:64px;font-family:'Press Start 2P',monospace;font-size:14px;color:var(--gold)}
.rank td:last-child{border-right:2px solid #0b0720;border-radius:0 12px 12px 0;text-align:right;color:var(--muted);font-weight:700}
.rank tr:nth-child(1) td:first-child{color:#ffd700}.rank tr:nth-child(2) td:first-child{color:#d8d8e8}.rank tr:nth-child(3) td:first-child{color:#e8a070}
.two{display:grid;grid-template-columns:1fr 1fr;gap:28px}
.team{display:flex;flex-wrap:wrap;gap:12px;padding:0;list-style:none}
.team li{display:flex;align-items:center;gap:10px;padding:10px 18px;background:var(--card);border:2px solid #0b0720;border-radius:12px;box-shadow:inset 0 0 0 2px #4a3d8c;font-weight:800}
.page{padding:44px 0 24px}
.page h1{margin:0 0 6px;font-size:clamp(16px,2.6vw,26px);text-shadow:3px 3px 0 #0b0720}
.page .lead{color:var(--muted);margin:0 0 22px;max-width:700px}
.box{background:var(--card);border:2px solid #0b0720;border-radius:16px;box-shadow:inset 0 0 0 2px #4a3d8c;padding:22px}
.badge{display:inline-block;margin-left:10px;padding:3px 10px;border-radius:999px;background:var(--pink);color:#fff;font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;vertical-align:middle}

/* ---- Sign in / sign up pages ---- */
.auth-page{min-height:100vh;display:grid;place-items:center;position:relative;padding:24px 16px}
.auth-page canvas{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;object-position:center bottom;image-rendering:pixelated;z-index:0}
.auth-page::before{content:'';position:fixed;inset:0;z-index:1;background:radial-gradient(ellipse at center,rgba(18,12,44,.3),rgba(18,12,44,.75))}
.auth-card{position:relative;z-index:2;width:min(460px,100%);padding:28px 26px}
.auth-card .logo{justify-content:center;font-size:20px;margin-bottom:6px;display:flex}
.auth-card h1{margin:12px 0 4px;font-size:14px;text-align:center;color:var(--gold)}
.auth-card .sub{text-align:center;color:var(--muted);margin:0 0 18px}
.auth-card .switch{margin:16px 0 0;text-align:center;color:var(--muted);font-size:15px}
.dots{display:flex;justify-content:center;gap:10px;list-style:none;padding:0;margin:0 0 18px}
.dots li{width:34px;height:8px;border-radius:4px;background:var(--line);transition:background .2s}
.dots li.on{background:var(--gold)}.dots li.done{background:var(--teal)}
.row{display:flex;gap:10px;justify-content:space-between;margin-top:6px}
.row .btn{flex:1}

footer.site{margin-top:0;background:#0b0720;border-top:4px solid var(--line);padding:34px 0 40px;color:var(--muted);font-size:14px}
footer.site .wrap{display:flex;flex-wrap:wrap;gap:18px 40px;justify-content:space-between}
footer.site a{color:var(--muted);text-decoration:none;margin-right:16px}
footer.site a:hover{color:var(--gold)}

.reveal{opacity:0;transform:translateY(22px);transition:opacity .6s ease,transform .6s ease}
.reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}.logo span,.piece img,.live i{animation:none}.tile,.piece,.post{transition:none}}

@media (max-width:900px){
  .hero-in{grid-template-columns:1fr}
  .hero::after{background:linear-gradient(0deg,rgba(18,12,44,.92),rgba(18,12,44,.6))}
  .tiles,.steps{grid-template-columns:repeat(2,1fr)}
  .news{grid-template-columns:1fr}
  .stats-in{grid-template-columns:repeat(2,1fr)}
  .two{grid-template-columns:1fr}
}
@media (max-width:560px){.tiles,.steps{grid-template-columns:1fr}.top nav{order:3;flex-basis:100%}}
`;

export interface PageOptions {
  title: string;
  description?: string;
  /** Key of the navigation link to highlight. */
  active?: string;
  body: string;
  /** Where the game itself lives. */
  gameUrl: string;
  /** The signed-in player, if any. */
  user: { nickname: string } | null;
  /** Page class for the body, and the animated city behind it. */
  bodyClass?: string;
  city?: boolean;
  /** No top bar or footer: the sign-in and sign-up pages. */
  bare?: boolean;
}

const LOGO_COLORS = ['#ff5a7a', '#ffc857', '#6be2a3', '#5ab8ff', '#b78cff', '#ff9a5a', '#ff5a7a'];
export const logo = () =>
  `<a class="logo px" href="/site" aria-label="Coloxel">${[...'COLOXEL'].map((c, k) => `<span aria-hidden="true" style="color:${LOGO_COLORS[k]};animation-delay:${k * 110}ms">${c}</span>`).join('')}</a>`;

const NAV: [string, string, string][] = [
  ['home', '/site', 'Accueil'],
  ['news', '/site/actualites', 'Actualités'],
  ['ranking', '/site/classement', 'Classement'],
  ['team', '/site/equipe', 'L’équipe'],
  ['status', '/site/statut', 'État du jeu'],
];

export function page(o: PageOptions): string {
  const links = NAV.map(([key, href, label]) => `<a href="${href}"${key === o.active ? ' class="on"' : ''}>${label}</a>`).join('');
  const account = o.user
    ? `<div class="who"><span>Salut, <b>${esc(o.user.nickname)}</b></span><a class="btn gold small" href="${esc(o.gameUrl)}">${icon('play', 14)} Jouer</a><button class="btn ghost small" type="button" data-logout>Se déconnecter</button></div>`
    : `<div class="who"><a class="btn ghost small" href="/site/connexion">Se connecter</a><a class="btn gold small" href="/site/inscription">Créer un compte</a></div>`;
  const top = o.bare
    ? ''
    : `<header class="top"><div class="wrap">${logo()}<nav aria-label="Navigation">${links}</nav>${account}</div></header>`;
  const foot = o.bare
    ? ''
    : `<footer class="site"><div class="wrap"><div>${logo()}<p>Chaque objet est inventé par un joueur, et n’existe qu’en un seul exemplaire.</p></div>
<div><p><a href="/site">Accueil</a><a href="/site/actualites">Actualités</a><a href="/site/classement">Classement</a><a href="/site/equipe">L’équipe</a><a href="/site/statut">État du jeu</a></p>
<p>Coloxel est réservé aux adultes (18 ans et plus) pendant l’alpha.</p></div></div></footer>`;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)} · Coloxel</title>
<meta name="description" content="${esc(o.description ?? 'Coloxel : un jeu social en pixel art où chaque objet est inventé par un joueur et n’existe qu’en un seul exemplaire.')}">
<meta name="theme-color" content="#120c2c">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800&family=Press+Start+2P&display=swap" rel="stylesheet">
<style>${STYLE}</style><noscript><style>.reveal{opacity:1;transform:none}</style></noscript></head>
<body class="${esc(o.bodyClass ?? '')}" data-game="${esc(o.gameUrl)}">${top}${o.body}${foot}
<script src="/site/assets/site.js" defer></script>${o.city ? '<script src="/site/assets/city.js" defer></script>' : ''}</body></html>`;
}
