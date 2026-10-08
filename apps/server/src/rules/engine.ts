import type { Condition, Trigger } from './schema';

export interface CellRef {
  i: number;
  j: number;
}

/** Something that happened in the apartment, as the room saw it. `who` is always the session's player, never a message's. */
export type GameEvent =
  | { type: 'enter'; who: string }
  | { type: 'step'; who: string; cell: CellRef }
  | { type: 'use'; who: string; cell: CellRef }
  | { type: 'say'; who: string; text: string }
  /** A player walked off a cell. */
  | { type: 'leave'; who: string; cell: CellRef }
  /** A score counter shows a new number (after a click of the owner, never after a rule). */
  | { type: 'score'; who: string; piece: string; value: number }
  /** The clock of the room: it says which rule's time has come. */
  | { type: 'every'; rule: number };

const flat = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Does what happened set this trigger off? (A periodic trigger is set off by the clock, which the room keeps.) */
export function triggerMatches(trigger: Trigger, event: GameEvent): boolean {
  switch (trigger.type) {
    case 'enter':
      return event.type === 'enter';
    case 'step':
      return event.type === 'step' && event.cell.i === trigger.cell.i && event.cell.j === trigger.cell.j;
    case 'use':
      return event.type === 'use' && event.cell.i === trigger.cell.i && event.cell.j === trigger.cell.j;
    case 'say': {
      if (event.type !== 'say') return false;
      const word = flat(trigger.word);
      return word.length > 0 && ` ${flat(event.text)} `.includes(` ${word} `);
    }
    case 'every':
      return event.type === 'every';
    case 'leave':
      return event.type === 'leave' && event.cell.i === trigger.cell.i && event.cell.j === trigger.cell.j;
    case 'score':
      return event.type === 'score' && event.piece === trigger.piece && event.value === trigger.n;
  }
}

/** The hour now in France, where the building is: what the "between these hours" condition reads. */
export function hourInFrance(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' }).formatToParts(now);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
}

/** Is `hour` within [from, to)? A span may go over midnight (22 to 6). from = to means all day. */
export function withinHours(hour: number, from: number, to: number): boolean {
  if (from === to) return true;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** What conditions may look at, read lazily: a lamp's state is a database read. */
export interface Situation {
  playerCount: number;
  /** Where the player who set the rule off stands, if there is one (a periodic rule has none). */
  whoCell: CellRef | null;
  isLit(piece: string): Promise<boolean | undefined>;
  /** Is somebody standing on this cell? */
  occupied(cell: CellRef): boolean;
  /** The hour now (0 to 23), in France. */
  hour: number;
}

export async function conditionsHold(conditions: readonly Condition[], situation: Situation): Promise<boolean> {
  for (const c of conditions) {
    switch (c.type) {
      case 'players':
        if (c.op === '>=' ? situation.playerCount < c.n : situation.playerCount > c.n) return false;
        break;
      case 'on-cell':
        if (!situation.whoCell || situation.whoCell.i !== c.cell.i || situation.whoCell.j !== c.cell.j) return false;
        break;
      case 'lit':
        // A lamp that is not there (taken back, thrown away) is neither lit nor out: the rule does not apply.
        if ((await situation.isLit(c.piece)) !== c.on) return false;
        break;
      case 'someone-on':
        if (!situation.occupied(c.cell)) return false;
        break;
      case 'hours':
        if (!withinHours(situation.hour, c.from, c.to)) return false;
        break;
    }
  }
  return true;
}

/** A room does at most this many effects in this many milliseconds, whatever its rules say. */
export const EFFECTS_PER_WINDOW = 10;
export const EFFECT_WINDOW_MS = 1000;

export class EffectBudget {
  private taken: number[] = [];

  constructor(
    private max = EFFECTS_PER_WINDOW,
    private windowMs = EFFECT_WINDOW_MS,
  ) {}

  /** Counts `n` effects, or refuses all of them when the room has done enough for now. */
  take(n: number, now = Date.now()): boolean {
    this.taken = this.taken.filter((t) => now - t < this.windowMs);
    if (this.taken.length + n > this.max) return false;
    for (let k = 0; k < n; k++) this.taken.push(now);
    return true;
  }
}
