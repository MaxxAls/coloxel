import { Application, Container } from 'pixi.js';
import type { User } from './api';
import { api } from './api';
import { createBuildingScene } from './building-scene';
import { appearance } from './appearance';
import { createFriends } from './friends';
import { createMessages } from './messages';
import { createNavigator } from './navigator';
import { pixelIcon } from './pixel-icons';
import { showNotice } from './notice-dialog';
import { createMarket } from './market';
import { createTrade } from './trade';
import { createQuests } from './quests';
import { createShop } from './shop';
import type { StaffPanel } from './staff-panel';
import { createHud } from './wallet';
import { createWardrobe } from './wardrobe';
import { windowBar } from './window';
import { createRoomScene } from './room-scene';
import { sameTarget, type Scene, type SceneHost, type Target, type WindowKey } from './scene';

/** Room left for the bottom bar, and for the cards at the top, when the scene is fitted to the window. */
const DOCK_SPACE = 96;
const TOP_SPACE = 12;

/** Fade a freshly built scene in so room changes do not pop. */
function fadeIn(stage: Container, app: Application) {
  stage.alpha = 0;
  let t = 0;
  const step = (ticker: { deltaMS: number }) => {
    t += ticker.deltaMS / 220;
    stage.alpha = Math.min(1, t);
    if (t >= 1) app.ticker.remove(step);
  };
  app.ticker.add(step);
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** The game shell: one canvas filling the window, a card at the top left, the windows, and one bar at the bottom for everything else. */
export async function startApp(user: User) {
  const app = new Application();
  // The canvas is the whole window; the page's gradient shows through behind the scene.
  await app.init({ resizeTo: window, backgroundAlpha: 0, antialias: false, roundPixels: true });
  try {
    await document.fonts.load('700 12px "Ubuntu"');
  } catch {
    // The fallback monospace font is fine.
  }

  document.body.classList.add('in-game');
  app.canvas.className = 'game-canvas';
  const stage = new Container();
  app.stage.addChild(stage);
  // Handy for end-to-end scripts that click on scene coordinates (development only).
  if (import.meta.env.DEV) (window as unknown as { __stage: Container }).__stage = stage;
  const vignette = make('div', 'vignette');
  const toast = make('div', 'toast');
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  const infoSlot = make('div', 'info-slot');
  const hud = createHud({ notify: (text) => notify(text) });

  // The bottom bar: where to go, what to say, and the small things (history, account).
  const dock = make('div', 'dock');
  const nav = make('nav', 'dock-nav');
  nav.setAttribute('aria-label', 'Navigation');
  const chatSlot = make('div', 'dock-chat');
  const dockEnd = make('div', 'dock-end');
  dock.append(nav, chatSlot, dockEnd);
  document.body.append(app.canvas, vignette, hud, infoSlot, dock, toast);

  let scene: Scene | null = null;
  let current: Target | null = null;
  let switching = 0;

  /**
   * Place the scene in the free part of the window. A room is shown at the real size of its pixels (or twice that,
   * zoomed in), centred on the part the room covers, and can be dragged around; smaller only when it cannot fit.
   * A scene without a focus (the building) is scaled as large as the window allows.
   */
  let zoom = 1;
  const pan = { x: 0, y: 0 };
  function fit() {
    const { w, h } = scene?.size ?? { w: 600, h: 400 };
    const availW = innerWidth;
    const availH = innerHeight - DOCK_SPACE - TOP_SPACE;
    const focus = scene?.focus?.();
    if (!focus) {
      const s = Math.min(availW / w, availH / h);
      // Whole steps when there is room (crisp pixels), finer steps on a small window.
      const scale = Math.max(0.5, s >= 2 ? Math.floor(s * 2) / 2 : Math.floor(s * 4) / 4);
      stage.scale.set(scale);
      stage.position.set(Math.round((availW - w * scale) / 2), Math.round(TOP_SPACE + (availH - h * scale) / 2));
      return;
    }
    const room = Math.min(availW / focus.w, availH / focus.h);
    const scale = zoom > 1 ? zoom : room >= 1 ? 1 : Math.max(0.5, Math.floor(room * 4) / 4);
    stage.scale.set(scale);
    stage.position.set(
      Math.round(availW / 2 - (focus.x + focus.w / 2) * scale + pan.x),
      Math.round(TOP_SPACE + availH / 2 - (focus.y + focus.h / 2) * scale + pan.y),
    );
  }
  addEventListener('resize', fit);

  // Drag the room around; a drag is not a click. The mouse wheel zooms in and out.
  let drag: { x: number; y: number; px: number; py: number; moved: boolean } | null = null;
  app.canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !scene?.focus) return;
    drag = { x: ev.clientX, y: ev.clientY, px: pan.x, py: pan.y, moved: false };
  });
  addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    app.canvas.style.cursor = 'grabbing';
    pan.x = drag.px + dx;
    pan.y = drag.py + dy;
    fit();
  });
  addEventListener('pointerup', () => {
    app.canvas.style.cursor = '';
    if (drag?.moved) setTimeout(() => (drag = null), 0);
    else drag = null;
  });
  app.canvas.addEventListener(
    'click',
    (ev) => {
      if (drag?.moved) ev.stopImmediatePropagation();
    },
    { capture: true },
  );
  app.canvas.addEventListener(
    'wheel',
    (ev) => {
      if (!scene?.focus) return;
      ev.preventDefault();
      const next = ev.deltaY < 0 ? 2 : 1;
      if (next === zoom) return;
      pan.x *= next / zoom;
      pan.y *= next / zoom;
      zoom = next;
      fit();
    },
    { passive: false },
  );

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = (text: string) => {
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
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
    friendsChanged: () => friends.refresh(),
    openWindow: (key) => {
      closeWindows(key ?? undefined);
      if (key) floating[key].open();
    },
  };
  const home: Target = { kind: 'apartment', ownerId: user.id };

  const navigator = createNavigator({
    go: (target) => void go(target),
    onToggle: () => markActive(),
  });
  document.body.append(navigator.element);
  const messages = createMessages({ notify: (text) => notify(text), onRead: () => friends.refresh() });
  document.body.append(messages.element);
  addEventListener('coloxel:pm', (ev) => messages.received((ev as CustomEvent<{ from: string }>).detail.from));
  const friends = createFriends({
    go: (target) => void go(target),
    message: (friendId, nickname) => messages.open(friendId, nickname),
    onToggle: () => markActive(),
    onPending: (count) => setBadge('friends', count),
    notify: (text) => notify(text),
  });
  document.body.append(friends.element);

  // ----- Windows the scene fills: inventory, apartment settings, what was said ------------
  function floatingWindow(title: string, className: string) {
    const root = make('section', `window float ${className}`);
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', title);
    const body = make('div', 'win-body');
    const close = () => {
      if (root.hidden) return;
      root.hidden = true;
      markActive();
    };
    root.append(windowBar(title, close), body);
    document.body.append(root);
    return {
      root,
      body,
      close,
      open: () => {
        root.hidden = false;
        markActive();
      },
      isOpen: () => !root.hidden,
      toggle() {
        if (root.hidden) this.open();
        else close();
      },
    };
  }
  const floating: Record<WindowKey, ReturnType<typeof floatingWindow>> = {
    inventory: floatingWindow('Inventaire', 'inventory-window'),
    apartment: floatingWindow('Mon appartement', 'apartment-window'),
    history: floatingWindow('Ce qui s’est dit', 'history-window'),
  };
  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') for (const w of Object.values(floating)) w.close();
  });

  // Windows float over the scene, one at a time.
  const closeWindows = (except?: string) => {
    if (except !== 'navigator') navigator.close();
    if (except !== 'friends') friends.close();
    if (except !== 'staff') staff?.close();
    if (except !== 'quests') quests.close();
    if (except !== 'market') market.close();
    if (except !== 'shop') shop.close();
    if (except !== 'wardrobe') wardrobe.close();
    for (const [key, w] of Object.entries(floating)) if (except !== key) w.close();
  };

  // Buying furniture or changing the apartment's look works from anywhere; the apartment on screen, if it is ours, follows.
  const shop = createShop({
    onChanged: () => void scene?.refresh?.(),
    onAppearance: () => scene?.refreshAppearance?.(),
    onToggle: () => markActive(),
    notify: (text) => notify(text),
    openWardrobe: () => {
      closeWindows('wardrobe');
      wardrobe.open();
    },
  });
  document.body.append(shop.element);
  // The staff panel is built once the server says this player is staff, and shows what their role allows.
  let staff: StaffPanel | null = null;
  const quests = createQuests({ onToggle: () => markActive() });
  document.body.append(quests.element);
  const market = createMarket({ onToggle: () => markActive(), onChanged: () => void scene?.refresh?.(), notify: (text) => notify(text) });
  document.body.append(market.element);
  const trade = createTrade({ notify: (text) => notify(text), onChanged: () => void scene?.refresh?.(), closeOthers: () => closeWindows('trade') });
  document.body.append(trade.element);
  const wardrobe = createWardrobe({ onToggle: () => markActive(), notify: (text) => notify(text) });
  document.body.append(wardrobe.element);
  // Whatever the player saves, the room tells the others.
  appearance.onSaved(() => scene?.refreshAppearance?.());

  // ----- Bottom bar ----------------------------------------------------------
  interface Item {
    key: string;
    label: string;
    /** Highlighted while this is where the player is (or what is open). */
    active: () => boolean;
    run?: () => void | Promise<void>;
  }
  const items: Item[] = [
    { key: 'building', label: 'Immeuble', active: () => current?.kind === 'building', run: () => go({ kind: 'building' }) },
    { key: 'home', label: 'Mon appart', active: () => !!current && sameTarget(current, home), run: () => go(home) },
    { key: 'navigator', label: 'Navigateur', active: () => navigator.isOpen(), run: () => {
        closeWindows('navigator');
        navigator.toggle();
      },
    },
    {
      key: 'inventory',
      label: 'Inventaire',
      active: () => floating.inventory.isOpen(),
      // The inventory belongs to the player's own apartment: from elsewhere, go home first.
      run: async () => {
        const wasOpen = floating.inventory.isOpen();
        closeWindows('inventory');
        if (!(current && sameTarget(current, home))) await go(home);
        if (wasOpen) floating.inventory.close();
        else floating.inventory.open();
      },
    },
    { key: 'catalogue', label: 'Boutique', active: () => shop.isOpen(), run: () => {
        closeWindows('shop');
        shop.toggle();
      },
    },
    { key: 'market', label: 'Marché', active: () => market.isOpen(), run: () => {
        closeWindows('market');
        market.toggle();
      },
    },
    { key: 'person', label: 'Personnage', active: () => wardrobe.isOpen(), run: () => {
        closeWindows('wardrobe');
        wardrobe.toggle();
      },
    },
    { key: 'quests', label: 'Défis', active: () => quests.isOpen(), run: () => {
        closeWindows('quests');
        quests.toggle();
      },
    },
    { key: 'friends', label: 'Amis', active: () => friends.isOpen(), run: () => {
        closeWindows('friends');
        friends.toggle();
      },
    },
  ];
  const buttons = new Map<string, HTMLButtonElement>();
  function addButton(item: Item, into: HTMLElement = nav) {
    const b = make('button');
    b.type = 'button';
    b.setAttribute('aria-label', item.label);
    b.title = item.label;
    b.dataset.key = item.key;
    b.append(pixelIcon(item.key === 'staff' ? 'lock' : item.key === 'quests' ? 'star' : item.key === 'history' ? 'chat' : item.key), make('span', undefined, item.label));
    if (item.key === 'navigator') b.dataset.navigatorToggle = '';
    if (item.key === 'friends') b.dataset.friendsToggle = '';
    if (item.key === 'quests') b.dataset.questsToggle = '';
    if (item.key === 'market') b.dataset.marketToggle = '';
    if (item.key === 'catalogue') b.dataset.shopToggle = '';
    if (item.key === 'person') b.dataset.wardrobeToggle = '';
    b.addEventListener('click', () => void item.run?.());
    buttons.set(item.key, b);
    into.append(b);
  }
  for (const item of items) addButton(item);

  // The small things at the end of the bar: what was said, and the account.
  const history: Item = {
    key: 'history',
    label: 'Historique',
    active: () => floating.history.isOpen(),
    run: () => {
      closeWindows('history');
      floating.history.toggle();
    },
  };
  items.push(history);
  addButton(history, dockEnd);

  const account = make('div', 'account');
  const accountButton = make('button', 'account-button', user.nickname);
  accountButton.type = 'button';
  accountButton.setAttribute('aria-haspopup', 'menu');
  accountButton.setAttribute('aria-expanded', 'false');
  const menu = make('div', 'account-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const entry = (label: string, run: () => void) => {
    const b = make('button', undefined, label);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => {
      menu.hidden = true;
      accountButton.setAttribute('aria-expanded', 'false');
      run();
    });
    return b;
  };
  menu.append(
    entry('Mon profil sur le site', () => window.open(`/site/joueur/${encodeURIComponent(user.nickname)}`, '_blank', 'noopener')),
    entry('Le site de Coloxel', () => window.open('/site', '_blank', 'noopener')),
    entry('Se déconnecter', async () => {
      await api.logout();
      location.reload();
    }),
  );
  // The beta's Discord, when the server has a link for it: just before "Se déconnecter".
  void api.community().then((res) => {
    const url = res.ok ? res.data.discordUrl : null;
    if (url) menu.insertBefore(entry('Le Discord de la bêta', () => window.open(url, '_blank', 'noopener')), menu.lastElementChild);
  });
  accountButton.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    accountButton.setAttribute('aria-expanded', String(!menu.hidden));
  });
  addEventListener('pointerdown', (ev) => {
    if (!menu.hidden && !account.contains(ev.target as Node)) {
      menu.hidden = true;
      accountButton.setAttribute('aria-expanded', 'false');
    }
  });
  account.append(accountButton, menu);
  dockEnd.append(account);

  api.staffMe().then(async (res) => {
    if (!res.ok) return;
    // Only staff downloads the administration.
    const { createStaffPanel } = await import('./staff-panel');
    const panel = createStaffPanel({ me: res.data, onToggle: () => markActive(), notify: (text) => notify(text) });
    staff = panel;
    document.body.append(panel.element);
    const item: Item = {
      key: 'staff',
      label: 'Staff',
      active: () => panel.isOpen(),
      run: () => {
        closeWindows('staff');
        panel.toggle();
      },
    };
    items.push(item);
    addButton(item);
  });

  /** A small red number on a bar button, for what waits for the player. */
  function setBadge(key: string, count: number) {
    const b = buttons.get(key);
    if (!b) return;
    b.querySelector('.bar-badge')?.remove();
    if (count > 0) {
      const badge = make('span', 'bar-badge', String(count));
      badge.setAttribute('aria-label', `${count} en attente`);
      b.append(badge);
    }
  }
  function markActive() {
    for (const item of items) {
      const active = item.active();
      buttons.get(item.key)?.classList.toggle('active', active);
      buttons.get(item.key)?.setAttribute('aria-pressed', String(active));
    }
  }

  /** What each window shows for the scene on screen. */
  function fillWindows(next: Scene | null) {
    infoSlot.replaceChildren(...(next ? [next.info] : []));
    const nothing = (text: string) => {
      const p = make('p', 'muted', text);
      return p;
    };
    floating.inventory.body.replaceChildren(next?.inventory ?? nothing('Ton inventaire est dans ton appart : va chez toi pour poser tes objets.'));
    floating.apartment.body.replaceChildren(next?.apartment ?? nothing('Les réglages sont ceux de ton appart : va chez toi pour les changer.'));
    floating.history.body.replaceChildren(next?.history ?? nothing('Rien n’a été dit ici.'));
    // Where one types: in a room. In the building there is nobody to talk to.
    if (next?.chatBar) chatSlot.replaceChildren(next.chatBar);
    else {
      const idle = make('div', 'chat-bar idle');
      const input = make('input');
      input.disabled = true;
      input.placeholder = 'Entre dans une salle pour discuter';
      input.setAttribute('aria-label', 'Discussion indisponible ici');
      idle.append(input);
      chatSlot.replaceChildren(idle);
    }
  }

  async function go(target: Target) {
    closeWindows();
    if (current && sameTarget(current, target)) return;
    const ticket = ++switching;
    dock.classList.add('busy');
    // Leaving a scene leaves its realtime room: we are never in two places at once.
    scene?.destroy();
    scene = null;
    current = null;
    fillWindows(null);

    const created =
      target.kind === 'building' ? await createBuildingScene(host) : await createRoomScene(host, target);
    if (ticket !== switching) {
      // Another move started while we were joining: drop this one.
      if (!('error' in created)) created.destroy();
      return;
    }
    dock.classList.remove('busy');
    if ('error' in created) {
      notify(created.error);
      // Fall back to the building, unless that is what just failed.
      if (target.kind !== 'building') return void go({ kind: 'building' });
      markActive();
      return;
    }
    scene = created;
    current = target;
    pan.x = 0;
    pan.y = 0;
    fillWindows(created);
    fadeIn(stage, app);
    fit();
    markActive();
  }

  fit();
  await go(home);

  // The news: the newest one is shown once, when it is new to this browser.
  const news = await api.announcements();
  if (news.ok && news.data.announcements[0]) {
    const latest = news.data.announcements.reduce((a, b) => (b.id > a.id ? b : a));
    let seen = 0;
    try {
      seen = Number(localStorage.getItem('coloxel.news') ?? 0);
    } catch {
      // Private window: the news will come back next time, which is harmless.
    }
    if (latest.id > seen) {
      showNotice(`${latest.title}\n\n${latest.body}`, () => {
        try {
          localStorage.setItem('coloxel.news', String(latest.id));
        } catch {
          // Nothing to do.
        }
      });
    }
  }

  // What the staff told the player and they have not read yet (warnings), or what still applies (a mute).
  const notices = await api.notices();
  if (notices.ok) {
    for (const n of notices.data.notices) showNotice(n.text, n.kind === 'warning' ? () => void api.noticesSeen([n.id]) : undefined);
  }
}
