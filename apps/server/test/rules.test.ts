import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import { EffectBudget, conditionsHold, triggerMatches } from '../src/rules/engine';
import { MAX_CONDITIONS, MAX_EFFECTS, MAX_RULES, rulesBodySchema, type Rule } from '../src/rules/schema';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

const PIECE = '11111111-1111-4111-8111-111111111111';
const rule = (extra: Partial<Rule> = {}): Rule => ({
  enabled: true,
  trigger: { type: 'enter' },
  conditions: [],
  effects: [{ type: 'dance' }],
  ...extra,
});
const parse = (rules: unknown[]) => rulesBodySchema.safeParse({ rules });

describe('mechanisms: what a rule may be', () => {
  it('accepts every kind of trigger, condition and effect', () => {
    const ok = parse([
      rule({ trigger: { type: 'enter' } }),
      rule({ trigger: { type: 'step', cell: { i: 3, j: 3 } } }),
      rule({ trigger: { type: 'use', cell: { i: 0, j: 7 } } }),
      rule({ trigger: { type: 'say', word: 'Abracadabra' } }),
      rule({ trigger: { type: 'every', seconds: 5 } }),
      rule({
        conditions: [{ type: 'players', op: '>=', n: 2 }, { type: 'lit', piece: PIECE, on: false }, { type: 'on-cell', cell: { i: 1, j: 1 } }],
        effects: [{ type: 'light', piece: PIECE, mode: 'toggle' }, { type: 'teleport', cell: { i: 7, j: 7 } }, { type: 'message', text: 'Bienvenue !' }, { type: 'dance' }],
      }),
    ]);
    expect(ok.success).toBe(true);
    // A word is kept in lower case.
    if (ok.success) expect(ok.data.rules[3]!.trigger).toEqual({ type: 'say', word: 'abracadabra' });
  });

  it('refuses anything that is not on the list, however it is dressed up', () => {
    const bad: [string, unknown][] = [
      ['an unknown trigger', rule({ trigger: { type: 'explode' } as never })],
      ['an unknown effect', rule({ effects: [{ type: 'give-pixels', amount: 1000 } as never] })],
      ['an extra field on a rule', { ...rule(), owner: 'x' }],
      ['an extra field on an effect', rule({ effects: [{ type: 'dance', times: 99 } as never] })],
      ['a cell outside the room', rule({ trigger: { type: 'step', cell: { i: 16, j: 0 } } })],
      ['a cell that is not whole', rule({ trigger: { type: 'step', cell: { i: 1.5, j: 0 } } })],
      ['a periodic rule that is too quick', rule({ trigger: { type: 'every', seconds: 4 } })],
      ['a periodic rule that is too slow', rule({ trigger: { type: 'every', seconds: 3601 } })],
      ['a one-letter word', rule({ trigger: { type: 'say', word: 'a' } })],
      ['a long word', rule({ trigger: { type: 'say', word: 'x'.repeat(21) } })],
      ['an empty message', rule({ effects: [{ type: 'message', text: '   ' }] })],
      ['a long message', rule({ effects: [{ type: 'message', text: 'x'.repeat(81) }] })],
      ['a message with a link', rule({ effects: [{ type: 'message', text: 'va sur exemple.com' }] })],
      ['a message with a number', rule({ effects: [{ type: 'message', text: 'appelle le 06 12 34 56 78' }] })],
      ['a message with an insult', rule({ effects: [{ type: 'message', text: 'espèce de connard' }] })],
      ['a piece that is not an id', rule({ effects: [{ type: 'light', piece: 'lampe', mode: 'on' }] })],
      ['no effect at all', rule({ effects: [] })],
      [`more than ${MAX_EFFECTS} effects`, rule({ effects: Array.from({ length: MAX_EFFECTS + 1 }, () => ({ type: 'dance' as const })) })],
      [`more than ${MAX_CONDITIONS} conditions`, rule({ conditions: Array.from({ length: MAX_CONDITIONS + 1 }, () => ({ type: 'players' as const, op: '>=' as const, n: 1 })) })],
      ['a bad comparison', rule({ conditions: [{ type: 'players', op: '=' as never, n: 1 }] })],
    ];
    for (const [what, r] of bad) expect(parse([r]).success, what).toBe(false);
    expect(parse(Array.from({ length: MAX_RULES + 1 }, () => rule())).success).toBe(false);
    expect(parse(Array.from({ length: MAX_RULES }, () => rule())).success).toBe(true);
    expect(rulesBodySchema.safeParse({ rules: [], extra: 1 }).success).toBe(false);
  });
});

