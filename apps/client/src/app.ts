import { Application } from 'pixi.js';
import type { User } from './api';
import { createBuildingScene } from './building-scene';
import { createNavigator } from './navigator';
import { createRoomScene } from './room-scene';
import { sameTarget, type Scene, type SceneHost, type Target } from './scene';

const PANEL_WIDTH = 320;

// 8x8 pixel icons, drawn with the current text color.
const ICONS: Record<string, string[]> = {
  building: ['.######.', '.#.##.#.', '.######.', '.#.##.#.', '.######.', '.#.##.#.', '.######.', '.##..##.'],
  home: ['...##...', '..####..', '.######.', '########', '.#.##.#.', '.#.##.#.', '.#.##.#.', '.######.'],
  navigator: ['..####..', '.#....#.', '#...#..#', '#..##..#', '#.##...#', '#.#....#', '.#....#.', '..####..'],
  inventory: ['..####..', '..#..#..', '.######.', '########', '#.####.#', '########', '########', '.######.'],
  catalogue: ['########', '#.#.#.#.', '########', '#......#', '#.####.#', '#.#..#.#', '#.#..#.#', '########'],
  friends: ['.##..##.', '.##..##.', '..#...#.', '####.###', '####.###', '.##..##.', '.##..##.', '.#.#.#.#'],
};

function icon(name: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  ICONS[name]!.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== '#') return;
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', '1');
      r.setAttribute('height', '1');
      r.setAttribute('fill', 'currentColor');
      svg.append(r);
    }),
  );
  return svg;
}

/** The game shell: one canvas, a side panel, the permanent bottom bar, and the scene being shown. */
export async function startApp(user: User) {
  const app = new Application();
  await app.init({ width: 300, height: 216, background: 0x120f22, antialias: false, roundPixels: true });
  try {
    await document.fonts.load('8px "Press Start 2P"');
  } catch {
    // The fallback monospace font is fine.
  }

  const layout = document.createElement('div');
  layout.className = 'game';
  const stage = document.createElement('div');
  stage.className = 'stage';
  const frame = document.createElement('div');
  frame.className = 'frame';
  frame.append(app.canvas);
  const panelHost = document.createElement('div');
  panelHost.className = 'panel-host';
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  const nav = document.createElement('nav');
  nav.className = 'navbar';
  nav.setAttribute('aria-label', 'Navigation');
  stage.append(frame);
  layout.append(stage, panelHost);
  document.body.append(layout, nav, toast);

  let scene: Scene | null = null;
  let current: Target | null = null;
  let switching = 0;

  const fit = () => {
    const { w, h } = scene?.size ?? { w: 300, h: 216 };
    const room = Math.max(280, innerWidth - (innerWidth > 760 ? PANEL_WIDTH + 64 : 32));
    const scale = Math.max(1, Math.floor(Math.min(room / w, (innerHeight - 100) / h)));
    app.canvas.style.width = `${w * scale}px`;
    app.canvas.style.height = `${h * scale}px`;
  };
  addEventListener('resize', fit);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = (text: string) => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 3500);
  };

  const host: SceneHost = { app, user, go: (target) => void go(target), notify };
  const home: Target = { kind: 'apartment', ownerId: user.id };

  const navigator = createNavigator({
    go: (target) => void go(target),
    onToggle: () => markActive(),
  });
  document.body.append(navigator.element);

  // ----- Bottom bar ----------------------------------------------------------
  interface Item {
    key: string;
    label: string;
    /** Highlighted while this is where the player is (or what is open). */
    active: () => boolean;
    run?: () => void | Promise<void>;
    soon?: boolean;
  }
  const items: Item[] = [
    { key: 'building', label: 'Immeuble', active: () => current?.kind === 'building', run: () => go({ kind: 'building' }) },
    { key: 'home', label: 'Mon appart', active: () => !!current && sameTarget(current, home), run: () => go(home) },
    { key: 'navigator', label: 'Navigateur', active: () => navigator.isOpen(), run: () => navigator.toggle() },
    {
      key: 'inventory',
      label: 'Inventaire',
      active: () => false,
      // The inventory lives in the panel of the player's own apartment.
      run: async () => {
        await go(home);
        const list = document.querySelector<HTMLElement>('.panel .inventory');
        list?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        list?.classList.add('flash');
        setTimeout(() => list?.classList.remove('flash'), 900);
      },
    },
    { key: 'catalogue', label: 'Catalogue', active: () => false, soon: true },
    { key: 'friends', label: 'Amis', active: () => false, soon: true },
  ];
  const buttons = new Map<string, HTMLButtonElement>();
  for (const item of items) {
    const b = document.createElement('button');
    b.type = 'button';
    const label = document.createElement('span');
    label.textContent = item.label;
    b.append(icon(item.key), label);
    if (item.key === 'navigator') b.dataset.navigatorToggle = '';
    if (item.soon) {
      b.disabled = true;
      b.title = 'Bientôt disponible';
    } else {
      b.addEventListener('click', () => void item.run?.());
    }
    buttons.set(item.key, b);
    nav.append(b);
  }
  function markActive() {
    for (const item of items) {
      const active = item.active();
      buttons.get(item.key)!.classList.toggle('active', active);
      buttons.get(item.key)!.setAttribute('aria-pressed', String(active));
    }
  }

  async function go(target: Target) {
    navigator.close();
    if (current && sameTarget(current, target)) return;
    const ticket = ++switching;
    nav.classList.add('busy');
    // Leaving a scene leaves its realtime room: we are never in two places at once.
    scene?.destroy();
    scene = null;
    current = null;
    panelHost.replaceChildren();

    const created =
      target.kind === 'building' ? await createBuildingScene(host) : await createRoomScene(host, target);
    if (ticket !== switching) {
      // Another move started while we were joining: drop this one.
      if (!('error' in created)) created.destroy();
      return;
    }
    nav.classList.remove('busy');
    if ('error' in created) {
      notify(created.error);
      // Fall back to the building, unless that is what just failed.
      if (target.kind !== 'building') return void go({ kind: 'building' });
      markActive();
      return;
    }
    scene = created;
    current = target;
    panelHost.replaceChildren(created.panel);
    app.renderer.resize(created.size.w, created.size.h);
    fit();
    markActive();
  }

  await go(home);
}
