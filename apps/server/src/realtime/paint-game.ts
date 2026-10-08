import { N } from '@coloxel/world';

/**
 * "Course des couleurs": two teams, one minute, everybody paints the floor tiles they walk on in their team's
 * colour, the team with the most tiles when the time is up wins. Nothing is staked or won: no Pixels, no object
 * (rule 6 of the project). The server runs the game; clients only draw what they are told.
 */
export type Team = 0 | 1;
export const TEAM_NAMES = ['Rouge', 'Bleu'] as const;

export const GAME_MS = 60_000;
/** Time between two games in the same room, so the board is not a way to spam the room. */
export const COOLDOWN_MS = 15_000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;

export interface GameIO {
  broadcast(type: string, data: unknown): void;
  sendTo(id: string, type: string, data: unknown): void;
}

export interface GameResult {
  scores: [number, number];
  /** 0 or 1, or null for a draw. */
  winner: Team | null;
}

export type StartResult = { ok: true } | { ok: false; message: string };

export class PaintGame {
  private running = false;
  private endsAt = 0;
  private nextAllowed = 0;
  private teams = new Map<string, Team>();
  /** Cell index (i * N + j) -> team that painted it. */
  private cells = new Map<number, Team>();

  constructor(private readonly io: GameIO) {}

  get isRunning(): boolean {
    return this.running;
  }

  teamOf(id: string): Team | undefined {
    return this.teams.get(id);
  }

  private scores(): [number, number] {
    const s: [number, number] = [0, 0];
    for (const t of this.cells.values()) s[t]++;
    return s;
  }

  /** Teams alternate in the order the players are given: the same room always splits the same way. */
  start(players: readonly string[], now: number): StartResult {
    if (this.running) return { ok: false, message: 'Une partie est déjà en cours.' };
    if (now < this.nextAllowed) return { ok: false, message: 'Laisse souffler la salle : une nouvelle partie dans quelques secondes.' };
    if (players.length < MIN_PLAYERS) return { ok: false, message: `Il faut au moins ${MIN_PLAYERS} joueurs dans la salle.` };
    if (players.length > MAX_PLAYERS) return { ok: false, message: `Trop de monde pour jouer : ${MAX_PLAYERS} joueurs au plus.` };
    this.teams.clear();
    this.cells.clear();
    players.forEach((id, k) => this.teams.set(id, (k % 2) as Team));
    this.running = true;
    this.endsAt = now + GAME_MS;
    this.io.broadcast('game', this.snapshot());
    return { ok: true };
  }

  /** What a client needs to draw the game: who is on which team, how long is left, which tiles are painted. */
  snapshot(): { running: boolean; endsAt: number; teams: Record<string, Team>; cells: [number, number, Team][] } {
    return {
      running: this.running,
      endsAt: this.endsAt,
      teams: Object.fromEntries(this.teams),
      cells: [...this.cells].map(([k, t]) => [Math.floor(k / N), k % N, t] as [number, number, Team]),
    };
  }

  /** A player stepped on a tile. Only players of the game paint, and only a tile that changes colour is told. */
  step(id: string, cell: { i: number; j: number }): void {
    if (!this.running) return;
    const team = this.teams.get(id);
    if (team === undefined) return;
    const key = cell.i * N + cell.j;
    if (this.cells.get(key) === team) return;
    this.cells.set(key, team);
    this.io.broadcast('game-paint', { i: cell.i, j: cell.j, team });
  }

  /** A player left the room. If a team has nobody left, the game is over. */
  leave(id: string, now: number): GameResult | null {
    if (!this.teams.delete(id)) return null;
    if (!this.running) return null;
    const left: [number, number] = [0, 0];
    for (const t of this.teams.values()) left[t]++;
    return left[0] === 0 || left[1] === 0 ? this.finish(now) : null;
  }

  /** Called regularly: ends the game when the time is up. */
  tick(now: number): GameResult | null {
    return this.running && now >= this.endsAt ? this.finish(now) : null;
  }

  private finish(now: number): GameResult {
    const scores = this.scores();
    const winner: Team | null = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
    this.running = false;
    this.nextAllowed = now + COOLDOWN_MS;
    const result: GameResult = { scores, winner };
    this.io.broadcast('game-end', { ...result, teams: Object.fromEntries(this.teams) });
    return result;
  }
}
