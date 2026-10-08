import { Client, type Room } from '@colyseus/sdk';
import type { StaffAlert } from './alerts';
import type { FriendTarget } from './api';
import type { ChatMessage } from './chat-ui';

// The realtime server shares the session cookie with the API: the browser sends
// it with the join request, the server decides who we are. We only say where we
// want to go.
const url = import.meta.env.VITE_REALTIME_URL ?? `${location.protocol}//${location.hostname}:2567`;
const client = new Client(url);

/** The server sent us out because the owner closed the apartment. */
export const CLOSED_BY_OWNER = 4003;
/** The server sent us out because the account was suspended or banned. */
export const SUSPENDED = 4004;
/** The server sent us out because the owner showed us out. */
export const EXPELLED = 4005;
/** The server sent us out because a member of the staff showed us out of the room. */
export const KICKED = 4006;

export interface PlayerState {
  id: string;
  nickname: string;
  i: number;
  j: number;
  /** 0 standing, 1 sitting, 2 lying down. */
  pose: number;
  /** The player's look as JSON (parse with parseLook before use). */
  look: string;
  /** Active companion as "species:colour:name", or empty. */
  pet: string;
  /** 0 nothing, 1 dancing. */
  emote: number;
  /** What the player holds (see HAND_ITEMS in packages/render), 0 nothing. */
  hand: number;
  /** The way the body faces: the last step (di, dj) coded (di + 1) * 3 + (dj + 1); 4 before any step. */
  dir: number;
  /** The companion's mood: 0 happy, 1 fine, 2 sad. */
  petMood: number;
  /** Level of the companion, 0 without one. */
  petLevel: number;
}

/** What the server says about the team game of the room (colour race, statues, football). */
export interface GameSnapshot {
  /** Absent means the colour race. */
  kind?: 'paint' | 'freeze' | 'soccer';
  running: boolean;
  endsAt: number;
  /** Player id -> team (0 red, 1 blue; for the statues 0 keeper, 1 runner). */
  teams: Record<string, number>;
  /** Painted tiles: i, j, team (colour race). */
  cells: [number, number, number][];
  /** Frozen players (statues). */
  frozen?: string[];
  /** The ball and the score (football). */
  ball?: { i: number; j: number };
  scores?: [number, number];
}
export interface GameEnd {
  kind?: 'paint' | 'freeze' | 'soccer';
  scores: [number, number];
  winner: number | null;
  teams: Record<string, number>;
}
export interface GameHandlers {
  onStart(snapshot: GameSnapshot): void;
  onPaint(paint: { i: number; j: number; team: number }): void;
  onEnd(end: GameEnd): void;
  onFreeze(change: { id: string; frozen: boolean }): void;
  onBall(ball: { i: number; j: number }): void;
  onGoal(goal: { team: number; scores: [number, number]; ball: { i: number; j: number } }): void;
}

export interface BuildingRoom {
  /** The team game of the room: it starts, tiles get painted, it ends. */
  onGame(handlers: GameHandlers): void;
  /** The tune of the room changed (0 is silence); `elapsed` is how far into it we are. */
  onMusic(callback: (track: number, elapsed: number) => void): void;
  /** A companion shows off a trick (the owner typed /compagnon <tour>). */
  onPetTrick(callback: (owner: string, trick: string) => void): void;
  /** Every player in the room, with the position the server last decided. */
  players(): PlayerState[];
  /** "I click the button at (i, j)": the server checks there is one, and what it sets off. */
  use(i: number, j: number): void;
  /** A flash the server wants everybody to see on a cell (a rule just did something there). */
  onFx(callback: (fx: { i: number; j: number; color: number }) => void): void;
  /** A burst of confetti, thrown by a host. */
  onConfetti(callback: () => void): void;
  /** A toy of chance shows its result over its cell (a die's number, the wheel's colour, who the bottle points at). */
  onToy(callback: (toy: { i: number; j: number; text: string }) => void): void;
  /** Are the party lights on? Part of the room's state, so that whoever comes in later sees them. */
  lights(): boolean;
  /** An announcement of the staff. */
  onAlert(callback: (alert: StaffAlert) => void): void;
  /** A member of the staff asks us to come. */
  onSummon(callback: (from: string, target: FriendTarget) => void): void;
  /** The staff member who typed ":goto" is taken there. */
  onGoto(callback: (target: FriendTarget) => void): void;
  /** A message a rule of the apartment shows us. */
  onRuleMessage(callback: (text: string) => void): void;
  /** "I want to walk to (i, j)". The server computes the path. */
  moveTo(i: number, j: number): void;
  /** I changed what I wear or my companion: the server reads it again from its records. */
  refreshAppearance(): void;
  /** Calls back once when the server closes our connection, with the close code (kicked, replaced, shut down). */
  onClosed(callback: (code: number) => void): void;
  /** A message the server broadcasts to the room. */
  onMessage(type: string, callback: () => void): void;
  /** "I say this": the server filters, journals and shows it to the room. */
  say(text: string): void;
  /** A message that was let through (ours included). */
  onChat(callback: (message: ChatMessage) => void): void;
  /** The server did not show what we said, and tells us why. */
  onChatRefused(callback: (refusal: { reason: string; message: string }) => void): void;
  /** Somebody rings at our door (we own the apartment we are in, or are anywhere in the building). */
  onRing(callback: (ring: { visitorId: string; nickname: string }) => void): void;
  /** The owner answered a ring we made. */
  onBellAnswer(callback: (answer: { accepted: boolean; text: string }) => void): void;
  /** The server answers a /command, to us alone. */
  onSystem(callback: (text: string) => void): void;
  /** A challenge tier was reached: the server tells us what it paid. */
  onQuest(callback: (text: string) => void): void;
  /** The staff or the server speaks to us (a warning, a mute). */
  onNotice(callback: (notice: Notice) => void): void;
  leave(): Promise<void>;
}

