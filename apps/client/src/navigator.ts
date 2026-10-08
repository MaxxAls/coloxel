import { api, apartmentTitle, type NavigatorData } from './api';
import { windowBar } from './window';
import type { Target } from './scene';

type Tab = 'events' | 'friends' | 'open' | 'places';

const TABS: [Tab, string][] = [
  ['events', 'Événements'],
  ['friends', 'Mes amis'],
  ['open', 'Apparts ouverts'],
  ['places', 'Lieux'],
];
const REFRESH_MS = 5000;

export interface Navigator {
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

const people = (n: number) => (n === 1 ? '1 personne' : `${n} personnes`);

/** Where to go: friends, open apartments (busiest first) and public places. */
export function createNavigator(options: { go(target: Target): void; onToggle(open: boolean): void }): Navigator {
  const root = el('section', 'window navigator');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Navigateur');

  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  const tabButtons = new Map<Tab, HTMLButtonElement>();
  const list = el('ul', 'nav-list');
  const status = el('p', 'muted small');
  const body = el('div', 'win-body');
  body.append(tabs, list, status);
  root.append(windowBar('Navigateur', () => hide()), body);

  let tab: Tab = 'open';
  let data: NavigatorData | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const row = (title: string, subtitle: string, badge: string, target: Target) => {
    const li = el('li');
    const b = el('button', 'nav-row');
    b.type = 'button';
    const text = el('span', 'nav-text');
    text.append(el('strong', undefined, title), el('span', 'muted small', subtitle));
    b.append(text);
    if (badge) b.append(el('span', 'badge', badge));
    b.addEventListener('click', () => {
      hide();
      options.go(target);
    });
    li.append(b);
    return li;
  };

  const render = () => {
    for (const [key, button] of tabButtons) {
      button.classList.toggle('active', key === tab);
      button.setAttribute('aria-selected', String(key === tab));
    }
    list.replaceChildren();
    status.textContent = '';
    if (!data) {
      status.textContent = 'Chargement…';
      return;
    }
    if (tab === 'events') {
      if (!data.events.length) status.textContent = 'Aucun événement en ce moment. Annonce le tien depuis les réglages de ton appart !';
      for (const e of data.events) {
        const until = new Date(e.endsAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        list.append(row(e.title, `chez ${e.nickname}, jusqu’à ${until}`, e.visitors > 0 ? people(e.visitors) : '', { kind: 'apartment', ownerId: e.ownerId }));
      }
    } else if (tab === 'friends') {
      if (!data.friends.length) status.textContent = 'Aucun ami en ligne pour l’instant. Ajoute des amis depuis le bouton Amis.';
      for (const f of data.friends) list.append(row(f.nickname, f.where, '', f.target));
    } else if (tab === 'open') {
      if (!data.open.length) status.textContent = 'Aucun appart ouvert pour l’instant. Ouvre le tien pour recevoir des visites !';
      for (const a of data.open) {
        const subtitle = a.mine ? 'Ton appart' : `de ${a.nickname}`;
        list.append(
          row(apartmentTitle(a.name, a.nickname), subtitle, a.visitors > 0 ? people(a.visitors) : '', {
            kind: 'apartment',
            ownerId: a.ownerId,
          }),
        );
      }
    } else {
      for (const p of data.places) {
        list.append(row(p.name, 'Rez-de-chaussée', p.visitors > 0 ? people(p.visitors) : '', { kind: 'hall' }));
      }
    }
  };

  const refresh = async () => {
    const res = await api.navigator();
    if (res.ok) {
      data = res.data;
      render();
    } else {
      status.textContent = res.error;
    }
  };

  for (const [key, label] of TABS) {
    const b = el('button', undefined, label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = key;
      render();
    });
    tabButtons.set(key, b);
    tabs.append(b);
  }

  function hide() {
    if (root.hidden) return;
    root.hidden = true;
    clearInterval(timer);
    options.onToggle(false);
  }
  const open = () => {
    root.hidden = false;
    // Opens on the most useful tab: events when there are some, then friends, otherwise open apartments.
    tab = data?.events.length ? 'events' : data?.friends.length ? 'friends' : 'open';
    render();
    void refresh();
    timer = setInterval(() => void refresh(), REFRESH_MS);
    options.onToggle(true);
  };

  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') hide();
  });
  // A click anywhere else closes it (clicks on the bar button are handled by toggle()).
  addEventListener('pointerdown', (ev) => {
    const t = ev.target as Node;
    if (!root.hidden && !root.contains(t) && !(t as HTMLElement).closest?.('[data-navigator-toggle]')) hide();
  });

  return {
    element: root,
    isOpen: () => !root.hidden,
    toggle: () => (root.hidden ? open() : hide()),
    close: hide,
  };
}
