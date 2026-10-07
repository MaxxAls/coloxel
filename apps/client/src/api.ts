import type { RoomLayout } from '@coloxel/world';
import { SPRITE_VERSION, type Look, type Slot } from '@coloxel/render';

// Thin wrappers over the server API. The server decides everything; these only send intentions.

export interface User {
  id: string;
  nickname: string;
}

export interface InventoryItem {
  id: string;
  serial: number;
  name: string;
  description: string;
  editionNumber: number;
  editionSize: number;
  creator: string;
  createdAt: string;
  /** Reported by several players or hidden by the staff: only its owner still sees it. */
  underReview?: boolean;
  placement: { i: number; j: number; rot: number } | null;
}

/** A piece of base furniture: free, not numbered, not tradeable. Not a creation. */
export interface FurnitureItem {
  id: string;
  key: string;
  name: string;
  placement: { i: number; j: number; rot: number } | null;
  /** A piece that gives light: lit or switched off. Absent means lit. */
  on?: boolean;
}

export interface BuildingApartment {
  id: number;
  floor: number;
  slot: number;
  /** The name its owner gave it, if any. */
  name: string | null;
  /** Wallpaper id, used to tint the apartment in the building view. */
  wall: string;
  /** Floor id, drawn in the apartment's strip of floor. */
  floorStyle: string;
  owner: { id: string; nickname: string } | null;
  mine: boolean;
  /** The player may walk in (own apartment, or opened to the building). */
  open: boolean;
  /** Closed to the player for now, but on the doorbell: they may ring. */
  canRing?: boolean;
  visitors: number;
}

export interface VisitedApartment {
  owner: { id: string; nickname: string };
  name: string | null;
  floor: string;
  wall: string;
  /** The shape of the room: cells with a floor, their levels, the door. */
  layout: RoomLayout;
  items: InventoryItem[];
  furniture: FurnitureItem[];
}

export type ApartmentAccess = 'closed' | 'bell' | 'friends' | 'building';

export interface MyApartment {
  id: number;
  floor: number;
  slot: number;
  name: string | null;
  access: ApartmentAccess;
  floorStyle: string;
  wallStyle: string;
  layout: RoomLayout;
  /** After a change of shape: how many pieces went back to the inventory. */
  putAway?: number;
}

export interface NavigatorData {
  places: { kind: 'hall'; name: string; visitors: number }[];
  open: { apartmentId: number; ownerId: string; nickname: string; name: string | null; mine: boolean; visitors: number }[];
  /** Friends one click away: where they are, and the room that takes the player there. */
  friends: { id: string; nickname: string; where: string; target: FriendTarget }[];
}

export type FriendTarget = { kind: 'hall' } | { kind: 'apartment'; ownerId: string };

export interface Friend {
  id: string;
  nickname: string;
  online: boolean;
  /** Where the friend is, in words; null when offline. */
  where: string | null;
  /** The room that takes the player to this friend, when they may follow. */
  target: FriendTarget | null;
}

export interface FriendsData {
  friends: Friend[];
  /** Players who asked to be our friend. */
  incoming: { id: string; nickname: string }[];
  /** Players we asked. */
  outgoing: { id: string; nickname: string }[];
}

/** What a player calls an apartment: the name its owner chose, or "Chez <pseudo>". */
export const apartmentTitle = (name: string | null, nickname: string) => name ?? `Chez ${nickname}`;

export interface CatalogueData {
  furniture: { key: string; name: string; category: string; price: number }[];
  floors: { id: string; name: string; a: number; b: number }[];
  walls: { id: string; name: string; left: number; right: number }[];
}

export interface WalletData {
  pixels: number;
  coloxs: number;
  dailyAvailable: boolean;
  dailyPixels: number;
}

export interface LookData {
  look: Look;
  /** Bought pieces by slot; the free basics belong to everybody and are not listed. */
  owned: Record<Slot, number[]>;
}

export interface PetData {
  id: string;
  species: string;
  color: number;
  name: string;
  active: boolean;
}

/** What the shop can be asked to sell: the server reads the price from its own catalogues. */
export type Purchase =
  | { kind: 'furniture'; key: string }
  | { kind: 'clothing'; slot: Slot; piece: number }
  | { kind: 'pet'; species: string; color: number; name: string };

export interface PurchaseResult {
  /** Balance after the purchase; null when it was free. */
  pixels: number | null;
  furniture?: FurnitureItem;
  clothing?: { slot: Slot; piece: number };
  pet?: { id: string; species: string; color: number; name: string };
}

