import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { renderSprite, type Recipe } from '@coloxel/render';
import type { Presence } from '../building/routes';
import { itemMaskedSql } from '../moderation/masking';
import { filterText } from '../moderation/text-filter';
import { spriteToPng } from '../sprite-png';
import { findAnnouncement, listAnnouncements, type Announcement } from './announcements';
import { isMaintenance } from './settings';
import { esc, icon, logo, page, type PageOptions } from './theme';

// The public website of the game: a landing page that makes people want to play, news, rankings,
// profiles, the team, the state of the game, and the sign-in and sign-up pages (the game itself
// sends visitors here to get an account).
//
// Everything readable without signing in only shows what a player already shows to the whole
// building: a nickname, the creations (name and number), the name of an apartment that is open.
// Never an email, a birth date, who is where, what was said, a description typed by a player
// (it could hold anything), nor anything the staff or the reports have masked.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const frDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const frMonth = (d: Date) => d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
const excerpt = (text: string, n = 150) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text);

const asset = (name: string) => readFileSync(fileURLToPath(new URL(`./assets/${name}`, import.meta.url)), 'utf8');
const ASSETS: Record<string, string> = { 'city.js': asset('city.js'), 'site.js': asset('site.js') };

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

const serialLabel = (n: number) => String(n).padStart(4, '0');
const playerLink = (nick: string) => `/site/joueur/${encodeURIComponent(nick)}`;

const pieces = (items: PublicItem[]) =>
  items
    .map(
      (i) =>
        `<a class="piece" href="${playerLink(i.creator)}"><div class="pic"><img src="/site/objet/${esc(i.id)}.png" alt="" width="132" height="154" loading="lazy"></div><span class="serial">n° ${serialLabel(i.serial)}</span><b>${esc(i.name)}</b><small>par ${esc(i.creator)}</small></a>`,
    )
    .join('');

const grid = (items: PublicItem[]) =>
  items.length ? `<div class="strip-row" style="flex-wrap:wrap;overflow:visible">${pieces(items)}</div>` : '<p class="muted">Rien à montrer pour l’instant.</p>';

const posts = (list: Announcement[]) =>
  list
    .map(
      (a) =>
        `<a class="post" href="/site/actualites/${a.id}"><span class="chip${a.pinned ? ' gold' : ''}">${a.pinned ? 'À la une · ' : ''}${esc(frDate(a.createdAt))}</span><h3>${esc(a.title)}</h3><p>${esc(excerpt(a.body))}</p></a>`,
    )
    .join('');

export interface SiteDeps {
  occupancy?: () => Promise<Presence>;
  /** Where the game itself is served: the "Jouer" buttons and the place sign-in leads to. */
  clientUrl?: string;
}

