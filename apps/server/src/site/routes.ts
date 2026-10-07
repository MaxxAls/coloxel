import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { renderSprite, type Recipe } from '@coloxel/render';
import { itemMaskedSql } from '../moderation/masking';
import { filterText } from '../moderation/text-filter';
import type { Presence } from '../building/routes';
import { spriteToPng } from '../sprite-png';
import { findAnnouncement, listAnnouncements, type Announcement } from './announcements';
import { isMaintenance } from './settings';

// The public website of the game: news, rankings, profiles, the team, the state of the game.
// Everything here is readable by anybody, signed in or not, so it only ever shows what a player
// already shows to the whole building: a nickname, the creations (name and number), the name of
// an apartment that is open. Never an email, a birth date, who is where, what was said, a description
// typed by a player (it could hold anything), nor anything the staff or the reports have masked.

const esc = (text: unknown) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const frDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const frMonth = (d: Date) => d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

const STYLE = `
:root{--bg:#17132a;--card:#231d3f;--line:#3b3366;--text:#f1ecff;--muted:#a79fcb;--accent:#ffc857}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(ellipse at 20% 0%,#2c1f5c 0%,transparent 55%),var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif}
a{color:var(--accent)}
header{display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px;padding:14px 24px;background:#1b1530;border-bottom:2px solid var(--line)}
header .logo{font-family:'Press Start 2P',ui-monospace,monospace;font-size:16px;color:var(--accent);text-decoration:none}
nav{display:flex;flex-wrap:wrap;gap:4px 16px;flex:1}
nav a{color:var(--muted);text-decoration:none;padding:4px 2px}
nav a.on,nav a:hover{color:var(--text);border-bottom:2px solid var(--accent)}
.play{background:var(--accent);color:#2a2140;font-weight:700;padding:8px 18px;border-radius:8px;text-decoration:none}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:28px;margin:0 0 8px;color:var(--accent)}
h2{font-size:20px;margin:28px 0 10px}
.lead{color:var(--muted);margin:0 0 20px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.stat strong{display:block;font-size:28px;color:var(--accent)}
.news article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin-bottom:12px}
.news h3{margin:0 0 4px}
.muted{color:var(--muted)}.small{font-size:14px}
.pin{background:var(--accent);color:#2a2140;border-radius:999px;padding:1px 8px;font-size:12px;font-weight:700;margin-left:6px}
.items{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;list-style:none;padding:0}
.items li{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px;text-align:center}
.items img{width:96px;height:112px;object-fit:contain;image-rendering:auto;background:#120f22;border-radius:8px}
table{width:100%;border-collapse:collapse}
td,th{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left}
.rank{width:40px;color:var(--muted)}
footer{border-top:1px solid var(--line);padding:18px 24px;color:var(--muted);text-align:center;font-size:14px}
.ok{color:#6be07a}.bad{color:#ff8a80}
`;

interface Layout {
  title: string;
  active?: string;
  body: string;
  clientUrl: string;
}

const NAV: [string, string, string][] = [
  ['home', '/site', 'Accueil'],
  ['news', '/site/actualites', 'Actualités'],
  ['ranking', '/site/classement', 'Classement'],
  ['team', '/site/equipe', 'L’équipe'],
  ['status', '/site/statut', 'État du jeu'],
];