export interface Quest {
  key: string;
  title: string;
  description: string;
  count: number;
  /** Tiers reached so far. */
  tier: number;
  tiers: { goal: number; reward: number; done: boolean }[];
  done: boolean;
}

/** The mechanisms of an apartment, as the server stores them (apps/server/src/rules/schema.ts). */
export interface RuleCell {
  i: number;
  j: number;
}
export type RuleTrigger =
  | { type: 'enter' }
  | { type: 'step'; cell: RuleCell }
  | { type: 'use'; cell: RuleCell }
  | { type: 'say'; word: string }
  | { type: 'every'; seconds: number };
export type RuleCondition =
  | { type: 'players'; op: '>=' | '<='; n: number }
  | { type: 'lit'; piece: string; on: boolean }
  | { type: 'on-cell'; cell: RuleCell };
export type RuleEffect =
  | { type: 'light'; piece: string; mode: 'on' | 'off' | 'toggle' }
  | { type: 'teleport'; cell: RuleCell }
  | { type: 'message'; text: string }
  | { type: 'dance' };
export interface Rule {
  enabled: boolean;
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  effects: RuleEffect[];
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  pinned: boolean;
  published: boolean;
  author: string;
  createdAt: string;
}

export interface AnnouncementDraft {
  title: string;
  body: string;
  pinned: boolean;
  published: boolean;
}

export type ReportKind = 'player' | 'message' | 'item' | 'apartment_name' | 'apartment';
export type ReportReason = 'insult' | 'harassment' | 'inappropriate' | 'personal_info' | 'spam' | 'other';

/** What the staff panel reads from the server (see apps/server/src/staff/routes.ts). */
export type SanctionKind = 'warning' | 'mute' | 'suspension' | 'ban';

export interface StaffReportGroup {
  kind: ReportKind;
  targetKey: string;
  targetUser: { id: string; nickname: string } | null;
  snapshot: string;
  count: number;
  firstAt: string;
  lastAt: string;
  reasons: Record<string, number>;
  reports: { id: number; reporter: string; reason: ReportReason; details: string | null; context: string | null; at: string }[];
  itemState: 'hidden' | 'cleared' | null;
  masked: boolean;
}

export interface StaffHandledReport {
  id: number;
  kind: ReportKind;
  reason: ReportReason;
  snapshot: string;
  status: 'dismissed' | 'confirmed';
  note: string | null;
  handledAt: string;
  handler: string | null;
  reporter: string;
  target: string | null;
}

export interface StaffChatMessage {
  id: number;
  userId: string;
  nickname: string;
  room: string;
  text: string;
  blocked: boolean;
  reason: string | null;
  at: string;
}

export interface StaffPlayerRow {
  id: string;
  nickname: string;
  role: string;
  createdAt: string;
  sanctions: SanctionKind[];
}

export interface StaffSanction {
  id: number;
  kind: SanctionKind;
  reason: string;
  issuer: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revoker: string | null;
  live: boolean;
}

export interface StaffPlayerSheet {
  player: { id: string; nickname: string; role: string; createdAt: string; apartment: { id: number; name: string | null; access: string } | null };
  creations: { id: string; serial: number; name: string; createdAt: string; masked: boolean; state: 'hidden' | 'cleared' | null }[];
  sanctions: StaffSanction[];
  reports: { againstOpen: number; againstTotal: number; made: number };
  chat: { id: number; room: string; text: string; blocked: boolean; reason: string | null; at: string }[];
}

export interface SanctionOrder {
  kind: SanctionKind;
  minutes?: number;
  reason: string;
}

/** What the signed-in staff member may do, as the server computed it from their role. */
export interface StaffMe {
  staff: true;
  role: string;
  title: string;
  level: number;
  permissions: string[];
  maxMuteMinutes: number | null;
  maxSuspensionMinutes: number | null;
  /** The roles this member may give (strictly below their own). */
  assignable: string[];
}

export interface StaffRoleDef {
  id: string;
  title: string;
  summary: string;
  level: number;
  permissions: string[];
  maxMuteMinutes: number | null;
  maxSuspensionMinutes: number | null;
}

export interface TeamMember {
  id: string;
  nickname: string;
  role: string;
  title: string;
  since: string | null;
  eventsHeld: number;
}

export interface RoleChange {
  nickname: string;
  from: string;
  to: string;
  by: string | null;
  at: string;
}

export interface StaffEvent {
  id: number;
  title: string;
  description: string;
  startsAt: string;
  place: string;
  host: string;
  hostId: string;
  status: 'planned' | 'done' | 'cancelled';
}

