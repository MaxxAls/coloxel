import { N } from '@coloxel/world';
import { MAX_PLAYERS, MIN_PLAYERS, type GameIO, type StartResult, type Team } from './paint-game';

/**
 * Two more games for a room, in the same spirit as the colour race (paint-game.ts): the server runs them, clients draw
 * what they are told, nothing is staked or won (rule 6).
 *
 * - Statues: a few keepers chase the runners. A runner a keeper touches is frozen on the spot; a free runner who
 *   walks up to a frozen one sets them free. Keepers win if every runner is frozen at once, runners win if the
 *   time is up first.
 * - Football: a ball on the floor. Walking onto it pushes it up to three tiles the way you were going. Put it in the
 *   goal of the other team to score.
 */
export interface Cell {
  i: number;
  j: number;
}

export interface TeamGameIO extends GameIO {
  /** Where a player is now. */
  at(id: string): Cell | undefined;
  /** Hold a player still (or let go) for the length of a game, without any message of the staff freeze. */
  hold(id: string, held: boolean): void;
  /** Tiles nobody can stand on (no floor, furniture): the ball does not go through them. */
  blocked(): ReadonlySet<number>;
}

const near = (a: Cell, b: Cell) => Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j)) <= 1;
const key = (c: Cell) => c.i * N + c.j;

abstract class TeamGame {
  protected running = false;
  protected endsAt = 0;
  private nextAllowed = 0;
  protected teams = new Map<string, Team>();

  constructor(protected readonly io: TeamGameIO, private readonly lengthMs: number, private readonly cooldownMs: number) {}

  get isRunning(): boolean {
    return this.running;
  }
  teamOf(id: string): Team | undefined {
    return this.teams.get(id);
  }

  /** Common checks. Returns a refusal to tell the player, or null when a game may start. */
  protected gate(players: readonly string[], now: number, min: number): string | null {
    if (this.running) return 'Une partie est déjà en cours.';
    if (now < this.nextAllowed) return 'Laisse souffler la salle : une nouvelle partie dans quelques secondes.';
    if (players.length < min) return `Il faut au moins ${min} joueurs dans la salle.`;
    if (players.length > MAX_PLAYERS) return `Trop de monde pour jouer : ${MAX_PLAYERS} joueurs au plus.`;
    return null;
  }

  protected begin(now: number) {
    this.running = true;
    this.endsAt = now + this.lengthMs;
  }

  protected over(now: number) {
    this.running = false;
    this.nextAllowed = now + this.cooldownMs;
    for (const id of this.teams.keys()) this.io.hold(id, false);
  }

  abstract snapshot(): Record<string, unknown>;
  abstract step(id: string, cell: Cell): void;
  abstract tick(now: number): void;
  abstract leave(id: string, now: number): void;
}

// ----- Statues ------------------------------------------------------------------------------------------------

export const FREEZE_MS = 75_000;
export const FREEZE_MIN_PLAYERS = 3;
/** Keepers are team 0, runners team 1. */
export const KEEPER: Team = 0;
export const RUNNER: Team = 1;

export class FreezeGame extends TeamGame {
  private frozen = new Set<string>();

  constructor(io: TeamGameIO, private readonly pick: (n: number) => number = (n) => Math.floor(Math.random() * n)) {
    super(io, FREEZE_MS, 15_000);
  }

  isFrozen(id: string): boolean {
    return this.frozen.has(id);
  }

  start(players: readonly string[], now: number): StartResult {
    const refusal = this.gate(players, now, FREEZE_MIN_PLAYERS);
    if (refusal) return { ok: false, message: refusal };
    // One keeper for every four players, picked at random.
    const pool = [...players];
    const keepers = new Set<string>();
    for (let k = 0; k < Math.ceil(players.length / 4); k++) keepers.add(pool.splice(this.pick(pool.length), 1)[0]!);
    this.teams.clear();
    this.frozen.clear();
    for (const id of players) this.teams.set(id, keepers.has(id) ? KEEPER : RUNNER);
    this.begin(now);
    this.io.broadcast('game', this.snapshot());
    return { ok: true };
  }

  snapshot() {
    return { kind: 'freeze', running: this.running, endsAt: this.endsAt, teams: Object.fromEntries(this.teams), frozen: [...this.frozen], cells: [] };
  }

  private runners(): string[] {
    return [...this.teams].filter(([, t]) => t === RUNNER).map(([id]) => id);
  }

  step(id: string, cell: Cell): void {
    if (!this.running) return;
    const team = this.teams.get(id);
    if (team === undefined || this.frozen.has(id)) return;
    for (const other of this.runners()) {
      const there = this.io.at(other);
      if (!there || other === id || !near(cell, there)) continue;
      if (team === KEEPER && !this.frozen.has(other)) {
        this.frozen.add(other);
        this.io.hold(other, true);
        this.io.broadcast('game-freeze', { id: other, frozen: true });
      } else if (team === RUNNER && this.frozen.has(other)) {
        this.frozen.delete(other);
        this.io.hold(other, false);
        this.io.broadcast('game-freeze', { id: other, frozen: false });
      }
    }
    if (this.runners().length > 0 && this.runners().every((r) => this.frozen.has(r))) this.finish(Date.now(), KEEPER);
  }

