// Look of the website: one stylesheet, one page frame, a few pixel icons. Original artwork, drawn in code.
// A sunny, playful look: sky and clouds, chunky game windows with coloured title bars, hard shadows.

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
:root{--ink:#2a2140;--ink2:#4a3d7a;--paper:#fffdf6;--lav:#ece4ff;--lav2:#dcd0fb;--purple:#6b5bb8;--purple-d:#43388a;--navy:#231a4a;
--gold:#ffc857;--gold-d:#c9921a;--pink:#ff5a7a;--teal:#2fc48d;--blue:#3ea7ff;--violet:#b78cff;--orange:#ff9a5a;--muted:#6f6794;
--sky1:#2f93ff;--sky2:#7cc8ff;--sky3:#cfeeff}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{scroll-behavior:smooth}
body{margin:0;background:var(--lav);color:var(--ink);font:16px/1.6 'Nunito',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--purple-d);font-weight:700}
img{max-width:100%}
.px{font-family:'Press Start 2P',ui-monospace,monospace;font-weight:400;line-height:1.55}
.icon{display:inline-block;vertical-align:-3px}
.wrap{max-width:1160px;margin:0 auto;padding:0 20px}
.muted{color:var(--muted)}.small{font-size:14px}
.ok{color:#168a5f}.bad{color:#d6334f}

/* ---- Top bar ---- */
.top{position:sticky;top:0;z-index:30;background:linear-gradient(var(--purple),var(--purple-d));border-bottom:4px solid var(--navy);box-shadow:0 4px 0 rgba(35,26,74,.25)}
.top .wrap{display:flex;align-items:center;gap:8px 20px;padding-top:9px;padding-bottom:9px;flex-wrap:wrap}
.logo{display:inline-flex;text-decoration:none;font-size:18px;letter-spacing:1px}
.logo span{display:inline-block;text-shadow:0 3px 0 var(--navy),2px 0 0 var(--navy),-2px 0 0 var(--navy),0 -2px 0 var(--navy);animation:bob 2.6s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.top nav{display:flex;flex-wrap:wrap;gap:4px;flex:1}
.top nav a{color:#e6dfff;text-decoration:none;font-weight:800;padding:6px 14px;border-radius:999px;border:2px solid transparent}
.top nav a:hover{background:rgba(255,255,255,.14);color:#fff}
.top nav a.on{color:var(--ink);background:var(--gold);border-color:var(--navy);box-shadow:0 3px 0 var(--navy)}
.who{display:flex;align-items:center;gap:10px;color:#fff}
.who b{color:var(--gold)}

/* ---- Buttons ---- */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font:inherit;font-weight:800;color:#fff;text-decoration:none;cursor:pointer;
  padding:10px 20px;border:3px solid var(--navy);border-radius:12px;background:linear-gradient(#8a78e0,#6b5bb8);
  box-shadow:inset 0 3px 0 rgba(255,255,255,.35),0 5px 0 var(--navy);transition:transform .08s,box-shadow .08s,filter .15s}
.btn:hover{filter:brightness(1.08)}
.btn:active{transform:translateY(5px);box-shadow:inset 0 3px 0 rgba(255,255,255,.35),0 0 0 var(--navy)}
.btn:disabled{opacity:.6;cursor:default}
.btn.gold{color:var(--ink);background:linear-gradient(#ffe48f,#ffc857)}
.btn.pink{background:linear-gradient(#ff8aa3,#ff5a7a)}
.btn.green{background:linear-gradient(#5fe0ad,#2fc48d);color:var(--ink)}
.btn.white{background:linear-gradient(#fff,#ece7ff);color:var(--ink)}
.btn.big{font-size:19px;padding:15px 30px;border-radius:14px}
.btn.small{padding:5px 14px;font-size:14px;border-width:2px;box-shadow:inset 0 2px 0 rgba(255,255,255,.35),0 3px 0 var(--navy)}
.btn.small:active{transform:translateY(3px)}

/* ---- Game windows ---- */
.win{background:var(--paper);border:3px solid var(--navy);border-radius:16px;box-shadow:0 7px 0 var(--navy);overflow:hidden}
.win>h2,.win>.bar{margin:0;padding:11px 16px;font-size:11px;color:#fff;background:linear-gradient(var(--c1,#8a78e0),var(--c2,#6b5bb8));border-bottom:3px solid var(--navy);text-shadow:0 2px 0 rgba(35,26,74,.55);display:flex;align-items:center;gap:10px}
.win .in{padding:18px}
.win.pinkbar{--c1:#ff8aa3;--c2:#ff5a7a}.win.goldbar{--c1:#ffd45e;--c2:#ffb52e}.win.greenbar{--c1:#5fe0ad;--c2:#2fc48d}.win.bluebar{--c1:#6bbcff;--c2:#3ea7ff}.win.violetbar{--c1:#c4a4ff;--c2:#9a72ee}
.win.goldbar>h2{color:var(--ink);text-shadow:0 2px 0 rgba(255,255,255,.5)}

/* ---- Hero ---- */
.hero{position:relative;overflow:hidden;background:linear-gradient(180deg,var(--sky1) 0%,var(--sky2) 55%,var(--sky3) 100%);border-bottom:4px solid var(--navy)}
.hero::before{content:'';position:absolute;right:9%;top:34px;width:84px;height:84px;background:#fff6c4;box-shadow:0 0 0 12px rgba(255,246,196,.35),0 0 0 28px rgba(255,246,196,.18);border-radius:50%}
.cloud{position:absolute;height:26px;background:#fff;opacity:.92;animation:drift linear infinite;
  box-shadow:0 0 0 0 #fff;clip-path:polygon(0 100%,0 55%,12% 55%,12% 30%,30% 30%,30% 8%,55% 8%,55% 30%,75% 30%,75% 50%,100% 50%,100% 100%)}
.cloud.c1{width:150px;height:46px;top:70px;left:-200px;animation-duration:70s}
.cloud.c2{width:96px;height:32px;top:150px;left:-200px;animation-duration:95s;animation-delay:-30s;opacity:.75}
.cloud.c3{width:190px;height:56px;top:30px;left:-250px;animation-duration:120s;animation-delay:-70s;opacity:.85}
@keyframes drift{from{transform:translateX(0)}to{transform:translateX(calc(100vw + 450px))}}
.hero-in{position:relative;z-index:2;display:grid;grid-template-columns:minmax(0,.78fr) minmax(0,1.22fr);gap:10px;align-items:center;padding-top:40px;padding-bottom:0;min-height:600px}
.hero-copy{padding-bottom:70px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:5px 14px;border-radius:999px;background:#fff;border:3px solid var(--navy);box-shadow:0 3px 0 var(--navy);color:var(--purple-d);font-weight:800;font-size:14px}
.hero h1{margin:18px 0 14px;font-size:clamp(18px,2.4vw,30px);color:#fff;text-shadow:0 4px 0 var(--navy),3px 0 0 var(--navy),-3px 0 0 var(--navy),0 -3px 0 var(--navy),3px 4px 0 var(--navy),-3px 4px 0 var(--navy)}
.hero h1 em{font-style:normal;color:var(--gold)}
.hero .lead{font-size:clamp(16px,1.5vw,19px);font-weight:700;color:var(--ink);max-width:520px;margin:0 0 24px}
.cta{display:flex;flex-wrap:wrap;gap:16px;align-items:center}
.stamp{margin-top:22px;color:var(--ink2);font-size:14px;font-weight:700}
.hero-art{position:relative;align-self:end;margin:0 -30px -6px -30px}
.hero-art img{display:block;width:100%;height:auto;filter:drop-shadow(0 12px 0 rgba(35,26,74,.22));animation:hover 6s ease-in-out infinite}
@keyframes hover{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.grass{position:relative;z-index:3;height:34px;background:
  linear-gradient(#5fd06a 0 10px,#3fae52 10px 100%);border-top:4px solid var(--navy);margin-top:-4px}
.grass::before{content:'';position:absolute;left:0;right:0;top:-16px;height:12px;background:
  repeating-linear-gradient(90deg,transparent 0 18px,#5fd06a 18px 30px,transparent 30px 52px,#5fd06a 52px 60px,transparent 60px 90px);clip-path:polygon(0 100%,0 40%,100% 40%,100% 100%)}
.me-chips{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 22px}
.me-chips span{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:12px;background:#fff;border:3px solid var(--navy);box-shadow:0 4px 0 var(--navy);font-weight:800}

/* ---- Forms ---- */
.form{display:grid;gap:12px}
.field{display:grid;gap:5px;font-weight:800;font-size:14px;color:var(--ink2)}
.field input{font:inherit;font-weight:700;color:var(--ink);background:#fff;border:3px solid var(--navy);border-radius:12px;padding:11px 14px;width:100%;box-shadow:inset 0 3px 0 rgba(42,33,64,.08);transition:box-shadow .15s}
.field input:focus{outline:0;box-shadow:0 0 0 4px rgba(255,200,87,.8)}
.field input::placeholder{color:#a79fcb}
.pw{position:relative}
.pw input{padding-right:70px}
.pw button{position:absolute;right:8px;top:50%;transform:translateY(-50%);font:inherit;font-size:13px;font-weight:800;color:var(--purple-d);background:none;border:0;cursor:pointer;padding:6px 8px}
.form-error{margin:0;min-height:1.4em;color:#d6334f;font-weight:800;font-size:14px}
.hint{margin:0;color:var(--muted);font-size:13px;font-weight:600}
.check{display:flex;align-items:flex-start;gap:10px;font-weight:700;font-size:14px}
.check input{width:22px;height:22px;margin-top:2px;accent-color:var(--purple)}

/* ---- Numbers ---- */
.stats{position:relative;z-index:4;margin-top:-22px}
.stats-in{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.stat{background:var(--paper);border:3px solid var(--navy);border-radius:14px;box-shadow:0 6px 0 var(--navy);padding:14px 12px;text-align:center}
.stat strong{display:block;font-family:'Press Start 2P',ui-monospace,monospace;font-weight:400;font-size:20px;color:var(--purple-d);margin-bottom:6px}
.stat:nth-child(2) strong{color:#e0457a}.stat:nth-child(3) strong{color:#168a5f}
.stat span{color:var(--muted);font-weight:800;font-size:14px}
strong.live{display:flex!important;justify-content:center;align-items:center}
.live{display:inline-flex;align-items:center;gap:8px}
.live i{display:block;width:14px;height:14px;border-radius:50%;background:var(--teal);border:2px solid var(--navy);animation:ping 1.8s infinite}
.live.off i{background:var(--pink);animation:none}
@keyframes ping{70%{box-shadow:0 0 0 9px rgba(47,196,141,0)}0%{box-shadow:0 0 0 0 rgba(47,196,141,.7)}100%{box-shadow:0 0 0 0 rgba(47,196,141,0)}}

/* ---- Sections ---- */
section.block{padding:58px 0 6px}
.head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap}
.head h2{margin:0;font-size:clamp(14px,2vw,20px);color:var(--ink)}
.head h2::before{content:'';display:inline-block;width:14px;height:14px;margin-right:12px;background:var(--gold);border:3px solid var(--navy);transform:rotate(45deg) scale(.75)}
.head p{margin:8px 0 0;color:var(--muted);max-width:640px;font-weight:600}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.tile{position:relative;background:var(--paper);border:3px solid var(--navy);border-radius:16px;box-shadow:0 7px 0 var(--navy);padding:0 18px 20px;overflow:hidden;transition:transform .2s}
.tile:hover{transform:translateY(-5px) rotate(-.6deg)}
.tile .ico{display:grid;place-items:center;height:96px;margin:0 -18px 14px;background:var(--c);color:#fff;border-bottom:3px solid var(--navy);
  background-image:radial-gradient(circle at 20% 30%,rgba(255,255,255,.35) 0 6px,transparent 7px),radial-gradient(circle at 80% 70%,rgba(255,255,255,.25) 0 10px,transparent 11px)}
.tile .ico svg{width:54px;height:54px;filter:drop-shadow(0 4px 0 rgba(35,26,74,.45))}
.tile h3{margin:0 0 6px;font-size:19px}
.tile p{margin:0;color:var(--ink2);font-size:15px;font-weight:600}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;counter-reset:s;list-style:none;padding:0;margin:0}
.steps li{counter-increment:s;position:relative;background:var(--paper);border:3px solid var(--navy);border-radius:16px;box-shadow:0 7px 0 var(--navy);padding:42px 18px 18px}
.steps li::before{content:counter(s);position:absolute;left:14px;top:-20px;width:46px;height:46px;border-radius:12px;display:grid;place-items:center;background:var(--gold);color:var(--ink);font-family:'Press Start 2P',monospace;font-size:16px;box-shadow:0 4px 0 var(--navy);border:3px solid var(--navy)}
.steps b{display:block;margin-bottom:4px;font-size:18px}
.steps span{color:var(--ink2);font-size:15px;font-weight:600}
.steps li:nth-child(2)::before{background:var(--pink);color:#fff}.steps li:nth-child(3)::before{background:var(--teal)}.steps li:nth-child(4)::before{background:var(--blue);color:#fff}

/* ---- Creations ---- */
.strip{position:relative}
.strip-row{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px 6px 22px;scrollbar-width:thin;scrollbar-color:var(--purple) transparent}
.piece{flex:0 0 190px;scroll-snap-align:start;background:var(--paper);border:3px solid var(--navy);border-radius:16px;box-shadow:0 6px 0 var(--navy);padding:12px;text-align:center;text-decoration:none;color:var(--ink);transition:transform .2s}
.piece:hover{transform:translateY(-6px) rotate(-1.2deg)}
.piece .pic{display:grid;place-items:center;height:164px;margin-bottom:10px;border-radius:12px;border:3px solid var(--navy);background:
  conic-gradient(#e6dcff 25%,#f4efff 0 50%,#e6dcff 0 75%,#f4efff 0) 0 0/20px 20px}
.piece img{width:132px;height:154px;object-fit:contain;image-rendering:auto;filter:drop-shadow(0 6px 0 rgba(35,26,74,.25));animation:float 4s ease-in-out infinite}
.piece:nth-child(2n) img{animation-delay:-1.3s}.piece:nth-child(3n) img{animation-delay:-2.4s}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
.piece b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.piece small{color:var(--muted);font-weight:700}
.serial{display:inline-block;margin-bottom:6px;padding:2px 10px;border-radius:999px;background:var(--gold);border:2px solid var(--navy);color:var(--ink);font-weight:800;font-size:12px}
.arrows{display:flex;gap:8px}

/* ---- Arrivals ---- */
.crowd{display:flex;gap:14px;overflow-x:auto;padding:6px 6px 22px;scrollbar-width:thin}
.who-card{flex:0 0 132px;text-align:center;text-decoration:none;color:var(--ink);background:var(--paper);border:3px solid var(--navy);border-radius:16px;box-shadow:0 6px 0 var(--navy);padding:10px 8px 12px;transition:transform .2s}
.who-card:hover{transform:translateY(-6px)}
.who-card .stage{display:grid;place-items:end center;height:128px;border-radius:12px;background:linear-gradient(var(--sky2),var(--sky3) 70%,#7fd88a 70%);border:3px solid var(--navy);margin-bottom:8px;overflow:hidden}
.who-card img{width:56px;height:108px;image-rendering:pixelated;margin-bottom:6px}
.who-card b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ---- News ---- */
.news{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.post{display:flex;flex-direction:column;gap:8px;background:var(--paper);border:3px solid var(--navy);border-radius:16px;box-shadow:0 7px 0 var(--navy);padding:18px;text-decoration:none;color:var(--ink);transition:transform .2s;border-top-width:12px}
.post:nth-child(3n+1){border-top-color:var(--pink)}.post:nth-child(3n+2){border-top-color:var(--blue)}.post:nth-child(3n){border-top-color:var(--teal)}
.post:hover{transform:translateY(-5px)}
.post h3{margin:0;font-size:19px}
.post p{margin:0;color:var(--ink2);font-size:15px;font-weight:600}
.chip{align-self:flex-start;padding:2px 11px;border-radius:999px;background:var(--lav2);border:2px solid var(--navy);color:var(--ink);font-weight:800;font-size:12px}
.chip.gold{background:var(--gold)}
.article{max-width:780px;background:var(--paper);border:3px solid var(--navy);border-radius:16px;box-shadow:0 7px 0 var(--navy);padding:26px 28px}
.article h1{font-size:clamp(16px,2.6vw,26px);margin:12px 0 14px}
.article p{font-size:17px;font-weight:600}

/* ---- Final call ---- */
.band{margin:70px 0 0;padding:54px 0;background:linear-gradient(120deg,#7a5ce0,#d04ea0 55%,#ff9a5a);border-top:4px solid var(--navy);border-bottom:4px solid var(--navy);text-align:center;position:relative;overflow:hidden}
.band::before,.band::after{content:'';position:absolute;width:140px;height:140px;border:14px solid rgba(255,255,255,.14);transform:rotate(45deg)}
.band::before{left:6%;top:-60px}.band::after{right:7%;bottom:-70px}
.band h2{margin:0 0 10px;font-size:clamp(14px,2.4vw,22px);color:#fff;text-shadow:0 3px 0 var(--navy),2px 0 0 var(--navy),-2px 0 0 var(--navy)}
.band p{margin:0 auto 24px;max-width:560px;color:#fff;font-weight:800;text-shadow:0 2px 0 rgba(35,26,74,.6)}

/* ---- Events and team ---- */
.events{display:grid;gap:16px}
.event{display:grid;grid-template-columns:96px 1fr;gap:0;background:var(--paper);border:3px solid var(--navy);border-radius:16px;box-shadow:0 7px 0 var(--navy);overflow:hidden}
.event .when{display:grid;place-content:center;text-align:center;padding:12px 6px;background:linear-gradient(var(--c1,#6bbcff),var(--c2,#3ea7ff));border-right:3px solid var(--navy);color:#fff;text-shadow:0 2px 0 rgba(35,26,74,.5)}
.event:nth-child(3n+2) .when{--c1:#ff8aa3;--c2:#ff5a7a}.event:nth-child(3n) .when{--c1:#5fe0ad;--c2:#2fc48d}
.event .when b{display:block;font-family:'Press Start 2P',monospace;font-weight:400;font-size:22px;line-height:1.2}
.event .when span{font-weight:800;font-size:14px;text-transform:uppercase}
.event .what{padding:14px 18px}
.event h3{margin:0 0 4px;font-size:19px}
.event p{margin:4px 0;font-weight:600;color:var(--ink2)}
.roles{display:grid;gap:18px}
.role-group h2{display:flex;align-items:center;gap:10px;font-size:12px;margin:0 0 6px}
.role-group p{margin:0 0 10px;color:var(--muted);font-weight:700}
.role-tag{display:inline-block;padding:2px 12px;border-radius:999px;border:2px solid var(--navy);font-family:'Nunito',sans-serif;font-size:13px;font-weight:800;color:#fff;background:var(--purple)}
.role-tag.animateur{background:#2fc48d}.role-tag.moderateur{background:#3ea7ff}.role-tag.super_moderateur{background:#6b5bb8}.role-tag.gerant{background:#ff9a5a}.role-tag.administrateur{background:#ff5a7a}
@media (max-width:560px){.event{grid-template-columns:1fr}.event .when{border-right:0;border-bottom:3px solid var(--navy);grid-auto-flow:column;gap:10px;place-content:center}}

/* ---- Tables, lists ---- */
.rank{width:100%;border-collapse:separate;border-spacing:0 10px}
.rank td{padding:12px 16px;background:var(--paper);border-top:3px solid var(--navy);border-bottom:3px solid var(--navy)}
.rank td:first-child{border-left:3px solid var(--navy);border-radius:12px 0 0 12px;width:64px;font-family:'Press Start 2P',monospace;font-size:14px;color:var(--purple-d)}
.rank td:last-child{border-right:3px solid var(--navy);border-radius:0 12px 12px 0;text-align:right;color:var(--muted);font-weight:800}
.rank tr:nth-child(1) td:first-child{color:#d6a000}.rank tr:nth-child(2) td:first-child{color:#8f9bb5}.rank tr:nth-child(3) td:first-child{color:#c9702f}
.two{display:grid;grid-template-columns:1fr 1fr;gap:28px}
.team{display:flex;flex-wrap:wrap;gap:14px;padding:0;list-style:none}
.team li{display:flex;align-items:center;gap:10px;padding:10px 18px;background:var(--paper);border:3px solid var(--navy);border-radius:12px;box-shadow:0 5px 0 var(--navy);font-weight:800}
.page{padding:42px 0 30px}
.page h1{margin:0 0 8px;font-size:clamp(16px,2.6vw,26px);color:var(--ink)}
.page .lead{color:var(--muted);margin:0 0 24px;max-width:700px;font-weight:700}
.page h2{color:var(--ink)}
.badge{display:inline-block;margin-left:10px;padding:3px 10px;border-radius:999px;background:var(--pink);border:2px solid var(--navy);color:#fff;font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;vertical-align:middle}
.profile{display:grid;grid-template-columns:240px 1fr;gap:26px;align-items:start;margin-bottom:30px}
.profile .stage{display:grid;place-items:end center;height:300px;border-radius:12px;border:3px solid var(--navy);background:linear-gradient(var(--sky2),var(--sky3) 74%,#7fd88a 74%);overflow:hidden}
.profile .stage img{width:120px;height:232px;image-rendering:pixelated;margin-bottom:14px;animation:float 3.6s ease-in-out infinite}
.profile .facts{display:grid;gap:10px;padding:0;margin:0;list-style:none}
.profile .facts li{display:flex;gap:10px;align-items:center;font-weight:800}
.profile .facts svg{color:var(--purple)}

/* ---- Sign in / sign up pages ---- */
.auth-page{background:#150d3a;min-height:100vh;display:grid;place-items:center;position:relative;padding:24px 16px}
.auth-page canvas{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;object-position:center bottom;image-rendering:pixelated;z-index:0}
.auth-page::before{content:'';position:fixed;inset:0;z-index:1;background:radial-gradient(ellipse at center,rgba(18,12,44,.15),rgba(18,12,44,.6))}
.auth-card{position:relative;z-index:2;width:min(470px,100%)}
.auth-card .in{padding:24px 26px 26px}
.auth-card .logo{justify-content:center;font-size:21px;margin-bottom:6px;display:flex}
.auth-card h1{margin:14px 0 4px;font-size:13px;text-align:center;color:var(--purple-d)}
.auth-card .sub{text-align:center;color:var(--muted);font-weight:700;margin:0 0 18px}
.auth-card .switch{margin:16px 0 0;text-align:center;color:var(--muted);font-size:15px;font-weight:700}
.dots{display:flex;justify-content:center;gap:10px;list-style:none;padding:0;margin:0 0 18px}
.dots li{width:38px;height:10px;border-radius:5px;background:var(--lav2);border:2px solid var(--navy);transition:background .2s}
.dots li.on{background:var(--gold)}.dots li.done{background:var(--teal)}
.row{display:flex;gap:10px;justify-content:space-between;margin-top:6px}
.row .btn{flex:1}

footer.site{background:var(--navy);border-top:4px solid var(--navy);padding:36px 0 42px;color:#b9aee6;font-size:14px;margin-top:0}
footer.site .wrap{display:flex;flex-wrap:wrap;gap:18px 40px;justify-content:space-between}
footer.site a{color:#d8cffa;text-decoration:none;margin-right:16px;font-weight:700}
footer.site a:hover{color:var(--gold)}
footer.site .logo{margin-bottom:8px}

.reveal{opacity:0;transform:translateY(24px);transition:opacity .6s ease,transform .6s ease}
.reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}.logo span,.piece img,.live i,.cloud,.hero-art img,.profile .stage img{animation:none}.tile,.piece,.post,.who-card{transition:none}}

@media (max-width:980px){
  .hero-in{grid-template-columns:1fr;min-height:0}
  .hero-copy{padding-bottom:10px}
  .hero-art{margin:0 -8px}
  .tiles,.steps{grid-template-columns:repeat(2,1fr)}
  .news{grid-template-columns:1fr}
  .stats-in{grid-template-columns:repeat(2,1fr)}
  .two{grid-template-columns:1fr}
  .profile{grid-template-columns:1fr}
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
<meta name="theme-color" content="#6b5bb8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800&family=Press+Start+2P&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site/assets/site.css?v=${assetVersions['site.css'] ?? '0'}"><noscript><style>.reveal{opacity:1;transform:none}</style></noscript></head>
<body class="${esc(o.bodyClass ?? '')}" data-game="${esc(o.gameUrl)}">${top}${o.body}${foot}
<script src="/site/assets/site.js?v=${assetVersions['site.js'] ?? '0'}" defer></script>${o.city ? `<script src="/site/assets/city.js?v=${assetVersions['city.js'] ?? '0'}" defer></script>` : ''}</body></html>`;
}
