import { Client, type Room } from '@colyseus/sdk';
import type { ChatMessage } from './chat-ui';

// The realtime server shares the session cookie with the API: the browser sends
// it with the join request, the server decides who we are. We only say where we
// want to go.
const url = import.meta.env.VITE_REALTIME_URL ?? `${location.protocol}//${location.hostname}:2567`;
const client = new Client(url);

/** The server sent us out because the owner closed the apartment. */
export const CLOSED_BY_OWNER = 4003;

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
}

export interface BuildingRoom {
  /** Every player in the room, with the position the server last decided. */
  players(): PlayerState[];
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
  /** The staff or the server speaks to us (a warning, a mute). */
  onNotice(callback: (notice: Notice) => void): void;
  leave(): Promise<void>;
}

/** Something the server tells this player alone. */
export interface Notice {
  kind: 'warning' | 'mute';
  text: string;
}

export type JoinResult = { ok: true; room: BuildingRoom } | { ok: false; status: number; error: string };

function wrap(room: Room): BuildingRoom {
  return {
    players() {
      const out: PlayerState[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (room.state as any)?.players?.forEach((p: PlayerState) => out.push({ id: p.id, nickname: p.nickname, i: p.i, j: p.j, pose: p.pose ?? 0, look: p.look ?? '', pet: p.pet ?? '' }));
      return out;
    },
    moveTo(i, j) {
      room.send('move', { i, j });
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
        : status === 403
          ? (e.message ?? 'Tu ne peux pas entrer ici.')
          : 'Impossible de se connecter à la salle, réessaie dans un instant.';
    return { ok: false, status, error };
  }
}

export const joinHall = () => join('hall', {});
export const joinApartment = (ownerId: string) => join('apartment', { ownerId });
