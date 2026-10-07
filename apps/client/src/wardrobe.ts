import { CLOTH_COLORS, EYES, HAIR_COLORS, LOOK_ITEMS, MOUTHS, SKIN_TONES, lookFor, type Look, type Slot } from '@coloxel/render';
import { appearance } from './appearance';
import type { Frame } from './avatar';
import { lookCanvas, thumbCanvas } from './look-art';
import { pixelIcon } from './pixel-icons';
import { pixelsLabel, wallet } from './wallet';
import { windowBar } from './window';

type Tab = Slot | 'face';

const TABS: [Tab, string][] = [
  ['face', 'Visage'],
  ['hair', 'Cheveux'],
  ['top', 'Hauts'],
  ['bottom', 'Bas'],
  ['shoes', 'Chaussures'],
  ['hat', 'Chapeaux'],
  ['glasses', 'Lunettes'],
  ['extra', 'Extras'],
];

const COLOR_KEY: Partial<Record<Slot, keyof Look>> = {
  hair: 'hairColor',
  top: 'topColor',
  bottom: 'bottomColor',
  shoes: 'shoesColor',
  hat: 'hatColor',
  extra: 'extraColor',
};

export interface Wardrobe {
  element: HTMLElement;
  isOpen(): boolean;
  toggle(): void;
  open(): void;
  close(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const same = (a: Look, b: Look) => (Object.keys(a) as (keyof Look)[]).every((k) => a[k] === b[k]);

/** The character editor: a live preview on the left, the wardrobe on the right. */
export function createWardrobe(options: { onToggle(open: boolean): void; notify(text: string): void }): Wardrobe {
  const root = el('section', 'window wardrobe');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Mon personnage');

  // Left: the preview.
  const stage = el('div', 'wd-stage');
  const view = el('div', 'wd-view');
  const controls = el('div', 'wd-controls');
  const turn = el('button', undefined, 'Tourner');
  const walk = el('button', undefined, 'Marcher');
  const dice = el('button', undefined, 'Au hasard');
  for (const b of [turn, walk, dice]) b.type = 'button';
  controls.append(turn, walk, dice);
  const balance = el('div', 'wd-balance');
  stage.append(view, controls, balance);

  // Right: the wardrobe.
  const tabs = el('div', 'tabs wd-tabs');
  tabs.setAttribute('role', 'tablist');
  const grid = el('div', 'wd-grid');
  const colors = el('div', 'wd-colors');
  const right = el('div', 'wd-right');
  right.append(tabs, grid, colors);

  const footer = el('div', 'wd-foot');
  const note = el('p', 'muted small wd-note');
  note.setAttribute('role', 'status');
  const reset = el('button', undefined, 'Annuler les changements');
  reset.type = 'button';
  const save = el('button', 'primary', 'Enregistrer');
  save.type = 'button';
  footer.append(note, reset, save);

  const layout = el('div', 'wd-layout');
  layout.append(stage, right);
  root.append(windowBar('Mon personnage', () => close()), layout, footer);

  let draft: Look = appearance.look;
  let tab: Tab = 'face';
  let facing: 'front' | 'back' = 'front';
  let walking = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let tick = 0;
  const tabButtons = new Map<Tab, HTMLButtonElement>();
  let busy = false;

  // ----- Preview -----------------------------------------------------------------
  const drawPreview = () => {
    const frame: Frame = walking ? ([1, 0, 2, 0][tick % 4] as Frame) : 0;
    const blink = !walking && tick % 24 === 0;
    view.replaceChildren(lookCanvas(draft, { zoom: 5, facing, frame, blink }));
  };

  // ----- Footer ------------------------------------------------------------------
  const refreshFooter = () => {
    const missing = appearance.missing(draft);
    const total = missing.reduce((sum, m) => sum + m.price, 0);
    reset.disabled = busy || same(draft, appearance.look);
    save.replaceChildren();
    if (missing.length) {
      save.append(el('span', undefined, 'Acheter et enregistrer '), pixelsLabel(total, 'px dark'));
      save.disabled = busy || total > wallet.get().pixels;
      note.textContent =
        total > wallet.get().pixels
          ? `Il te manque ${total - wallet.get().pixels} Pixels pour : ${missing.map((m) => m.name).join(', ')}.`
          : `À acheter : ${missing.map((m) => m.name).join(', ')}.`;
    } else {
      save.append(document.createTextNode('Enregistrer'));
      save.disabled = busy || same(draft, appearance.look);
      note.textContent = same(draft, appearance.look) ? 'Choisis tes vêtements : tout se voit tout de suite.' : 'Tu portes ces vêtements en essai : enregistre pour les garder.';
    }
    balance.replaceChildren(el('span', undefined, 'Tes Pixels'), pixelsLabel(wallet.get().pixels));
  };

  const change = (patch: Partial<Look>) => {
    draft = { ...draft, ...patch };
    drawPreview();
    renderTab();
    refreshFooter();
  };

  // ----- Tabs --------------------------------------------------------------------
  const swatches = (palette: readonly number[], current: number, onPick: (k: number) => void) => {
    const row = el('div', 'wd-swatches');
    palette.forEach((c, k) => {
      const b = el('button', `wd-swatch${k === current ? ' active' : ''}`);
      b.type = 'button';
      b.style.background = hex(c);
      b.setAttribute('aria-label', `Couleur ${k + 1}`);
      b.setAttribute('aria-pressed', String(k === current));
      b.addEventListener('click', () => onPick(k));
      row.append(b);
    });
    return row;
  };

  const heading = (text: string) => el('h3', 'wd-heading', text);

  const choiceTile = (label: string, area: Tab, preview: Look, active: boolean, onPick: () => void, extra?: HTMLElement) => {
    const b = el('button', `wd-tile${active ? ' active' : ''}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(active));
    b.append(thumbCanvas(preview, area === 'face' ? 'face' : area), el('span', 'wd-tile-name', label));
    if (extra) b.append(extra);
    b.addEventListener('click', onPick);
    return b;
  };

  const renderTab = () => {
    for (const [key, button] of tabButtons) {
      button.classList.toggle('active', key === tab);
      button.setAttribute('aria-selected', String(key === tab));
    }
    grid.replaceChildren();
    colors.replaceChildren();
    if (tab === 'face') {
      grid.className = 'wd-grid face';
      grid.append(heading('Peau'), swatches(SKIN_TONES, draft.skin, (skin) => change({ skin })));
      grid.append(heading('Yeux'));
      const eyes = el('div', 'wd-tiles');
      EYES.forEach((name, k) => eyes.append(choiceTile(name, 'face', { ...draft, eyes: k }, draft.eyes === k, () => change({ eyes: k }))));
      grid.append(eyes, heading('Bouche'));
      const mouths = el('div', 'wd-tiles');
      MOUTHS.forEach((name, k) => mouths.append(choiceTile(name, 'face', { ...draft, mouth: k }, draft.mouth === k, () => change({ mouth: k }))));
      grid.append(mouths);
      return;
    }
    grid.className = 'wd-grid';
    const slot = tab;
    const tiles = el('div', 'wd-tiles');
    for (const piece of LOOK_ITEMS[slot]) {
      const owns = appearance.owns(slot, piece.id);
      const badge = el('span', 'wd-badge');
      if (piece.price === 0) badge.append(document.createTextNode(''));
      else if (owns) badge.append(pixelIcon('check', 12), document.createTextNode(' À toi'));
      else badge.append(pixelIcon('lock', 12), pixelsLabel(piece.price, 'px small'));
      badge.classList.toggle('owned', piece.price > 0 && owns);
      tiles.append(
        choiceTile(piece.name, slot, { ...draft, [slot]: piece.id }, draft[slot] === piece.id, () => change({ [slot]: piece.id } as Partial<Look>), badge),
      );
    }
    grid.append(tiles);
    const colorKey = COLOR_KEY[slot];
    const piece = LOOK_ITEMS[slot][draft[slot]];
    if (colorKey && (slot === 'hair' ? draft.hair !== 9 : piece?.colorable)) {
      colors.append(
        heading(slot === 'hair' ? 'Couleur des cheveux' : 'Couleur'),
        swatches(slot === 'hair' ? HAIR_COLORS : CLOTH_COLORS, draft[colorKey], (k) => change({ [colorKey]: k } as Partial<Look>)),
      );
    }
  };

  for (const [key, label] of TABS) {
    const b = el('button', undefined, label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = key;
      renderTab();
    });
    tabButtons.set(key, b);
    tabs.append(b);
  }

  // ----- Actions -----------------------------------------------------------------
  turn.addEventListener('click', () => {
    facing = facing === 'front' ? 'back' : 'front';
    drawPreview();
  });
  walk.addEventListener('click', () => {
    walking = !walking;
    walk.textContent = walking ? 'S’arrêter' : 'Marcher';
    walk.classList.toggle('active', walking);
    drawPreview();
  });
  dice.addEventListener('click', () => {
    // A look made of pieces the player may already wear.
    const random = lookFor(`${Math.random()}`);
    const owned = (slot: Slot, k: number) => (appearance.owns(slot, k) ? k : 0);
    change({ ...random, hat: owned('hat', random.hat), glasses: owned('glasses', random.glasses) });
  });
  reset.addEventListener('click', () => {
    draft = appearance.look;
    drawPreview();
    renderTab();
    refreshFooter();
  });
  save.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    refreshFooter();
    // Buy whatever is not owned yet (the server charges the catalogue price), then save the look.
    for (const m of appearance.missing(draft)) {
      const bought = await appearance.buy(m.slot, m.id);
      if (!bought.ok) {
        busy = false;
        options.notify(bought.message);
        renderTab();
        refreshFooter();
        return;
      }
    }
    const saved = await appearance.save(draft);
    busy = false;
    options.notify(saved.message);
    if (saved.ok) draft = appearance.look;
    renderTab();
    refreshFooter();
  });

  // ----- Open and close ----------------------------------------------------------
  function close() {
    if (root.hidden) return;
    root.hidden = true;
    clearInterval(timer);
    options.onToggle(false);
  }
  function open() {
    if (!root.hidden) return;
    root.hidden = false;
    void appearance.load().then(() => {
      // Keep what is being tried on if the data arrives late; start from the saved look otherwise.
      if (same(draft, DEFAULT_DRAFT) || same(draft, appearance.look)) draft = appearance.look;
      drawPreview();
      renderTab();
      refreshFooter();
    });
    draft = appearance.look;
    tick = 0;
    drawPreview();
    renderTab();
    refreshFooter();
    clearInterval(timer);
    timer = setInterval(() => {
      tick++;
      if (walking || tick % 24 === 0 || tick % 24 === 1) drawPreview();
    }, 140);
    options.onToggle(true);
  }
  const DEFAULT_DRAFT = appearance.look;

  wallet.onChange(() => !root.hidden && refreshFooter());
  appearance.onChange(() => {
    if (root.hidden) return;
    renderTab();
    refreshFooter();
  });
  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') close();
  });
  addEventListener('pointerdown', (ev) => {
    const t = ev.target as HTMLElement;
    if (!root.hidden && !root.contains(t) && !t.closest?.('[data-wardrobe-toggle]') && !t.closest?.('.toast')) close();
  });

  return { element: root, isOpen: () => !root.hidden, toggle: () => (root.hidden ? open() : close()), open, close };
}