  tick(now: number): void {
    if (this.running && now >= this.endsAt) this.finish(now, RUNNER);
  }

  leave(id: string, now: number): void {
    if (!this.teams.delete(id)) return;
    this.frozen.delete(id);
    if (!this.running) return;
    const left: [number, number] = [0, 0];
    for (const t of this.teams.values()) left[t]++;
    // No keeper left: the runners have won. No runner left: the keepers have.
    if (left[KEEPER] === 0) this.finish(now, RUNNER);
    else if (left[RUNNER] === 0) this.finish(now, KEEPER);
  }

  private finish(now: number, winner: Team) {
    this.io.broadcast('game-end', { kind: 'freeze', winner, scores: [this.frozen.size, this.runners().length - this.frozen.size], teams: Object.fromEntries(this.teams) });
    this.over(now);
    this.frozen.clear();
  }
}

// ----- Football -----------------------------------------------------------------------------------------------

export const SOCCER_MS = 90_000;
export const KICK_TILES = 3;

export interface SoccerSetup {
  /** Tiles of each goal: a goal of team 0 is where team 1 scores. */
  goals: ReadonlyMap<number, Team>;
  /** Where the ball starts, and goes back after a goal. */
  kickoff: Cell;
}

export class SoccerGame extends TeamGame {
  private ball: Cell = { i: 0, j: 0 };
  private setup: SoccerSetup = { goals: new Map(), kickoff: { i: 0, j: 0 } };
  private last = new Map<string, Cell>();
  private scores: [number, number] = [0, 0];

  constructor(io: TeamGameIO) {
    super(io, SOCCER_MS, 15_000);
  }

  start(players: readonly string[], now: number, setup: SoccerSetup): StartResult {
    const refusal = this.gate(players, now, MIN_PLAYERS);
    if (refusal) return { ok: false, message: refusal };
    const owners = new Set(setup.goals.values());
    if (!owners.has(0) || !owners.has(1)) return { ok: false, message: 'Il faut un but rouge et un but bleu dans l’appart.' };
    this.setup = setup;
    this.ball = { ...setup.kickoff };
    this.scores = [0, 0];
    this.teams.clear();
    this.last.clear();
    players.forEach((id, k) => {
      this.teams.set(id, (k % 2) as Team);
      const at = this.io.at(id);
      if (at) this.last.set(id, at);
    });
    this.begin(now);
    this.io.broadcast('game', this.snapshot());
    return { ok: true };
  }

  snapshot() {
    return { kind: 'soccer', running: this.running, endsAt: this.endsAt, teams: Object.fromEntries(this.teams), ball: this.ball, scores: this.scores, cells: [] };
  }

  step(id: string, cell: Cell): void {
    if (!this.running || !this.teams.has(id)) return;
    const from = this.last.get(id);
    this.last.set(id, { ...cell });
    if (!from || cell.i !== this.ball.i || cell.j !== this.ball.j) return;
    // The player walked onto the ball: it goes on the way they were going.
    const di = Math.sign(cell.i - from.i), dj = Math.sign(cell.j - from.j);
    if (di === 0 && dj === 0) return;
    const blocked = this.io.blocked();
    let at = { ...this.ball };
    for (let k = 0; k < KICK_TILES; k++) {
      const next = { i: at.i + di, j: at.j + dj };
      if (next.i < 0 || next.j < 0 || next.i >= N || next.j >= N || blocked.has(key(next)) && !this.setup.goals.has(key(next))) break;
      at = next;
      const owner = this.setup.goals.get(key(at));
      if (owner !== undefined) return this.goal(id, (1 - owner) as Team, Date.now());
    }
    this.ball = at;
    this.io.broadcast('game-ball', { ...at, by: id });
  }

  private goal(by: string, team: Team, now: number) {
    this.scores[team]++;
    this.ball = { ...this.setup.kickoff };
    this.io.broadcast('game-goal', { team, by, scores: this.scores, ball: this.ball });
    void now;
  }

  tick(now: number): void {
    if (this.running && now >= this.endsAt) this.finish(now);
  }

  leave(id: string, now: number): void {
    if (!this.teams.delete(id)) return;
    this.last.delete(id);
    if (!this.running) return;
    const left: [number, number] = [0, 0];
    for (const t of this.teams.values()) left[t]++;
    if (left[0] === 0 || left[1] === 0) this.finish(now);
  }

  private finish(now: number) {
    const [a, b] = this.scores;
    this.io.broadcast('game-end', { kind: 'soccer', scores: this.scores, winner: a === b ? null : a > b ? 0 : 1, teams: Object.fromEntries(this.teams) });
    this.over(now);
  }
}