describe('mechanisms: what sets a rule off', () => {
  const cell = { i: 3, j: 3 };
  it('matches the right event only', () => {
    expect(triggerMatches({ type: 'enter' }, { type: 'enter', who: 'a' })).toBe(true);
    expect(triggerMatches({ type: 'enter' }, { type: 'step', who: 'a', cell })).toBe(false);
    expect(triggerMatches({ type: 'step', cell }, { type: 'step', who: 'a', cell: { i: 3, j: 3 } })).toBe(true);
    expect(triggerMatches({ type: 'step', cell }, { type: 'step', who: 'a', cell: { i: 3, j: 4 } })).toBe(false);
    expect(triggerMatches({ type: 'step', cell }, { type: 'use', who: 'a', cell })).toBe(false);
    expect(triggerMatches({ type: 'use', cell }, { type: 'use', who: 'a', cell })).toBe(true);
    expect(triggerMatches({ type: 'every', seconds: 5 }, { type: 'every', rule: 0 })).toBe(true);
  });

  it('hears a word the way people write it: any case, any accent, as a whole word', () => {
    const say = (word: string, text: string) => triggerMatches({ type: 'say', word }, { type: 'say', who: 'a', text });
    expect(say('bonjour', 'BONJOUR tout le monde')).toBe(true);
    expect(say('abracadabra', 'dis abracadabra !')).toBe(true);
    expect(say('ete', 'quel été!')).toBe(true);
    expect(say('ouvre toi', 'allez, ouvre-toi')).toBe(true);
    expect(say('bonjour', 'bonjours')).toBe(false);
    expect(say('jour', 'bonjour')).toBe(false);
    expect(say('bonjour', 'salut')).toBe(false);
  });

  it('checks conditions on what the room says, and reads a lamp only when asked', async () => {
    let reads = 0;
    const situation = { playerCount: 2, whoCell: { i: 1, j: 1 }, isLit: async (p: string) => (reads++, p === PIECE ? true : undefined) };
    expect(await conditionsHold([], situation)).toBe(true);
    expect(await conditionsHold([{ type: 'players', op: '>=', n: 2 }], situation)).toBe(true);
    expect(await conditionsHold([{ type: 'players', op: '>=', n: 3 }], situation)).toBe(false);
    expect(await conditionsHold([{ type: 'players', op: '<=', n: 1 }], situation)).toBe(false);
    expect(reads).toBe(0);
    expect(await conditionsHold([{ type: 'on-cell', cell: { i: 1, j: 1 } }], situation)).toBe(true);
    expect(await conditionsHold([{ type: 'on-cell', cell: { i: 2, j: 1 } }], situation)).toBe(false);
    expect(await conditionsHold([{ type: 'on-cell', cell: { i: 1, j: 1 } }], { ...situation, whoCell: null })).toBe(false);
    expect(await conditionsHold([{ type: 'lit', piece: PIECE, on: true }], situation)).toBe(true);
    expect(await conditionsHold([{ type: 'lit', piece: PIECE, on: false }], situation)).toBe(false);
    // A lamp that is not there is neither lit nor out.
    expect(await conditionsHold([{ type: 'lit', piece: '22222222-2222-4222-8222-222222222222', on: false }], situation)).toBe(false);
    // The first condition that fails ends the check.
    reads = 0;
    expect(await conditionsHold([{ type: 'players', op: '>=', n: 9 }, { type: 'lit', piece: PIECE, on: true }], situation)).toBe(false);
    expect(reads).toBe(0);
  });

  it('keeps a room from doing more than its budget of effects a second', () => {
    const budget = new EffectBudget(10, 1000);
    expect(budget.take(4, 0)).toBe(true);
    expect(budget.take(4, 100)).toBe(true);
    // Not even part of a rule: all of its effects or none.
    expect(budget.take(4, 200)).toBe(false);
    expect(budget.take(2, 300)).toBe(true);
    expect(budget.take(1, 400)).toBe(false);
    // A second later the room is calm again.
    expect(budget.take(10, 1500)).toBe(true);
  });
});

