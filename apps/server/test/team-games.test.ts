import { describe, expect, it } from 'vitest';
import { N } from '@coloxel/world';
import { FreezeGame, KEEPER, RUNNER, SOCCER_MS, FREEZE_MS, SoccerGame, type Cell, type SoccerSetup } from '../src/realtime/team-games';

const world = () => {
  const sent: { type: string; data: any }[] = [];
  const pos = new Map<string, Cell>();
  const held = new Set<string>();
  const blocked = new Set<number>();
  const io = {
    broadcast: (type: string, data: unknown) => sent.push({ type, data }),
    sendTo: () => {},
    at: (id: string) => pos.get(id),
    hold: (id: string, on: boolean) => (on ? held.add(id) : held.delete(id)),
    blocked: () => blocked,
  };
  return { io, sent, pos, held, blocked };
};
const key = (i: number, j: number) => i * N + j;

describe('FreezeGame', () => {
  const setup = () => {
    const w = world();
    // The first player is always the keeper.
    const game = new FreezeGame(w.io, () => 0);
    w.pos.set('k', { i: 0, j: 0 });
    w.pos.set('a', { i: 5, j: 5 });
    w.pos.set('b', { i: 5, j: 1 });
    return { ...w, game };
  };

  it('needs three players, and picks one keeper for every four', () => {
    const { game } = setup();
    expect(game.start(['k', 'a'], 0)).toMatchObject({ ok: false });
    expect(game.start(['k', 'a', 'b'], 0)).toEqual({ ok: true });
    expect([game.teamOf('k'), game.teamOf('a'), game.teamOf('b')]).toEqual([KEEPER, RUNNER, RUNNER]);
    const many = setup();
    many.game.start(Array.from({ length: 9 }, (_, k) => `p${k}`), 0);
    expect(Array.from({ length: 9 }, (_, k) => many.game.teamOf(`p${k}`)).filter((t) => t === KEEPER)).toHaveLength(3);
  });

  it('freezes a runner a keeper touches, holds them, and frees them when another runner comes up', () => {
    const { game, pos, held, sent } = setup();
    game.start(['k', 'a', 'b'], 0);
    // The keeper walks next to a.
    pos.set('k', { i: 4, j: 5 });
    game.step('k', { i: 4, j: 5 });
    expect(game.isFrozen('a')).toBe(true);
    expect(held.has('a')).toBe(true);
    expect(sent.some((m) => m.type === 'game-freeze' && m.data.id === 'a' && m.data.frozen)).toBe(true);
    // A frozen player does not freeze or free anybody.
    game.step('a', { i: 5, j: 5 });
    // b is away: nothing yet. Then b comes up to a.
    pos.set('b', { i: 5, j: 4 });
    game.step('b', { i: 5, j: 4 });
    expect(game.isFrozen('a')).toBe(false);
    expect(held.has('a')).toBe(false);
  });

  it('ends in favour of the keepers when every runner is frozen, and of the runners when time is up', () => {
    const one = setup();
    one.game.start(['k', 'a', 'b'], 0);
    one.pos.set('k', { i: 5, j: 2 }); // next to b (5,1) but not a
    one.game.step('k', { i: 5, j: 2 });
    expect(one.game.isRunning).toBe(true);
    one.pos.set('k', { i: 5, j: 4 }); // next to a (5,5)
    one.game.step('k', { i: 5, j: 4 });
    expect(one.game.isRunning).toBe(false);
    expect(one.sent.at(-1)).toMatchObject({ type: 'game-end', data: { winner: KEEPER } });
    expect(one.held.size).toBe(0);

    const two = setup();
    two.game.start(['k', 'a', 'b'], 0);
    two.game.tick(FREEZE_MS - 1);
    expect(two.game.isRunning).toBe(true);
    two.game.tick(FREEZE_MS);
    expect(two.sent.at(-1)).toMatchObject({ type: 'game-end', data: { winner: RUNNER } });
  });

  it('ends when a side has nobody left, and lets nobody stay held', () => {
    const { game, held, pos } = setup();
    game.start(['k', 'a', 'b'], 0);
    pos.set('k', { i: 4, j: 5 });
    game.step('k', { i: 4, j: 5 });
    expect(held.has('a')).toBe(true);
    game.leave('k', 10);
    expect(game.isRunning).toBe(false);
    expect(held.size).toBe(0);
  });
});

