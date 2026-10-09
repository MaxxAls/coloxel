import { api, type PrivateMessage } from './api';
import { openReportDialog } from './report-dialog';
import { windowBar } from './window';

// Private messages with a friend: one conversation at a time, in a small window. The server filters, keeps and
// delivers them; here we only show them and send what the player writes.

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** While a conversation is open, it is read again this often (new messages also arrive through the room). */
const REFRESH_MS = 4000;

export interface Messages {
  element: HTMLElement;
  /** Open the conversation with this friend. */
  open(friendId: string, nickname: string): void;
  /** A friend wrote to us: read the conversation again if it is theirs. */
  received(from: string): void;
  close(): void;
}

export function createMessages(options: { notify(text: string): void; onRead(): void }): Messages {
  const root = el('section', 'window messages-window');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Messages privés');
  const bar = windowBar('Messages', () => close());
  const title = bar.querySelector('.win-title')!;
  const list = el('ul', 'pm-list');
  list.setAttribute('aria-live', 'polite');
  const form = el('form', 'pm-form');
  const input = el('input');
  input.maxLength = 300;
  input.placeholder = 'Écris ton message…';
  input.setAttribute('aria-label', 'Ton message');
  const send = el('button', 'primary', 'Envoyer');
  send.type = 'submit';
  form.append(input, send);
  const status = el('p', 'muted small');
  status.setAttribute('role', 'status');
  const body = el('div', 'win-body');
  body.append(list, status, form);
  root.append(bar, body);

  let friend: { id: string; nickname: string } | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  function render(messages: PrivateMessage[]) {
    list.replaceChildren();
    if (!messages.length) list.append(el('li', 'muted small', 'Pas encore de message. Dis bonjour !'));
    for (const m of messages) {
      const li = el('li', m.mine ? 'pm mine' : 'pm');
      li.append(el('span', 'pm-text', m.text), el('span', 'muted small', time(m.at)));
      if (!m.mine && friend) {
        const flag = el('button', 'link flag', 'Signaler');
        flag.type = 'button';
        const who = friend.nickname;
        flag.addEventListener('click', () => openReportDialog({ kind: 'private', id: String(m.id), label: `ce message de ${who}` }, options.notify));
        li.append(flag);
      }
      list.append(li);
    }
    list.scrollTop = list.scrollHeight;
  }

  async function load() {
    if (!friend) return;
    const res = await api.conversation(friend.id);
    if (!res.ok) {
      status.textContent = res.error;
      return;
    }
    render(res.data.messages);
    options.onRead();
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!friend || !input.value.trim()) return;
    send.disabled = true;
    status.textContent = '';
    const res = await api.sendMessage(friend.id, input.value);
    send.disabled = false;
    if (!res.ok) {
      status.textContent = res.error;
      return;
    }
    input.value = '';
    await load();
  });

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    friend = null;
    clearInterval(timer);
  }

  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') close();
  });

  return {
    element: root,
    open(friendId, nickname) {
      friend = { id: friendId, nickname };
      title.textContent = `Messages avec ${nickname}`;
      status.textContent = 'Tes messages sont filtrés et l’équipe peut lire ceux qui sont signalés.';
      root.hidden = false;
      list.replaceChildren();
      void load();
      clearInterval(timer);
      timer = setInterval(() => void load(), REFRESH_MS);
      input.focus();
    },
    received(from) {
      if (friend && friend.id === from) void load();
    },
    close,
  };
}