function layout({ title, active, body, clientUrl }: Layout): string {
  const links = NAV.map(([key, href, label]) => `<a href="${href}"${key === active ? ' class="on"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Coloxel</title><style>${STYLE}</style></head>
<body><header><a class="logo" href="/site">COLOXEL</a><nav aria-label="Navigation">${links}</nav><a class="play" href="${esc(clientUrl)}">Jouer</a></header>
<main>${body}</main>
<footer>Coloxel : un jeu où chaque objet est inventé par un joueur et n’existe qu’en un seul exemplaire.</footer></body></html>`;
}

interface PublicItem {
  id: string;
  serial: number;
  name: string;
  creator: string;
}

/** Creations anybody may be shown: not masked, and with a name that passes the same filter as the chat. */
async function publicItems(pool: pg.Pool, where: string, params: unknown[], limit: number): Promise<PublicItem[]> {
  const { rows } = await pool.query<{ id: string; serial: number; name: string; creator: string }>(
    `SELECT it.id, it.serial, it.name, cr.nickname AS creator
       FROM items it JOIN users cr ON cr.id = it.creator_id
      WHERE NOT ${itemMaskedSql('it')} ${where}
      ORDER BY it.serial DESC LIMIT ${Math.floor(limit * 3)}`,
    params,
  );
  return rows.filter((r) => filterText(r.name).ok).slice(0, limit);
}

const itemList = (items: PublicItem[]) =>
  items.length
    ? `<ul class="items">${items
        .map(
          (i) =>
            `<li><img src="/site/objet/${esc(i.id)}.png" alt="" width="96" height="112" loading="lazy"><div><strong>${esc(i.name)}</strong></div><div class="muted small">n° ${String(i.serial).padStart(4, '0')} · <a href="/site/joueur/${encodeURIComponent(i.creator)}">${esc(i.creator)}</a></div></li>`,
        )
        .join('')}</ul>`
    : '<p class="muted">Rien à montrer pour l’instant.</p>';

const newsBlock = (list: Announcement[]) =>
  list
    .map(
      (a) =>
        `<article><h3><a href="/site/actualites/${a.id}">${esc(a.title)}</a>${a.pinned ? '<span class="pin">épinglé</span>' : ''}</h3><div class="muted small">${frDate(a.createdAt)}</div>${paragraphs(a.body.slice(0, 280) + (a.body.length > 280 ? '…' : ''))}</article>`,
    )
    .join('');

export interface SiteDeps {
  occupancy?: () => Promise<Presence>;
  /** Where the game itself is served (the "Jouer" button). */
  clientUrl?: string;
}

export function registerSiteRoutes(app: FastifyInstance, pool: pg.Pool, deps: SiteDeps = {}) {
  const clientUrl = deps.clientUrl ?? process.env.CLIENT_URL ?? 'http://localhost:5173';
  const html = (reply: FastifyReply, code: number, page: Layout) =>
    reply.code(code).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'public, max-age=30').send(layout(page));
  const notFound = (reply: FastifyReply) =>
    html(reply, 404, { title: 'Page introuvable', clientUrl, body: '<h1>Page introuvable</h1><p class="lead">Cette page n’existe pas (ou plus). <a href="/site">Retour à l’accueil</a>.</p>' });

  app.get('/site', async (_req, reply) => {
    const [players, serial, news, items, present, maintenance] = await Promise.all([
      pool.query<{ n: string }>('SELECT count(*) AS n FROM users'),
      pool.query<{ last_value: number }>('SELECT last_value FROM item_serial WHERE id = 1'),
      listAnnouncements(pool, { limit: 3 }),
      publicItems(pool, '', [], 8),
      deps.occupancy ? deps.occupancy().catch(() => null) : Promise.resolve(null),
      isMaintenance(pool),
    ]);
    const online = present ? present.hall + [...present.apartments.values()].reduce((a, b) => a + b, 0) : 0;
    const body = `
<h1>Coloxel</h1>
<p class="lead">Décris un objet, une IA en dessine la recette, le moteur du jeu le dessine, et il naît en exemplaire unique et numéroté. Chaque objet est inventé par un joueur.</p>
${maintenance ? '<p class="card bad">Le jeu est en maintenance pour le moment.</p>' : ''}
<div class="cards">
  <div class="card stat"><strong>${Number(players.rows[0]!.n)}</strong>joueurs</div>
  <div class="card stat"><strong>${serial.rows[0]?.last_value ?? 0}</strong>objets uniques créés</div>
  <div class="card stat"><strong>${online}</strong>en ligne maintenant</div>
</div>
<h2>Actualités</h2>
<div class="news">${news.length ? newsBlock(news) : '<p class="muted">Pas encore d’actualité.</p>'}</div>
<p><a href="/site/actualites">Toutes les actualités</a></p>
<h2>Dernières créations</h2>
${itemList(items)}`;
    return html(reply, 200, { title: 'Accueil', active: 'home', clientUrl, body });
  });

  app.get<{ Querystring: { avant?: string } }>('/site/actualites', async (req, reply) => {
    const before = req.query.avant && /^\d{1,15}$/.test(req.query.avant) ? Number(req.query.avant) : undefined;
    const list = await listAnnouncements(pool, { limit: 11, before });
    const more = list.length > 10;
    const shown = list.slice(0, 10);
    const body = `<h1>Actualités</h1><div class="news">${shown.length ? newsBlock(shown) : '<p class="muted">Rien ici.</p>'}</div>${
      more ? `<p><a href="/site/actualites?avant=${shown[shown.length - 1]!.id}">Plus anciennes</a></p>` : ''
    }`;
    return html(reply, 200, { title: 'Actualités', active: 'news', clientUrl, body });
  });

  app.get<{ Params: { id: string } }>('/site/actualites/:id', async (req, reply) => {
    if (!/^\d{1,15}$/.test(req.params.id)) return notFound(reply);
    const a = await findAnnouncement(pool, Number(req.params.id));
    if (!a) return notFound(reply);
    const body = `<h1>${esc(a.title)}</h1><p class="lead">${frDate(a.createdAt)} · par ${esc(a.author)}</p>${paragraphs(a.body)}<p><a href="/site/actualites">← Actualités</a></p>`;
    return html(reply, 200, { title: a.title, active: 'news', clientUrl, body });
  });

  app.get('/site/classement', async (_req, reply) => {
    const [creators, visited] = await Promise.all([
      pool.query<{ nickname: string; n: string }>(
        `SELECT u.nickname, count(*) AS n FROM items it JOIN users u ON u.id = it.creator_id
          WHERE NOT ${itemMaskedSql('it')} GROUP BY u.id, u.nickname ORDER BY count(*) DESC, lower(u.nickname) LIMIT 10`,
      ),
      // Apartments open to everybody, by the number of different players who visited them.
      pool.query<{ nickname: string; name: string | null; n: string }>(
        `SELECT u.nickname, a.name, count(*) AS n
           FROM quest_marks q
           JOIN users u ON u.id::text = q.ref AND u.apartment_access = 'building'
           LEFT JOIN apartments a ON a.owner_id = u.id
          WHERE q.event = 'visit' GROUP BY u.id, u.nickname, a.name ORDER BY count(*) DESC, lower(u.nickname) LIMIT 10`,
      ),
    ]);
    const rows = <T,>(list: T[], line: (r: T, k: number) => string) =>
      list.length ? `<table>${list.map((r, k) => `<tr><td class="rank">${k + 1}</td>${line(r, k)}</tr>`).join('')}</table>` : '<p class="muted">Pas encore de classement.</p>';
    const link = (nick: string) => `<a href="/site/joueur/${encodeURIComponent(nick)}">${esc(nick)}</a>`;
    const body = `<h1>Classement</h1>
<h2>Les inventeurs</h2>${rows(creators.rows, (r) => `<td>${link(r.nickname)}</td><td>${Number(r.n)} objets</td>`)}
<h2>Les apparts les plus visités</h2>${rows(visited.rows, (r) => `<td>${esc(r.name ?? `Chez ${r.nickname}`)}</td><td>${link(r.nickname)}</td><td>${Number(r.n)} visiteurs</td>`)}`;
    return html(reply, 200, { title: 'Classement', active: 'ranking', clientUrl, body });
  });

  app.get('/site/equipe', async (_req, reply) => {
    const { rows } = await pool.query<{ nickname: string }>("SELECT nickname FROM users WHERE role = 'staff' ORDER BY lower(nickname)");
    const body = `<h1>L’équipe</h1><p class="lead">Elle veille sur le jeu, répond aux signalements et garde l’immeuble agréable pour tous.</p>${
      rows.length ? `<ul>${rows.map((r) => `<li>${esc(r.nickname)}</li>`).join('')}</ul>` : '<p class="muted">Personne pour l’instant.</p>'
    }`;
    return html(reply, 200, { title: 'L’équipe', active: 'team', clientUrl, body });
  });

  app.get('/site/statut', async (_req, reply) => {
    const maintenance = await isMaintenance(pool);
    const body = `<h1>État du jeu</h1><p class="card">${
      maintenance ? '<span class="bad">En maintenance</span> : le jeu revient dans quelques instants.' : '<span class="ok">Le jeu est ouvert.</span> Bonne partie !'
    }</p>`;
    return html(reply, 200, { title: 'État du jeu', active: 'status', clientUrl, body });
  });

  app.get<{ Params: { nickname: string } }>('/site/joueur/:nickname', async (req, reply) => {
    const { rows } = await pool.query<{ id: string; nickname: string; role: string; created_at: Date; access: string; name: string | null }>(
      `SELECT u.id, u.nickname, u.role, u.created_at, u.apartment_access AS access, a.name
         FROM users u LEFT JOIN apartments a ON a.owner_id = u.id WHERE lower(u.nickname) = lower($1)`,
      [req.params.nickname],
    );
    const p = rows[0];
    if (!p) return notFound(reply);
    const [items, count] = await Promise.all([
      publicItems(pool, 'AND it.creator_id = $1', [p.id], 24),
      pool.query<{ n: string }>(`SELECT count(*) AS n FROM items it WHERE it.creator_id = $1 AND NOT ${itemMaskedSql('it')}`, [p.id]),
    ]);
    const flat = p.access === 'building' ? `ouvert à tous${p.name && filterText(p.name).ok ? ` : « ${esc(p.name)} »` : ''}` : 'sur invitation';
    const body = `<h1>${esc(p.nickname)}${p.role === 'staff' ? '<span class="pin">équipe</span>' : ''}</h1>
<p class="lead">Membre depuis ${esc(frMonth(p.created_at))} · ${Number(count.rows[0]!.n)} objet(s) inventé(s) · appartement ${flat}</p>
<h2>Ses créations</h2>${itemList(items)}`;
    return html(reply, 200, { title: p.nickname, clientUrl, body });
  });

  // Sprites of the creations shown above, and only of those: the same rule as the lists.
  app.get<{ Params: { id: string } }>('/site/objet/:id.png', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send('Introuvable');
    const items = await publicItems(pool, 'AND it.id = $1', [req.params.id], 1);
    if (!items[0]) return reply.code(404).send('Introuvable');
    const { rows } = await pool.query<{ recipe: Recipe }>('SELECT recipe FROM items WHERE id = $1', [req.params.id]);
    return reply.header('cache-control', 'public, max-age=3600').type('image/png').send(spriteToPng(renderSprite(rows[0]!.recipe.parts)));
  });
}
