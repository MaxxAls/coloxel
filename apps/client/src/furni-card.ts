export interface FurniAction {
  label: string;
  run(): void | Promise<void>;
  kind?: 'primary' | 'danger';
}

export interface FurniCardData {
  /** Picture of the piece. */
  image: string;
  name: string;
  /** What the server knows about it, one line each. */
  lines: string[];
  actions: FurniAction[];
}

export interface FurniCard {
  show(data: FurniCardData): void;
  hide(): void;
  isShown(): boolean;
  destroy(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * What one piece of furniture says about itself, and what can be done with it, next to the bottom bar: the piece the player
 * clicked, in the room, not in a list. The scene decides which actions to offer (the owner moves, turns and puts away; a
 * visitor reports); the server checks each of them again.
 */
export function createFurniCard(): FurniCard {
  const root = el('aside', 'furni-card');
  root.hidden = true;
  root.setAttribute('aria-label', 'Objet');
  const picture = el('div', 'furni-picture');
  const img = el('img');
  img.alt = '';
  img.width = 96;
  img.height = 112;
  picture.append(img);
  const text = el('div', 'furni-text');
  const name = el('strong', 'name');
  const lines = el('div', 'furni-lines');
  const actions = el('div', 'furni-actions');
  const close = el('button', 'furni-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fermer');
  text.append(name, lines, actions);
  root.append(picture, text, close);
  document.body.append(root);

  const hide = () => {
    root.hidden = true;
  };
  close.addEventListener('click', hide);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && !root.hidden) hide();
  };
  addEventListener('keydown', onKey);

  return {
    show(data) {
      img.src = data.image;
      name.textContent = data.name;
      lines.replaceChildren(...data.lines.map((l, k) => el('p', k === 0 ? 'small' : 'muted small', l)));
      actions.replaceChildren(
        ...data.actions.map((a) => {
          const b = el('button', a.kind, a.label);
          b.type = 'button';
          b.addEventListener('click', () => void a.run());
          return b;
        }),
      );
      root.hidden = false;
    },
    hide,
    isShown: () => !root.hidden,
    destroy() {
      removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