describe.skipIf(!available)('mechanisms: the owner’s rules (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  const notified: [string, string][] = [];

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    await pool.query('INSERT INTO apartments (id, floor, slot) SELECT n, 10 + n, 0 FROM generate_series(31, 70) AS n');
    app = buildServer({ pool, model: null, notifyApartment: (owner, kind) => void notified.push([owner, kind]) });
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
  const as = (a: Account) => ({ coloxel_sid: a.sid });
  const save = (a: Account, rules: unknown) => app.inject({ method: 'PUT', url: '/api/apartment/rules', payload: { rules } as object, cookies: as(a) });
  const read = async (a: Account) => (await app.inject({ method: 'GET', url: '/api/apartment/rules', cookies: as(a) })).json();
  const pieceOf = async (a: Account, key: string) =>
    (await pool.query<{ id: string }>('SELECT id FROM furniture WHERE owner_id = $1 AND catalogue_key = $2', [a.id, key])).rows[0]!.id;

  it('requires a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/apartment/rules' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/apartment/rules', payload: { rules: [] } })).statusCode).toBe(401);
  });

  it('keeps the rules in order, replaces them as a whole, and tells the apartment’s room', async () => {
    const owner = await signUp('ru_owner');
    expect((await read(owner)).rules).toEqual([]);
    const lamp = await pieceOf(owner, 'lampadaire');
    const first = rule({ trigger: { type: 'step', cell: { i: 3, j: 3 } }, effects: [{ type: 'light', piece: lamp, mode: 'toggle' }] });
    const second = rule({ trigger: { type: 'say', word: 'Salut' }, effects: [{ type: 'message', text: 'Coucou toi' }], enabled: false });
    notified.length = 0;
    const res = await save(owner, [first, second]);
    expect(res.statusCode).toBe(200);
    expect(notified).toContainEqual([owner.id, 'rules']);
    expect((await read(owner)).rules).toEqual([first, { ...second, trigger: { type: 'say', word: 'salut' } }]);
    // Saving again replaces everything, and an empty list clears it.
    expect((await save(owner, [second])).statusCode).toBe(200);
    expect((await read(owner)).rules).toHaveLength(1);
    expect((await save(owner, [])).statusCode).toBe(200);
    expect((await read(owner)).rules).toEqual([]);
  });

  it('only ever touches the apartment of the player of the session', async () => {
    const a = await signUp('ru_a');
    const b = await signUp('ru_b');
    await save(a, [rule()]);
    expect((await read(b)).rules).toEqual([]);
    // Naming somebody else's apartment is not even a valid request.
    const res = await app.inject({ method: 'PUT', url: '/api/apartment/rules', payload: { rules: [], owner: a.id }, cookies: as(b) });
    expect(res.statusCode).toBe(400);
    await save(b, []);
    expect((await read(a)).rules).toHaveLength(1);
  });

  it('refuses a rule about furniture that is not the owner’s, or does not light up', async () => {
    const a = await signUp('ru_pieces_a');
    const b = await signUp('ru_pieces_b');
    const theirs = await pieceOf(b, 'lampadaire');
    const mine = await pieceOf(a, 'lampadaire');
    const plant = await pieceOf(a, 'monstera');
    const stranger = await save(a, [rule({ effects: [{ type: 'light', piece: theirs, mode: 'on' }] })]);
    expect(stranger.statusCode).toBe(400);
    expect(stranger.json().error).toMatch(/pas à toi/);
    const unknown = await save(a, [rule({ conditions: [{ type: 'lit', piece: PIECE, on: true }] })]);
    expect(unknown.statusCode).toBe(400);
    const dark = await save(a, [rule({ effects: [{ type: 'light', piece: plant, mode: 'on' }] })]);
    expect(dark.statusCode).toBe(400);
    expect(dark.json().error).toMatch(/ne s’allume pas/);
    expect((await save(a, [rule({ effects: [{ type: 'light', piece: mine, mode: 'on' }] })])).statusCode).toBe(200);
  });

  it('reports what is wrong with a rule in words', async () => {
    const a = await signUp('ru_words');
    const filtered = await save(a, [rule({ effects: [{ type: 'message', text: 'écris à jean@gmail.com' }] })]);
    expect(filtered.statusCode).toBe(400);
    expect(filtered.json().error).toMatch(/pas autorisé/);
    expect((await save(a, [rule({ trigger: { type: 'every', seconds: 2 } })])).json().error).toMatch(/5 secondes/);
    expect((await save(a, 'nope')).statusCode).toBe(400);
    expect((await read(a)).rules).toEqual([]);
  });
});
