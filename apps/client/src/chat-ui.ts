/** What the server broadcasts for a message that was let through. */
export interface ChatMessage {
  /** Id in the server's journal: what a report points to. */
  id: number;
  from: string;
  nickname: string;
  text: string;
}

export const CHAT_MAX_LENGTH = 120;
const LOG_KEEP = 40;

export interface ChatUi {
  /** The input row, floating over the scene. */
  bar: HTMLElement;
  /** The last messages of the room, for the side panel. */
  log: HTMLElement;
  /** A message the server let through. */
  add(message: ChatMessage): void;
  /** The server did not show our message: say why, next to the log. */
  refused(text: string): void;
  /** The server answers a command: a line only we see. */
  system(text: string): void;
  destroy(): void;
}

export interface ChatOptions {
  say(text: string): void;
  /** The player's own id: their messages are not reported. */
  me: string;
  /** Called with a message the player wants to report. */
  onReport?(message: ChatMessage): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Typing a message, and the list of what was said lately. Whatever is typed goes to the server, which decides what the room sees. */
export function createChat(options: ChatOptions): ChatUi {
  const bar = el('form', 'chat-bar');
  bar.autocomplete = 'off';
  const input = el('input');
  input.maxLength = CHAT_MAX_LENGTH;
  input.placeholder = 'Dis quelque chose… (Entrée pour écrire, /aide pour les commandes)';
  input.setAttribute('aria-label', 'Ton message');
  const send = el('button', 'primary', 'Envoyer');
  send.type = 'submit';
  bar.append(input, send);

  const log = el('section', 'chat-log-box');
  log.append(el('h2', undefined, 'Discussion'));
  const list = el('ul', 'chat-log');
  list.setAttribute('aria-live', 'polite');
  const note = el('p', 'error small');
  note.setAttribute('role', 'alert');
  log.append(list, note);
  const empty = el('li', 'muted small', 'Personne n’a encore parlé ici.');
  list.append(empty);

  bar.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    note.textContent = '';
    options.say(text);
    input.value = '';
  });

  // Enter jumps to the input from anywhere in the game, like in most chats.
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Enter' || ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLSelectElement) return;
    if (bar.hidden) return;
    ev.preventDefault();
    input.focus();
  };
  addEventListener('keydown', onKey);

  return {
    bar,
    log,
    add(message) {
      empty.remove();
      const li = el('li');
      li.append(el('strong', message.from === options.me ? 'me' : undefined, message.nickname), document.createTextNode(` ${message.text}`));
      if (options.onReport && message.from !== options.me) {
        const flag = el('button', 'link flag', 'Signaler');
        flag.type = 'button';
        flag.title = 'Signaler ce message';
        flag.addEventListener('click', () => options.onReport?.(message));
        li.append(flag);
      }
      list.append(li);
      while (list.children.length > LOG_KEEP) list.firstElementChild?.remove();
      list.scrollTop = list.scrollHeight;
    },
    refused(text) {
      note.textContent = text;
    },
    system(text) {
      empty.remove();
      const li = el('li', 'system', text);
      list.append(li);
      while (list.children.length > LOG_KEEP) list.firstElementChild?.remove();
      list.scrollTop = list.scrollHeight;
    },
    destroy() {
      removeEventListener('keydown', onKey);
      bar.remove();
    },
  };
}
