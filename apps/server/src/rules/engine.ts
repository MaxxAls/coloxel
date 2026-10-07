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
  }
}

/** What conditions may look at, read lazily: a lamp's state is a database read. */
export interface Situation {
  playerCount: number;
  /** Where the player who set the rule off stands, if there is one (a periodic rule has none). */
  whoCell: CellRef | null;
  isLit(piece: string): Promise<boolean | undefined>;
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