export interface StaffDashboard {
  players: number;
  newToday: number;
  creations: number;
  reportsOpen: number;
  sanctionsLive: number;
  messages24h: number;
  blocked24h: number;
  signups: { day: string; count: number }[];
  announcements: number;
  maintenance: boolean;
}

export interface ChatQuery {
  nickname?: string;
  owner?: string;
  room?: string;
  q?: string;
  blocked?: 'true' | 'false';
  before?: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      return { ok: false, status: res.status, error: typeof json.error === 'string' ? json.error : 'Erreur inattendue' };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, error: 'Le serveur ne répond pas, réessaie dans un instant.' };
  }
}

export const api = {
  me: () => call<{ user: User }>('GET', '/api/auth/me'),
  login: (email: string, password: string) => call<{ user: User }>('POST', '/api/auth/login', { email, password }),
  register: (body: { email: string; password: string; nickname: string; birthDate: string }) =>
    call<{ user: User }>('POST', '/api/auth/register', body),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout'),
  charges: () => call<{ charges: number }>('GET', '/api/charges'),
  create: (description: string) =>
    call<{ item: InventoryItem; charges: number }>('POST', '/api/creations', { description }),
  inventory: () => call<{ items: InventoryItem[]; furniture: FurnitureItem[] }>('GET', '/api/inventory'),
  catalogue: () => call<CatalogueData>('GET', '/api/catalogue'),
  takeFurniture: (key: string) => call<{ furniture: FurnitureItem }>('POST', '/api/furniture', { key }),
  setLight: (id: string, on: boolean) => call<{ on: boolean }>('PUT', `/api/furniture/${id}/light`, { on }),
  throwFurniture: (id: string) => call<unknown>('DELETE', `/api/furniture/${id}`),
  /** `rot` is the number of quarter turns; left out, a move keeps the way the piece faces. */
  place: (itemId: string, i: number, j: number, rot?: number) => call<unknown>('PUT', '/api/placements', { itemId, i, j, rot }),
  building: () => call<{ apartments: BuildingApartment[] }>('GET', '/api/building'),
  apartment: (ownerId: string) => call<VisitedApartment>('GET', `/api/apartments/${ownerId}`),
  myApartment: () => call<MyApartment>('GET', '/api/apartment'),
  updateApartment: (body: {
    name?: string | null;
    access?: ApartmentAccess;
    floor?: string;
    wall?: string;
    layout?: { preset: string } | RoomLayout;
  }) =>
    call<MyApartment>('PUT', '/api/apartment', body),
  navigator: () => call<NavigatorData>('GET', '/api/navigator'),
  quests: () => call<{ quests: Quest[] }>('GET', '/api/quests'),
  ring: (ownerId: string) => call<{ status: 'open' | 'ringing' }>('POST', `/api/apartments/${ownerId}/ring`),
  answerBell: (visitorId: string, accept: boolean) => call<unknown>('POST', '/api/apartment/bell/answer', { visitorId, accept }),
  expel: (userId: string) => call<unknown>('POST', `/api/apartment/visitors/${userId}/expel`),
  rules: () => call<{ rules: Rule[] }>('GET', '/api/apartment/rules'),
  saveRules: (rules: Rule[]) => call<{ rules: Rule[] }>('PUT', '/api/apartment/rules', { rules }),
  announcements: () => call<{ announcements: Announcement[] }>('GET', '/api/announcements'),
  staffAnnouncements: () => call<{ announcements: Announcement[]; maintenance: boolean }>('GET', '/api/staff/announcements'),
  staffAnnounce: (draft: AnnouncementDraft) => call<{ id: number }>('POST', '/api/staff/announcements', draft),
  staffEditAnnouncement: (id: number, draft: AnnouncementDraft) => call<unknown>('PUT', `/api/staff/announcements/${id}`, draft),
  staffDeleteAnnouncement: (id: number) => call<unknown>('DELETE', `/api/staff/announcements/${id}`),
  staffMaintenance: (on: boolean) => call<{ maintenance: boolean }>('PUT', '/api/staff/maintenance', { on }),
  friends: () => call<FriendsData>('GET', '/api/friends'),
  askFriend: (nickname: string) => call<{ status: 'pending' | 'accepted' }>('POST', '/api/friends/requests', { nickname }),
  acceptFriend: (id: string) => call<unknown>('POST', `/api/friends/requests/${id}/accept`),
  removeFriend: (id: string) => call<unknown>('DELETE', `/api/friends/${id}`),
  notices: () => call<{ notices: { id: number; kind: 'warning' | 'mute'; text: string }[] }>('GET', '/api/notices'),
  noticesSeen: (ids: number[]) => call<unknown>('POST', '/api/notices/seen', { ids }),
  staffMe: () => call<StaffMe>('GET', '/api/staff/me'),
  staffLog: (query: { staff?: string; before?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.staff) params.set('staff', query.staff);
    if (query.before) params.set('before', String(query.before));
    return call<{ entries: { id: number; staff: string; command: string; args: string; room: string | null; at: string }[]; next: number | null }>('GET', `/api/staff/log?${params}`);
  },
  staffRoles: () => call<{ roles: StaffRoleDef[]; mine: string; assignable: string[] }>('GET', '/api/staff/roles'),
  staffTeam: () => call<{ members: TeamMember[]; history: RoleChange[] }>('GET', '/api/staff/team'),
  staffSetRole: (playerId: string, role: string) => call<{ role: string; title: string }>('PUT', `/api/staff/players/${playerId}/role`, { role }),
  staffEvents: () => call<{ events: StaffEvent[]; ranking: { nickname: string; events: number }[] }>('GET', '/api/staff/events'),
  staffCreateEvent: (event: { title: string; description: string; startsAt: string; place: string }) => call<{ id: number }>('POST', '/api/staff/events', event),
  staffCloseEvent: (id: number, status: 'done' | 'cancelled') => call<unknown>('PUT', `/api/staff/events/${id}`, { status }),
  staffDashboard: () => call<StaffDashboard>('GET', '/api/staff/dashboard'),
  staffReports: () => call<{ groups: StaffReportGroup[] }>('GET', '/api/staff/reports'),
  staffHandled: () => call<{ handled: StaffHandledReport[] }>('GET', '/api/staff/reports?status=handled'),
  staffResolve: (body: { kind: ReportKind; targetKey: string; decision: 'dismiss' | 'confirm'; note?: string; sanction?: SanctionOrder }) =>
    call<{ resolved: number }>('POST', '/api/staff/reports/resolve', body),
  staffChat: (query: ChatQuery) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
    return call<{ messages: StaffChatMessage[]; next: number | null }>('GET', `/api/staff/chat?${params}`);
  },
  staffPlayers: (q: string) => call<{ players: StaffPlayerRow[] }>('GET', `/api/staff/players?q=${encodeURIComponent(q)}`),
  staffPlayer: (id: string) => call<StaffPlayerSheet>('GET', `/api/staff/players/${id}`),
  staffSanction: (playerId: string, order: SanctionOrder) => call<{ id: number }>('POST', `/api/staff/players/${playerId}/sanctions`, order),
  staffRevoke: (sanctionId: number) => call<unknown>('POST', `/api/staff/sanctions/${sanctionId}/revoke`),
  staffItem: (itemId: string, state: 'hidden' | 'cleared' | 'none') => call<unknown>('POST', `/api/staff/items/${itemId}/moderation`, { state }),
  report: (body: { kind: ReportKind; targetId: string | number; reason: ReportReason; details?: string }) =>
    call<{ ok: true; already: boolean }>('POST', '/api/reports', body),
  pickUp: (itemId: string) => call<unknown>('DELETE', `/api/placements/${itemId}`),
  wallet: () => call<WalletData>('GET', '/api/wallet'),
  daily: () => call<{ pixels: number; gained: number }>('POST', '/api/wallet/daily'),
  redeem: (code: string) => call<{ pixels: number; gained: number }>('POST', '/api/wallet/redeem', { code }),
  myLook: () => call<LookData>('GET', '/api/me/look'),
  saveLook: (look: Look) => call<{ look: Look }>('PUT', '/api/me/look', look),
  buy: (order: Purchase) => call<PurchaseResult>('POST', '/api/shop/buy', order),
  pets: () => call<{ pets: PetData[] }>('GET', '/api/pets'),
  setActivePet: (id: string | null) => call<{ pets: PetData[] }>('PUT', '/api/pets/active', { id }),
  renamePet: (id: string, name: string) => call<{ pets: PetData[] }>('PATCH', `/api/pets/${id}`, { name }),
  releasePet: (id: string) => call<{ pets: PetData[] }>('DELETE', `/api/pets/${id}`),
};

export const itemSpriteUrl = (id: string, rot = 0) => `/api/items/${id}.png?v=${SPRITE_VERSION}${rot ? `&r=${rot}` : ''}`;
export const furnitureSpriteUrl = (key: string, rot = 0) => `/api/catalogue/${key}.png?v=${SPRITE_VERSION}${rot ? `&r=${rot}` : ''}`;
