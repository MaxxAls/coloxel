import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { schema, t, type SchemaType } from '@colyseus/schema';
import type pg from 'pg';
import { z } from 'zod';
import { CATALOGUE, catalogueEntry, isSwitchable } from '@coloxel/render';
import { DEFAULT_LAYOUT, N, canStep, findPath, hasFloor, inGrid, voidKeys, type Cell, type RoomLayout } from '@coloxel/world';
import { canEnterApartment, isExpelled } from '../apartments/access';
import { loadLayout } from '../apartments/layout';
import { loadAppearance } from '../avatar/routes';
import type { SessionUser } from '../auth/routes';
import type { QuestRecorder } from '../quests/engine';
import { ChatLimiter, REFUSAL_MESSAGES, judgeChatText, logChat } from '../chat/chat';
import { SUSPENDED, USER_TOPIC, liveSanction, sanctionText, type UserEvent } from '../moderation/sanctions';
import { EffectBudget, conditionsHold, triggerMatches, type GameEvent } from '../rules/engine';
import { loadRules } from '../rules/routes';
import type { Effect, Rule } from '../rules/schema';
import { authenticateConnection } from './auth';
import { DANCE_MS, HELP_TEXT, parseCommand } from './commands';
import { PaintGame } from './paint-game';
import { HOTEL_TOPIC, parseStaffCommand, runStaffCommand, usageOf, type CommandEnv, type CommandRoom, type HotelAlert } from './staff-commands';
import { can, loadStaff } from '../staff/roles';
import { WHERE_KEY, roomLabel, type Location, type WhereEntry } from './where';

