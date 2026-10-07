import { api, type WalletData } from './api';
import { pixelIcon } from './pixel-icons';

// The player's Pixels, shared by the bar at the top and the shop. The server
// owns the balance: this only mirrors the last number it sent.

let state: WalletData = { pixels: 0, dailyAvailable: false, dailyPixels: 0 };
const listeners = new Set<(w: WalletData) => void>();
const emit = () => listeners.forEach((cb) => cb(state));

export const wallet = {
  get: () => state,
  async refresh() {
    const res = await api.wallet();
    if (res.ok) {
      state = res.data;
      emit();
    }
  },
  /** The server's answer to a purchase or a reward carries the new balance. */
  setPixels(pixels: number | null | undefined) {
    if (typeof pixels !== 'number') return;
    state = { ...state, pixels };
    emit();
  },
  async claimDaily(): Promise<{ ok: boolean; message: string }> {
    const res = await api.daily();
    if (!res.ok) {
      if (res.status === 409) {
        state = { ...state, dailyAvailable: false };
        emit();
      }
      return { ok: false, message: res.error };
    }
    state = { ...state, pixels: res.data.pixels, dailyAvailable: false };
    emit();
    return { ok: true, message: `+${res.data.gained} Pixels : ta récompense du jour !` };
  },
  async redeem(code: string): Promise<{ ok: boolean; message: string }> {
    const res = await api.redeem(code);
    if (!res.ok) return { ok: false, message: res.error };
    wallet.setPixels(res.data.pixels);
    return { ok: true, message: `Code accepté : +${res.data.gained} Pixels !` };
  },
  onChange(cb: (w: WalletData) => void) {
    listeners.add(cb);
    return () => void listeners.delete(cb);
  },
};

/** "◆ 120", with the gem drawn in pixels. */
export function pixelsLabel(amount: number | string, className = 'px'): HTMLElement {
  const span = document.createElement('span');
  span.className = className;
  span.append(pixelIcon('gem', 14), document.createTextNode(String(amount)));
  return span;
}

/** The bar at the top left: the Pixels, the daily reward and the (not yet open) purchase of credits. */
export function createHud(handlers: { notify(text: string): void }): HTMLElement {
  const root = document.createElement('div');
  root.className = 'hud';

  const balance = document.createElement('div');
  balance.className = 'hud-balance';
  balance.title = 'Tes Pixels : la monnaie gratuite du jeu';
  const amount = document.createElement('strong');
  const label = document.createElement('span');
  label.textContent = 'Pixels';
  balance.append(pixelIcon('gem', 16), amount, label);

  const daily = document.createElement('button');
  daily.type = 'button';
  daily.className = 'hud-daily';
  daily.append(pixelIcon('gift', 16), document.createTextNode('Récompense du jour'));
  daily.addEventListener('click', async () => {
    daily.disabled = true;
    handlers.notify((await wallet.claimDaily()).message);
  });

  const credits = document.createElement('button');
  credits.type = 'button';
  credits.className = 'hud-credits';
  credits.textContent = 'Obtenir des crédits';
  credits.addEventListener('click', () => handlers.notify('Les crédits payants arrivent bientôt. En attendant, joue et récupère tes Pixels chaque jour !'));

  root.append(balance, daily, credits);

  let shown = -1;
  let tween = 0;
  const render = (w: WalletData) => {
    daily.hidden = !w.dailyAvailable;
    daily.disabled = false;
    const from = shown < 0 ? w.pixels : shown;
    cancelAnimationFrame(tween);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      shown = Math.round(from + (w.pixels - from) * t);
      amount.textContent = String(shown);
      if (t < 1) tween = requestAnimationFrame(step);
    };
    if (from !== w.pixels) {
      balance.classList.remove('bump');
      void balance.offsetWidth;
      balance.classList.add('bump');
    }
    tween = requestAnimationFrame(step);
  };
  wallet.onChange(render);
  render(wallet.get());
  void wallet.refresh();
  return root;
}
