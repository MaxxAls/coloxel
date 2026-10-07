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
  placement: { i: number; j: number } | null;
}

/** A piece of base furniture: free, not numbered, not tradeable. Not a creation. */
export interface FurnitureItem {
  id: string;
  key: string;
  name: string;
  placement: { i: number; j: number } | null;
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
  visitors: number;
}

export interface VisitedApartment {
  owner: { id: string; nickname: string };
  name: string | null;
  floor: string;
  wall: string;
  items: InventoryItem[];
  furniture: FurnitureItem[];
}

export type ApartmentAccess = 'closed' | 'friends' | 'building';

export interface MyApartment {
  id: number;
  floor: number;
  slot: number;
  name: string | null;
  access: ApartmentAccess;
  floorStyle: string;
  wallStyle: string;
}

export interface NavigatorData {
  places: { kind: 'hall'; name: string; visitors: number }[];
  open: { apartmentId: number; ownerId: string; nickname: string; name: string | null; mine: boolean; visitors: number }[];
  friends: { ownerId: string; nickname: string; where: string }[];
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
  throwFurniture: (id: string) => call<unknown>('DELETE', `/api/furniture/${id}`),
  place: (itemId: string, i: number, j: number) => call<unknown>('PUT', '/api/placements', { itemId, i, j }),
  building: () => call<{ apartments: BuildingApartment[] }>('GET', '/api/building'),
  apartment: (ownerId: string) => call<VisitedApartment>('GET', `/api/apartments/${ownerId}`),
  myApartment: () => call<MyApartment>('GET', '/api/apartment'),
  updateApartment: (body: { name?: string | null; access?: ApartmentAccess; floor?: string; wall?: string }) =>
    call<MyApartment>('PUT', '/api/apartment', body),
  navigator: () => call<NavigatorData>('GET', '/api/navigator'),
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

export const itemSpriteUrl = (id: string) => `/api/items/${id}.png?v=${SPRITE_VERSION}`;
export const furnitureSpriteUrl = (key: string) => `/api/catalogue/${key}.png?v=${SPRITE_VERSION}`;
