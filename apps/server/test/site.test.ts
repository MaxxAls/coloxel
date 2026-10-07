import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import { forgetMaintenance } from '../src/site/settings';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

describe.skipIf(!available)('website, news and maintenance (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    await pool.query('INSERT INTO apartments (id, floor, slot) SELECT n, 10 + n, 0 FROM generate_series(31, 70) AS n');
    app = buildServer({ pool, model: null, occupancy: async () => ({ apartments: new Map([['x', 2]]), hall: 3 }) });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function signUp(nickname: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `${nickname}@test.dev`, password: 'motdepasse', nickname, birthDate: '1990-01-01' },
    });
    return { id: res.json().user.id as string, nickname, sid: res.cookies.find((c) => c.name === 'coloxel_sid')!.value };
  }
  type Account = Awaited<ReturnType<typeof signUp>>;
  const staffMember = async (nickname: string) => {
    const a = await signUp(nickname);
    await pool.query("UPDATE users SET role = 'staff' WHERE id = $1", [a.id]);
    return a;
  };
  const as = (a: Account) => ({ coloxel_sid: a.sid });
  const page = (path: string) => app.inject({ method: 'GET', url: path });
  const nextCell = new Map<string, number>();
  async function createItem(owner: Account, name: string, description = 'une lampe') {
    const j = nextCell.get(owner.id) ?? 0;
    nextCell.set(owner.id, j + 1);
    const id = (
      await pool.query<{ id: string }>(
        `INSERT INTO items (serial, name, description, recipe, creator_id, owner_id)
         VALUES ((SELECT COALESCE(max(serial), 0) + 1 FROM items), $1, $3, $2, $4, $4) RETURNING id`,
        [name, JSON.stringify({ name, parts: SEEDS[0]!.parts }), description, owner.id],
      )
    ).rows[0]!.id;
    await pool.query('UPDATE item_serial SET last_value = (SELECT max(serial) FROM items)');
    await pool.query('INSERT INTO placements (item_id, user_id, i, j) VALUES ($1, $2, 6, $3)', [id, owner.id, j + 2]);
    return id;
  }
  const announce = (staff: Account, payload: object) => app.inject({ method: 'POST', url: '/api/staff/announcements', payload, cookies: as(staff) });

  describe('news', () => {
    it('is written by the staff only, validated, and read by everybody', async () => {
      const staff = await staffMember('site_editor');
      const player = await signUp('site_reader');
      expect((await app.inject({ method: 'POST', url: '/api/staff/announcements', payload: { title: 'x', body: 'y' } })).statusCode).toBe(401);
      expect((await announce(player, { title: 'Pirate', body: 'Je prends le contrôle' })).statusCode).toBe(404);
      for (const bad of [{}, { title: '', body: 'x' }, { title: 'x', body: '' }, { title: 'x'.repeat(81), body: 'y' }, { title: 'x', body: 'y'.repeat(4001) }, { title: 'x', body: 'y', author: 'z' }]) {
        expect((await announce(staff, bad)).statusCode, JSON.stringify(bad).slice(0, 40)).toBe(400);
      }
      const created = await announce(staff, { title: 'Bienvenue <b>à tous</b>', body: 'Premier paragraphe.\n\nSecond <script>alert(1)</script> paragraphe.', pinned: true });
      expect(created.statusCode).toBe(201);
      await announce(staff, { title: 'Brouillon secret', body: 'pas encore', published: false });
      await announce(staff, { title: 'Une autre nouvelle', body: 'texte' });

      // The game's news: no session needed, drafts left out, pinned first.
      const api = (await page('/api/announcements')).json().announcements as { title: string; pinned: boolean }[];
      expect(api.map((a) => a.title)).toEqual(['Bienvenue <b>à tous</b>', 'Une autre nouvelle']);
      // The staff sees the drafts as well.
      const all = (await app.inject({ method: 'GET', url: '/api/staff/announcements', cookies: as(staff) })).json().announcements as { title: string }[];
      expect(all.map((a) => a.title)).toContain('Brouillon secret');
      expect((await app.inject({ method: 'GET', url: '/api/staff/announcements', cookies: as(player) })).statusCode).toBe(404);

      // The website shows them with every character escaped.
      const home = await page('/site');
      expect(home.statusCode).toBe(200);
      expect(home.headers['content-type']).toMatch(/text\/html/);
      expect(home.body).toContain('Bienvenue &lt;b&gt;à tous&lt;/b&gt;');
      expect(home.body).not.toContain('<script>alert');
      expect(home.body).not.toContain('Brouillon secret');
      const id = created.json().id as number;
      const detail = await page(`/site/actualites/${id}`);
      expect(detail.statusCode).toBe(200);
      expect(detail.body).toContain('Second &lt;script&gt;alert(1)&lt;/script&gt; paragraphe.');
      expect(detail.body).toContain('<p>Premier paragraphe.</p>');
      // A draft has no public page.
      const draft = all.find((a) => a.title === 'Brouillon secret') as unknown as { id: number };
      expect((await page(`/site/actualites/${draft.id}`)).statusCode).toBe(404);
      expect((await page('/site/actualites/abc')).statusCode).toBe(404);
    });

    it('can be edited and deleted by the staff', async () => {
      const staff = await staffMember('site_editor2');
      const player = await signUp('site_nobody');
      const id = (await announce(staff, { title: 'Avant', body: 'texte' })).json().id as number;
      expect((await app.inject({ method: 'PUT', url: `/api/staff/announcements/${id}`, payload: { title: 'Après', body: 'texte 2', published: true }, cookies: as(staff) })).statusCode).toBe(200);
      expect((await page(`/site/actualites/${id}`)).body).toContain('Après');
      expect((await app.inject({ method: 'DELETE', url: `/api/staff/announcements/${id}`, cookies: as(player) })).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: `/api/staff/announcements/${id}`, cookies: as(staff) })).statusCode).toBe(204);
      expect((await page(`/site/actualites/${id}`)).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: `/api/staff/announcements/${id}`, cookies: as(staff) })).statusCode).toBe(404);
    });
  });

  describe('public pages', () => {
    it('shows the counters, the team and the state of the game to anybody', async () => {
      await staffMember('site_team_lead');
      const home = (await page('/site')).body;
      expect(home).toMatch(/joueurs/);
      expect(home).toMatch(/<strong>5<\/strong>en ligne/);
      expect((await page('/site/equipe')).body).toContain('site_team_lead');
      expect((await page('/site/statut')).body).toContain('Le jeu est ouvert');
      expect((await page('/site/classement')).statusCode).toBe(200);
      expect((await page('/site/nimporte-quoi')).statusCode).toBe(404);
    });

    it('shows a profile with the creations, and nothing private', async () => {
      const maker = await signUp('site_maker');
      const itemId = await createItem(maker, 'Lampe lune', 'appelle moi au 06 12 34 56 78');
      const res = await page('/site/joueur/SITE_MAKER');
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Lampe lune');
      expect(res.body).toContain('1 objet(s) inventé(s)');
      expect(res.body).toContain(`/site/objet/${itemId}.png`);
      // Neither the description (anybody can type anything in it), nor the private data of the player.
      expect(res.body).not.toMatch(/06 12|appelle moi/);
      expect(res.body).not.toMatch(/@test\.dev|1990|password|motdepasse/i);
      expect(res.body).toContain('sur invitation');
      await pool.query("UPDATE users SET apartment_access = 'building' WHERE id = $1", [maker.id]);
      await pool.query("UPDATE apartments SET name = 'Atelier lune' WHERE owner_id = $1", [maker.id]);
      expect((await page('/site/joueur/site_maker')).body).toContain('Atelier lune');
      expect((await page('/site/joueur/personne_ici')).statusCode).toBe(404);
      // The sprite is served for what the profile shows.
      const sprite = await page(`/site/objet/${itemId}.png`);
      expect(sprite.statusCode).toBe(200);
      expect(sprite.headers['content-type']).toBe('image/png');
    });

    it('shows nothing that was masked, or whose name would not pass the chat filter', async () => {
      const maker = await signUp('site_hider');
      const masked = await createItem(maker, 'Chose masquée');
      const shady = await createItem(maker, 'écris moi sur exemple.com');
      const fine = await createItem(maker, 'Chose visible');
      const staff = await staffMember('site_moderator');
      await pool.query("INSERT INTO item_moderation (item_id, state, decided_by) VALUES ($1, 'hidden', $2)", [masked, staff.id]);
      const res = await page('/site/joueur/site_hider');
      expect(res.body).toContain('Chose visible');
      expect(res.body).not.toContain('Chose masquée');
      expect(res.body).not.toContain('exemple.com');
      for (const id of [masked, shady]) expect((await page(`/site/objet/${id}.png`)).statusCode).toBe(404);
      expect((await page(`/site/objet/${fine}.png`)).statusCode).toBe(200);
      expect((await page('/site/objet/not-a-uuid.png')).statusCode).toBe(404);
      const home = (await page('/site')).body;
      expect(home).not.toContain('Chose masquée');
      expect(home).not.toContain('exemple.com');
    });

    it('ranks the inventors and the apartments that were visited, without closed ones', async () => {
      const a = await signUp('site_rank_a');
      const b = await signUp('site_rank_b');
      const visitors = await Promise.all([signUp('site_v1'), signUp('site_v2')]);
      await createItem(a, 'A1');
      await createItem(b, 'B1');
      await createItem(b, 'B2');
      await pool.query("UPDATE users SET apartment_access = 'building' WHERE id = $1", [a.id]);
      for (const v of visitors) {
        for (const owner of [a, b]) await pool.query("INSERT INTO quest_marks (user_id, event, ref) VALUES ($1, 'visit', $2)", [v.id, owner.id]);
      }
      const body = (await page('/site/classement')).body;
      expect(body.indexOf('site_rank_b')).toBeLessThan(body.indexOf('site_rank_a'));
      expect(body).toContain('2 objets');
      // Visited, but closed: not in the apartments ranking (b appears only among the inventors).
      const visited = body.slice(body.indexOf('Les apparts les plus visités'));
      expect(visited).toContain('site_rank_a');
      expect(visited).not.toContain('site_rank_b');
      expect(visited).toContain('2 visiteurs');
    });
  });

  describe('maintenance', () => {
    const setMaintenance = (staff: Account, on: unknown) =>
      app.inject({ method: 'PUT', url: '/api/staff/maintenance', payload: { on } as object, cookies: as(staff) });

    it('keeps players out of the API, lets the staff and the sign-in through, and ends on request', async () => {
      const staff = await staffMember('site_ops');
      const player = await signUp('site_waiting');
      expect((await setMaintenance(player, true)).statusCode).toBe(404);
      expect((await setMaintenance(staff, 'yes')).statusCode).toBe(400);
      expect((await app.inject({ method: 'GET', url: '/api/status' })).json()).toEqual({ ok: true, maintenance: false });

      expect((await setMaintenance(staff, true)).json()).toEqual({ maintenance: true });
      try {
        expect((await app.inject({ method: 'GET', url: '/api/status' })).json()).toEqual({ ok: true, maintenance: true });
        const blocked = await app.inject({ method: 'GET', url: '/api/inventory', cookies: as(player) });
        expect(blocked.statusCode).toBe(503);
        expect(blocked.json()).toMatchObject({ maintenance: true, error: expect.stringContaining('maintenance') });
        expect((await app.inject({ method: 'GET', url: '/api/inventory' })).statusCode).toBe(503);
        // Signing in stays possible (the staff needs it), and so does the website.
        expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies: as(player) })).statusCode).toBe(200);
        expect((await page('/site')).statusCode).toBe(200);
        expect((await page('/site/statut')).body).toContain('En maintenance');
        // The staff still plays.
        expect((await app.inject({ method: 'GET', url: '/api/inventory', cookies: as(staff) })).statusCode).toBe(200);
      } finally {
        await setMaintenance(staff, false);
        forgetMaintenance();
      }
      expect((await app.inject({ method: 'GET', url: '/api/inventory', cookies: as(player) })).statusCode).toBe(200);
    });
  });
});