export function registerSiteRoutes(app: FastifyInstance, pool: pg.Pool, deps: SiteDeps = {}) {
  const gameUrl = deps.clientUrl ?? process.env.CLIENT_URL ?? 'http://localhost:5173';

  const html = (req: FastifyRequest, reply: FastifyReply, code: number, options: Omit<PageOptions, 'gameUrl' | 'user'>) =>
    reply
      .code(code)
      .header('content-type', 'text/html; charset=utf-8')
      // Pages change with who is looking: never shared between visitors.
      .header('cache-control', 'private, no-cache')
      .send(page({ ...options, gameUrl, user: req.user ? { nickname: req.user.nickname } : null }));

  const notFound = (req: FastifyRequest, reply: FastifyReply) =>
    html(req, reply, 404, {
      title: 'Page introuvable',
      body: '<main class="wrap page"><h1 class="px">Page introuvable</h1><p class="lead">Cette page n’existe pas (ou plus).</p><a class="btn gold" href="/site">Retour à l’accueil</a></main>',
    });

  // ----- Scripts of the pages ---------------------------------------------------
  app.get<{ Params: { name: string } }>('/site/assets/:name', async (req, reply) => {
    const body = ASSETS[req.params.name];
    if (!body) return reply.code(404).send('Introuvable');
    return reply.header('content-type', 'text/javascript; charset=utf-8').header('cache-control', 'public, max-age=300').send(body);
  });

  // ----- Home ---------------------------------------------------------------------
  app.get('/site', async (req, reply) => {
    const [players, serial, news, items, present, maintenance] = await Promise.all([
      pool.query<{ n: string }>('SELECT count(*) AS n FROM users'),
      pool.query<{ last_value: number }>('SELECT last_value FROM item_serial WHERE id = 1'),
      listAnnouncements(pool, { limit: 3 }),
      publicItems(pool, '', [], 12),
      deps.occupancy ? deps.occupancy().catch(() => null) : Promise.resolve(null),
      isMaintenance(pool),
    ]);
    const online = present ? present.hall + [...present.apartments.values()].reduce((a, b) => a + b, 0) : 0;

    // The card beside the headline: a sign-in form for a visitor, a small summary for a player.
    let card: string;
    if (req.user) {
      const [me, mine, friends] = await Promise.all([
        pool.query<{ pixels: number }>('SELECT pixels FROM users WHERE id = $1', [req.user.id]),
        pool.query<{ n: string }>('SELECT count(*) AS n FROM items WHERE creator_id = $1', [req.user.id]),
        pool.query<{ n: string }>(`SELECT count(*) AS n FROM friendships WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`, [req.user.id]),
      ]);
      card = `<div class="panel"><h2 class="px">Ton appart t’attend</h2>
<div class="me-line"><span>Pseudo</span><strong>${esc(req.user.nickname)}</strong></div>
<div class="me-line"><span>${icon('gem', 14)} Pixels</span><strong>${me.rows[0]?.pixels ?? 0}</strong></div>
<div class="me-line"><span>${icon('wand', 14)} Objets inventés</span><strong>${Number(mine.rows[0]!.n)}</strong></div>
<div class="me-line"><span>${icon('friends', 14)} Amis</span><strong>${Number(friends.rows[0]!.n)}</strong></div>
<p style="margin:16px 0 0"><a class="btn gold big" style="width:100%" href="${esc(gameUrl)}">${icon('play', 18)} Jouer</a></p></div>`;
    } else {
      card = `<div class="panel"><h2 class="px">Déjà un compte ?</h2>
<form class="form" data-login novalidate>
<label class="field">Email<input name="email" type="email" autocomplete="email" required placeholder="toi@exemple.fr"></label>
<label class="field">Mot de passe<span class="pw"><input name="password" type="password" autocomplete="current-password" required><button type="button" data-peek aria-pressed="false">Voir</button></span></label>
<p class="form-error" role="alert"></p>
<button class="btn gold" type="submit">Entrer dans l’immeuble</button>
<p class="hint">Pas encore de compte ? <a href="/site/inscription">Crée le tien, c’est gratuit</a>.</p>
</form></div>`;
    }

    const cta = req.user
      ? `<a class="btn gold big" href="${esc(gameUrl)}">${icon('play', 18)} Jouer maintenant</a><a class="btn ghost big" href="/site/actualites">Les nouveautés</a>`
      : `<a class="btn gold big" href="/site/inscription">${icon('star', 18)} Créer mon compte</a><a class="btn ghost big" href="/site/connexion">J’ai déjà un compte</a>`;

    const body = `
<section class="hero"><canvas id="city" aria-hidden="true"></canvas>
<div class="wrap hero-in"><div>
<span class="eyebrow">${icon('star', 14)} Un jeu social en pixel art</span>
<h1 class="px">Invente un objet.<br><em>Il n’existera qu’une seule fois.</em></h1>
<p class="lead">Décris-le avec des mots : une IA en dessine la recette, le jeu le dessine, et il naît en exemplaire unique et numéroté. Décore ton appart, rends visite à tes voisins, montre ce que tu as inventé.</p>
<div class="cta">${cta}</div>
<p class="stamp">Gratuit · Réservé aux adultes pendant l’alpha · Chat filtré et équipe de modération</p>
</div>${card}</div></section>

<div class="wrap stats"><div class="stats-in">
<div class="stat"><strong>${Number(players.rows[0]!.n)}</strong><span>joueurs</span></div>
<div class="stat"><strong>${serial.rows[0]?.last_value ?? 0}</strong><span>objets uniques</span></div>
<div class="stat"><strong>${online}</strong><span>en ligne</span></div>
<div class="stat"><strong class="live${maintenance ? ' off' : ''}"><i></i></strong><span>${maintenance ? 'En maintenance' : 'Le jeu est ouvert'}</span></div>
</div></div>

<div class="wrap">
<section class="block reveal"><div class="head"><div><h2 class="px">Un immeuble à habiter</h2><p>Chaque joueur a son appart dans un immeuble commun. Ce que tu y poses, c’est toi qui l’as inventé.</p></div></div>
<div class="tiles">
<div class="tile" style="--c:var(--pink)"><div class="ico">${icon('wand', 26)}</div><h3>Invente</h3><p>Écris « une lampe en forme de lune » : l’objet apparaît, unique, avec son numéro et ton nom dessus.</p></div>
<div class="tile" style="--c:var(--gold)"><div class="ico">${icon('home', 26)}</div><h3>Décore</h3><p>Meubles gratuits, sols, papiers peints, lumières à allumer : fais de ton appart un endroit à toi.</p></div>
<div class="tile" style="--c:var(--teal)"><div class="ico">${icon('friends', 26)}</div><h3>Rencontre</h3><p>Visite les voisins, discute, sonne aux portes, ajoute des amis et retrouve-les en un clic.</p></div>
<div class="tile" style="--c:var(--blue)"><div class="ico">${icon('shield', 26)}</div><h3>Joue sereinement</h3><p>Messages filtrés, signalements, une équipe qui veille : l’immeuble reste agréable pour tous.</p></div>
</div></section>

<section class="block reveal"><div class="head"><div><h2 class="px">Comment ça marche</h2></div></div>
<ol class="steps">
<li><b>Tu décris</b><span>Quelques mots suffisent : « un fauteuil en forme de champignon ».</span></li>
<li><b>Le jeu dessine</b><span>Une IA écrit la recette, notre moteur la transforme en pixels.</span></li>
<li><b>Il naît unique</b><span>Un numéro, un créateur, une date : personne d’autre n’aura le même.</span></li>
<li><b>Tu le montres</b><span>Pose-le chez toi, fais visiter, et regarde ce que les autres inventent.</span></li>
</ol></section>

<section class="block reveal" data-strip><div class="head"><div><h2 class="px">Ils viennent de naître</h2><p>Les dernières créations des joueurs, chacune en un seul exemplaire.</p></div>
<div class="arrows"><button class="btn small" type="button" data-scroll="-1" aria-label="Précédent">‹</button><button class="btn small" type="button" data-scroll="1" aria-label="Suivant">›</button></div></div>
${items.length ? `<div class="strip-row">${pieces(items)}</div>` : '<p class="muted">Le premier objet attend son inventeur. Ce sera peut-être le tien !</p>'}
</section>

<section class="block reveal"><div class="head"><div><h2 class="px">Les nouvelles</h2></div><a class="btn ghost small" href="/site/actualites">Tout voir</a></div>
${news.length ? `<div class="news">${posts(news)}</div>` : '<p class="muted">Pas encore d’actualité.</p>'}</section>
</div>

${
  req.user
    ? ''
    : `<section class="band reveal"><div class="wrap"><h2 class="px">Ton appart est prêt à être meublé</h2><p>Crée ton compte en une minute : tu arrives dans un appart déjà installé, avec des Pixels pour commencer.</p><a class="btn gold big" href="/site/inscription">${icon('play', 18)} Commencer à jouer</a></div></section>`
}`;
    return html(req, reply, 200, { title: 'Accueil', active: 'home', body, city: true });
  });

  // ----- Sign in and sign up (the game sends people here) -----------------------------
  app.get('/site/connexion', async (req, reply) => {
    if (req.user) return reply.redirect(gameUrl);
    const body = `<main class="auth-page"><canvas id="city" aria-hidden="true"></canvas>
<div class="panel auth-card">${logo()}<h1 class="px">Content de te revoir</h1><p class="sub">Entre dans l’immeuble.</p>
<form class="form" data-login novalidate>
<label class="field">Email<input name="email" type="email" autocomplete="email" required placeholder="toi@exemple.fr"></label>
<label class="field">Mot de passe<span class="pw"><input name="password" type="password" autocomplete="current-password" required><button type="button" data-peek aria-pressed="false">Voir</button></span></label>
<p class="form-error" role="alert"></p>
<button class="btn gold big" type="submit">Se connecter</button>
</form>
<p class="switch">Pas encore de compte ? <a href="/site/inscription">Crée le tien</a> · <a href="/site">Retour au site</a></p></div></main>`;
    return html(req, reply, 200, { title: 'Connexion', body, bare: true, city: true });
  });

  app.get('/site/inscription', async (req, reply) => {
    if (req.user) return reply.redirect(gameUrl);
    const body = `<main class="auth-page"><canvas id="city" aria-hidden="true"></canvas>
<div class="panel auth-card">${logo()}<h1 class="px">Bienvenue dans l’immeuble</h1><p class="sub">Trois petites étapes, et ton appart est à toi.</p>
<form class="form" data-register novalidate>
<ol class="dots" aria-hidden="true"><li></li><li></li><li></li></ol>
<div class="step form">
<label class="field">Choisis ton pseudo<input name="nickname" autocomplete="username" maxlength="20" placeholder="Capitaine_Pixel" required></label>
<p class="hint">3 à 20 caractères : lettres, chiffres, _ et -. C’est le nom que verront les autres joueurs : n’y mets rien de personnel.</p>
<div class="row"><button class="btn gold" type="button" data-next>Continuer</button></div></div>
<div class="step form" hidden>
<label class="field">Ton email<input name="email" type="email" autocomplete="email" placeholder="toi@exemple.fr" required></label>
<label class="field">Mot de passe<span class="pw"><input name="password" type="password" autocomplete="new-password" required><button type="button" data-peek aria-pressed="false">Voir</button></span></label>
<label class="field">Encore une fois<input name="password2" type="password" autocomplete="new-password" required></label>
<p class="hint">8 caractères au moins. L’email ne sera jamais montré aux autres joueurs.</p>
<div class="row"><button class="btn ghost" type="button" data-back>Retour</button><button class="btn gold" type="button" data-next>Continuer</button></div></div>
<div class="step form" hidden>
<label class="field">Ta date de naissance<input name="birth" type="date" autocomplete="bday" required></label>
<p class="hint">Coloxel est réservé aux adultes (18 ans et plus) pendant l’alpha. Ta date de naissance n’est jamais affichée.</p>
<label class="check"><input type="checkbox" name="rules"><span>Je respecte les autres joueurs, je ne partage aucune information personnelle et j’accepte que l’équipe modère le jeu.</span></label>
<div class="row"><button class="btn ghost" type="button" data-back>Retour</button><button class="btn gold" type="submit">Créer mon compte</button></div></div>
<p class="form-error" role="alert"></p>
</form>
<p class="switch">Déjà un compte ? <a href="/site/connexion">Connecte-toi</a> · <a href="/site">Retour au site</a></p></div></main>`;
    return html(req, reply, 200, { title: 'Inscription', body, bare: true, city: true });
  });

  // ----- News -----------------------------------------------------------------------
  app.get<{ Querystring: { avant?: string } }>('/site/actualites', async (req, reply) => {
    const before = req.query.avant && /^\d{1,15}$/.test(req.query.avant) ? Number(req.query.avant) : undefined;
    const list = await listAnnouncements(pool, { limit: 13, before });
    const more = list.length > 12;
    const shown = list.slice(0, 12);
    const body = `<main class="wrap page"><h1 class="px">Actualités</h1><p class="lead">Les nouveautés du jeu, racontées par l’équipe.</p>
${shown.length ? `<div class="news">${posts(shown)}</div>` : '<p class="muted">Rien ici pour l’instant.</p>'}
${more ? `<p style="margin-top:22px"><a class="btn ghost" href="/site/actualites?avant=${shown[shown.length - 1]!.id}">Plus anciennes</a></p>` : ''}</main>`;
    return html(req, reply, 200, { title: 'Actualités', active: 'news', body });
  });

  app.get<{ Params: { id: string } }>('/site/actualites/:id', async (req, reply) => {
    if (!/^\d{1,15}$/.test(req.params.id)) return notFound(req, reply);
    const a = await findAnnouncement(pool, Number(req.params.id));
    if (!a) return notFound(req, reply);
    const body = `<main class="wrap page"><article class="article"><span class="chip${a.pinned ? ' gold' : ''}">${esc(frDate(a.createdAt))} · par ${esc(a.author)}</span>
<h1 class="px">${esc(a.title)}</h1>${paragraphs(a.body)}<p style="margin-top:26px"><a class="btn ghost" href="/site/actualites">← Toutes les actualités</a></p></article></main>`;
    return html(req, reply, 200, { title: a.title, active: 'news', body, description: excerpt(a.body, 160) });
  });

  // ----- Rankings ----------------------------------------------------------------------
  app.get('/site/classement', async (req, reply) => {
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
    const rows = <T,>(list: T[], line: (r: T) => string) =>
      list.length ? `<table class="rank">${list.map((r, k) => `<tr><td>${k + 1}</td>${line(r)}</tr>`).join('')}</table>` : '<p class="muted">Pas encore de classement.</p>';
    const link = (nick: string) => `<a href="${playerLink(nick)}">${esc(nick)}</a>`;
    const flatName = (name: string | null, nick: string) => esc(name && filterText(name).ok ? name : `Chez ${nick}`);
    const body = `<main class="wrap page"><h1 class="px">Classement</h1><p class="lead">Ceux qui inventent le plus, et les apparts où l’on se presse.</p>
<div class="two"><section><h2 class="px" style="font-size:13px">${icon('wand', 16)} Les inventeurs</h2>${rows(creators.rows, (r) => `<td><b>${link(r.nickname)}</b></td><td>${Number(r.n)} objets</td>`)}</section>
<section><h2 class="px" style="font-size:13px">${icon('home', 16)} Apparts les plus visités</h2>${rows(visited.rows, (r) => `<td><b>${flatName(r.name, r.nickname)}</b><br><small class="muted">de ${link(r.nickname)}</small></td><td>${Number(r.n)} visiteurs</td>`)}</section></div></main>`;
    return html(req, reply, 200, { title: 'Classement', active: 'ranking', body });
  });

  // ----- Team and state of the game ----------------------------------------------------
  app.get('/site/equipe', async (req, reply) => {
    const { rows } = await pool.query<{ nickname: string }>("SELECT nickname FROM users WHERE role = 'staff' ORDER BY lower(nickname)");
    const body = `<main class="wrap page"><h1 class="px">L’équipe</h1><p class="lead">Elle veille sur le jeu, répond aux signalements et garde l’immeuble agréable pour tous. Un souci ? Signale-le en jeu : un membre de l’équipe le lira.</p>
${rows.length ? `<ul class="team">${rows.map((r) => `<li>${icon('shield', 18)} ${esc(r.nickname)}</li>`).join('')}</ul>` : '<p class="muted">Personne pour l’instant.</p>'}</main>`;
    return html(req, reply, 200, { title: 'L’équipe', active: 'team', body });
  });

  app.get('/site/statut', async (req, reply) => {
    const maintenance = await isMaintenance(pool);
    const body = `<main class="wrap page"><h1 class="px">État du jeu</h1><div class="box" style="max-width:620px"><p class="live${maintenance ? ' off' : ''}" style="font-size:20px;font-weight:800;margin:0 0 6px"><i></i> ${
      maintenance ? '<span class="bad">En maintenance</span>' : '<span class="ok">Le jeu est ouvert</span>'
    }</p><p class="muted" style="margin:0">${maintenance ? 'Le jeu revient dans quelques instants.' : 'Tout fonctionne. Bonne partie !'}</p></div></main>`;
    return html(req, reply, 200, { title: 'État du jeu', active: 'status', body });
  });

  // ----- Profiles and sprites ----------------------------------------------------------
  app.get<{ Params: { nickname: string } }>('/site/joueur/:nickname', async (req, reply) => {
    const { rows } = await pool.query<{ id: string; nickname: string; role: string; created_at: Date; access: string; name: string | null }>(
      `SELECT u.id, u.nickname, u.role, u.created_at, u.apartment_access AS access, a.name
         FROM users u LEFT JOIN apartments a ON a.owner_id = u.id WHERE lower(u.nickname) = lower($1)`,
      [req.params.nickname],
    );
    const p = rows[0];
    if (!p) return notFound(req, reply);
    const [items, count] = await Promise.all([
      publicItems(pool, 'AND it.creator_id = $1', [p.id], 24),
      pool.query<{ n: string }>(`SELECT count(*) AS n FROM items it WHERE it.creator_id = $1 AND NOT ${itemMaskedSql('it')}`, [p.id]),
    ]);
    const flat = p.access === 'building' ? `ouvert à tous${p.name && filterText(p.name).ok ? ` : « ${esc(p.name)} »` : ''}` : 'sur invitation';
    const body = `<main class="wrap page"><h1 class="px">${esc(p.nickname)}${p.role === 'staff' ? '<span class="badge">équipe</span>' : ''}</h1>
<p class="lead">Membre depuis ${esc(frMonth(p.created_at))} · ${Number(count.rows[0]!.n)} objet(s) inventé(s) · appartement ${flat}</p>
<div class="head"><div><h2 class="px" style="font-size:14px">Ses créations</h2></div></div>${grid(items)}</main>`;
    return html(req, reply, 200, { title: p.nickname, body });
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
