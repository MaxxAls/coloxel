import { DEFAULT_LOOK, LOOK_ITEMS, SLOTS, paidPieces, type Look, type Slot } from '@coloxel/render';
import { api } from './api';
import { wallet } from './wallet';

// What the player wears and owns, shared by the wardrobe and the shop. The
// server checks every save and every purchase: this only keeps the last answer.

let look: Look = DEFAULT_LOOK;
let owned = Object.fromEntries(SLOTS.map((s) => [s, [] as number[]])) as Record<Slot, number[]>;
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const savedHooks = new Set<() => void>();
const emit = () => listeners.forEach((cb) => cb());

export interface Missing {
  slot: Slot;
  id: number;
  name: string;
  price: number;
}

export const appearance = {
  get look() {
    return look;
  },
  load(force = false): Promise<void> {
    if (!loaded || force) {
      loaded = api.myLook().then((res) => {
        if (res.ok) {
          look = res.data.look;
          owned = res.data.owned;
          emit();
        } else {
          loaded = null;
        }
      });
    }
    return loaded;
  },
  owns: (slot: Slot, id: number): boolean => (LOOK_ITEMS[slot][id]?.price ?? 1) === 0 || owned[slot].includes(id),
  /** The paid pieces a look wears that the player does not own yet. */
  missing(candidate: Look): Missing[] {
    return paidPieces(candidate)
      .filter((p) => !owned[p.slot].includes(p.id))
      .map((p) => ({ ...p, name: LOOK_ITEMS[p.slot][p.id]!.name }));
  },
  async save(next: Look): Promise<{ ok: boolean; message: string }> {
    const res = await api.saveLook(next);
    if (!res.ok) return { ok: false, message: res.error };
    look = res.data.look;
    emit();
    savedHooks.forEach((cb) => cb());
    return { ok: true, message: 'Ton personnage est enregistré !' };
  },
  async buy(slot: Slot, id: number): Promise<{ ok: boolean; message: string }> {
    const res = await api.buy({ kind: 'clothing', slot, piece: id });
    if (!res.ok) return { ok: false, message: res.error };
    owned = { ...owned, [slot]: [...owned[slot], id] };
    wallet.setPixels(res.data.pixels);
    emit();
    return { ok: true, message: `« ${LOOK_ITEMS[slot][id]!.name} » est à toi !` };
  },
  onChange(cb: () => void) {
    listeners.add(cb);
    return () => void listeners.delete(cb);
  },
  /** Called after the server accepted a new look: the room must tell the others. */
  onSaved(cb: () => void) {
    savedHooks.add(cb);
    return () => void savedHooks.delete(cb);
  },
  notifySaved() {
    savedHooks.forEach((cb) => cb());
  },
};
