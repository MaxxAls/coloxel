import { furnitureThumb } from './thumb';
import { api, itemSpriteUrl, type FurnitureItem, type InventoryItem, type MarketRules, type User } from './api';
import { describeFees } from './market';

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
        el('span', 'muted small', item.listing ? `En vente : ${item.listing.price} Coloxs` : item.placement ? 'Posé dans l’appart' : 'Dans l’inventaire'),
      );
      inspectable(info, item.id);

      // On the market the item is in escrow: it can only be withdrawn. Otherwise it can be placed or sold.
      const listing = item.listing;
      const action = el('button', undefined, listing ? 'Retirer de la vente' : item.placement ? 'Reprendre' : item.id === selected ? 'Annuler' : 'Poser');
      action.type = 'button';
      action.addEventListener('click', async () => {
        if (listing) {
          action.disabled = true;
          const res = await api.withdraw(listing.id);
          panel.setMessage(res.ok ? `« ${item.name} » est de retour dans ton inventaire.` : res.error);
          handlers.onChange();
        } else if (item.placement) handlers.onPickUp(item.id);
        else handlers.onSelect(item.id === selected ? null : item.id);
      });
      li.append(img, info, action);
      if (!listing && !item.underReview) {
        const sell = el('button', 'link', 'Vendre');
        sell.type = 'button';
        sell.addEventListener('click', () => sellForm(li, item, sell));
        li.append(sell);
      }
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

  let rules: MarketRules | null = null;
  /** The price to ask for a creation. The server checks the limits and the ownership. */
  function sellForm(li: HTMLElement, item: InventoryItem, trigger: HTMLButtonElement) {
    trigger.hidden = true;
    const box = el('form', 'market-confirm');
    const price = el('input');
    price.type = 'number';
    price.min = '1';
    price.step = '1';
    price.required = true;
    price.placeholder = 'Prix en Coloxs';
    price.setAttribute('aria-label', 'Prix en Coloxs');
    const hint = el('p', 'muted small', 'Une fois en vente, l’objet quitte ton appart jusqu’à la vente ou au retrait.');
    const go = el('button', 'primary', 'Mettre en vente');
    go.type = 'submit';
    const cancel = el('button', undefined, 'Annuler');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      box.remove();
      trigger.hidden = false;
    });
    price.addEventListener('input', () => {
      const n = Number(price.value);
      hint.textContent = Number.isInteger(n) && n > 0 ? describeFees(n, rules) : hint.textContent;
    });
    box.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      go.disabled = true;
      const res = await api.sell(item.id, Number(price.value));
      panel.setMessage(res.ok ? `« ${item.name} » est en vente pour ${res.data.price} Coloxs.` : res.error);
      if (res.ok) handlers.onChange();
      else go.disabled = false;
    });
    box.append(price, hint, go, cancel);
    li.append(box);
    price.focus();
    if (!rules) void api.marketRules().then((r) => r.ok && (rules = r.data));
  }

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
