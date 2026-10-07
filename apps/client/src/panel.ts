import { api, itemSpriteUrl, type InventoryItem, type User } from './api';

export interface PanelHandlers {
  /** The inventory changed (creation); the room must be re-synced. */
  onChange(): void;
  /** The player picked an item to place; null cancels. */
  onSelect(itemId: string | null): void;
  onPickUp(itemId: string): void;
  onLogout(): void;
}

export interface Panel {
  element: HTMLElement;
  setItems(items: InventoryItem[]): void;
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

export function createPanel(user: User, handlers: PanelHandlers): Panel {
  const root = el('aside', 'panel');

  const header = el('div', 'panel-head');
  header.append(el('strong', undefined, user.nickname));
  const logout = el('button', 'link', 'Déconnexion');
  logout.type = 'button';
  logout.addEventListener('click', handlers.onLogout);
  header.append(logout);

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

  const listTitle = el('h2', undefined, 'Mon inventaire');
  const list = el('ul', 'inventory');
  const empty = el('p', 'muted small', 'Rien pour l’instant : invente ton premier objet !');

  root.append(header, form, message, listTitle, list, empty);

  let items: InventoryItem[] = [];
  let selected: string | null = null;
  let busy = false;

  const setCharges = (n: number) => {
    chargesLabel.textContent = `${n} charge${n > 1 ? 's' : ''} de création aujourd’hui`;
    create.disabled = busy || n <= 0;
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
        el('span', 'muted small', `n° ${String(item.serial).padStart(4, '0')} · ${item.editionNumber}/${item.editionSize}`),
        el('span', 'muted small', item.placement ? 'Posé dans l’appart' : 'Dans l’inventaire'),
      );

      const action = el('button', undefined, item.placement ? 'Reprendre' : item.id === selected ? 'Annuler' : 'Poser');
      action.type = 'button';
      action.addEventListener('click', () => {
        if (item.placement) handlers.onPickUp(item.id);
        else handlers.onSelect(item.id === selected ? null : item.id);
      });

      li.append(img, info, action);
      list.append(li);
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
      panel.setMessage(`« ${result.data.item.name} » est né, exemplaire n° ${String(result.data.item.serial).padStart(4, '0')} !`);
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
