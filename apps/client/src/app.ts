import { Application } from 'pixi.js';
import type { User } from './api';
import { createBuildingScene } from './building-scene';
import { createRoomScene } from './room-scene';
import { sameTarget, type Scene, type SceneHost, type Target } from './scene';

const PANEL_WIDTH = 320;

/** The game shell: one canvas, a side panel, a navigation bar, and the scene being shown. */
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
  const nav = document.createElement('nav');
  nav.className = 'navbar';
  nav.setAttribute('aria-label', 'Navigation');
  const panelHost = document.createElement('div');
  panelHost.className = 'panel-host';
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  stage.append(frame, nav);
  layout.append(stage, panelHost);
  document.body.append(layout, toast);

  let scene: Scene | null = null;
  let current: Target | null = null;
  let switching = 0;

  const fit = () => {
    const { w, h } = scene?.size ?? { w: 300, h: 216 };
    const room = Math.max(280, innerWidth - (innerWidth > 760 ? PANEL_WIDTH + 64 : 32));
    const scale = Math.max(1, Math.floor(Math.min(room / w, (innerHeight - 110) / h)));
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

  const buttons = new Map<string, HTMLButtonElement>();
  const links: [string, string, Target][] = [
    ['building', 'Immeuble', { kind: 'building' }],
    ['home', 'Mon appart', { kind: 'apartment', ownerId: user.id }],
    ['hall', 'Hall', { kind: 'hall' }],
  ];
  const markActive = () => {
    for (const [key, , target] of links) {
      const active = !!current && sameTarget(current, target);
      buttons.get(key)!.classList.toggle('active', active);
      buttons.get(key)!.setAttribute('aria-current', active ? 'page' : 'false');
    }
  };

  const host: SceneHost = { app, user, go: (target) => void go(target), notify };

  async function go(target: Target) {
    if (current && sameTarget(current, target)) return;
    const ticket = ++switching;
    nav.classList.add('busy');
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
      current = null;
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

  for (const [key, label, target] of links) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => void go(target));
    buttons.set(key, b);
    nav.append(b);
  }

  await go({ kind: 'apartment', ownerId: user.id });
}