/** One cell per step: a calm, continuous walk, about half a second per cell. */
export const STEP_MS = 480;
/** How a player is posed: on their feet, sitting, or lying down. */
export const POSE = { stand: 0, sit: 1, lie: 2 } as const;
type Interaction = 'sit' | 'lie';
type RoomMap = { blocked: Set<number>; seats: Map<number, Interaction>; shape: RoomLayout };
/** Close code sent to a visitor when the owner closes the apartment on them. */
export const CLOSED_BY_OWNER = 4003;
/** Close code sent to a visitor the owner showed out. */
export const EXPELLED = 4005;
/** Close code sent to a player a member of the staff showed out of the room. */
export const KICKED = 4006;
/** Presence topic carrying the changes of one apartment. */
export const apartmentTopic = (ownerId: string) => `apartment:${ownerId.toLowerCase()}`;
export const SPAWN: Cell = { i: 7, j: 0 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Player = schema(
  {
    id: t.string(),
    nickname: t.string(),
    i: t.uint8(),
    j: t.uint8(),
    pose: t.uint8(),
    /** The player's look, as JSON of plain numbers (see packages/render/src/look.ts). */
    look: t.string(),
    /** Active companion as "species:colour:name", or empty. */
    pet: t.string(),
    /** What the player is doing for show: 0 nothing, 1 dancing. */
    emote: t.uint8(),
  },
  'Player',
);
export type Player = SchemaType<typeof Player>;

export const RoomState = schema({ players: t.map(Player), /** The party lights are on (a host switched them on). */ disco: t.boolean() }, 'RoomState');
export type RoomState = SchemaType<typeof RoomState>;

export interface RealtimeDeps {
  pool: pg.Pool;
  allowedOrigins: readonly string[];
  /** Moves challenges forward (visits, messages, sitting down). */
  quest: QuestRecorder;
  /** What the staff commands typed in a room need from outside it. */
  commands: CommandEnv;
}

// Wired by startRealtime() before any room is created.
let deps: RealtimeDeps | null = null;
export function configureRooms(d: RealtimeDeps) {
  deps = d;
}
const needDeps = () => {
  if (!deps) throw new Error('realtime rooms are not configured');
  return deps;
};

const moveSchema = z.object({ i: z.number().int(), j: z.number().int() }).strict();
const chatSchema = z.object({ text: z.string() }).strict();

type AuthedClient = Client<{ auth: SessionUser }>;

// onAuth always ran before any handler: a client without identity cannot be here.
function userOf(client: AuthedClient): SessionUser {
  if (!client.auth) throw new ServerError(401, 'Non connecté');
  return client.auth;
}

/**
 * Shared behaviour of the hall and the apartments. The server owns positions:
 * a client only says "I want to go to (i, j)"; the server finds the path and
 * moves the player one cell per step. Who the player is comes from the
 * session (client.auth), never from a message.
 */
abstract class BuildingRoom extends Room<{ state: RoomState; client: AuthedClient }> {
  override maxClients = 50;
  // Past this a client is disconnected, which keeps a flooding client from
  // loading the room: the other players are unaffected.
  override maxMessagesPerSecond = 20;

  private paths = new Map<string, Cell[]>();
  private clientsByUser = new Map<string, AuthedClient>();
  private lastRefresh = new Map<string, number>();
  private chatLimiter = new ChatLimiter();
  private chatChain: Promise<void> = Promise.resolve();
  /** Who follows whom (both are in this room). */
  private following = new Map<string, string>();
  private emoteUntil = new Map<string, number>();
  /** The cells in the way, as of the last time somebody asked to move: followers walk around them. */
  private blockedCache = new Set<number>();
  /** The shape of the room as of the last look: followers climb the same steps as everybody. */
  private shapeCache: RoomLayout = DEFAULT_LAYOUT;
  /** A player walking to a seat or a bed takes the pose when they arrive. */
  private pending = new Map<string, { cell: Cell; pose: number }>();

  /** Where this room is: the hall, or the apartment of its owner. */
  protected abstract location(): Location;

  /** Room-specific entry check (the hall is open to every signed-in player). */
  protected async authorize(_user: SessionUser): Promise<void> {}

  /**
   * Cells nobody can walk onto (no floor, or something in the way), the seats and beds, and the shape
   * of the room (levels, door). The hall is a plain square with nothing in it.
   */
  protected async layout(): Promise<RoomMap> {
    return { blocked: new Set(), seats: new Map(), shape: DEFAULT_LAYOUT };
  }

  /** Is someone already sitting or lying on this cell? */
  private taken(i: number, j: number, except?: string): boolean {
    let found = false;
    this.state.players.forEach((p, id) => {
      if (id !== except && p.i === i && p.j === j && p.pose !== POSE.stand) found = true;
    });
    return found;
  }

  /** After the decor changed: whoever sits or lies where there is no longer a seat gets back on their feet. */
  protected async revalidatePoses(): Promise<void> {
    const { seats, blocked, shape } = await this.layout();
    this.shapeCache = shape;
    this.blockedCache = blocked;
    this.state.players.forEach((p, id) => {
      if (p.pose !== POSE.stand && !seats.has(p.i * N + p.j)) {
        p.pose = POSE.stand;
        this.pending.delete(id);
      }
    });
    // Whoever stood where the floor is gone is put back at the door.
    for (const [id, p] of [...this.state.players.entries()]) {
      if (hasFloor(shape, p.i, p.j)) continue;
      const cell = this.freeCellNear(shape.door, blocked, id);
      if (cell) this.moveInstantly(id, cell);
    }
  }

  override async onAuth(_client: Client, _options: unknown, context: AuthContext) {
    const { pool, allowedOrigins } = needDeps();
    const user = await authenticateConnection(pool, context, allowedOrigins);
    await this.authorize(user);
    return user;
  }

  /** The staff sanctioned a player: if they are here, they are told, or shown out. Wherever the room runs. */
  private onUserEvent = (event: UserEvent) => {
    if (!event || typeof event.userId !== 'string') return;
    for (const client of [...this.clients]) {
      if ((client.auth as SessionUser | undefined)?.id !== event.userId) continue;
      switch (event.kind) {
        case 'suspension':
        case 'ban':
          client.leave(SUSPENDED, event.text);
          break;
        case 'warning':
        case 'mute':
          client.send('notice', { id: event.id, kind: event.kind, text: event.text });
          break;
        case 'quest':
          client.send('quest', { text: event.text });
          break;
        case 'alert':
          client.send('alert', { kind: 'user', text: event.text, from: event.from });
          break;
        case 'summon':
          client.send('summon', { from: event.from, target: event.target });
          break;
        case 'ring':
          client.send('ring', { visitorId: event.visitorId, nickname: event.nickname });
          break;
        case 'bell-answer':
          client.send('bell-answer', { ownerId: event.ownerId, accepted: event.accepted, text: event.text });
          break;
      }
    }
  };

  /** An announcement for the whole game: every room shows it to everybody in it. */
  private onHotelAlert = (alert: HotelAlert) => {
    if (!alert || typeof alert.text !== 'string') return;
    this.broadcast('alert', { kind: alert.kind, text: alert.text, from: alert.from, link: alert.link, target: alert.target });
  };

  // ----- Commands of the staff: what they may do to this room -----------------------
  private roomMuted = false;
  private frozen = new Map<string, number>();

  private isFrozen(id: string): boolean {
    const until = this.frozen.get(id);
    if (until === undefined) return false;
    if (Date.now() < until) return true;
    this.frozen.delete(id);
    return false;
  }

  private commandRoom(): CommandRoom {
    return {
      location: this.location(),
      findPlayer: (nickname) => {
        let found: { id: string; nickname: string } | undefined;
        this.state.players.forEach((p) => {
          if (p.nickname.toLowerCase() === nickname.toLowerCase()) found = { id: p.id, nickname: p.nickname };
        });
        return found;
      },
      alertRoom: (text, from) => this.broadcast('alert', { kind: 'room', text, from }),
      kick: (id, reason) => this.clientsByUser.get(id)?.leave(KICKED, reason),
      roomMuted: () => this.roomMuted,
      setRoomMuted: (on) => {
        this.roomMuted = on;
        this.broadcast('system', { text: on ? 'La salle est en sourdine : seule l’équipe peut parler.' : 'La salle peut de nouveau parler.' });
      },
      massDance: (on) => {
        this.state.players.forEach((p, id) => {
          if (p.pose !== POSE.stand) return;
          if (on) this.startDance(id);
          else this.setEmote(id, 0);
        });
      },
      setDisco: (on) => {
        // In the state, not in a message: whoever comes in later sees the lights on too.
        this.state.disco = on;
      },
      confetti: () => this.broadcast('fx', { kind: 'confetti' }),
      freeze: (id, seconds) => {
        if (seconds <= 0) {
          this.frozen.delete(id);
          return this.sendTo(id, 'system', { text: 'Tu peux de nouveau bouger.' });
        }
        this.frozen.set(id, Date.now() + seconds * 1000);
        this.paths.delete(id);
        this.pending.delete(id);
        this.following.delete(id);
        this.sendTo(id, 'system', { text: `Tu es immobilisé ${seconds} secondes.` });
      },
    };
  }

  /** A command typed by a member of the staff. True when it was one (and was run); false means: ordinary chat. */
  private async tryStaffCommand(client: AuthedClient, rawText: string): Promise<boolean> {
    const parsed = parseStaffCommand(rawText);
    if (!parsed) return false;
    const staff = await loadStaff(needDeps().pool, userOf(client).id);
    if (!staff) return false;
    const reply = (text: string) => client.send('system', { text });
    const handled = await runStaffCommand(parsed, {
      staff,
      room: this.commandRoom(),
      env: needDeps().commands,
      reply,
      send: (type, data) => client.send(type, data),
    });
    // A command that needs something, typed without anything, says how it is used.
    if (handled && !parsed.rest) {
      const usage = usageOf(parsed.name);
      if (usage?.includes('<')) reply(`Usage : ${usage}`);
    }
    return handled;
  }

  override onCreate(_options?: unknown) {
    this.setState(new RoomState());
    void this.presence.subscribe(USER_TOPIC, this.onUserEvent);
    void this.presence.subscribe(HOTEL_TOPIC, this.onHotelAlert);
    this.setSimulationInterval(() => this.step(), STEP_MS);

    // The player changed what they wear or which companion follows them: read it again from the database.
    // The message carries nothing; what everybody sees always comes from the server's own records.
    this.onMessage('refresh', async (client) => {
      const { id } = userOf(client);
      const player = this.state.players.get(id);
      const now = Date.now();
      if (!player || now - (this.lastRefresh.get(id) ?? 0) < 400) return;
      this.lastRefresh.set(id, now);
      const appearance = await loadAppearance(needDeps().pool, id);
      player.look = JSON.stringify(appearance.look);
      player.pet = appearance.pet;
    });

    // Chat. The author is the session's player, the text is checked, journaled and only then shown to the room.
    // A blocked message is told to its author alone; nobody else sees anything.
    this.onMessage('chat', (client, message) => {
      const parsed = chatSchema.safeParse(message);
      if (!parsed.success) return;
      // One at a time, in order of arrival: messages are shown in the order they were written.
      this.chatChain = this.chatChain.then(() => this.handleChat(client, parsed.data.text)).catch(() => {});
    });

    this.onMessage('use', (client, message) => {
      const parsed = moveSchema.safeParse(message);
      if (!parsed.success || !inGrid(parsed.data.i, parsed.data.j)) return;
      void this.handleUse(client, parsed.data).catch(() => {});
    });

    this.onMessage('move', async (client, message) => {
      const parsed = moveSchema.safeParse(message);
      if (!parsed.success || !inGrid(parsed.data.i, parsed.data.j)) return;
      const { id } = userOf(client);
      const player = this.state.players.get(id);
      if (!player) return;
      if (this.isFrozen(id)) return;
      // Walking off ends a dance and stops following.
      this.following.delete(id);
      this.setEmote(id, 0);
      const { blocked, seats, shape } = await this.layout();
      this.blockedCache = blocked;
      this.shapeCache = shape;
      const target = parsed.data;
      // A seat or a bed that is free can be walked onto: that is how one sits down. Everything else placed is in the way.
      const kind = seats.get(target.i * N + target.j);
      const usable = kind !== undefined && !this.taken(target.i, target.j, id);
      const path = findPath(
        { i: player.i, j: player.j },
        target,
        (i, j) => blocked.has(i * N + j) && !(usable && i === target.i && j === target.j),
        (a, b) => canStep(shape, a, b),
      );
      if (path.length) {
        // Any new walk gets the player back on their feet first.
        player.pose = POSE.stand;
        this.paths.set(id, path);
        if (usable) this.pending.set(id, { cell: target, pose: kind === 'lie' ? POSE.lie : POSE.sit });
        else this.pending.delete(id);
      } else {
        this.paths.delete(id);
        this.pending.delete(id);
      }
    });
  }

  private async handleChat(client: AuthedClient, rawText: string) {
    const { id } = userOf(client);
    const player = this.state.players.get(id);
    if (!player) return;
    const refuse = (reason: string, text: string) => client.send('chat-refused', { reason, message: text });
    if (!this.chatLimiter.allow(id)) return refuse('rate', REFUSAL_MESSAGES.rate);
    const command = parseCommand(rawText);
    if (command) return this.handleCommand(client, command);
    if (await this.tryStaffCommand(client, rawText)) return;
    // In a room the staff silenced, only the staff speaks.
    if (this.roomMuted) {
      const staff = await loadStaff(needDeps().pool, id);
      if (!staff || !can(staff.role, 'admin.access')) return refuse('room-muted', 'La salle est en sourdine : seule l’équipe peut parler.');
    }
    const verdict = judgeChatText(rawText);
    if (!verdict.ok && verdict.reason !== 'filtered') return refuse(verdict.reason, verdict.message);
    const room = roomLabel(this.location());
    const { pool } = needDeps();
    try {
      // A muted player is told so; what they write is journaled, and shown to nobody.
      const mute = await liveSanction(pool, id, ['mute']);
      if (mute) {
        await logChat(pool, { userId: id, room, text: verdict.text, blocked: true, reason: 'muted' });
        return refuse('muted', sanctionText('mute', mute.reason, mute.expiresAt));
      }
      if (!verdict.ok) {
        await logChat(pool, { userId: id, room, text: verdict.text, blocked: true, reason: verdict.detail });
        return refuse(verdict.reason, verdict.message);
      }
      const messageId = await logChat(pool, { userId: id, room, text: verdict.text, blocked: false });
      this.broadcast('chat', { id: messageId, from: id, nickname: player.nickname, text: verdict.text });
      needDeps().quest(id, 'chat');
      this.onGameEvent({ type: 'say', who: id, text: verdict.text });
    } catch {
      // Not journaled, not shown: every message shown is a message the staff can find.
      refuse('error', 'Ton message n’a pas pu être envoyé, réessaie.');
    }
  }

  private setEmote(id: string, emote: number) {
    const player = this.state.players.get(id);
    if (!player) return;
    player.emote = emote;
    if (emote === 0) this.emoteUntil.delete(id);
    else this.emoteUntil.set(id, Date.now() + DANCE_MS);
  }

  /** Slash commands: they act on the player who typed them, and are answered to that player alone. */
  private async handleCommand(client: AuthedClient, command: ReturnType<typeof parseCommand> & object) {
    const { id } = userOf(client);
    const player = this.state.players.get(id);
    if (!player) return;
    const say = (text: string) => client.send('system', { text });
    switch (command.name) {
      case 'help':
        return say(HELP_TEXT);
      case 'unknown':
        return say(`Commande inconnue : /${command.typed}. ${HELP_TEXT}`);
      case 'stop': {
        const was = this.following.delete(id) || player.emote !== 0;
        this.setEmote(id, 0);
        this.paths.delete(id);
        return say(was ? 'C’est fait.' : 'Rien à arrêter.');
      }
      case 'dance': {
        if (player.pose !== POSE.stand) return say('Lève-toi d’abord pour danser.');
        if (player.emote !== 0) {
          this.setEmote(id, 0);
          return say('Tu arrêtes de danser.');
        }
        this.following.delete(id);
        this.paths.delete(id);
        this.setEmote(id, 1);
        return;
      }
      case 'follow': {
        if (!command.who) return say('Qui veux-tu suivre ? Écris /suivre <pseudo>.');
        let target: Player | undefined;
        this.state.players.forEach((p) => {
          if (p.nickname.toLowerCase() === command.who.toLowerCase()) target = p;
        });
        if (!target || target.id === id) return say('Cette personne n’est pas dans la salle.');
        // Following is for friends: nobody is trailed by a stranger.
        const friends = await needDeps().pool.query(
          `SELECT 1 FROM friendships WHERE status = 'accepted'
             AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
          [id, target.id],
        );
        if (!friends.rowCount) return say('Tu ne peux suivre que tes amis.');
        this.blockedCache = (await this.layout()).blocked;
        this.setEmote(id, 0);
        this.following.set(id, target.id);
        return say(`Tu suis ${target.nickname}. Écris /stop pour arrêter.`);
      }
    }
  }

  // ----- What mechanisms need from a room -----------------------------------------
  /** Something happened in the room: a step, a word, a click, an arrival. Apartments run their mechanisms from it. */
  protected onGameEvent(_event: GameEvent): void {}
  /** Called at every step of the room's clock. */
  protected onClock(_now: number): void {}
  /** Is there something on this cell that a click sets off (a button)? */
  protected async pressableAt(_cell: Cell): Promise<boolean> {
    return false;
  }

  /** A player is now in the room (it is told the state of whatever is going on). */
  protected onPlayerJoined(_client: AuthedClient, _id: string): void {}
  /** A player left the room. */
  protected onPlayerLeft(_id: string): void {}

  /** What a click on a pressable piece does besides setting off the rules (a gate, a cannon). */
  protected async useAt(_cell: Cell, _who: string): Promise<void> {}

  protected playerCount(): number {
    return this.state.players.size;
  }

  protected sendTo(id: string, type: string, data: unknown): void {
    this.clientsByUser.get(id)?.send(type, data);
  }

  protected startDance(id: string): void {
    const player = this.state.players.get(id);
    if (!player || player.pose !== POSE.stand) return;
    this.following.delete(id);
    this.paths.delete(id);
    this.setEmote(id, 1);
  }

  /** The free cell nearest to this one: not in the way, not under somebody. */
  protected freeCellNear(target: Cell, blocked: Set<number>, except?: string): Cell | null {
    const taken = new Set<number>(blocked);
    this.state.players.forEach((p, id) => {
      if (id !== except) taken.add(p.i * N + p.j);
    });
    let best: Cell | null = null;
    let bestDistance = Infinity;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const d = Math.abs(i - target.i) + Math.abs(j - target.j);
        if (!taken.has(i * N + j) && d < bestDistance) {
          best = { i, j };
          bestDistance = d;
        }
      }
    }
    return best;
  }

  /** Put a player on a cell at once (a portal): their walk, seat and dance end there. */
  protected moveInstantly(id: string, cell: Cell): void {
    const player = this.state.players.get(id);
    if (!player) return;
    this.paths.delete(id);
    this.pending.delete(id);
    this.following.delete(id);
    this.setEmote(id, 0);
    player.pose = POSE.stand;
    player.i = cell.i;
    player.j = cell.j;
  }

  private lastUse = new Map<string, number>();

  /** A click on a button: the server checks there is one, and that the player is not hammering it. */
  private async handleUse(client: AuthedClient, cell: Cell) {
    const { id } = userOf(client);
    const now = Date.now();
    if (now - (this.lastUse.get(id) ?? 0) < 500) return;
    this.lastUse.set(id, now);
    if (!this.state.players.has(id) || !(await this.pressableAt(cell))) return;
    await this.useAt(cell, id);
    this.onGameEvent({ type: 'use', who: id, cell });
  }

  /** The free cell closest to the door: not under an object, not under another player. */
  private spawnCell(blocked: Set<number>, door: Cell): Cell {
    const taken = new Set<number>(blocked);
    this.state.players.forEach((p) => taken.add(p.i * N + p.j));
    let best: Cell | null = null;
    let bestDistance = Infinity;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const d = Math.abs(i - door.i) + Math.abs(j - door.j);
        if (!taken.has(i * N + j) && d < bestDistance) {
          best = { i, j };
          bestDistance = d;
        }
      }
    }
    return best ?? door;
  }

  override async onJoin(client: AuthedClient) {
    const user = userOf(client);
    const { blocked, shape } = await this.layout();
    this.shapeCache = shape;
    // One seat per player: a second connection replaces the first.
    const previous = this.clientsByUser.get(user.id);
    if (previous && previous !== client) previous.leave(4000, 'Connecté ailleurs');
    this.clientsByUser.set(user.id, client);

    const player = new Player();
    player.id = user.id;
    player.nickname = user.nickname;
    const appearance = await loadAppearance(needDeps().pool, user.id);
    player.look = JSON.stringify(appearance.look);
    player.pet = appearance.pet;
    // A second connection of the same player replaces the first: its old cell is free again.
    this.state.players.delete(user.id);
    const spawn = this.spawnCell(blocked, shape.door);
    player.i = spawn.i;
    player.j = spawn.j;
    player.pose = POSE.stand;
    player.emote = 0;
    this.paths.delete(user.id);
    this.pending.delete(user.id);
    this.state.players.set(user.id, player);
    // Friends can see where we are.
    const entry: WhereEntry = { room: roomLabel(this.location()), roomId: this.roomId };
    await this.presence.hset(WHERE_KEY, user.id, JSON.stringify(entry)).catch(() => {});
    const at = this.location();
    if (at.kind === 'apartment' && at.ownerId.toLowerCase() !== user.id.toLowerCase()) needDeps().quest(user.id, 'visit', at.ownerId.toLowerCase());
    this.onPlayerJoined(client, user.id);
    this.onGameEvent({ type: 'enter', who: user.id });
    if (this.roomMuted) client.send('system', { text: 'La salle est en sourdine : seule l’équipe peut parler.' });
  }

  override onDispose() {
    void this.presence.unsubscribe(USER_TOPIC, this.onUserEvent);
    void this.presence.unsubscribe(HOTEL_TOPIC, this.onHotelAlert);
  }

  override async onLeave(client: AuthedClient) {
    const id = userOf(client).id;
    // A replaced connection leaving must not remove the player of the new one.
    if (this.clientsByUser.get(id) !== client) return;
    this.clientsByUser.delete(id);
    this.lastRefresh.delete(id);
    this.chatLimiter.forget(id);
    this.following.delete(id);
    this.emoteUntil.delete(id);
    this.paths.delete(id);
    this.pending.delete(id);
    this.state.players.delete(id);
    this.onPlayerLeft(id);
    // Forget our place, unless the player already is somewhere else (they joined another room before this one noticed).
    try {
      const raw = await this.presence.hget(WHERE_KEY, id);
      if (raw && (JSON.parse(raw) as WhereEntry).roomId === this.roomId) await this.presence.hdel(WHERE_KEY, id);
    } catch {
      // The presence store is a convenience for friends lists: a failure here must not break leaving.
    }
  }

  private step() {
    // A dance ends by itself after a while.
    const now = Date.now();
    for (const [id, until] of this.emoteUntil) {
      if (now > until) this.setEmote(id, 0);
    }
    // Followers keep a step behind: next to the one they follow, never on top of them.
    for (const [id, targetId] of this.following) {
      const me = this.state.players.get(id);
      const target = this.state.players.get(targetId);
      if (!me || !target) {
        this.following.delete(id);
        continue;
      }
      if (this.paths.has(id) || me.pose !== POSE.stand) continue;
      if (Math.max(Math.abs(me.i - target.i), Math.abs(me.j - target.j)) <= 1) continue;
      const path = findPath(
        { i: me.i, j: me.j },
        { i: target.i, j: target.j },
        (i, j) => this.blockedCache.has(i * N + j) && !(i === target.i && j === target.j),
        (a, b) => canStep(this.shapeCache, a, b),
      );
      path.pop();
      if (path.length) this.paths.set(id, path);
    }
    for (const [id, path] of this.paths) {
      const player = this.state.players.get(id);
      const next = path.shift();
      if (!player || !next) {
        this.paths.delete(id);
        continue;
      }
      player.i = next.i;
      player.j = next.j;
      this.onGameEvent({ type: 'step', who: id, cell: { i: next.i, j: next.j } });
      if (!path.length) {
        this.paths.delete(id);
        // Arrived: sit down or lie down, unless someone got there first.
        const want = this.pending.get(id);
        this.pending.delete(id);
        if (want && want.cell.i === next.i && want.cell.j === next.j && !this.taken(next.i, next.j, id)) {
          player.pose = want.pose;
          needDeps().quest(id, 'sit');
        }
      }
    }
    this.onClock(now);
  }
}

/** The common area on the ground floor. */
export class HallRoom extends BuildingRoom {
  protected override location(): Location {
    return { kind: 'hall' };
  }
}

/** One room per open apartment, keyed by its owner. */
export class ApartmentRoom extends BuildingRoom {
  override maxClients = 20;
  // Taken from the creation options once, then fixed: a client cannot pick
  // another apartment by forging the options of a later join.
  private ownerId = '';

  override onCreate(options?: { ownerId?: unknown }) {
    if (typeof options?.ownerId !== 'string' || !UUID.test(options.ownerId)) {
      throw new ServerError(400, 'Appartement invalide');
    }
    this.ownerId = options.ownerId.toLowerCase();
    // Lets the building view count who is inside.
    void this.setMetadata({ ownerId: this.ownerId });
    super.onCreate();
    // The owner changes the door or the decor through the API: this room, wherever it runs, hears of it.
    this.presence.subscribe(apartmentTopic(this.ownerId), this.onChange);
    void this.reloadRules();
  }

  override onDispose() {
    super.onDispose();
    void this.presence.unsubscribe(apartmentTopic(this.ownerId), this.onChange);
  }

  protected override location(): Location {
    return { kind: 'apartment', ownerId: this.ownerId };
  }

  private onChange = (kind: unknown) => {
    if (kind === 'decor') {
      this.layoutCache = null;
      void this.revalidatePoses().then(() => this.broadcast('decor'));
    }
    else if (kind === 'access') void this.sendOutUnwelcome();
    else if (kind === 'rules') void this.reloadRules();
  };

  // ----- Mechanisms ----------------------------------------------------------------
  // The owner's rules, in memory. A rule is data (apps/server/src/rules/schema.ts): the room reads it, checks it
  // again, and does only what the list of effects allows, a handful of times a second at most. What an effect does
  // never sets off another rule, so a rule cannot feed itself.
  private rules: Rule[] = [];
  private budget = new EffectBudget();
  private lastEvery = new Map<number, number>();
  private firing: Promise<void> = Promise.resolve();

  private async reloadRules() {
    try {
      this.rules = await loadRules(needDeps().pool, this.ownerId);
      this.lastEvery.clear();
    } catch {
      // Keep the rules we had.
    }
  }

  // ----- Team game ------------------------------------------------------------------
  private game = new PaintGame({
    broadcast: (type, data) => this.broadcast(type, data),
    sendTo: (id, type, data) => this.sendTo(id, type, data),
  });

  protected override onPlayerJoined(client: AuthedClient) {
    // Somebody arriving in the middle of a game sees the board, and watches.
    if (this.game.isRunning) client.send('game', this.game.snapshot());
  }

  protected override onPlayerLeft(id: string) {
    this.game.leave(id, Date.now());
  }

  protected override onGameEvent(event: GameEvent) {
    if (event.type === 'step') this.game.step(event.who, event.cell);
    if (!this.rules.length) return;
    // One event at a time, in the order they happened.
    this.firing = this.firing.then(() => this.fire(event)).catch(() => {});
  }

  protected override onClock(now: number) {
    this.game.tick(now);
    if (!this.rules.length || this.playerCount() === 0) return;
    this.rules.forEach((rule, index) => {
      if (!rule.enabled || rule.trigger.type !== 'every') return;
      const last = this.lastEvery.get(index);
      // The first period starts when somebody is there to see it.
      if (last === undefined) this.lastEvery.set(index, now);
      else if (now - last >= rule.trigger.seconds * 1000) {
        this.lastEvery.set(index, now);
        this.onGameEvent({ type: 'every', rule: index });
      }
    });
  }

  protected override async pressableAt(cell: Cell): Promise<boolean> {
    const { rows } = await needDeps().pool.query<{ key: string }>(
      `SELECT f.catalogue_key AS key FROM placements p JOIN furniture f ON f.id = p.furniture_id
        WHERE p.user_id = $1 AND $2 >= p.i AND $2 < p.i + p.w AND $3 >= p.j AND $3 < p.j + p.h`,
      [this.ownerId, cell.i, cell.j],
    );
    return !!rows[0] && !!catalogueEntry(rows[0].key)?.pressable;
  }

  private lastConfetti = 0;

  /** The piece under a click, if it is base furniture: what it is, which placement, and whether it is lit (a gate: open). */
  private async pieceAt(cell: Cell) {
    const { rows } = await needDeps().pool.query<{ id: string; key: string; lit: boolean }>(
      `SELECT f.id, f.catalogue_key AS key, p.lit FROM placements p JOIN furniture f ON f.id = p.furniture_id
        WHERE p.user_id = $1 AND $2 >= p.i AND $2 < p.i + p.w AND $3 >= p.j AND $3 < p.j + p.h`,
      [this.ownerId, cell.i, cell.j],
    );
    const row = rows[0];
    return row ? { ...row, entry: catalogueEntry(row.key) } : undefined;
  }

  protected override async useAt(cell: Cell, who: string): Promise<void> {
    const piece = await this.pieceAt(cell);
    const entry = piece?.entry;
    if (!piece || !entry) return;
    if (entry.gate) {
      // Only the owner decides who gets through.
      if (who.toLowerCase() !== this.ownerId.toLowerCase()) return this.sendTo(who, 'rule-message', { text: 'Seul le propriétaire ouvre et ferme ce portillon.' });
      const { rows } = await needDeps().pool.query<{ i: number; j: number; w: number; h: number }>(
        'SELECT i, j, w, h FROM placements WHERE furniture_id = $1 AND user_id = $2',
        [piece.id, this.ownerId],
      );
      const at = rows[0];
      if (!at) return;
      // Nobody is shut in, or crushed: a gate with someone in it stays open.
      if (piece.lit) {
        let occupied = false;
        this.state.players.forEach((p) => {
          if (p.i >= at.i && p.i < at.i + at.w && p.j >= at.j && p.j < at.j + at.h) occupied = true;
        });
        if (occupied) return this.sendTo(who, 'rule-message', { text: 'Quelqu’un est dans le passage.' });
      }
      await needDeps().pool.query('UPDATE placements SET lit = NOT lit WHERE furniture_id = $1 AND user_id = $2', [piece.id, this.ownerId]);
      this.layoutCache = null;
      this.broadcast('fx', { kind: 'pulse', i: at.i, j: at.j, color: 0xd6b25a });
      this.broadcast('decor');
      return;
    }
    if (entry.game) {
      const players = [...this.state.players.keys()];
      const res = this.game.start(players, Date.now());
      if (!res.ok) return this.sendTo(who, 'rule-message', { text: res.message });
      this.broadcast('fx', { kind: 'pulse', i: cell.i, j: cell.j, color: 0xffc857 });
      return;
    }
    if (entry.confetti) {
      const now = Date.now();
      // One shower at a time: the cannon is not a way to flood the room.
      if (now - this.lastConfetti < 4000) return;
      this.lastConfetti = now;
      this.broadcast('fx', { kind: 'confetti' });
    }
  }

  private async pieceLit(piece: string): Promise<boolean | undefined> {
    const { rows } = await needDeps().pool.query<{ lit: boolean }>('SELECT lit FROM placements WHERE furniture_id = $1 AND user_id = $2', [piece, this.ownerId]);
    return rows[0]?.lit;
  }

  private async fire(event: GameEvent) {
    const candidates = event.type === 'every' ? [this.rules[event.rule]] : this.rules;
    for (const rule of candidates) {
      if (!rule?.enabled || (event.type !== 'every' && !triggerMatches(rule.trigger, event))) continue;
      const who = 'who' in event ? this.state.players.get(event.who) : undefined;
      const holds = await conditionsHold(rule.conditions, {
        playerCount: this.playerCount(),
        whoCell: who ? { i: who.i, j: who.j } : null,
        isLit: (piece) => this.pieceLit(piece),
      });
      if (!holds) continue;
      // A busy room does not do more: the rest waits for the next time.
      if (!this.budget.take(rule.effects.length)) return;
      if (event.type === 'step' || event.type === 'use') this.broadcast('fx', { kind: 'pulse', i: event.cell.i, j: event.cell.j, color: 0xffc857 });
      for (const effect of rule.effects) await this.apply(effect, who?.id);
    }
  }

  private async apply(effect: Effect, who: string | undefined) {
    const { pool } = needDeps();
    switch (effect.type) {
      case 'light': {
        const switchable = CATALOGUE.filter((c) => isSwitchable(c)).map((c) => c.key);
        const { rows } = await pool.query<{ i: number; j: number }>(
          `UPDATE placements p
              SET lit = CASE $3 WHEN 'on' THEN true WHEN 'off' THEN false ELSE NOT p.lit END
             FROM furniture f
            WHERE p.furniture_id = f.id AND f.id = $1 AND p.user_id = $2 AND f.catalogue_key = ANY($4)
        RETURNING p.i, p.j`,
          [effect.piece, this.ownerId, effect.mode, switchable],
        );
        if (rows[0]) {
          this.broadcast('fx', { kind: 'pulse', i: rows[0].i, j: rows[0].j, color: 0xfff3a0 });
          this.broadcast('decor');
        }
        return;
      }
      case 'teleport': {
        const player = who ? this.state.players.get(who) : undefined;
        if (!who || !player) return;
        const { blocked } = await this.layout();
        const target = this.freeCellNear(effect.cell, blocked, who);
        if (!target) return;
        this.broadcast('fx', { kind: 'pulse', i: player.i, j: player.j, color: 0x7cc8ff });
        this.moveInstantly(who, target);
        this.broadcast('fx', { kind: 'pulse', i: target.i, j: target.j, color: 0x7cc8ff });
        return;
      }
      case 'message':
        if (who) this.sendTo(who, 'rule-message', { text: effect.text });
        return;
      case 'dance':
        if (who) this.startDance(who);
        return;
    }
  }

  /** Visitors who may no longer enter (door closed, or opened to friends only) are shown out at once. */
  private async sendOutUnwelcome() {
    const { pool } = needDeps();
    for (const client of [...this.clients]) {
      const user = client.auth as SessionUser | undefined;
      if (!user || user.id.toLowerCase() === this.ownerId) continue;
      if (await isExpelled(pool, this.ownerId, user.id)) client.leave(EXPELLED, 'Le propriétaire t’a invité à sortir');
      else if (!(await canEnterApartment(pool, this.ownerId, user.id))) client.leave(CLOSED_BY_OWNER, 'Le propriétaire a fermé son appart');
    }
  }

  protected override async authorize(user: SessionUser) {
    // Same answer for a closed apartment and an unknown one.
    if (!(await canEnterApartment(needDeps().pool, this.ownerId, user.id))) {
      throw new ServerError(403, 'Cet appartement est fermé');
    }
  }

  /** The layout is asked at every click: it is remembered for a moment, and forgotten as soon as the decor changes. */
  private layoutCache: { at: number; value: Promise<RoomMap> } | null = null;

  protected override async layout() {
    const now = Date.now();
    if (!this.layoutCache || now - this.layoutCache.at > 1000) {
      const value = this.readLayout();
      this.layoutCache = { at: now, value };
      // A failed read is not kept.
      value.catch(() => {
        if (this.layoutCache?.value === value) this.layoutCache = null;
      });
    }
    return this.layoutCache.value;
  }

  private async readLayout(): Promise<RoomMap> {
    const shape = await loadLayout(needDeps().pool, this.ownerId);
    const { rows } = await needDeps().pool.query<{ i: number; j: number; w: number; h: number; lit: boolean; key: string | null }>(
      `SELECT p.i, p.j, p.w, p.h, p.lit, f.catalogue_key AS key
         FROM placements p LEFT JOIN furniture f ON f.id = p.furniture_id
        WHERE p.user_id = $1`,
      [this.ownerId],
    );
    // No floor: nobody walks there.
    const blocked = voidKeys(shape);
    const seats = new Map<number, Interaction>();
    for (const r of rows) {
      const entry = r.key ? catalogueEntry(r.key) : undefined;
      // A rug, a pressure plate, a portal lies on the floor: one walks over it.
      // A big piece blocks (or is used from) every tile it covers.
      for (let a = 0; a < r.w; a++) {
        for (let b = 0; b < r.h; b++) {
          const cell = (r.i + a) * N + (r.j + b);
          // An open gate lets players through; a closed one is a wall.
          if (!entry?.walkable && !(entry?.gate && r.lit)) blocked.add(cell);
          // Only base furniture can be used: a creation is whatever its maker invented.
          if (entry?.interaction) seats.set(cell, entry.interaction);
        }
      }
    }
    return { blocked, seats, shape };
  }
}
