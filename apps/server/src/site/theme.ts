import { skylineSvg } from '@coloxel/render';

// Look of the website: one stylesheet, one page frame, a few pixel icons. Original artwork, drawn in code.
// A night-time look shared with the game: dusk sky and skyline, glass cards, warm gold accents.

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
  crown: ['#..##..#', '#.####.#', '########', '########', '.######.', '........', '........', '........'],
  heart: ['.##..##.', '########', '########', '########', '.######.', '..####..', '...##...', '........'],
};

export function icon(name: string, size = 20): string {
  const rows = ICONS[name] ?? ICONS.star!;
  const rects = rows
    .flatMap((row, y) => [...row].flatMap((ch, x) => (ch === '#' ? [`<rect x="${x}" y="${y}" width="1" height="1"/>`] : [])))
    .join('');
  return `<svg class="icon" viewBox="0 0 8 8" width="${size}" height="${size}" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}

/** Versions of the files the pages load, so that a browser keeps them for a year and fetches them again only when they change. */
export const assetVersions: Record<string, string> = {};

export const STYLE = `
:root{--ink:#f6f3ff;--ink2:#cdc7ef;--dark:#2a1a05;--paper:rgba(24,19,50,.62);--paper-strong:rgba(18,14,38,.88);--line:rgba(255,255,255,.12);--lav:#0c0a1d;--lav2:rgba(255,255,255,.1);
--purple:#8f7bff;--purple-d:#c9bdff;--navy:#0c0a1d;--gold:#ffc857;--gold-d:#c9921a;--pink:#ff6b9a;--teal:#34d6a0;--blue:#4cb6ff;--violet:#b78cff;--orange:#ff9a5a;--muted:#a9a4cf;
--ease:cubic-bezier(.2,.9,.25,1.15);--glow:0 0 0 1px rgba(255,255,255,.05),0 24px 60px -20px rgba(3,1,18,.9)}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{scroll-behavior:smooth}
body{margin:0;background:#0c0a1d;color:var(--ink);font:16px/1.6 'Outfit','Nunito',system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:#ffd98a;font-weight:600}
img{max-width:100%}
::selection{background:rgba(255,200,87,.35)}
.px{font-family:'Press Start 2P',ui-monospace,monospace;font-weight:400;line-height:1.55}
.icon{display:inline-block;vertical-align:-3px}
.wrap{max-width:1180px;margin:0 auto;padding:0 22px}
.muted{color:var(--muted)}.small{font-size:14px}
.ok{color:#5be3b0}.bad{color:#ff7a95}

/* ---- Night scenery behind every page ---- */
.night{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;background:
  radial-gradient(120% 80% at 50% 115%,#5b2b86 0%,rgba(91,43,134,0) 60%),radial-gradient(80% 60% at 85% 0%,#1d3a7a 0%,rgba(29,58,122,0) 70%),
  radial-gradient(70% 55% at 10% 10%,#3a1a6e 0%,rgba(58,26,110,0) 70%),linear-gradient(#0e0b26,#170f38 55%,#2a1450)}
.night .stars,.night .stars::after{position:absolute;inset:0;content:'';animation:twinkle 5.5s ease-in-out infinite;background-image:
  radial-gradient(1.4px 1.4px at 8% 12%,#fff 50%,transparent 52%),radial-gradient(1px 1px at 17% 31%,rgba(255,255,255,.8) 50%,transparent 52%),
  radial-gradient(1.6px 1.6px at 27% 8%,#fff 50%,transparent 52%),radial-gradient(1px 1px at 36% 22%,rgba(255,255,255,.7) 50%,transparent 52%),
  radial-gradient(1.3px 1.3px at 47% 11%,#ffe9b0 50%,transparent 52%),radial-gradient(1px 1px at 58% 27%,rgba(255,255,255,.8) 50%,transparent 52%),
  radial-gradient(1.5px 1.5px at 66% 6%,#fff 50%,transparent 52%),radial-gradient(1px 1px at 74% 19%,rgba(255,255,255,.7) 50%,transparent 52%),
  radial-gradient(1.4px 1.4px at 83% 9%,#cfe6ff 50%,transparent 52%),radial-gradient(1px 1px at 91% 28%,rgba(255,255,255,.8) 50%,transparent 52%),
  radial-gradient(1.2px 1.2px at 96% 14%,#fff 50%,transparent 52%),radial-gradient(1px 1px at 4% 38%,rgba(255,255,255,.6) 50%,transparent 52%),
  radial-gradient(1.2px 1.2px at 42% 36%,rgba(255,255,255,.6) 50%,transparent 52%)}
.night .stars::after{background-position:13% 9%;background-size:70% 70%;animation-duration:8s;animation-delay:-3s;opacity:.7}
@keyframes twinkle{0%,100%{opacity:1}50%{opacity:.45}}
.night .aurora{position:absolute;width:70vmax;height:70vmax;border-radius:50%;filter:blur(80px);opacity:.5;mix-blend-mode:screen;animation:drift-a 26s ease-in-out infinite alternate}
.night .aurora.a{left:-18vmax;top:-30vmax;background:radial-gradient(circle,#7a3df0 0%,rgba(122,61,240,0) 65%)}
.night .aurora.b{right:-22vmax;top:8vmax;background:radial-gradient(circle,#ff5fa8 0%,rgba(255,95,168,0) 62%);opacity:.32;animation-duration:34s;animation-direction:alternate-reverse}
.night .aurora.c{left:20vmax;bottom:-42vmax;background:radial-gradient(circle,#29c6ff 0%,rgba(41,198,255,0) 62%);opacity:.22;animation-duration:40s}
@keyframes drift-a{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(6vmax,4vmax,0) scale(1.18)}}
.night .moon{position:absolute;top:12vh;right:11vw;width:90px;height:90px;border-radius:50%;background:radial-gradient(circle at 36% 34%,#fffdf2 0%,#ffe9b8 55%,#f6c978 100%);box-shadow:0 0 0 14px rgba(255,233,184,.06),0 0 90px 30px rgba(255,214,140,.28)}
.night .skyline{position:absolute;left:-2%;right:-2%;bottom:0;width:104%;height:34vh;opacity:.9}

/* ---- Top bar ---- */
.top{position:sticky;top:0;z-index:30;background:rgba(14,11,38,.62);-webkit-backdrop-filter:blur(20px) saturate(1.5);backdrop-filter:blur(20px) saturate(1.5);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:8px 22px;padding-top:12px;padding-bottom:12px;flex-wrap:wrap}
.logo{display:inline-flex;text-decoration:none;font-size:17px;letter-spacing:1px}
.logo span{display:inline-block;text-shadow:0 0 18px currentColor;animation:bob 2.6s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.top nav{display:flex;flex-wrap:wrap;gap:4px;flex:1}
.top nav a{color:var(--ink2);text-decoration:none;font-weight:600;padding:7px 16px;border-radius:999px;transition:background .15s,color .15s}
.top nav a:hover{background:rgba(255,255,255,.1);color:#fff}
.top nav a.on{color:var(--dark);background:linear-gradient(135deg,#ffe08a,#ffb84a);box-shadow:0 8px 22px -8px rgba(255,184,74,.8)}
.who{display:flex;align-items:center;gap:10px;color:var(--ink2)}
.who b{color:var(--gold)}

/* ---- Buttons ---- */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font:inherit;font-weight:700;color:#fff;text-decoration:none;cursor:pointer;
  padding:11px 22px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.1);
  transition:transform .2s var(--ease),box-shadow .2s,background .15s,filter .15s}
.btn:hover{background:rgba(255,255,255,.18);transform:translateY(-2px)}
.btn:active{transform:scale(.97)}
.btn:disabled{opacity:.6;cursor:default}
.btn.gold{color:var(--dark);border:0;background:linear-gradient(135deg,#ffe08a,#ffb84a);box-shadow:0 14px 30px -12px rgba(255,184,74,.85),inset 0 1px 0 rgba(255,255,255,.6)}
.btn.gold:hover{background:linear-gradient(135deg,#ffe9a6,#ffc563);box-shadow:0 18px 38px -12px rgba(255,184,74,.95),inset 0 1px 0 rgba(255,255,255,.6)}
.btn.pink{border:0;background:linear-gradient(135deg,#ff8fb4,#ff5a8a);box-shadow:0 14px 30px -12px rgba(255,90,138,.8)}
.btn.green{color:#04281d;border:0;background:linear-gradient(135deg,#6af2bd,#1fae86)}
.btn.white{background:rgba(255,255,255,.12)}
.btn.big{font-size:18px;padding:16px 32px;border-radius:18px}
.btn.small{padding:6px 16px;font-size:14px;border-radius:12px}

/* ---- Glass windows ---- */
.win{background:var(--paper);-webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4);border:1px solid var(--line);border-radius:22px;box-shadow:var(--glow),inset 0 1px 0 rgba(255,255,255,.1);overflow:hidden}
.win>h2,.win>.bar{margin:0;padding:15px 22px;font-size:11px;color:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,var(--c1,#8f7bff),transparent 85%);background-color:rgba(255,255,255,.03)}
.win .in{padding:22px}
.win.pinkbar{--c1:rgba(255,107,154,.5)}.win.goldbar{--c1:rgba(255,200,87,.5)}.win.greenbar{--c1:rgba(52,214,160,.5)}.win.bluebar{--c1:rgba(76,182,255,.5)}.win.violetbar{--c1:rgba(183,140,255,.5)}
.win.goldbar>h2{color:#fff}

/* ---- Hero ---- */
.hero{position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;left:50%;top:-20%;width:90vw;height:90%;transform:translateX(-50%);background:radial-gradient(closest-side,rgba(143,123,255,.22),transparent);pointer-events:none}
.cloud{display:none}
.hero-in{position:relative;z-index:2;display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:20px;align-items:center;padding-top:56px;padding-bottom:30px;min-height:640px}
.hero-copy{padding-bottom:30px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:7px 16px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid var(--line);color:#ffe3a3;font-weight:600;font-size:14px;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.hero h1{margin:22px 0 18px;font-family:'Outfit',sans-serif;font-weight:800;line-height:1.05;letter-spacing:-.02em;font-size:clamp(34px,4.3vw,62px);color:#fff}
.hero h1.px{font-family:'Outfit',sans-serif}
.hero h1 em{font-style:normal;background:linear-gradient(100deg,#ffd98a,#ff8ac0 55%,#9f8bff);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero .lead{font-size:clamp(17px,1.5vw,20px);font-weight:400;color:var(--ink2);max-width:540px;margin:0 0 30px}
.cta{display:flex;flex-wrap:wrap;gap:14px;align-items:center}
.stamp{margin-top:24px;color:var(--muted);font-size:14px}
.hero-art{position:relative;align-self:center;margin:0 -90px 0 -30px}
.hero-art::before{content:'';position:absolute;left:8%;right:8%;bottom:2%;height:22%;background:radial-gradient(closest-side,rgba(0,0,0,.65),transparent);filter:blur(10px)}
.hero-art img{position:relative;display:block;width:100%;height:auto;filter:drop-shadow(0 0 60px rgba(143,123,255,.35)) drop-shadow(0 30px 30px rgba(0,0,0,.4));animation:hover 7s ease-in-out infinite}
@keyframes hover{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.grass{display:none}
.me-chips{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 26px}
.me-chips span{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:14px;background:var(--paper);border:1px solid var(--line);font-weight:600;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}

/* ---- Forms ---- */
.form{display:grid;gap:14px}
.field{display:grid;gap:6px;font-weight:600;font-size:14px;color:var(--ink2)}
.field input{font:inherit;font-weight:500;color:#fff;background:rgba(6,4,20,.5);border:1px solid var(--line);border-radius:14px;padding:13px 16px;width:100%;transition:border-color .15s,box-shadow .15s}
.field input:focus{outline:0;border-color:rgba(255,200,87,.7);box-shadow:0 0 0 4px rgba(255,200,87,.16)}
.field input::placeholder{color:rgba(169,164,207,.65)}
.pw{position:relative}
.pw input{padding-right:70px}
.pw button{position:absolute;right:8px;top:50%;transform:translateY(-50%);font:inherit;font-size:13px;font-weight:700;color:#ffd98a;background:none;border:0;cursor:pointer;padding:6px 8px}
.form-error{margin:0;min-height:1.4em;color:#ff8aa3;font-weight:600;font-size:14px}
.hint{margin:0;color:var(--muted);font-size:13px}
.check{display:flex;align-items:flex-start;gap:10px;font-weight:500;font-size:14px;color:var(--ink2)}
.check input{width:20px;height:20px;margin-top:2px;accent-color:var(--gold)}

/* ---- Numbers ---- */
.stats{position:relative;z-index:4;margin-top:6px}
.stats-in{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.stat{background:var(--paper);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid var(--line);border-radius:20px;box-shadow:var(--glow);padding:20px 14px;text-align:center}
.stat strong{display:block;font-family:'Outfit',sans-serif;font-weight:800;font-size:40px;line-height:1.1;color:#fff;margin-bottom:4px;background:linear-gradient(120deg,#fff,#c9bdff);-webkit-background-clip:text;background-clip:text;color:transparent}
.stat:nth-child(2) strong{background:linear-gradient(120deg,#ffd98a,#ff8ac0);-webkit-background-clip:text;background-clip:text}
.stat:nth-child(3) strong{background:linear-gradient(120deg,#8ee8ff,#34d6a0);-webkit-background-clip:text;background-clip:text}
.stat span{color:var(--muted);font-weight:500;font-size:14px}
strong.live{display:flex!important;justify-content:center;align-items:center;min-height:44px}
.live{display:inline-flex;align-items:center;gap:8px}
.live i{display:block;width:14px;height:14px;border-radius:50%;background:var(--teal);animation:ping 1.8s infinite}
.live.off i{background:var(--pink);animation:none}
@keyframes ping{70%{box-shadow:0 0 0 12px rgba(52,214,160,0)}0%{box-shadow:0 0 0 0 rgba(52,214,160,.7)}100%{box-shadow:0 0 0 0 rgba(52,214,160,0)}}

/* ---- Sections ---- */
section.block{padding:72px 0 6px}
.head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:26px;flex-wrap:wrap}
.head h2{margin:0;font-size:clamp(13px,1.8vw,18px);color:#fff}
.head h2::before{content:'';display:inline-block;width:10px;height:10px;margin-right:14px;background:linear-gradient(135deg,#ffe08a,#ff8ac0);transform:rotate(45deg);box-shadow:0 0 16px rgba(255,200,87,.8)}
.head p{margin:10px 0 0;color:var(--muted);max-width:640px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.tile{position:relative;background:var(--paper);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid var(--line);border-radius:22px;box-shadow:var(--glow);padding:0 20px 24px;overflow:hidden;transition:transform .3s var(--ease),border-color .2s,box-shadow .3s}
.tile:hover{transform:translateY(-8px);border-color:rgba(255,255,255,.28);box-shadow:var(--glow),0 30px 60px -24px var(--c)}
.tile .ico{display:grid;place-items:center;height:104px;margin:0 -20px 18px;color:#fff;background:radial-gradient(circle at 50% 120%,var(--c),transparent 75%);border-bottom:1px solid var(--line)}
.tile .ico svg{width:50px;height:50px;filter:drop-shadow(0 0 18px var(--c))}
.tile h3{margin:0 0 6px;font-size:21px;font-weight:700}
.tile p{margin:0;color:var(--ink2);font-size:15px}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;counter-reset:s;list-style:none;padding:0;margin:0}
.steps li{counter-increment:s;position:relative;background:var(--paper);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid var(--line);border-radius:22px;box-shadow:var(--glow);padding:42px 20px 22px}
.steps li::before{content:counter(s);position:absolute;left:18px;top:-20px;width:46px;height:46px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,#ffe08a,#ffb84a);color:var(--dark);font-family:'Outfit',sans-serif;font-weight:800;font-size:22px;box-shadow:0 12px 24px -8px rgba(255,184,74,.8)}
.steps b{display:block;margin-bottom:4px;font-size:19px}
.steps span{color:var(--ink2);font-size:15px}
.steps li:nth-child(2)::before{background:linear-gradient(135deg,#ff9fc0,#ff5a8a);color:#fff;box-shadow:0 12px 24px -8px rgba(255,90,138,.8)}
.steps li:nth-child(3)::before{background:linear-gradient(135deg,#6af2bd,#1fae86);color:#04281d;box-shadow:0 12px 24px -8px rgba(40,210,160,.8)}
.steps li:nth-child(4)::before{background:linear-gradient(135deg,#7cc8ff,#3d8cff);color:#fff;box-shadow:0 12px 24px -8px rgba(61,140,255,.8)}

/* ---- Creations ---- */
.strip{position:relative}
.strip-row{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding:8px 6px 26px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
.piece{flex:0 0 200px;scroll-snap-align:start;background:var(--paper);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid var(--line);border-radius:20px;box-shadow:var(--glow);padding:12px;text-align:center;text-decoration:none;color:var(--ink);transition:transform .3s var(--ease),border-color .2s}
.piece:hover{transform:translateY(-8px);border-color:rgba(255,200,87,.6)}
.piece .pic{display:grid;place-items:center;height:168px;margin-bottom:12px;border-radius:14px;background:radial-gradient(ellipse at 50% 85%,rgba(255,255,255,.2),rgba(255,255,255,.03) 70%)}
.piece img{width:132px;height:154px;object-fit:contain;image-rendering:auto;filter:drop-shadow(0 12px 14px rgba(0,0,0,.45));animation:float 4s ease-in-out infinite}
.piece:nth-child(2n) img{animation-delay:-1.3s}.piece:nth-child(3n) img{animation-delay:-2.4s}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.piece b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.piece small{color:var(--muted);font-weight:500}
.serial{display:inline-block;margin-bottom:6px;padding:2px 12px;border-radius:999px;background:linear-gradient(135deg,#ffe08a,#ffb84a);color:var(--dark);font-weight:700;font-size:12px}
.arrows{display:flex;gap:8px}

/* ---- Arrivals ---- */
.crowd{display:flex;gap:14px;overflow-x:auto;padding:6px 6px 26px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
.who-card{flex:0 0 138px;text-align:center;text-decoration:none;color:var(--ink);background:var(--paper);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid var(--line);border-radius:20px;box-shadow:var(--glow);padding:10px 8px 14px;transition:transform .3s var(--ease),border-color .2s}
.who-card:hover{transform:translateY(-8px);border-color:rgba(255,200,87,.6)}
.who-card .stage{display:grid;place-items:end center;height:128px;border-radius:14px;background:radial-gradient(ellipse at 50% 100%,rgba(143,123,255,.45),rgba(255,255,255,.03) 75%);margin-bottom:8px;overflow:hidden}
.who-card img{width:56px;height:108px;image-rendering:pixelated;margin-bottom:6px;filter:drop-shadow(0 6px 6px rgba(0,0,0,.4))}
.who-card b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}

/* ---- News ---- */
.news{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.post{display:flex;flex-direction:column;gap:10px;background:var(--paper);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid var(--line);border-radius:22px;box-shadow:var(--glow);padding:22px;text-decoration:none;color:var(--ink);transition:transform .3s var(--ease),border-color .2s;border-top:3px solid var(--pink)}
.post:nth-child(3n+1){border-top-color:var(--pink)}.post:nth-child(3n+2){border-top-color:var(--blue)}.post:nth-child(3n){border-top-color:var(--teal)}
.post:hover{transform:translateY(-6px);border-color:rgba(255,255,255,.3)}
.post h3{margin:0;font-size:21px;font-weight:700}
.post p{margin:0;color:var(--ink2);font-size:15px}
.chip{align-self:flex-start;padding:3px 12px;border-radius:999px;background:rgba(255,255,255,.1);color:var(--ink);font-weight:600;font-size:12px}
.chip.gold{background:linear-gradient(135deg,#ffe08a,#ffb84a);color:var(--dark)}
.article{max-width:780px;background:var(--paper);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);border:1px solid var(--line);border-radius:22px;box-shadow:var(--glow);padding:30px 34px}
.article h1{font-size:clamp(16px,2.6vw,24px);margin:14px 0 16px;color:#fff}
.article p{font-size:17px;color:var(--ink2)}

/* ---- Final call ---- */
.band{margin:90px 0 0;padding:70px 0;background:linear-gradient(120deg,rgba(122,92,224,.55),rgba(208,78,160,.5) 55%,rgba(255,154,90,.5));border-top:1px solid var(--line);border-bottom:1px solid var(--line);text-align:center;position:relative;overflow:hidden;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.band::before,.band::after{content:'';position:absolute;width:160px;height:160px;border:1px solid rgba(255,255,255,.2);border-radius:36px;transform:rotate(45deg)}
.band::before{left:6%;top:-70px}.band::after{right:7%;bottom:-80px}
.band h2{margin:0 0 14px;font-size:clamp(14px,2.4vw,22px);color:#fff;text-shadow:0 4px 30px rgba(0,0,0,.4)}
.band p{margin:0 auto 28px;max-width:560px;color:#fff;font-weight:500;font-size:18px}

/* ---- Events and team ---- */
.events{display:grid;gap:16px}
.event{display:grid;grid-template-columns:104px 1fr;background:var(--paper);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid var(--line);border-radius:22px;box-shadow:var(--glow);overflow:hidden}
.event .when{display:grid;place-content:center;text-align:center;padding:14px 6px;background:linear-gradient(160deg,var(--c1,#4cb6ff),var(--c2,#3d8cff));color:#fff}
.event:nth-child(3n+2) .when{--c1:#ff8fb4;--c2:#ff5a8a}.event:nth-child(3n) .when{--c1:#5fe0ad;--c2:#1fae86}
.event .when b{display:block;font-family:'Outfit',sans-serif;font-weight:800;font-size:34px;line-height:1.1}
.event .when span{font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em}
.event .what{padding:16px 22px}
.event h3{margin:0 0 4px;font-size:21px}
.event p{margin:4px 0;color:var(--ink2)}
.roles{display:grid;gap:20px}
.role-group h2{display:flex;align-items:center;gap:10px;font-size:12px;margin:0 0 6px}
.role-group p{margin:0 0 10px;color:var(--muted)}
.role-tag{display:inline-block;padding:3px 14px;border-radius:999px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:700;color:#fff;background:var(--purple)}
.role-tag.animateur{background:#1fae86}.role-tag.moderateur{background:#3d8cff}.role-tag.super_moderateur{background:#7a5ce0}.role-tag.gerant{background:#ff8a3d}.role-tag.administrateur{background:#ff5a8a}
@media (max-width:560px){.event{grid-template-columns:1fr}.event .when{grid-auto-flow:column;gap:10px;place-content:center}}

/* ---- Tables, lists ---- */
.rank{width:100%;border-collapse:separate;border-spacing:0 8px}
.rank td{padding:14px 18px;background:var(--paper);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.rank td:first-child{border-left:1px solid var(--line);border-radius:16px 0 0 16px;width:64px;font-family:'Outfit',sans-serif;font-weight:800;font-size:20px;color:var(--purple-d)}
.rank td:last-child{border-right:1px solid var(--line);border-radius:0 16px 16px 0;text-align:right;color:var(--muted);font-weight:600}
.rank tr:nth-child(1) td:first-child{color:#ffd24a}.rank tr:nth-child(2) td:first-child{color:#c3cde6}.rank tr:nth-child(3) td:first-child{color:#ff9f5a}
.two{display:grid;grid-template-columns:1fr 1fr;gap:30px}
.team{display:flex;flex-wrap:wrap;gap:14px;padding:0;list-style:none}
.team li{display:flex;align-items:center;gap:10px;padding:11px 20px;background:var(--paper);border:1px solid var(--line);border-radius:16px;font-weight:600}
.page{padding:50px 0 34px}
.page h1{margin:0 0 10px;font-size:clamp(16px,2.6vw,24px);color:#fff}
.page .lead{color:var(--ink2);margin:0 0 28px;max-width:700px}
.page h2{color:#fff}
.badge{display:inline-block;margin-left:10px;padding:3px 11px;border-radius:999px;background:var(--pink);color:#fff;font-family:'Outfit',sans-serif;font-size:12px;font-weight:700;vertical-align:middle}
.profile{display:grid;grid-template-columns:260px 1fr;gap:28px;align-items:start;margin-bottom:34px}
.profile .stage{display:grid;place-items:end center;height:320px;border-radius:24px;border:1px solid var(--line);background:radial-gradient(ellipse at 50% 100%,rgba(143,123,255,.5),rgba(255,255,255,.03) 75%);overflow:hidden}
.profile .stage img{width:120px;height:232px;image-rendering:pixelated;margin-bottom:16px;animation:float 3.6s ease-in-out infinite;filter:drop-shadow(0 10px 10px rgba(0,0,0,.45))}
.profile .facts{display:grid;gap:12px;padding:0;margin:0;list-style:none}
.profile .facts li{display:flex;gap:10px;align-items:center;font-weight:600}
.profile .facts svg{color:var(--purple)}

/* ---- Sign in / sign up pages ---- */
.auth-page{min-height:100vh;display:grid;place-items:center;position:relative;padding:24px 16px}
.auth-page canvas{display:none}
.auth-card{position:relative;z-index:2;width:min(480px,100%)}
.auth-card .in{padding:30px 32px 32px}
.auth-card .logo{justify-content:center;font-size:21px;margin-bottom:6px;display:flex}
.auth-card h1{margin:18px 0 4px;font-size:13px;text-align:center;color:#fff}
.auth-card .sub{text-align:center;color:var(--ink2);margin:0 0 22px}
.auth-card .switch{margin:18px 0 0;text-align:center;color:var(--muted);font-size:15px}
.dots{display:flex;justify-content:center;gap:10px;list-style:none;padding:0;margin:0 0 20px}
.dots li{width:38px;height:6px;border-radius:3px;background:rgba(255,255,255,.14);transition:background .2s}
.dots li.on{background:var(--gold);box-shadow:0 0 12px rgba(255,200,87,.7)}.dots li.done{background:var(--teal)}
.row{display:flex;gap:10px;justify-content:space-between;margin-top:6px}
.row .btn{flex:1}

footer.site{background:rgba(8,6,24,.7);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-top:1px solid var(--line);padding:44px 0 50px;color:var(--muted);font-size:14px;margin-top:0}
footer.site .wrap{display:flex;flex-wrap:wrap;gap:18px 40px;justify-content:space-between}
footer.site a{color:var(--ink2);text-decoration:none;margin-right:18px;font-weight:600}
footer.site a:hover{color:var(--gold)}
footer.site .logo{margin-bottom:10px}

.reveal{opacity:0;transform:translateY(28px);transition:opacity .7s ease,transform .7s ease}
.reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}.logo span,.piece img,.live i,.hero-art img,.profile .stage img,.night .stars,.night .stars::after,.night .aurora{animation:none}.tile,.piece,.post,.who-card,.btn{transition:none}}

@media (max-width:980px){
  .hero-in{grid-template-columns:1fr;min-height:0;padding-top:34px}
  .hero-copy{padding-bottom:10px}
  .hero-art{margin:0 -8px}
  .tiles,.steps{grid-template-columns:repeat(2,1fr)}
  .news{grid-template-columns:1fr}
  .stats-in{grid-template-columns:repeat(2,1fr)}
  .two{grid-template-columns:1fr}
  .profile{grid-template-columns:1fr}
  .night .moon{width:60px;height:60px}
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
  user: { nickname: string; staff?: boolean } | null;
  /** Page class for the body, and the animated city behind it. */
  bodyClass?: string;
  city?: boolean;
  /** No top bar or footer: the sign-in and sign-up pages. */
  bare?: boolean;
}

/** The sky behind every page: stars, aurora, moon and the skyline (the same as in the game). */
const NIGHT = `<div class="night" aria-hidden="true"><div class="aurora a"></div><div class="aurora b"></div><div class="aurora c"></div><div class="stars"></div><div class="moon"></div>${skylineSvg('skyline')}</div>`;

const LOGO_COLORS = ['#ff5a7a', '#ffc857', '#6be2a3', '#5ab8ff', '#b78cff', '#ff9a5a', '#ff5a7a'];
export const logo = () =>
  `<a class="logo px" href="/site" aria-label="Coloxel">${[...'COLOXEL'].map((c, k) => `<span aria-hidden="true" style="color:${LOGO_COLORS[k]};animation-delay:${k * 110}ms">${c}</span>`).join('')}</a>`;

const NAV: [string, string, string][] = [
  ['home', '/site', 'Accueil'],
  ['news', '/site/actualites', 'Actualités'],
  ['events', '/site/evenements', 'Événements'],
  ['ranking', '/site/classement', 'Classement'],
  ['team', '/site/equipe', 'L’équipe'],
  ['status', '/site/statut', 'État du jeu'],
];

export function page(o: PageOptions): string {
  const links = NAV.map(([key, href, label]) => `<a href="${href}"${key === o.active ? ' class="on"' : ''}>${label}</a>`).join('');
  const account = o.user
    ? `<div class="who"><span>Salut, <b>${esc(o.user.nickname)}</b></span><a class="btn gold small" href="${esc(o.gameUrl)}">${icon('play', 14)} Jouer</a>${o.user.staff ? `<a class="btn pink small" href="${esc(o.gameUrl.replace(/\/+$/, ''))}/admin.html">${icon('shield', 14)} Administration</a>` : ''}<button class="btn white small" type="button" data-logout>Se déconnecter</button></div>`
    : `<div class="who"><a class="btn white small" href="/site/connexion">Se connecter</a><a class="btn gold small" href="/site/inscription">Créer un compte</a></div>`;
  const top = o.bare
    ? ''
    : `<header class="top"><div class="wrap">${logo()}<nav aria-label="Navigation">${links}</nav>${account}</div></header>`;
  const foot = o.bare
    ? ''
    : `<footer class="site"><div class="wrap"><div>${logo()}<p>Chaque objet est inventé par un joueur,<br>et n’existe qu’en un seul exemplaire.</p></div>
<div><p><a href="/site">Accueil</a><a href="/site/actualites">Actualités</a><a href="/site/evenements">Événements</a><a href="/site/classement">Classement</a><a href="/site/equipe">L’équipe</a><a href="/site/statut">État du jeu</a></p>
<p>Coloxel est réservé aux adultes (18 ans et plus) pendant l’alpha.</p></div></div></footer>`;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)} · Coloxel</title>
<meta name="description" content="${esc(o.description ?? 'Coloxel : un jeu social en pixel art où chaque objet est inventé par un joueur et n’existe qu’en un seul exemplaire.')}">
<meta name="theme-color" content="#0c0a1d">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Press+Start+2P&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site/assets/site.css?v=${assetVersions['site.css'] ?? '0'}"><noscript><style>.reveal{opacity:1;transform:none}</style></noscript></head>
<body class="${esc(o.bodyClass ?? '')}" data-game="${esc(o.gameUrl)}">${NIGHT}${top}${o.body}${foot}
<script src="/site/assets/site.js?v=${assetVersions['site.js'] ?? '0'}" defer></script>${o.city ? `<script src="/site/assets/city.js?v=${assetVersions['city.js'] ?? '0'}" defer></script>` : ''}</body></html>`;
}
