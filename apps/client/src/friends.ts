import { api, type FriendsData } from './api';
import { windowBar } from './window';
import type { Target } from './scene';

const REFRESH_MS = 5000;
/** The bar's badge is refreshed this often while the window is closed. */
const BADGE_MS = 20000;

export interface Friends {
  element: HTMLElement;
  isOpen(): boolean;
  toggle(): void;
  close(): void;
  /** Re-read the list now (after an outside change, for instance a friend added from a player card). */
  refresh(): void;
}

export interface FriendsOptions {
  go(target: Target): void;
  onToggle(open: boolean): void;
  /** How many requests wait for an answer: the bar shows it. */
  onPending(count: number): void;
  notify(text: string): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** The friends list: who is where, requests to answer, and a field to ask someone by their nickname. */
export function createFriends(options: FriendsOptions): Friends {
  const root = el('section', 'window navigator friends');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Amis');

  const form = el('form', 'friend-add');
  const input = el('input');
  input.maxLength = 40;
  input.placeholder = 'Pseudo d’un joueur…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Pseudo du joueur à ajouter');
  const add = el('button', 'primary', 'Demander');
  add.type = 'submit';
  form.append(input, add);
  const status = el('p', 'muted small');
  status.setAttribute('role', 'status');
  const lists = el('div', 'friend-lists');
  const body = el('div', 'win-body');
  body.append(form, status, lists);
  root.append(windowBar('Amis', () => hide()), body);

  let data: FriendsData | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const button = (label: string, run: () => void | Promise<void>, className?: string) => {
    const b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', () => void run());
    return b;
  };

  const section = (title: string, rows: HTMLElement[]) => {
    const box = el('section');
    box.append(el('h3', undefined, title));
    const ul = el('ul', 'nav-list');
    for (const r of rows) ul.append(r);
    box.append(ul);
    return box;
  };

  const row = (name: string, subtitle: string, actions: HTMLElement[], online = false) => {
    const li = el('li', 'friend-row');
    const text = el('span', 'nav-text');
    const title = el('strong', undefined, name);
    if (online) title.classList.add('online');
    text.append(title, el('span', 'muted small', subtitle));
    const buttons = el('span', 'friend-actions');
    buttons.append(...actions);
    li.append(text, buttons);
    return li;
  };

  async function act(call: Promise<{ ok: boolean; error?: string }>, done?: string) {
    const res = await call;
    if (!res.ok) options.notify(res.error ?? 'Erreur inattendue');
    else if (done) options.notify(done);
    await refresh();
  }

  const render = () => {
    lists.replaceChildren();
    if (!data) {
      status.textContent = 'Chargement…';
      return;
    }
    const { friends, incoming, outgoing } = data;
    if (incoming.length) {
      lists.append(
        section(
          'Demandes reçues',
          incoming.map((p) =>
            row(p.nickname, 'veut devenir ton ami', [
              button('Accepter', () => act(api.acceptFriend(p.id), `${p.nickname} est maintenant ton ami.`), 'primary'),
              button('Refuser', () => act(api.removeFriend(p.id))),
            ]),
          ),
        ),
      );
    }
    if (!friends.length && !incoming.length && !outgoing.length) {
      status.textContent = 'Tu n’as pas encore d’amis. Écris le pseudo d’un joueur pour lui envoyer une demande.';
    } else {
      status.textContent = '';
    }
    if (friends.length) {
      lists.append(
        section(
          `Mes amis (${friends.length})`,
          friends.map((f) => {
            const target = f.target;
            const actions = [];
            if (target) {
              actions.push(
                button('Rejoindre', () => {
                  hide();
                  options.go(target);
                }, 'primary'),
              );
            }
            actions.push(button('Retirer', () => act(api.removeFriend(f.id), `${f.nickname} n’est plus dans tes amis.`)));
            return row(f.nickname, f.online ? (f.where ?? 'En ligne') : 'Hors ligne', actions, f.online);
          }),
        ),
      );
    }
    if (outgoing.length) {
      lists.append(
        section(
          'Demandes envoyées',
          outgoing.map((p) => row(p.nickname, 'en attente de réponse', [button('Annuler', () => act(api.removeFriend(p.id)))])),
        ),
      );
    }
  };

  async function refresh() {
    const res = await api.friends();
    if (!res.ok) {
      if (!root.hidden) status.textContent = res.error;
      return;
    }
    data = res.data;
    options.onPending(res.data.incoming.length);
    if (!root.hidden) render();
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nickname = input.value.trim();
    if (!nickname) return;
    add.disabled = true;
    const res = await api.askFriend(nickname);
    add.disabled = false;
    if (res.ok) {
      input.value = '';
      options.notify(res.data.status === 'accepted' ? `${nickname} est maintenant ton ami.` : `Demande envoyée à ${nickname}.`);
      await refresh();
    } else {
      status.textContent = res.error;
    }
  });

  function hide() {
    if (root.hidden) return;
    root.hidden = true;
    clearInterval(timer);
    options.onToggle(false);
  }
  const open = () => {
    root.hidden = false;
    render();
    void refresh();
    timer = setInterval(() => void refresh(), REFRESH_MS);
    options.onToggle(true);
  };

  setInterval(() => {
    if (root.hidden) void refresh();
  }, BADGE_MS);
  void refresh();

  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') hide();
  });
  addEventListener('pointerdown', (ev) => {
    const t = ev.target as Node;
    if (!root.hidden && !root.contains(t) && !(t as HTMLElement).closest?.('[data-friends-toggle], .player-card')) hide();
  });

  return {
    element: root,
    isOpen: () => !root.hidden,
    toggle: () => (root.hidden ? open() : hide()),
    close: hide,
    refresh: () => void refresh(),
  };
}
