import { furnitureThumb } from './thumb';
import { api, furnitureSpriteUrl, itemSpriteUrl, type FurnitureItem, type InventoryItem, type User } from './api';

export interface PanelHandlers {
  /** The inventory changed (creation); the room must be re-synced. */
  onChange(): void;
  /** The player picked an item to place; null cancels. */
  onSelect(itemId: string | null): void;
  onPickUp(itemId: string): void;
  /** Throw a piece of base furniture away (free to take again). */
  onThrow(furnitureId: string): void;
  onLogout(): void;
}

export interface Panel {
  element: HTMLElement;
  setItems(items: InventoryItem[]): void;
  setFurniture(furniture: FurnitureItem[]): void;
  setSelected(itemId: string | null): void;
  /** Show the item card for this item; null closes it. */
  inspect(itemId: string | null): void;
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

  // Item card: everything the server stores about the item, nothing the client could invent.
  const cardBox = el('section', 'item-card');
  cardBox.hidden = true;
  cardBox.setAttribute('aria-label', 'Fiche objet');
  const cardHead = el('div', 'item-card-head');
  cardHead.append(el('h2', undefined, 'Fiche objet'));
  const cardClose = el('button', 'link', 'Fermer');
  cardClose.type = 'button';
  cardHead.append(cardClose);
  const cardBody = el('div', 'item-card-body');
  const cardImg = el('img');
  cardImg.alt = '';
  cardImg.width = 128;
  cardImg.height = 149;
  const cardMeta = el('div', 'meta');
  const cardName = el('strong', 'name');
  const cardDesc = el('p', 'muted small');
  const cardSerial = el('p', 'small');
  const cardCreator = el('p', 'muted small');
  cardMeta.append(cardName, cardDesc, cardSerial, cardCreator);
  cardBody.append(cardImg, cardMeta);
  const cardActions = el('div', 'item-card-actions');
  const cardPlace = el('button', 'primary');
  cardPlace.type = 'button';
  const cardPickUp = el('button', undefined, 'Reprendre');
  cardPickUp.type = 'button';
  const cardThrow = el('button', undefined, 'Jeter');
  cardThrow.type = 'button';
  cardThrow.hidden = true;
  cardActions.append(cardPlace, cardPickUp, cardThrow);
  cardBox.append(cardHead, cardBody, cardActions);

  const listTitle = el('h2', undefined, 'Mes créations');
  const list = el('ul', 'inventory');
  const empty = el('p', 'muted small', 'Rien pour l’instant : invente ton premier objet !');
  const furnitureTitle = el('h2', undefined, 'Mobilier de base');
  const furnitureList = el('ul', 'inventory furniture-list');
  const furnitureEmpty = el('p', 'muted small', 'Prends des meubles gratuits dans le catalogue.');

  root.append(header, form, message, cardBox, listTitle, list, empty, furnitureTitle, furnitureList, furnitureEmpty);

  let items: InventoryItem[] = [];
  let furniture: FurnitureItem[] = [];
  let selected: string | null = null;
  let inspected: string | null = null;
  let busy = false;

  const setCharges = (n: number) => {
    chargesLabel.textContent = `${n} charge${n > 1 ? 's' : ''} de création aujourd’hui`;
    create.disabled = busy || n <= 0;
  };

  const renderCard = () => {
    const item = items.find((it) => it.id === inspected);
    const piece = item ? undefined : furniture.find((f) => f.id === inspected);
    cardBox.hidden = !item && !piece;
    cardThrow.hidden = !piece;
    if (piece) {
      // Base furniture is not a creation: no number, no creator, no edition.
      cardImg.src = furnitureSpriteUrl(piece.key);
      cardName.textContent = piece.name;
      cardDesc.textContent = 'Gratuit, en quantité illimitée.';
      cardSerial.textContent = 'Mobilier de base · pas une création';
      cardCreator.textContent = 'Ni numéroté, ni échangeable.';
      cardPlace.textContent = piece.id === selected ? 'Annuler' : piece.placement ? 'Déplacer' : 'Poser';
      cardPickUp.hidden = !piece.placement;
      return;
    }
    if (!item) return;
    cardImg.src = itemSpriteUrl(item.id);
    cardName.textContent = item.name;
    cardDesc.textContent = `« ${item.description} »`;
    cardSerial.textContent = `N° ${serialLabel(item.serial)} · Exemplaire ${item.editionNumber}/${item.editionSize}`;
    const date = new Date(item.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    cardCreator.textContent = `Créé par ${item.creator} le ${date}${item.underReview ? ' · En revue : les autres joueurs ne le voient plus pour l’instant.' : ''}`;
    cardPlace.textContent = item.id === selected ? 'Annuler' : item.placement ? 'Déplacer' : 'Poser';
    cardPickUp.hidden = !item.placement;
  };

  const render = () => {
    renderCard();
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

      const action = el('button', undefined, item.placement ? 'Reprendre' : item.id === selected ? 'Annuler' : 'Poser');
      action.type = 'button';
      action.addEventListener('click', () => {
        if (item.placement) handlers.onPickUp(item.id);
        else handlers.onSelect(item.id === selected ? null : item.id);
      });

      info.tabIndex = 0;
      info.addEventListener('click', () => panel.inspect(item.id));
      info.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          panel.inspect(item.id);
        }
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
      info.tabIndex = 0;
      info.addEventListener('click', () => panel.inspect(piece.id));
      info.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          panel.inspect(piece.id);
        }
      });
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

  cardClose.addEventListener('click', () => panel.inspect(null));
  cardPlace.addEventListener('click', () => {
    if (inspected) handlers.onSelect(inspected === selected ? null : inspected);
  });
  cardPickUp.addEventListener('click', () => {
    if (inspected) handlers.onPickUp(inspected);
  });
  cardThrow.addEventListener('click', () => {
    if (inspected) handlers.onThrow(inspected);
  });

  const panel: Panel = {
    element: root,
    setItems(next) {
      items = next;
      render();
    },
    setFurniture(next) {
      furniture = next;
      if (inspected && !items.some((it) => it.id === inspected) && !furniture.some((f) => f.id === inspected)) inspected = null;
      render();
    },
    setSelected(id) {
      selected = id;
      render();
    },
    inspect(id) {
      inspected = id;
      renderCard();
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
