import { describe, expect, it } from 'vitest';
import { COOLDOWN_MS, GAME_MS, MAX_PLAYERS, PaintGame } from '../src/realtime/paint-game';

const make = () => {
  const sent: { type: string; data: any }[] = [];
  const game = new PaintGame({
    broadcast: (type, data) => sent.push({ type, data }),
    sendTo: (id, type, data) => sent.push({ type: `${id}:${type}`, data }),
  });
  return { game, sent };
};

describe('PaintGame', () => {
  it('needs two players, at most twelve, and refuses a second game while one runs', () => {
    const { game } = make();
    expect(game.start(['a'], 0)).toMatchObject({ ok: false });
    expect(game.start(Array.from({ length: MAX_PLAYERS + 1 }, (_, k) => `p${k}`), 0)).toMatchObject({ ok: false });
    expect(game.start(['a', 'b'], 0)).toEqual({ ok: true });
    expect(game.start(['a', 'b'], 1)).toMatchObject({ ok: false });
  });

  it('splits the players into two teams in order', () => {
    const { game } = make();
    game.start(['a', 'b', 'c'], 0);
    expect([game.teamOf('a'), game.teamOf('b'), game.teamOf('c')]).toEqual([0, 1, 0]);
  });

  it('paints a tile for the team of whoever steps on it, and says it only when the tile changes', () => {
    const { game, sent } = make();
    game.start(['a', 'b'], 0);
    sent.length = 0;
    game.step('a', { i: 2, j: 3 });
    game.step('a', { i: 2, j: 3 }); // already red
    game.step('b', { i: 2, j: 3 }); // taken over
    game.step('stranger', { i: 4, j: 4 }); // not playing
    expect(sent.map((m) => m.data)).toEqual([{ i: 2, j: 3, team: 0 }, { i: 2, j: 3, team: 1 }]);
    expect(game.snapshot().cells).toEqual([[2, 3, 1]]);
  });

  it('ends when the time is up and names the winner, or a draw', () => {
    const { game, sent } = make();
    game.start(['a', 'b'], 0);
    game.step('a', { i: 0, j: 0 });
    game.step('a', { i: 0, j: 1 });
    game.step('b', { i: 5, j: 5 });
    expect(game.tick(GAME_MS - 1)).toBeNull();
    expect(game.tick(GAME_MS)).toEqual({ scores: [2, 1], winner: 0 });
    expect(sent.at(-1)!.type).toBe('game-end');
    expect(game.isRunning).toBe(false);

    const again = make();
    again.game.start(['a', 'b'], 0);
    again.game.step('a', { i: 0, j: 0 });
    again.game.step('b', { i: 1, j: 1 });
    expect(again.game.tick(GAME_MS)).toEqual({ scores: [1, 1], winner: null });
  });

  it('makes the room wait a little between two games', () => {
    const { game } = make();
    game.start(['a', 'b'], 0);
    game.tick(GAME_MS);
    expect(game.start(['a', 'b'], GAME_MS + 1)).toMatchObject({ ok: false });
    expect(game.start(['a', 'b'], GAME_MS + COOLDOWN_MS)).toEqual({ ok: true });
  });

  it('ends the game when a whole team has left, and ignores a leaving spectator', () => {
    const { game } = make();
    game.start(['a', 'b', 'c'], 0);
    expect(game.leave('stranger', 5)).toBeNull();
    expect(game.leave('a', 5)).toBeNull(); // c is still red
    game.step('c', { i: 1, j: 1 });
    expect(game.leave('b', 6)).toMatchObject({ scores: [1, 0], winner: 0 });
    expect(game.isRunning).toBe(false);
  });
});