/** Something the server tells this player alone. */
export interface Notice {
  /** Warnings only: tell the server once it has been read. */
  id?: number;
  kind: 'warning' | 'mute';
  text: string;
}

export type JoinResult = { ok: true; room: BuildingRoom } | { ok: false; status: number; error: string };

function wrap(room: Room): BuildingRoom {
  return {
    players() {
      const out: PlayerState[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (room.state as any)?.players?.forEach((p: PlayerState) => out.push({ id: p.id, nickname: p.nickname, i: p.i, j: p.j, pose: p.pose ?? 0, look: p.look ?? '', pet: p.pet ?? '', emote: p.emote ?? 0, hand: p.hand ?? 0, dir: p.dir ?? 4, petMood: p.petMood ?? 0, petLevel: p.petLevel ?? 0 }));
      return out;
    },
    moveTo(i, j) {
      room.send('move', { i, j });
    },
    use(i, j) {
      room.send('use', { i, j });
    },
    onFx(callback) {
      room.onMessage('fx', (m: { kind?: string; i: number; j: number; color?: number }) => {
        if (m.kind === 'pulse') callback({ i: m.i, j: m.j, color: m.color ?? 0xffc857 });
      });
    },
    onMusic(callback) {
      room.onMessage('music', (m: { track: number; elapsed: number }) => callback(m.track, m.elapsed));
    },
    onPetTrick(callback) {
      room.onMessage('pet-trick', (m: { id: string; trick: string }) => callback(m.id, m.trick));
    },
    onGame(handlers) {
      room.onMessage('game', (m: GameSnapshot) => handlers.onStart(m));
      room.onMessage('game-paint', (m: { i: number; j: number; team: number }) => handlers.onPaint(m));
      room.onMessage('game-end', (m: GameEnd) => handlers.onEnd(m));
      room.onMessage('game-freeze', (m: { id: string; frozen: boolean }) => handlers.onFreeze(m));
      room.onMessage('game-ball', (m: { i: number; j: number }) => handlers.onBall(m));
      room.onMessage('game-goal', (m: { team: number; scores: [number, number]; ball: { i: number; j: number } }) => handlers.onGoal(m));
    },
    onConfetti(callback) {
      room.onMessage('fx', (m: { kind?: string }) => {
        if (m.kind === 'confetti') callback();
      });
    },
    onToy(callback) {
      room.onMessage('fx', (m: { kind?: string; i: number; j: number; text?: string }) => {
        if (m.kind === 'toy' && typeof m.text === 'string') callback({ i: m.i, j: m.j, text: m.text.slice(0, 24) });
      });
    },
    lights() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (room.state as any)?.disco === true;
    },
    onAlert(callback) {
      room.onMessage('alert', (m: StaffAlert) => callback(m));
    },
    onSummon(callback) {
      room.onMessage('summon', (m: { from: string; target: FriendTarget }) => callback(m.from, m.target));
    },
    onGoto(callback) {
      room.onMessage('goto', (m: { target: FriendTarget }) => callback(m.target));
    },
    onRuleMessage(callback) {
      room.onMessage('rule-message', (m: { text: string }) => callback(m.text));
    },
    refreshAppearance() {
      room.send('refresh');
    },
    onClosed(callback) {
      room.onLeave((code: number) => callback(code));
    },
    onMessage(type, callback) {
      room.onMessage(type, () => callback());
    },
    say(text) {
      room.send('chat', { text });
    },
    onChat(callback) {
      room.onMessage('chat', (m: ChatMessage) => callback(m));
    },
    onChatRefused(callback) {
      room.onMessage('chat-refused', (m: { reason: string; message: string }) => callback(m));
    },
    onRing(callback) {
      room.onMessage('ring', (m: { visitorId: string; nickname: string }) => callback(m));
    },
    onBellAnswer(callback) {
      room.onMessage('bell-answer', (m: { accepted: boolean; text: string }) => callback(m));
    },
    onSystem(callback) {
      room.onMessage('system', (m: { text: string }) => callback(m.text));
    },
    onQuest(callback) {
      room.onMessage('quest', (m: { text: string }) => callback(m.text));
    },
    onNotice(callback) {
      room.onMessage('notice', (m: Notice) => callback(m));
    },
    leave: async () => {
      await room.leave().catch(() => {});
    },
  };
}

async function join(name: string, options: object): Promise<JoinResult> {
  try {
    return { ok: true, room: wrap(await client.joinOrCreate(name, options)) };
  } catch (err) {
    const e = err as { code?: number; message?: string };
    const status = e.code ?? 0;
    const error =
      status === 401
        ? 'Ta session a expiré, reconnecte-toi.'
        : status === 503
          ? (e.message ?? 'Le jeu est en maintenance.')
        : status === 403
          ? (e.message ?? 'Tu ne peux pas entrer ici.')
          : 'Impossible de se connecter à la salle, réessaie dans un instant.';
    return { ok: false, status, error };
  }
}

export const joinHall = () => join('hall', {});
export const joinApartment = (ownerId: string) => join('apartment', { ownerId });
