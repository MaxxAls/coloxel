import { furnitureThumb } from './thumb';
import { api, itemSpriteUrl, type FurnitureItem, type InventoryItem, type User } from './api';

export interface PanelHandlers {
  /** The inventory changed (creation); the room must be re-synced. */
  onChange(): void;
  /** The player picked an item to place; null cancels. */
  onSelect(itemId: string | null): void;
  onPickUp(itemId: string): void;
  /** The player wants the card of this item. */
  onInspect(itemId: string): void;
}

export interface Panel {
  element: HTMLElement;
  setItems(items: InventoryItem[]): void;
  setFurniture(furniture: FurnitureItem[]): void;
  setSelected(itemId: string | null): void;
  setMessage(text: string): void;
  refreshCharges(): Promise<void>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const serialLabel = (n: number) => String(n).padStart(4, '0');

/** The inventory window: the form to invent an object, the creations, the base furniture. */
export function createPanel(_user: User, handlers: PanelHandlers): Panel {
  const root = el('div', 'inventory-body');

  // Creation form
  const form = el('form', 'create');
  const label = el('label');
  label.append(el('span', undefined, 'Décris un objet à inventer'));
  const input = el('input');
  input.type = 'text';
  input.minLength = 3;
  input.maxLength = 200;
  input.required = true;
  input.placeholder = 'une lampe qui ressemble à une lune';
  label.append(input);
  const chargesLabel = el('p', 'muted small');
  const create = el('button', 'primary', 'Créer');
  create.type = 'submit';
  const formError = el('p', 'error');
  formError.setAttribute('role', 'alert');
  form.append(label, create, chargesLabel, formError);

  const message = el('p', 'message');
  message.setAttribute('role', 'status');

  const listTitle = el('h2', undefined, 'Mes créations');
  const list = el('ul', 'inventory');
  const empty = el('p', 'muted small', 'Rien pour l’instant : invente ton premier objet !');
  const furnitureTitle = el('h2', undefined, 'Mobilier de base');
  const furnitureList = el('ul', 'inventory furniture-list');
  const furnitureEmpty = el('p', 'muted small', 'Prends des meubles gratuits dans la boutique.');

  root.append(form, message, listTitle, list, empty, furnitureTitle, furnitureList, furnitureEmpty);

  let items: InventoryItem[] = [];
  let furniture: FurnitureItem[] = [];
  let selected: string | null = null;
  let busy = false;

  const setCharges = (n: number) => {
    chargesLabel.textContent = `${n} charge${n > 1 ? 's' : ''} de création aujourd’hui`;
    create.disabled = busy || n <= 0;
  };

  const inspectable = (info: HTMLElement, id: string) => {
    info.tabIndex = 0;
    info.addEventListener('click', () => handlers.onInspect(id));
    info.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        handlers.onInspect(id);
      }
    });
  };

  const render = () => {
    list.replaceChildren();
    empty.hidden = items.length > 0;
    for (const item of items) {
      const li = el('li', item.id === selected ? 'selected' : '');
      li.title = item.description;

      const img = el('img');
      img.src = itemSpriteUrl(item.id);
      img.alt = '';
      img.width = 48;
      img.height = 56;

      const info = el('div', 'info');
      info.append(
        el('strong', undefined, item.name),
        el('span', 'muted small', `n° ${serialLabel(item.serial)} · ${item.editionNumber}/${item.editionSize}`),
        el('span', 'muted small', item.placement ? 'Posé dans l’appart' : 'Dans l’inventaire'),
      );
      inspectable(info, item.id);

      const action = el('button', undefined, item.placement ? 'Reprendre' : item.id === selected ? 'Annuler' : 'Poser');
      action.type = 'button';
      action.addEventListener('click', () => {
        if (item.placement) handlers.onPickUp(item.id);
        else handlers.onSelect(item.id === selected ? null : item.id);
      });
      li.append(img, info, action);
      list.append(li);
    }

    furnitureList.replaceChildren();
    furnitureEmpty.hidden = furniture.length > 0;
    for (const piece of furniture) {
      const li = el('li', piece.id === selected ? 'selected' : '');
      const info = el('div', 'info');
      info.append(
        el('strong', undefined, piece.name),
        el('span', 'muted small', 'Mobilier de base'),
        el('span', 'muted small', piece.placement ? 'Posé dans l’appart' : 'Dans l’inventaire'),
      );
      inspectable(info, piece.id);
      const action = el('button', undefined, piece.placement ? 'Reprendre' : piece.id === selected ? 'Annuler' : 'Poser');
      action.type = 'button';
      action.addEventListener('click', () => {
        if (piece.placement) handlers.onPickUp(piece.id);
        else handlers.onSelect(piece.id === selected ? null : piece.id);
      });
      li.append(furnitureThumb(piece.key, 'sm'), info, action);
      furnitureList.append(li);
    }
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    busy = true;
    create.disabled = true;
    create.textContent = 'Création en cours…';
    formError.textContent = '';
    const result = await api.create(input.value);
    busy = false;
    create.textContent = 'Créer';
    if (result.ok) {
      input.value = '';
      setCharges(result.data.charges);
      panel.setMessage(`« ${result.data.item.name} » est né, exemplaire n° ${serialLabel(result.data.item.serial)} !`);
      handlers.onChange();
    } else {
      formError.textContent = result.error;
      await panel.refreshCharges();
    }
  });

  const panel: Panel = {
    element: root,
    setItems(next) {
      items = next;
      render();
    },
    setFurniture(next) {
      furniture = next;
      render();
    },
    setSelected(id) {
      selected = id;
      render();
    },
    setMessage(text) {
      message.textContent = text;
    },
    async refreshCharges() {
      const res = await api.charges();
      if (res.ok) setCharges(res.data.charges);
    },
  };
  return panel;
}
