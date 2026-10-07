import { Application, Container } from 'pixi.js';
import type { User } from './api';
import { createBuildingScene } from './building-scene';
import { createCatalogue } from './catalogue';
import { createNavigator } from './navigator';
import { createRoomScene } from './room-scene';
import { sameTarget, type Scene, type SceneHost, type Target } from './scene';

const PANEL_WIDTH = 340;
const BAR_SPACE = 100;

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
  // The canvas is the whole window; the page's gradient shows through behind the scene.
  await app.init({ resizeTo: window, backgroundAlpha: 0, antialias: false, roundPixels: true });
  try {
    await document.fonts.load('8px "Press Start 2P"');
  } catch {
    // The fallback monospace font is fine.
  }

  document.body.classList.add('in-game');
  app.canvas.className = 'game-canvas';
  const stage = new Container();
  app.stage.addChild(stage);
  // Handy for end-to-end scripts that click on scene coordinates (development only).
  if (import.meta.env.DEV) (window as unknown as { __stage: Container }).__stage = stage;
  const vignette = document.createElement('div');
  vignette.className = 'vignette';
  const panelHost = document.createElement('div');
  panelHost.className = 'panel-host';
  const panelToggle = document.createElement('button');
  panelToggle.type = 'button';
  panelToggle.className = 'panel-toggle';
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  const nav = document.createElement('nav');
  nav.className = 'navbar';
  nav.setAttribute('aria-label', 'Navigation');
  document.body.append(app.canvas, vignette, panelHost, panelToggle, nav, toast);

  let scene: Scene | null = null;
  let current: Target | null = null;
  let switching = 0;

  // The panel floats over the right of the window; on a narrow window it starts hidden.
  let panelOpen = innerWidth >= 900;
  const syncPanel = () => {
    panelHost.hidden = !panelOpen;
    panelToggle.textContent = panelOpen ? 'Masquer le panneau' : 'Panneau';
    panelToggle.setAttribute('aria-expanded', String(panelOpen));
    fit();
  };
  panelToggle.addEventListener('click', () => {
    panelOpen = !panelOpen;
    syncPanel();
  });

  /** Scale the scene as large as the free part of the window allows, and centre it there. */
  function fit() {
    const { w, h } = scene?.size ?? { w: 600, h: 400 };
    const availW = innerWidth - (panelOpen ? PANEL_WIDTH + 24 : 0);
    const availH = innerHeight - BAR_SPACE;
    const s = Math.min(availW / w, availH / h);
    // Whole steps when there is room (crisp pixels), finer steps on a small window.
    const scale = Math.max(0.5, s >= 2 ? Math.floor(s * 2) / 2 : Math.floor(s * 4) / 4);
    stage.scale.set(scale);
    stage.position.set(Math.round((availW - w * scale) / 2), Math.round((availH - h * scale) / 2 + 8));
  }
  addEventListener('resize', fit);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = (text: string) => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 3500);
  };

  const host: SceneHost = {
    app,
    stage,
    pointer: (ev) => {
      const r = app.canvas.getBoundingClientRect();
      return {
        x: (ev.clientX - r.left - stage.position.x) / stage.scale.x,
        y: (ev.clientY - r.top - stage.position.y) / stage.scale.y,
      };
    },
    user,
    go: (target) => void go(target),
    notify,
  };
  const home: Target = { kind: 'apartment', ownerId: user.id };

  const navigator = createNavigator({
    go: (target) => void go(target),
    onToggle: () => markActive(),
  });
  document.body.append(navigator.element);

  // Taking furniture or changing the look works from anywhere; the apartment on screen, if it is ours, follows.
  const catalogue = createCatalogue({
    onChanged: () => void scene?.refresh?.(),
    onToggle: () => markActive(),
  });
  document.body.append(catalogue.element);

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
    { key: 'navigator', label: 'Navigateur', active: () => navigator.isOpen(), run: () => {
        catalogue.close();
        navigator.toggle();
      },
    },
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
    { key: 'catalogue', label: 'Catalogue', active: () => catalogue.isOpen(), run: () => {
        navigator.close();
        catalogue.toggle();
      },
    },
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
    if (item.key === 'catalogue') b.dataset.catalogueToggle = '';
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
    catalogue.close();
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
    fit();
    markActive();
  }

  syncPanel();
  await go(home);
}
