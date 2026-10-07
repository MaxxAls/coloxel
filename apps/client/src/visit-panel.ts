import { furnitureSpriteUrl, itemSpriteUrl, type FurnitureItem, type InventoryItem } from './api';

export interface VisitPanel {
  element: HTMLElement;
  /** Show the item card for this item; null closes it. */
  inspect(item: InventoryItem | FurnitureItem | null): void;
  setPresent(count: number): void;
}

export interface VisitPanelOptions {
  title: string;
  subtitle: string;
  /** Buttons going elsewhere: [label, action]. */
  links: [string, () => void][];
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Side panel when the player is not in their own apartment: who is here, and what the objects are. */
export function createVisitPanel(options: VisitPanelOptions): VisitPanel {
  const root = el('aside', 'panel visit');
  const head = el('div', 'visit-head');
  head.append(el('h2', undefined, options.title), el('p', 'muted small', options.subtitle));
  const present = el('p', 'present small');
  present.setAttribute('role', 'status');

  const links = el('div', 'visit-links');
  for (const [label, action] of options.links) {
    const b = el('button', undefined, label);
    b.type = 'button';
    b.addEventListener('click', action);
    links.append(b);
  }

  // Item card: only what the server stores about the item.
  const card = el('section', 'item-card');
  card.hidden = true;
  card.setAttribute('aria-label', 'Fiche objet');
  const cardHead = el('div', 'item-card-head');
  cardHead.append(el('h2', undefined, 'Fiche objet'));
  const close = el('button', 'link', 'Fermer');
  close.type = 'button';
  cardHead.append(close);
  const body = el('div', 'item-card-body');
  const img = el('img');
  img.alt = '';
  img.width = 128;
  img.height = 149;
  const meta = el('div', 'meta');
  const name = el('strong', 'name');
  const desc = el('p', 'muted small');
  const serial = el('p', 'small');
  const creator = el('p', 'muted small');
  meta.append(name, desc, serial, creator);
  body.append(img, meta);
  card.append(cardHead, body);
  close.addEventListener('click', () => (card.hidden = true));

  const hint = el('p', 'muted small', 'Clique sur un objet pour voir sa fiche, ou sur une case pour te déplacer.');
  root.append(head, present, links, card, hint);

  return {
    element: root,
    inspect(item) {
      card.hidden = !item;
      if (!item) return;
      if (!('serial' in item)) {
        // Base furniture: free, not numbered, not a creation.
        img.src = furnitureSpriteUrl(item.key);
        name.textContent = item.name;
        desc.textContent = 'Gratuit, en quantité illimitée.';
        serial.textContent = 'Mobilier de base · pas une création';
        creator.textContent = 'Ni numéroté, ni échangeable.';
        return;
      }
      img.src = itemSpriteUrl(item.id);
      name.textContent = item.name;
      desc.textContent = `« ${item.description} »`;
      serial.textContent = `N° ${String(item.serial).padStart(4, '0')} · Exemplaire ${item.editionNumber}/${item.editionSize}`;
      const date = new Date(item.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      creator.textContent = `Créé par ${item.creator} le ${date}`;
    },
    setPresent(count) {
      present.textContent = count > 1 ? `${count} personnes ici` : 'Tu es seul ici';
    },
  };
}
