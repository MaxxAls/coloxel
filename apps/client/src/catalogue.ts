import { api, type CatalogueData, type MyApartment } from './api';
import { furnitureThumb } from './thumb';

type Tab = 'furniture' | 'floors' | 'walls';

const TABS: [Tab, string][] = [
  ['furniture', 'Meubles'],
  ['floors', 'Sols'],
  ['walls', 'Murs'],
];

export interface Catalogue {
  element: HTMLElement;
  isOpen(): boolean;
  toggle(): void;
  close(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** The base catalogue: free furniture in any quantity, and the floors and wallpapers of the apartment. */
export function createCatalogue(options: {
  /** Something changed in the player's apartment or inventory. */
  onChanged(): void;
  onToggle(open: boolean): void;
}): Catalogue {
  const root = el('section', 'catalogue');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Catalogue');

  const head = el('div', 'catalogue-head');
  head.append(el('h2', undefined, 'Catalogue'), el('p', 'muted small', 'Tout est gratuit, prends-en autant que tu veux.'));
  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  const grid = el('div', 'catalogue-grid');
  const status = el('p', 'muted small');
  status.setAttribute('role', 'status');
  root.append(head, tabs, grid, status);

  let tab: Tab = 'furniture';
  let data: CatalogueData | null = null;
  let mine: MyApartment | null = null;
  const tabButtons = new Map<Tab, HTMLButtonElement>();

  async function take(key: string, name: string, button: HTMLButtonElement) {
    button.disabled = true;
    const res = await api.takeFurniture(key);
    button.disabled = false;
    status.textContent = res.ok ? `« ${name} » est dans ton inventaire.` : res.error;
    if (res.ok) options.onChanged();
  }

  async function setLook(body: { floor?: string; wall?: string }) {
    const res = await api.updateApartment(body);
    if (res.ok) {
      mine = res.data;
      status.textContent = 'Ton appart a changé de look !';
      options.onChanged();
      render();
    } else {
      status.textContent = res.error;
    }
  }

  const render = () => {
    for (const [key, button] of tabButtons) {
      button.classList.toggle('active', key === tab);
      button.setAttribute('aria-selected', String(key === tab));
    }
    grid.replaceChildren();
    grid.className = `catalogue-grid ${tab}`;
    if (!data) {
      status.textContent = 'Chargement…';
      return;
    }
    if (tab === 'furniture') {
      for (const f of data.furniture) {
        const card = el('div', 'piece');
        const take1 = el('button', undefined, 'Prendre');
        take1.type = 'button';
        take1.addEventListener('click', () => void take(f.key, f.name, take1));
        card.append(furnitureThumb(f.key, 'lg'), el('strong', undefined, f.name), take1);
        grid.append(card);
      }
    } else if (tab === 'floors') {
      for (const f of data.floors) {
        grid.append(swatch(f.name, `linear-gradient(135deg, ${hex(f.a)} 50%, ${hex(f.b)} 50%)`, mine?.floorStyle === f.id, () => void setLook({ floor: f.id })));
      }
    } else {
      for (const w of data.walls) {
        grid.append(swatch(w.name, `linear-gradient(90deg, ${hex(w.left)} 50%, ${hex(w.right)} 50%)`, mine?.wallStyle === w.id, () => void setLook({ wall: w.id })));
      }
    }
  };

  function swatch(name: string, background: string, active: boolean, run: () => void) {
    const b = el('button', `swatch-card${active ? ' active' : ''}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(active));
    const chip = el('span', 'chip');
    chip.style.background = background;
    b.append(chip, el('span', undefined, name));
    b.addEventListener('click', run);
    return b;
  }

  for (const [key, label] of TABS) {
    const b = el('button', undefined, label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = key;
      status.textContent = '';
      render();
    });
    tabButtons.set(key, b);
    tabs.append(b);
  }

  const load = async () => {
    const [cat, apt] = await Promise.all([api.catalogue(), api.myApartment()]);
    if (cat.ok) data = cat.data;
    else status.textContent = cat.error;
    if (apt.ok) mine = apt.data;
    render();
  };

  function hide() {
    if (root.hidden) return;
    root.hidden = true;
    options.onToggle(false);
  }
  const open = () => {
    root.hidden = false;
    status.textContent = '';
    render();
    void load();
    options.onToggle(true);
  };

  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') hide();
  });
  addEventListener('pointerdown', (ev) => {
    const t = ev.target as HTMLElement;
    if (!root.hidden && !root.contains(t) && !t.closest?.('[data-catalogue-toggle]')) hide();
  });

  return { element: root, isOpen: () => !root.hidden, toggle: () => (root.hidden ? open() : hide()), close: hide };
}
