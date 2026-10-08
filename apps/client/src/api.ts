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
  placement: { i: number; j: number; rot: number; w?: number; h?: number } | null;
  /** Tiles the piece covers before any turn: along i, along j. Absent means one. */
  size?: [number, number];
  /** On the market: in escrow, it cannot be placed until the offer ends. */
  listing?: { id: string; price: number } | null;
}

/** A piece of base furniture: free, not numbered, not tradeable. Not a creation. */
export interface FurnitureItem {
  id: string;
  key: string;
  name: string;
  placement: { i: number; j: number; rot: number; w?: number; h?: number } | null;
  /** Tiles the piece covers before any turn: along i, along j. Absent means one. */
  size?: [number, number];
  /** A piece that gives light: lit or switched off. Absent means lit. */
  on?: boolean;
  /** What a placed piece says or wears: the text of a sign, the look (JSON) on a mannequin. */
  data?: string | null;
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
  /** End of the VIP Atelier, when the player is a VIP. */
  vipUntil?: string | null;
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
  /** 0 to 100, worked out by the server from real time. */
  hunger: number;
  joy: number;
  mood: 'happy' | 'ok' | 'sad';
  xp: number;
  level: number;
  /** XP needed for the next level, null at the top. */
  nextLevelXp: number | null;
  /** Keys of the tricks it knows (see PET_TRICKS in packages/render). */
  tricks: string[];
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

export type ReportKind = 'player' | 'message' | 'item' | 'apartment_name' | 'apartment' | 'listing' | 'trade';
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

export interface MarketRules {
  commissionPercent: number;
  royaltyPercent: number;
  minPrice: number;
  maxPrice: number;
  listingDays: number;
  maxActiveListings: number;
}

export interface MarketListing {
  id: string;
  price: number;
  expiresAt: string;
  seller: string;
  mine: boolean;
  underReview: boolean;
  item: { id: string; serial: number; name: string; description: string; editionNumber: number; editionSize: number; creator: string };
}

export interface MarketQuery {
  q?: string;
  sort?: 'recent' | 'price_asc' | 'price_desc' | 'serial';
  mine?: boolean;
  offset?: number;
}

export interface OwnerLine {
  kind: 'creation' | 'sale' | 'trade';
  from: string | null;
  to: string;
  price: number | null;
  at: string;
}

export interface TradeSide {
  accepted: boolean;
  confirmed: boolean;
  items: { id: string; serial: number; name: string; editionNumber: number; editionSize: number; creator: string }[];
}

export interface TradeData {
  id: string;
  version: number;
  partner: string;
  stage: 'offer' | 'confirm';
  mine: TradeSide;
  theirs: TradeSide;
}

export interface MarketFlag {
  id: number;
  kind: string;
  detail: string;
  status: string;
  at: string;
  itemId: string | null;
  serial: number | null;
  player: string;
  other: string | null;
}

export interface MarketPlayerSheet {
  player: { id: string; nickname: string; coloxs: number; since: string };
  block: { reason: string; until: string | null } | null;
  sales: { id: number; serial: number; name: string; seller: string; buyer: string; price: number; commission: number; royalty: number; at: string; reversed: boolean }[];
  trades: { id: string; status: string; at: string; a: string; b: string; gaveA: number; gaveB: number }[];
  listings: { id: string; serial: number; name: string; price: number; expiresAt: string }[];
  ledger: { delta: number; kind: string; detail: string | null; at: string }[];
}

export interface Economy {
  coloxs: { circulating: number; bought: number; givenByStaff: number; refunded: number; destroyed: number };
  last24h: { sales: number; volume: number; medianPrice: number | null };
  activity: { listings: number; tradesOpen: number; tradesDone: number; salesTotal: number };
  perDay: { day: string; sales: number; volume: number; medianPrice: number | null }[];
  topHolders: { nickname: string; items: number }[];
  concentration: { name: string; size: number; nickname: string; held: number }[];
  flagsOpen: number;
  marketBlocks: number;
  ledgerMismatches: number;
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
  create: (description: string, edition = 1) =>
    call<{ item: InventoryItem; items: InventoryItem[]; charges: number }>('POST', '/api/creations', { description, edition }),
  inventory: () => call<{ items: InventoryItem[]; furniture: FurnitureItem[] }>('GET', '/api/inventory'),
  catalogue: () => call<CatalogueData>('GET', '/api/catalogue'),
  takeFurniture: (key: string) => call<{ furniture: FurnitureItem }>('POST', '/api/furniture', { key }),
  setLight: (id: string, on: boolean) => call<{ on: boolean }>('PUT', `/api/furniture/${id}/light`, { on }),
  dressMannequin: (id: string) => call<{ ok: boolean }>('POST', `/api/furniture/${id}/dress`, {}),
  writeSign: (id: string, text: string) => call<{ text: string }>('PUT', `/api/furniture/${id}/text`, { text }),
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
  community: () => call<{ discordUrl: string | null }>('GET', '/api/community'),
  staffEconomy: () => call<Economy>('GET', '/api/staff/economy'),
  staffMarketFlags: (status: 'open' | 'handled') => call<{ flags: MarketFlag[] }>('GET', `/api/staff/market/flags?status=${status}`),
  staffHandleFlag: (id: number) => call<void>('POST', `/api/staff/market/flags/${id}/handle`),
  staffMarketPlayer: (nickname: string) => call<MarketPlayerSheet>('GET', `/api/staff/market/player?nickname=${encodeURIComponent(nickname)}`),
  staffReverseSale: (id: number, note: string) => call<void>('POST', `/api/staff/market/sales/${id}/reverse`, { note }),
  staffMarketBlock: (nickname: string, reason: string, minutes?: number) => call<void>('POST', '/api/staff/market/block', { nickname, reason, minutes }),
  staffMarketUnblock: (nickname: string) => call<void>('POST', '/api/staff/market/unblock', { nickname }),
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
  marketRules: () => call<MarketRules>('GET', '/api/market/rules'),
  marketListings: (query: MarketQuery = {}) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.sort) params.set('sort', query.sort);
    if (query.mine) params.set('mine', '1');
    if (query.offset) params.set('offset', String(query.offset));
    return call<{ total: number; listings: MarketListing[] }>('GET', `/api/market/listings?${params}`);
  },
  royalties: () =>
    call<{ resales: number; earned: number; top: { itemId: string; name: string; serial: number; resales: number; earned: number; lastPrice: number }[] }>('GET', '/api/market/royalties'),
  sell: (itemId: string, price: number) => call<{ id: string; price: number; expiresAt: string }>('POST', '/api/market/listings', { itemId, price }),
  withdraw: (listingId: string) => call<void>('DELETE', `/api/market/listings/${listingId}`),
  buyListing: (listingId: string) => call<{ itemId: string; price: number; coloxs: number }>('POST', `/api/market/listings/${listingId}/buy`),
  itemHistory: (itemId: string) => call<{ history: OwnerLine[] }>('GET', `/api/items/${itemId}/history`),
  currentTrade: () => call<{ trade: TradeData | null }>('GET', '/api/trades/current'),
  startTrade: (nickname: string) => call<{ trade: TradeData }>('POST', '/api/trades', { nickname }),
  offerTrade: (id: string, itemIds: string[]) => call<{ trade: TradeData }>('PUT', `/api/trades/${id}/offer`, { itemIds }),
  acceptTrade: (id: string, version: number) => call<{ trade: TradeData | null; done: boolean }>('POST', `/api/trades/${id}/accept`, { version }),
  confirmTrade: (id: string, version: number) => call<{ trade: TradeData | null; done: boolean }>('POST', `/api/trades/${id}/confirm`, { version }),
  cancelTrade: (id: string) => call<void>('DELETE', `/api/trades/${id}`),
  wallet: () => call<WalletData>('GET', '/api/wallet'),
  daily: () => call<{ pixels: number; gained: number }>('POST', '/api/wallet/daily'),
  redeem: (code: string) => call<{ pixels: number; gained: number }>('POST', '/api/wallet/redeem', { code }),
  myLook: () => call<LookData>('GET', '/api/me/look'),
  saveLook: (look: Look) => call<{ look: Look }>('PUT', '/api/me/look', look),
  buy: (order: Purchase) => call<PurchaseResult>('POST', '/api/shop/buy', order),
  pets: () => call<{ pets: PetData[] }>('GET', '/api/pets'),
  setActivePet: (id: string | null) => call<{ pets: PetData[] }>('PUT', '/api/pets/active', { id }),
  renamePet: (id: string, name: string) => call<{ pets: PetData[] }>('PATCH', `/api/pets/${id}`, { name }),
  feedPet: (id: string) => call<{ pets: PetData[] }>('POST', `/api/pets/${id}/feed`, {}),
  playWithPet: (id: string) => call<{ pets: PetData[] }>('POST', `/api/pets/${id}/play`, {}),
  releasePet: (id: string) => call<{ pets: PetData[] }>('DELETE', `/api/pets/${id}`),
};

export const itemSpriteUrl = (id: string, rot = 0) => `/api/items/${id}.png?v=${SPRITE_VERSION}${rot ? `&r=${rot}` : ''}`;
export const furnitureSpriteUrl = (key: string, rot = 0, alt = false, frame = 0) =>
  `/api/catalogue/${key}.png?v=${SPRITE_VERSION}${rot ? `&r=${rot}` : ''}${alt ? '&s=1' : ''}${frame ? `&f=${frame}` : ''}`;