describe('SoccerGame', () => {
  const goals = new Map<number, 0 | 1>([[key(0, 3), 0], [key(7, 3), 1]]);
  const setupSoccer = (): { setup: SoccerSetup } & ReturnType<typeof world> & { game: SoccerGame } => {
    const w = world();
    const game = new SoccerGame(w.io);
    w.pos.set('a', { i: 3, j: 2 });
    w.pos.set('b', { i: 5, j: 5 });
    return { ...w, game, setup: { goals, kickoff: { i: 3, j: 3 } } };
  };

  it('needs both goals and two players, and puts the ball on the kick-off tile', () => {
    const { game, setup, sent } = setupSoccer();
    expect(game.start(['a'], 0, setup)).toMatchObject({ ok: false });
    expect(game.start(['a', 'b'], 0, { ...setup, goals: new Map([[key(0, 3), 0]]) })).toMatchObject({ ok: false });
    expect(game.start(['a', 'b'], 0, setup)).toEqual({ ok: true });
    expect(sent.at(-1)!.data).toMatchObject({ kind: 'soccer', ball: { i: 3, j: 3 }, scores: [0, 0] });
  });

  it('pushes the ball three tiles the way the player was walking, and stops it at an obstacle', () => {
    const { game, setup, sent, blocked } = setupSoccer();
    game.start(['a', 'b'], 0, setup);
    // a walks from (3,2) onto the ball at (3,3): pushed along +j to (3,6).
    game.step('a', { i: 3, j: 3 });
    expect(sent.at(-1)).toMatchObject({ type: 'game-ball', data: { i: 3, j: 6 } });
    // Walking onto a tile that is not the ball does nothing.
    const count = sent.length;
    game.step('a', { i: 3, j: 4 });
    expect(sent).toHaveLength(count);
    // a walks onto the ball again (now at 3,6) from (3,5), with a wall at (3,7)-> it does not move.
    blocked.add(key(3, 7));
    game.step('a', { i: 3, j: 5 });
    game.step('a', { i: 3, j: 6 });
    expect(sent.at(-1)).toMatchObject({ type: 'game-ball', data: { i: 3, j: 6 } });
  });

  it('scores for the team opposite the goal, puts the ball back, and names the winner at the end', () => {
    const { game, setup, sent, pos } = setupSoccer();
    game.start(['a', 'b'], 0, setup);
    // a is red (team 0): red scores in the blue goal (team 1) at (7,3). The ball is at (3,3): walk along +i from (2,3).
    pos.set('a', { i: 2, j: 3 });
    game.step('a', { i: 2, j: 3 });
    game.step('a', { i: 3, j: 3 });
    // Ball goes (4,3), (5,3), (6,3): three tiles, no goal yet. Walk it again.
    expect(sent.at(-1)).toMatchObject({ type: 'game-ball', data: { i: 6, j: 3 } });
    game.step('a', { i: 5, j: 3 });
    game.step('a', { i: 6, j: 3 });
    expect(sent.at(-1)).toMatchObject({ type: 'game-goal', data: { team: 0, scores: [1, 0], ball: { i: 3, j: 3 } } });
    game.tick(SOCCER_MS);
    expect(sent.at(-1)).toMatchObject({ type: 'game-end', data: { winner: 0, scores: [1, 0] } });
    expect(game.isRunning).toBe(false);
  });

  it('ends in a draw at the same score, and when one team has left', () => {
    const a = setupSoccer();
    a.game.start(['a', 'b'], 0, a.setup);
    a.game.tick(SOCCER_MS);
    expect(a.sent.at(-1)).toMatchObject({ type: 'game-end', data: { winner: null } });
    const b = setupSoccer();
    b.game.start(['a', 'b'], 0, b.setup);
    b.game.leave('b', 5);
    expect(b.game.isRunning).toBe(false);
  });
});
