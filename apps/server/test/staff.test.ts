import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import { REPORT_HIDE_THRESHOLD } from '../src/moderation/masking';
import type { UserEvent } from '../src/moderation/sanctions';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

describe.skipIf(!available)('staff panel and sanctions (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  const events: UserEvent[] = [];
  const decor: string[] = [];

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    await pool.query('INSERT INTO apartments (id, floor, slot) SELECT n, 10 + n, 0 FROM generate_series(31, 90) AS n');
    app = buildServer({
      pool,
      model: null,
      notifyUser: (e) => void events.push(e),
      notifyApartment: (ownerId, kind) => void (kind === 'decor' && decor.push(ownerId)),
    });
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
    return { id: res.json().user.id as string, nickname, email: `${nickname}@test.dev`, sid: res.cookies.find((c) => c.name === 'coloxel_sid')!.value };
  }
  type Account = Awaited<ReturnType<typeof signUp>>;
  const signUpStaff = async (nickname: string) => {
    const a = await signUp(nickname);
    await pool.query("UPDATE users SET role = 'staff' WHERE id = $1", [a.id]);
    return a;
  };
  const as = (a: Account) => ({ coloxel_sid: a.sid });
  const get = (a: Account, path: string) => app.inject({ method: 'GET', url: path, cookies: as(a) });
  const post = (a: Account, path: string, payload?: unknown) =>
    app.inject({ method: 'POST', url: path, payload: payload as object, cookies: as(a) });
  const report = (who: Account, payload: object) => post(who, '/api/reports', payload);
  const sanction = (staff: Account, target: Account, payload: object) => post(staff, `/api/staff/players/${target.id}/sanctions`, payload);
  const login = (a: Account) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: a.email, password: 'motdepasse' } });
  const open = (a: Account) => pool.query("UPDATE users SET apartment_access = 'building' WHERE id = $1", [a.id]);

  const nextCell = new Map<string, number>();
  async function createItem(owner: Account, name = 'Lampe') {
    // One object per cell: each new creation of a player goes one cell further.
    const j = nextCell.get(owner.id) ?? 0;
    nextCell.set(owner.id, j + 1);
    const item = (
      await pool.query<{ id: string }>(
        `INSERT INTO items (serial, name, description, recipe, creator_id, owner_id)
         VALUES ((SELECT COALESCE(max(serial), 0) + 1 FROM items), $1, 'une lampe', $2, $3, $3) RETURNING id`,
        [name, JSON.stringify({ name, parts: SEEDS[0]!.parts }), owner.id],
      )
    ).rows[0]!.id;
    await pool.query('INSERT INTO placements (item_id, user_id, i, j) VALUES ($1, $2, 6, $3)', [item, owner.id, j + 2]);
    return item;
  }

  describe('access', () => {
    it('is closed to everybody who is not staff, whatever they know of the routes', async () => {
      const staff = await signUpStaff('st_boss');
      const player = await signUp('st_player');
      expect((await app.inject({ method: 'GET', url: '/api/staff/me' })).statusCode).toBe(401);
      for (const path of ['/api/staff/me', '/api/staff/reports', '/api/staff/chat', '/api/staff/players', `/api/staff/players/${staff.id}`]) {
        expect((await get(player, path)).statusCode, path).toBe(404);
      }
      expect((await post(player, '/api/staff/reports/resolve', { kind: 'player', targetKey: staff.id, decision: 'confirm' })).statusCode).toBe(404);
      expect((await sanction(player, staff, { kind: 'ban', reason: 'pour rire' })).statusCode).toBe(404);
      expect((await post(player, '/api/staff/sanctions/1/revoke')).statusCode).toBe(404);
      expect((await get(staff, '/api/staff/me')).json()).toEqual({ staff: true });
      // No way to promote oneself through the game.
      expect((await app.inject({ method: 'PUT', url: '/api/me/look', payload: { role: 'staff' }, cookies: as(player) })).statusCode).not.toBe(200);
      expect((await pool.query('SELECT role FROM users WHERE id = $1', [player.id])).rows[0].role).toBe('user');
    });
  });

  describe('dashboard', () => {
    it('gives the staff the numbers of the game, and nobody else', async () => {
      const staff = await signUpStaff('st_dash_staff');
      const player = await signUp('st_dash_player');
      expect((await get(player, '/api/staff/dashboard')).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/api/staff/dashboard' })).statusCode).toBe(401);

      await pool.query("INSERT INTO chat_log (user_id, room, text) VALUES ($1, 'hall', 'bonjour')", [player.id]);
      await pool.query("INSERT INTO chat_log (user_id, room, text, blocked, reason) VALUES ($1, 'hall', 'x', true, 'link')", [player.id]);
      await post(staff, `/api/staff/players/${player.id}/sanctions`, { kind: 'mute', minutes: 10, reason: 'Pour le test' });
      const d = (await get(staff, '/api/staff/dashboard')).json();
      expect(d.players).toBeGreaterThanOrEqual(2);
      expect(d.newToday).toBeGreaterThanOrEqual(2);
      expect(d.messages24h).toBeGreaterThanOrEqual(2);
      expect(d.blocked24h).toBeGreaterThanOrEqual(1);
      expect(d.sanctionsLive).toBeGreaterThanOrEqual(1);
      expect(typeof d.maintenance).toBe('boolean');
      // A week of sign-ups, oldest first, today last, and it adds up.
      expect(d.signups).toHaveLength(7);
      expect(d.signups.at(-1).count).toBe(d.newToday);
      expect(d.signups.map((s: { day: string }) => s.day)).toEqual([...d.signups.map((s: { day: string }) => s.day)].sort());
    });
  });

  describe('reports', () => {
    it('groups the reports of one thing, most reported first, and keeps who said what', async () => {
      const staff = await signUpStaff('st_rep_staff');
      const culprit = await signUp('st_culprit');
      const other = await signUp('st_other');
      const [a, b, c] = await Promise.all([signUp('st_ra'), signUp('st_rb'), signUp('st_rc')]);
      await report(a, { kind: 'player', targetId: other.id, reason: 'spam' });
      await report(a, { kind: 'player', targetId: culprit.id, reason: 'harassment', details: 'il me suit partout' });
      await report(b, { kind: 'player', targetId: culprit.id, reason: 'insult' });
      await report(c, { kind: 'player', targetId: culprit.id, reason: 'harassment' });

      const { groups } = (await get(staff, '/api/staff/reports')).json();
      const mine = groups.filter((g: { kind: string; targetUser: { id: string } }) => g.targetUser?.id === culprit.id || g.targetUser?.id === other.id);
      expect(mine.map((g: { targetUser: { nickname: string }; count: number }) => [g.targetUser.nickname, g.count])).toEqual([
        ['st_culprit', 3],
        ['st_other', 1],
      ]);
      expect(mine[0].reasons).toEqual({ harassment: 2, insult: 1 });
      expect(mine[0].reports.map((r: { reporter: string }) => r.reporter)).toEqual(['st_ra', 'st_rb', 'st_rc']);
      expect(mine[0].reports[0]).toMatchObject({ details: 'il me suit partout' });
    });

    it('settles all the reports of a thing at once, and a second decision finds nothing left', async () => {
      const staff = await signUpStaff('st_judge');
      const accused = await signUp('st_accused');
      const a = await signUp('st_ja');
      const b = await signUp('st_jb');
      await report(a, { kind: 'player', targetId: accused.id, reason: 'spam' });
      await report(b, { kind: 'player', targetId: accused.id, reason: 'spam' });

      const res = await post(staff, '/api/staff/reports/resolve', { kind: 'player', targetKey: accused.id, decision: 'dismiss', note: 'rien à signaler' });
      expect(res.statusCode).toBe(200);
      expect(res.json().resolved).toBe(2);
      const rows = (await pool.query('SELECT status, handled_by, note FROM reports WHERE target_user_id = $1', [accused.id])).rows;
      expect(rows).toEqual([
        { status: 'dismissed', handled_by: staff.id, note: 'rien à signaler' },
        { status: 'dismissed', handled_by: staff.id, note: 'rien à signaler' },
      ]);
      expect((await post(staff, '/api/staff/reports/resolve', { kind: 'player', targetKey: accused.id, decision: 'confirm' })).statusCode).toBe(404);
      const open = (await get(staff, '/api/staff/reports')).json().groups as { targetUser: { id: string } }[];
      expect(open.some((g) => g.targetUser?.id === accused.id)).toBe(false);
      const handled = (await get(staff, '/api/staff/reports?status=handled')).json().handled as { target: string; handler: string; status: string }[];
      expect(handled.filter((h) => h.target === 'st_accused')).toMatchObject([{ handler: 'st_judge', status: 'dismissed' }, { handler: 'st_judge' }]);
    });

    it('lets the staff hide a reported creation for good, or clear it for good', async () => {
      const staff = await signUpStaff('st_curator');
      const owner = await signUp('st_artist');
      const visitor = await signUp('st_visitor');
      await open(owner);
      const sprite = (id: string) => get(visitor, `/api/items/${id}.png`);

      // Hidden by the staff after a single report: no need to wait for the threshold.
      const bad = await createItem(owner, 'Truc douteux');
      await report(visitor, { kind: 'item', targetId: bad, reason: 'inappropriate' });
      expect((await sprite(bad)).statusCode).toBe(200);
      decor.length = 0;
      expect((await post(staff, '/api/staff/reports/resolve', { kind: 'item', targetKey: bad, decision: 'confirm' })).statusCode).toBe(200);
      expect((await sprite(bad)).statusCode).toBe(404);
      expect(decor).toContain(owner.id);
      expect((await get(owner, `/api/items/${bad}.png`)).statusCode).toBe(200);
      // The staff still sees what they hid.
      expect((await get(staff, `/api/items/${bad}.png`)).statusCode).toBe(200);

      // Masked by the crowd, then cleared by the staff: it comes back, and stays whatever is reported next.
      const fine = await createItem(owner, 'Lampe sage');
      const crowd = await Promise.all(Array.from({ length: REPORT_HIDE_THRESHOLD }, (_, k) => signUp(`st_crowd${k}`)));
      for (const r of crowd) await report(r, { kind: 'item', targetId: fine, reason: 'spam' });
      expect((await sprite(fine)).statusCode).toBe(404);
      const queue = (await get(staff, '/api/staff/reports')).json().groups as { kind: string; targetKey: string; masked: boolean; count: number }[];
      expect(queue.find((g) => g.targetKey === fine)).toMatchObject({ kind: 'item', masked: true, count: REPORT_HIDE_THRESHOLD });
      expect((await post(staff, '/api/staff/reports/resolve', { kind: 'item', targetKey: fine, decision: 'dismiss' })).statusCode).toBe(200);
      expect((await sprite(fine)).statusCode).toBe(200);
      const later = await Promise.all(Array.from({ length: REPORT_HIDE_THRESHOLD }, (_, k) => signUp(`st_later${k}`)));
      for (const r of later) await report(r, { kind: 'item', targetId: fine, reason: 'spam' });
      expect((await sprite(fine)).statusCode).toBe(200);

      // And the staff can change their mind from the creator's sheet.
      expect((await post(staff, `/api/staff/items/${fine}/moderation`, { state: 'hidden' })).statusCode).toBe(200);
      expect((await sprite(fine)).statusCode).toBe(404);
      expect((await post(staff, `/api/staff/items/${fine}/moderation`, { state: 'none' })).statusCode).toBe(200);
      expect((await post(staff, `/api/staff/items/${fine}/moderation`, { state: 'maybe' })).statusCode).toBe(400);
    });

    it('can sanction the player in the same move, and remembers which report it answers', async () => {
      const staff = await signUpStaff('st_mod');
      const rude = await signUp('st_rude');
      const witness = await signUp('st_witness');
      await report(witness, { kind: 'player', targetId: rude.id, reason: 'insult' });
      const res = await post(staff, '/api/staff/reports/resolve', {
        kind: 'player',
        targetKey: rude.id,
        decision: 'confirm',
        sanction: { kind: 'mute', minutes: 30, reason: 'Insultes répétées' },
      });
      expect(res.statusCode).toBe(200);
      const row = (await pool.query('SELECT kind, reason, issued_by, report_id, expires_at FROM sanctions WHERE user_id = $1', [rude.id])).rows[0];
      expect(row).toMatchObject({ kind: 'mute', reason: 'Insultes répétées', issued_by: staff.id });
      expect(row.report_id).not.toBeNull();
      expect(Math.round((row.expires_at.getTime() - Date.now()) / 60_000)).toBe(30);
    });
  });

  describe('sanctions', () => {
    it('refuses sanctions that are incomplete, impossible, or aimed at the wrong person', async () => {
      const staff = await signUpStaff('st_chief');
      const colleague = await signUpStaff('st_colleague');
      const player = await signUp('st_victim');
      const bad: [object, number][] = [
        [{ kind: 'mute', minutes: 10 }, 400], // no reason
        [{ kind: 'mute', minutes: 10, reason: 'ok' }, 400], // reason too short
        [{ kind: 'mute', reason: 'Spam répété' }, 400], // no duration
        [{ kind: 'suspension', minutes: 0, reason: 'Spam répété' }, 400],
        [{ kind: 'suspension', minutes: 600000, reason: 'Spam répété' }, 400],
        [{ kind: 'warning', minutes: 5, reason: 'Spam répété' }, 400], // a warning has no duration
        [{ kind: 'ban', minutes: 5, reason: 'Spam répété' }, 400],
        [{ kind: 'exile', reason: 'Spam répété' }, 400],
        [{ kind: 'warning', reason: 'Spam répété', issuedBy: colleague.id }, 400],
      ];
      for (const [payload, status] of bad) expect((await sanction(staff, player, payload)).statusCode, JSON.stringify(payload)).toBe(status);
      expect((await sanction(staff, colleague, { kind: 'ban', reason: 'Je tente ma chance' })).statusCode).toBe(400);
      expect((await sanction(staff, staff, { kind: 'ban', reason: 'Je tente ma chance' })).statusCode).toBe(400);
      expect((await post(staff, '/api/staff/players/00000000-0000-4000-8000-000000000000/sanctions', { kind: 'warning', reason: 'Spam répété' })).statusCode).toBe(404);
      expect((await pool.query('SELECT count(*) FROM sanctions WHERE user_id = ANY($1)', [[player.id, colleague.id, staff.id]])).rows[0].count).toBe('0');
    });

    it('takes effect at once on a suspended player: no session, no sign-in, until the sanction is lifted or ends', async () => {
      const staff = await signUpStaff('st_warden');
      const player = await signUp('st_suspended');
      expect((await get(player, '/api/auth/me')).statusCode).toBe(200);
      events.length = 0;

      const res = await sanction(staff, player, { kind: 'suspension', minutes: 60, reason: 'Harcèlement' });
      expect(res.statusCode).toBe(201);
      expect(events).toMatchObject([{ userId: player.id, kind: 'suspension' }]);
      expect((await get(player, '/api/auth/me')).statusCode).toBe(401);
      const refused = await login(player);
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error).toMatch(/suspendu.*Harcèlement/);

      // Lifted: back in, and the history keeps both facts.
      expect((await post(staff, `/api/staff/sanctions/${res.json().id}/revoke`)).statusCode).toBe(200);
      expect((await post(staff, `/api/staff/sanctions/${res.json().id}/revoke`)).statusCode).toBe(404);
      expect((await get(player, '/api/auth/me')).statusCode).toBe(200);
      expect((await login(player)).statusCode).toBe(200);
      const sheet = (await get(staff, `/api/staff/players/${player.id}`)).json();
      expect(sheet.sanctions).toMatchObject([{ kind: 'suspension', reason: 'Harcèlement', issuer: 'st_warden', revoker: 'st_warden', live: false }]);

      // One that ran out on its own does not apply either.
      await sanction(staff, player, { kind: 'suspension', minutes: 5, reason: 'Encore' });
      expect((await get(player, '/api/auth/me')).statusCode).toBe(401);
      await pool.query("UPDATE sanctions SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [player.id]);
      expect((await get(player, '/api/auth/me')).statusCode).toBe(200);
    });

    it('bans for good', async () => {
      const staff = await signUpStaff('st_judge2');
      const player = await signUp('st_banned');
      expect((await sanction(staff, player, { kind: 'ban', reason: 'Comportement inacceptable' })).statusCode).toBe(201);
      expect((await get(player, '/api/auth/me')).statusCode).toBe(401);
      const refused = await login(player);
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error).toMatch(/banni/);
      expect(events.at(-1)).toMatchObject({ userId: player.id, kind: 'ban' });
    });

    it('tells a player about a warning once, and about a mute for as long as it lasts', async () => {
      const staff = await signUpStaff('st_teacher');
      const player = await signUp('st_pupil');
      expect((await get(player, '/api/notices')).json().notices).toEqual([]);
      events.length = 0;
      const warning = await sanction(staff, player, { kind: 'warning', reason: 'Reste poli avec les autres.' });
      expect(events).toMatchObject([{ userId: player.id, kind: 'warning', id: warning.json().id }]);
      await sanction(staff, player, { kind: 'mute', minutes: 15, reason: 'Trop de bruit' });

      const notices = (await get(player, '/api/notices')).json().notices as { id: number; kind: string; text: string }[];
      expect(notices.map((n) => n.kind)).toEqual(['warning', 'mute']);
      expect(notices[0]!.text).toMatch(/Reste poli/);
      expect((await post(player, '/api/notices/seen', { ids: notices.map((n) => n.id) })).statusCode).toBe(200);
      expect((await get(player, '/api/notices')).json().notices.map((n: { kind: string }) => n.kind)).toEqual(['mute']);
      // Someone else's warning cannot be marked read by another player.
      const other = await signUp('st_other_pupil');
      const second = await sanction(staff, other, { kind: 'warning', reason: 'Une autre fois' });
      const thief = await signUp('st_thief');
      await post(thief, '/api/notices/seen', { ids: [second.json().id] });
      expect((await pool.query('SELECT seen_at FROM sanctions WHERE id = $1', [second.json().id])).rows[0].seen_at).toBeNull();
    });
  });

  describe('chat journal and player sheets', () => {
    it('filters the journal by player, room, text and whether the message was blocked, page by page', async () => {
      const staff = await signUpStaff('st_reader');
      const a = await signUp('st_ja_talker');
      const b = await signUp('st_jb_talker');
      const say = (u: Account, room: string, text: string, blocked = false, reason: string | null = null) =>
        pool.query('INSERT INTO chat_log (user_id, room, text, blocked, reason) VALUES ($1, $2, $3, $4, $5)', [u.id, room, text, blocked, reason]);
      await say(a, 'hall', 'bonjour le hall');
      await say(a, 'hall', 'regarde exemple.com', true, 'link');
      await say(b, `apartment:${a.id}`, 'sympa chez toi 100%');
      await say(b, 'hall', 'salut a_b');

      const ask = async (query: string) => ((await get(staff, `/api/staff/chat?${query}`)).json().messages as { nickname: string; text: string; blocked: boolean }[]);
      expect((await ask(`nickname=ST_JA_TALKER`)).map((m) => m.text)).toEqual(['regarde exemple.com', 'bonjour le hall']); // newest first
      expect((await ask(`userId=${b.id}&room=hall`)).map((m) => m.text)).toEqual(['salut a_b']);
      expect((await ask(`owner=st_ja_talker`)).map((m) => [m.nickname, m.text])).toEqual([['st_jb_talker', 'sympa chez toi 100%']]);
      expect((await ask(`nickname=st_ja_talker&blocked=true`)).map((m) => m.text)).toEqual(['regarde exemple.com']);
      expect((await ask(`nickname=st_ja_talker&blocked=false`)).map((m) => m.text)).toEqual(['bonjour le hall']);
      // `%` and `_` are plain characters in a search.
      expect((await ask(`q=100%25`)).map((m) => m.text)).toEqual(['sympa chez toi 100%']);
      expect((await ask(`q=a_b`)).map((m) => m.text)).toEqual(['salut a_b']);
      const first = (await get(staff, `/api/staff/chat?nickname=st_ja_talker&limit=1`)).json();
      expect(first.messages).toHaveLength(1);
      expect(first.next).not.toBeNull();
      expect((await ask(`nickname=st_ja_talker&before=${first.next}`)).map((m) => m.text)).toEqual(['bonjour le hall']);
      expect((await get(staff, '/api/staff/chat?userId=nope')).statusCode).toBe(400);
    });

    it('gives a player sheet with creations, sanctions, reports and recent chat, and no private data', async () => {
      const staff = await signUpStaff('st_sheet_staff');
      const player = await signUp('st_sheet_player');
      const reporter = await signUp('st_sheet_reporter');
      await createItem(player, 'Ma lampe');
      await pool.query('INSERT INTO chat_log (user_id, room, text) VALUES ($1, $2, $3)', [player.id, 'hall', 'coucou']);
      await report(reporter, { kind: 'player', targetId: player.id, reason: 'spam' });
      await sanction(staff, player, { kind: 'warning', reason: 'Première fois' });

      const res = await get(staff, `/api/staff/players/${player.id}`);
      expect(res.statusCode).toBe(200);
      const sheet = res.json();
      expect(sheet.player).toMatchObject({ id: player.id, nickname: 'st_sheet_player', role: 'user', apartment: { access: 'closed' } });
      expect(sheet.creations).toMatchObject([{ name: 'Ma lampe', masked: false, state: null }]);
      expect(sheet.sanctions).toMatchObject([{ kind: 'warning', reason: 'Première fois', issuer: 'st_sheet_staff' }]);
      expect(sheet.reports).toEqual({ againstOpen: 1, againstTotal: 1, made: 0 });
      expect(sheet.chat).toMatchObject([{ text: 'coucou', blocked: false }]);
      // Nothing private leaves the server.
      expect(JSON.stringify(sheet)).not.toMatch(/@test\.dev|password|birth|1990/i);
      expect((await get(staff, '/api/staff/players/not-a-uuid')).statusCode).toBe(404);

      const found = (await get(staff, '/api/staff/players?q=SHEET_pl')).json().players as { nickname: string; sanctions: string[] }[];
      expect(found.map((p) => p.nickname)).toEqual(['st_sheet_player']);
      // A warning is not a restriction: the list only flags what limits the player.
      expect(found[0]!.sanctions).toEqual([]);
    });
  });
});
