import { api } from './api';

export interface PlayerCardOptions {
  id: string;
  nickname: string;
  /** Where to show it, in window pixels. */
  at: { x: number; y: number };
  notify(text: string): void;
  /** Open the report dialog for this player. */
  onReport?(): void;
  /** The friends list changed: let it read again. */
  onFriendsChanged(): void;
  /** The owner of this apartment shows the player out. */
  onExpel?(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

let current: HTMLElement | null = null;
let stopListening: (() => void) | null = null;

export function closePlayerCard() {
  current?.remove();
  current = null;
  stopListening?.();
  stopListening = null;
}

/** What can be done with another player met in a room: ask them as a friend, report them. */
export function showPlayerCard(options: PlayerCardOptions) {
  closePlayerCard();
  const card = el('div', 'player-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', `Joueur ${options.nickname}`);
  card.append(el('strong', undefined, options.nickname));

  const friend = el('button', 'primary', 'Ajouter en ami');
  friend.type = 'button';
  friend.addEventListener('click', async () => {
    friend.disabled = true;
    const res = await api.askFriend(options.nickname);
    options.notify(
      res.ok ? (res.data.status === 'accepted' ? `${options.nickname} est maintenant ton ami.` : `Demande envoyée à ${options.nickname}.`) : res.error,
    );
    options.onFriendsChanged();
    closePlayerCard();
  });
  const close = el('button', 'link', 'Fermer');
  close.type = 'button';
  close.addEventListener('click', closePlayerCard);
  card.append(friend);
  const onReport = options.onReport;
  if (onReport) {
    const report = el('button', undefined, 'Signaler');
    report.type = 'button';
    report.addEventListener('click', () => {
      closePlayerCard();
      onReport();
    });
    card.append(report);
  }
  const onExpel = options.onExpel;
  if (onExpel) {
    const out = el('button', undefined, 'Faire sortir');
    out.type = 'button';
    out.addEventListener('click', () => {
      closePlayerCard();
      onExpel();
    });
    card.append(out);
  }
  card.append(close);

  document.body.append(card);
  // Next to the avatar, but never outside the window.
  const { width, height } = card.getBoundingClientRect();
  card.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, options.at.x + 12))}px`;
  card.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, options.at.y - height / 2))}px`;
  current = card;

  // Anywhere else, or Escape, closes it. Listening starts after this click is over.
  const away = (ev: Event) => {
    if (ev instanceof KeyboardEvent ? ev.key === 'Escape' : !card.contains(ev.target as Node)) closePlayerCard();
  };
  const timer = setTimeout(() => {
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', away, true);
  });
  stopListening = () => {
    clearTimeout(timer);
    removeEventListener('pointerdown', away, true);
    removeEventListener('keydown', away, true);
  };
}
