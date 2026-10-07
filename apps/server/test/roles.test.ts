import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import { forgetMaintenance } from '../src/site/settings';
import { PERMISSIONS, ROLES, ROLE_IDS, STAFF_ROLES, assignableRoles, can, outranks, sanctionRefusal, type RoleId } from '../src/staff/roles';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

describe('staff roles (rules)', () => {
  it('has levels that rise with each role, and every staff role may open the administration', () => {
    const levels = ROLE_IDS.map((r) => ROLES[r].level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels).size).toBe(levels.length);
    for (const role of STAFF_ROLES) expect(can(role.id, 'admin.access')).toBe(true);
    expect(can('user', 'admin.access')).toBe(false);
    expect(can('nonsense', 'admin.access')).toBe(false);
  });

  it('gives each role more than the one below it, and the administrator everything', () => {
    for (let k = 2; k < STAFF_ROLES.length; k++) {
      const below = STAFF_ROLES[k - 1]!;
      const role = STAFF_ROLES[k]!;
      // A moderator is not an animateur plus more (the animateur writes the news and holds events): compare the moderation side.
      if (below.id === 'animateur') continue;
      for (const p of below.permissions) expect(role.permissions, `${role.id} lacks ${p}`).toContain(p);
    }
    expect([...ROLES.administrateur.permissions].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('keeps the powers where they belong', () => {
    expect(can('animateur', 'events.manage')).toBe(true);
    expect(can('animateur', 'reports.view')).toBe(false);
    expect(can('moderateur', 'reports.resolve')).toBe(true);
    expect(can('moderateur', 'sanction.ban')).toBe(false);
    expect(can('moderateur', 'maintenance.toggle')).toBe(false);
    expect(can('super_moderateur', 'sanction.ban')).toBe(true);
    expect(can('super_moderateur', 'roles.manage')).toBe(false);
    expect(can('gerant', 'maintenance.toggle')).toBe(true);
    expect(can('gerant', 'roles.manage')).toBe(true);
  });

  it('only lets a role hand out roles strictly below its own', () => {
    expect(assignableRoles('animateur')).toEqual([]);
    expect(assignableRoles('moderateur')).toEqual([]);
    expect(assignableRoles('gerant').map((r) => r.id)).toEqual(['user', 'animateur', 'moderateur', 'super_moderateur'].sort((a, b) => ROLES[a as RoleId].level - ROLES[b as RoleId].level));
    expect(assignableRoles('administrateur').map((r) => r.id)).toContain('gerant');
    expect(assignableRoles('administrateur').map((r) => r.id)).not.toContain('administrateur');
  });

  it('never lets a role act on its equal or its superior', () => {
    expect(outranks('moderateur', 'animateur')).toBe(true);
    expect(outranks('moderateur', 'user')).toBe(true);
    expect(outranks('moderateur', 'moderateur')).toBe(false);
    expect(outranks('moderateur', 'gerant')).toBe(false);
    expect(outranks('user', 'user')).toBe(false);
  });

  it('limits what each role may sanction, and for how long', () => {
    const day = 24 * 60;
    expect(sanctionRefusal('animateur', 'warning', undefined)).toBeNull();
    expect(sanctionRefusal('animateur', 'mute', 10)).toMatch(/ne permet pas/);
    expect(sanctionRefusal('moderateur', 'mute', day)).toBeNull();
    expect(sanctionRefusal('moderateur', 'mute', day + 1)).toMatch(/24 h/);
    expect(sanctionRefusal('moderateur', 'suspension', 7 * day)).toBeNull();
    expect(sanctionRefusal('moderateur', 'suspension', 7 * day + 1)).toMatch(/7 jours/);
    expect(sanctionRefusal('moderateur', 'ban', undefined)).toMatch(/ne permet pas/);
    expect(sanctionRefusal('super_moderateur', 'ban', undefined)).toBeNull();
    expect(sanctionRefusal('administrateur', 'suspension', 365 * day)).toBeNull();
    expect(sanctionRefusal('user', 'warning', undefined)).not.toBeNull();
  });
});

describe.skipIf(!available)('staff roles in the administration (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    await pool.query('INSERT INTO apartments (id, floor, slot) SELECT n, 10 + n, 0 FROM generate_series(31, 90) AS n');
    app = buildServer({ pool, model: null });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function signUp(nickname: string, role: RoleId = 'user') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `${nickname}@test.dev`, password: 'motdepasse', nickname, birthDate: '1990-01-01' },
    });
    const id = res.json().user.id as string;
    if (role !== 'user') await pool.query('UPDATE users SET role = $2 WHERE id = $1', [id, role]);
    return { id, nickname, sid: res.cookies.find((c) => c.name === 'coloxel_sid')!.value };
  }
  type Account = Awaited<ReturnType<typeof signUp>>;
  const as = (a: Account) => ({ coloxel_sid: a.sid });
  const get = (a: Account, path: string) => app.inject({ method: 'GET', url: path, cookies: as(a) });
  const send = (method: 'POST' | 'PUT' | 'DELETE', a: Account, path: string, payload?: unknown) =>
    app.inject({ method, url: path, payload: payload as object, cookies: as(a) });
  const sanction = (by: Account, target: Account, payload: object) => send('POST', by, `/api/staff/players/${target.id}/sanctions`, payload);
  const setRole = (by: Account, target: Account, role: string) => send('PUT', by, `/api/staff/players/${target.id}/role`, { role });
  const roleOf = async (a: Account) => (await pool.query('SELECT role FROM users WHERE id = $1', [a.id])).rows[0].role as string;

  describe('who may open what', () => {
    it('tells each staff member what their role allows, and keeps players out', async () => {
      const player = await signUp('rl_player');
      const mod = await signUp('rl_me_mod', 'moderateur');
      const admin = await signUp('rl_me_admin', 'administrateur');
      expect((await get(player, '/api/staff/me')).statusCode).toBe(404);
      const me = (await get(mod, '/api/staff/me')).json();
      expect(me).toMatchObject({ staff: true, role: 'moderateur', title: 'Modérateur', level: 40, maxMuteMinutes: 1440, maxSuspensionMinutes: 7 * 1440, assignable: [] });
      expect(me.permissions).toContain('reports.resolve');
      expect(me.permissions).not.toContain('sanction.ban');
      const all = (await get(admin, '/api/staff/me')).json();
      expect(all.permissions).toHaveLength(PERMISSIONS.length);
      expect(all.assignable).toContain('gerant');
    });

    it('lets an animateur run events and news, but not moderate', async () => {
      const host = await signUp('rl_host', 'animateur');
      const target = await signUp('rl_t_host');
      expect((await get(host, '/api/staff/dashboard')).statusCode).toBe(200);
      expect((await get(host, '/api/staff/players?q=rl_t')).statusCode).toBe(200);
      for (const path of ['/api/staff/reports', '/api/staff/chat', '/api/staff/team']) expect((await get(host, path)).statusCode, path).toBe(403);
      expect((await send('POST', host, '/api/staff/announcements', { title: 'Soirée', body: 'Ce soir !' })).statusCode).toBe(201);
      expect((await send('PUT', host, '/api/staff/maintenance', { on: true })).statusCode).toBe(403);
      expect((await sanction(host, target, { kind: 'warning', reason: 'Reste poli' })).statusCode).toBe(201);
      const refused = await sanction(host, target, { kind: 'mute', minutes: 10, reason: 'Trop de bruit' });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error).toMatch(/Animateur/);
      expect((await send('POST', host, '/api/staff/items/00000000-0000-4000-8000-000000000000/moderation', { state: 'hidden' })).statusCode).toBe(403);
      expect((await setRole(host, target, 'animateur')).statusCode).toBe(403);
    });

    it('lets a modérateur treat reports and sanction within its limits, not ban, not write news', async () => {
      const mod = await signUp('rl_mod', 'moderateur');
      const other = await signUp('rl_mod_other', 'moderateur');
      const host = await signUp('rl_mod_host', 'animateur');
      const target = await signUp('rl_t_mod');
      for (const path of ['/api/staff/reports', '/api/staff/chat', '/api/staff/team', '/api/staff/dashboard']) expect((await get(mod, path)).statusCode, path).toBe(200);
      expect((await send('POST', mod, '/api/staff/announcements', { title: 'Hop', body: 'Non' })).statusCode).toBe(403);
      expect((await get(mod, '/api/staff/events')).statusCode).toBe(403);

      expect((await sanction(mod, target, { kind: 'mute', minutes: 24 * 60, reason: 'Trop de bruit' })).statusCode).toBe(201);
      const long = await sanction(mod, target, { kind: 'mute', minutes: 24 * 60 + 1, reason: 'Trop de bruit' });
      expect(long.statusCode).toBe(403);
      expect(long.json().error).toMatch(/24 h/);
      expect((await sanction(mod, target, { kind: 'suspension', minutes: 7 * 24 * 60, reason: 'Harcèlement' })).statusCode).toBe(201);
      expect((await sanction(mod, target, { kind: 'suspension', minutes: 8 * 24 * 60, reason: 'Harcèlement' })).statusCode).toBe(403);
      expect((await sanction(mod, target, { kind: 'ban', reason: 'Définitif' })).statusCode).toBe(403);
      // Only down the ladder: never an equal, never a superior, and an animateur is below.
      expect((await sanction(mod, other, { kind: 'warning', reason: 'Entre collègues' })).statusCode).toBe(400);
      expect((await sanction(mod, host, { kind: 'warning', reason: 'Un animateur est en dessous' })).statusCode).toBe(201);
      expect((await sanction(host, mod, { kind: 'warning', reason: 'Pas de bas en haut' })).statusCode).toBe(400);
    });

    it('lets a super-modérateur ban, and a modérateur not lift that ban', async () => {
      const senior = await signUp('rl_senior', 'super_moderateur');
      const mod = await signUp('rl_senior_mod', 'moderateur');
      const target = await signUp('rl_t_senior');
      const banned = await sanction(senior, target, { kind: 'ban', reason: 'Comportement grave' });
      expect(banned.statusCode).toBe(201);
      expect((await send('POST', mod, `/api/staff/sanctions/${banned.json().id}/revoke`)).statusCode).toBe(403);
      expect((await send('POST', senior, `/api/staff/sanctions/${banned.json().id}/revoke`)).statusCode).toBe(200);
      // Nobody lifts a sanction on an equal or a superior.
      const above = await signUp('rl_above', 'gerant');
      const mute = await sanction(await signUp('rl_boss_admin', 'administrateur'), above, { kind: 'mute', minutes: 60, reason: 'Test' });
      expect(mute.statusCode).toBe(201);
      expect((await send('POST', senior, `/api/staff/sanctions/${mute.json().id}/revoke`)).statusCode).toBe(403);
    });

    it('lets a gérant run the game: maintenance and the team below it', async () => {
      const boss = await signUp('rl_manager', 'gerant');
      const mod = await signUp('rl_manager_mod', 'moderateur');
      const player = await signUp('rl_manager_player');
      try {
        expect((await send('PUT', mod, '/api/staff/maintenance', { on: true })).statusCode).toBe(403);
        expect((await send('PUT', boss, '/api/staff/maintenance', { on: true })).statusCode).toBe(200);
        // In maintenance only the roles that run the game keep playing.
        expect((await get(player, '/api/inventory')).statusCode).toBe(503);
        expect((await get(mod, '/api/inventory')).statusCode).toBe(503);
        expect((await get(boss, '/api/inventory')).statusCode).toBe(200);
      } finally {
        await send('PUT', boss, '/api/staff/maintenance', { on: false });
        forgetMaintenance();
      }
      expect((await get(mod, '/api/inventory')).statusCode).toBe(200);
    });
  });

  describe('changing roles', () => {
    it('lets a gérant name animateurs and moderators, never an equal or a higher role, never itself', async () => {
      const boss = await signUp('rl_boss', 'gerant');
      const peer = await signUp('rl_peer', 'gerant');
      const top = await signUp('rl_top', 'administrateur');
      const player = await signUp('rl_promoted');
      expect((await setRole(boss, player, 'moderateur')).json()).toMatchObject({ role: 'moderateur', title: 'Modérateur' });
      expect(await roleOf(player)).toBe('moderateur');
      expect((await setRole(boss, player, 'super_moderateur')).statusCode).toBe(200);
      for (const role of ['gerant', 'administrateur']) expect((await setRole(boss, player, role)).statusCode, role).toBe(403);
      expect((await setRole(boss, peer, 'user')).statusCode).toBe(403); // an equal
      expect((await setRole(boss, top, 'user')).statusCode).toBe(403); // a superior
      expect((await setRole(boss, boss, 'user')).statusCode).toBe(400);
      expect((await setRole(boss, player, 'roi')).statusCode).toBe(400);
      expect((await send('PUT', boss, `/api/staff/players/${player.id}/role`, { role: 'user', by: top.id })).statusCode).toBe(400);
      expect((await send('PUT', boss, '/api/staff/players/00000000-0000-4000-8000-000000000000/role', { role: 'animateur' })).statusCode).toBe(404);
      expect((await send('PUT', boss, '/api/staff/players/not-a-uuid/role', { role: 'animateur' })).statusCode).toBe(404);
    });

    it('lets an administrator name gérants, and nobody below may name anybody', async () => {
      const top = await signUp('rl_chief', 'administrateur');
      const mod = await signUp('rl_nobody', 'moderateur');
      const player = await signUp('rl_future_boss');
      expect((await setRole(mod, player, 'animateur')).statusCode).toBe(403);
      expect((await setRole(top, player, 'gerant')).statusCode).toBe(200);
      expect((await setRole(top, player, 'administrateur')).statusCode).toBe(403);
      expect((await setRole(top, player, 'user')).statusCode).toBe(200);
      expect(await roleOf(player)).toBe('user');
    });

    it('takes effect at once, and is journaled with who did it', async () => {
      const boss = await signUp('rl_log_boss', 'gerant');
      const recruit = await signUp('rl_recruit');
      expect((await get(recruit, '/api/staff/me')).statusCode).toBe(404);
      await setRole(boss, recruit, 'moderateur');
      expect((await get(recruit, '/api/staff/reports')).statusCode).toBe(200);
      await setRole(boss, recruit, 'user');
      // Demoted: the very next request is a player's.
      expect((await get(recruit, '/api/staff/reports')).statusCode).toBe(404);

      const logs = (await pool.query('SELECT from_role, to_role, changed_by FROM role_log WHERE user_id = $1 ORDER BY id', [recruit.id])).rows;
      expect(logs).toEqual([
        { from_role: 'user', to_role: 'moderateur', changed_by: boss.id },
        { from_role: 'moderateur', to_role: 'user', changed_by: boss.id },
      ]);
      // A role set to what it already is leaves no trace.
      await setRole(boss, recruit, 'user');
      expect((await pool.query('SELECT count(*) FROM role_log WHERE user_id = $1', [recruit.id])).rows[0].count).toBe('2');

      const team = (await get(boss, '/api/staff/team')).json();
      expect(team.history[0]).toMatchObject({ nickname: 'rl_recruit', from: 'Modérateur', to: 'Joueur', by: 'rl_log_boss' });
      expect(team.members.some((m: { nickname: string }) => m.nickname === 'rl_recruit')).toBe(false);
    });

    it('lists the team from the top, with the roles’ definitions for everybody on it', async () => {
      const mod = await signUp('rl_list_mod', 'moderateur');
      await signUp('rl_list_host', 'animateur');
      const team = (await get(mod, '/api/staff/team')).json().members as { nickname: string; role: string }[];
      const order = team.map((m) => ROLES[m.role as RoleId].level);
      expect(order).toEqual([...order].sort((a, b) => b - a));
      const roles = (await get(mod, '/api/staff/roles')).json();
      expect(roles.roles.map((r: { id: string }) => r.id)).toEqual(STAFF_ROLES.map((r) => r.id));
      expect(roles.mine).toBe('moderateur');
      expect((await get(await signUp('rl_list_player'), '/api/staff/roles')).statusCode).toBe(404);
    });
  });

  describe('the journal of the staff commands', () => {
    it('is read by the managers only, newest first, filtered by member', async () => {
      const boss = await signUp('rl_jl_boss', 'gerant');
      const mod = await signUp('rl_jl_mod', 'moderateur');
      await pool.query("INSERT INTO staff_log (staff_id, command, args, room) VALUES ($1, 'kick', 'rl_x', 'hall'), ($1, 'mute', 'rl_y 10 test', 'hall'), ($2, 'ha', 'bonjour', 'hall')", [mod.id, boss.id]);
      expect((await get(mod, '/api/staff/log')).statusCode).toBe(403);
      expect((await get(await signUp('rl_jl_player'), '/api/staff/log')).statusCode).toBe(404);
      const all = (await get(boss, '/api/staff/log')).json();
      expect(all.entries.map((e: { command: string }) => e.command).slice(0, 3)).toEqual(['ha', 'mute', 'kick']);
      expect(all.entries[0]).toMatchObject({ staff: 'rl_jl_boss', args: 'bonjour', room: 'hall' });
      const only = (await get(boss, '/api/staff/log?staff=RL_JL_MOD')).json();
      expect(only.entries.map((e: { command: string }) => e.command)).toEqual(['mute', 'kick']);
      expect((await get(boss, '/api/staff/log?before=abc')).statusCode).toBe(400);
    });
  });

  describe('events', () => {
    const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    const event = (by: Account, extra: object = {}) =>
      send('POST', by, '/api/staff/events', { title: 'Chasse aux objets', description: 'Trouve l’objet caché dans le hall.', startsAt: inHours(5), place: 'Le hall', ...extra });

    it('is organised by the animateurs and the roles above, and shown to everybody', async () => {
      const host = await signUp('rl_ev_host', 'animateur');
      const mod = await signUp('rl_ev_mod', 'moderateur');
      const player = await signUp('rl_ev_player');
      expect((await event(player)).statusCode).toBe(404);
      expect((await event(mod)).statusCode).toBe(403);
      const created = await event(host);
      expect(created.statusCode).toBe(201);
      await event(host, { title: 'Plus tard', startsAt: inHours(30) });

      const list = (await app.inject({ method: 'GET', url: '/api/events' })).json().events as { title: string; host: string }[];
      expect(list.map((e) => e.title)).toEqual(['Chasse aux objets', 'Plus tard']);
      expect(list[0]).toMatchObject({ host: 'rl_ev_host', place: 'Le hall', status: 'planned' });
    });

    it('refuses what is not a proper event', async () => {
      const host = await signUp('rl_ev_bad', 'animateur');
      for (const bad of [{ title: '' }, { description: '' }, { place: '' }, { title: 'x'.repeat(81) }, { startsAt: 'demain' }, { startsAt: inHours(-5) }, { host: 'x' }]) {
        expect((await event(host, bad)).statusCode, JSON.stringify(bad)).toBe(400);
      }
    });

    it('is closed by its host or a gérant, counts for its host once held, and ends up in the ranking', async () => {
      const host = await signUp('rl_ev_one', 'animateur');
      const rival = await signUp('rl_ev_two', 'animateur');
      const boss = await signUp('rl_ev_boss', 'gerant');
      const first = (await event(host)).json().id as number;
      const second = (await event(host, { title: 'Deuxième' })).json().id as number;
      const third = (await event(host, { title: 'Troisième' })).json().id as number;

      expect((await send('PUT', rival, `/api/staff/events/${first}`, { status: 'done' })).statusCode).toBe(403);
      expect((await send('PUT', host, `/api/staff/events/${first}`, { status: 'done' })).statusCode).toBe(200);
      expect((await send('PUT', boss, `/api/staff/events/${second}`, { status: 'done' })).statusCode).toBe(200);
      expect((await send('PUT', host, `/api/staff/events/${third}`, { status: 'cancelled' })).statusCode).toBe(200);
      // Already closed.
      expect((await send('PUT', host, `/api/staff/events/${first}`, { status: 'cancelled' })).statusCode).toBe(409);
      expect((await send('PUT', host, `/api/staff/events/${first}`, { status: 'maybe' })).statusCode).toBe(400);
      expect((await send('PUT', host, '/api/staff/events/999999', { status: 'done' })).statusCode).toBe(404);

      const upcoming = (await app.inject({ method: 'GET', url: '/api/events' })).json().events as { id: number }[];
      expect(upcoming.some((e) => [first, second, third].includes(e.id))).toBe(false);
      const ranking = (await get(host, '/api/staff/events')).json().ranking as { nickname: string; events: number }[];
      expect(ranking.find((r) => r.nickname === 'rl_ev_one')).toEqual({ nickname: 'rl_ev_one', events: 2 });
      expect(ranking.some((r) => r.nickname === 'rl_ev_two')).toBe(false);
    });
  });

  describe('on the website', () => {
    it('shows the team by role, the events, and the role on a profile', async () => {
      const top = await signUp('rl_site_top', 'administrateur');
      const host = await signUp('rl_site_host', 'animateur');
      await send('POST', host, '/api/staff/events', { title: 'Concours de déco', description: 'Décore ton appart au thème « espace ».', startsAt: new Date(Date.now() + 7_200_000).toISOString(), place: 'Chez rl_site_host' });

      const team = (await app.inject({ method: 'GET', url: '/site/equipe' })).body;
      expect(team).toContain('Administrateur');
      expect(team).toContain('Animateur');
      expect(team).toContain('rl_site_top');
      // Roles are listed from the top.
      expect(team.indexOf('Administrateur')).toBeLessThan(team.indexOf('Animateur'));

      const page = (await app.inject({ method: 'GET', url: '/site/evenements' })).body;
      expect(page).toContain('Concours de déco');
      expect(page).toContain('Chez rl_site_host');
      expect((await app.inject({ method: 'GET', url: '/site' })).body).toContain('Concours de déco');
      expect((await app.inject({ method: 'GET', url: '/site/joueur/rl_site_host' })).body).toContain('>Animateur<');
      void top;
    });
  });
});
