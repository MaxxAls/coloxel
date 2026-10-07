import { api, itemSpriteUrl, type MarketListing, type MarketRules, type MarketQuery } from './api';
import { wallet } from './wallet';
import { windowBar } from './window';

export interface Market {
  element: HTMLElement;
  isOpen(): boolean;
  toggle(): void;
  close(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const serialLabel = (n: number) => String(n).padStart(4, '0');

/** How a price will be shared, for the confirmation. The server computes the real split; this only informs. */
export function describeFees(price: number, rules: MarketRules | null): string {
  if (!rules) return '';
  const commission = Math.floor((price * rules.commissionPercent) / 100);
  return `${commission} Coloxs de commission détruits à chaque vente.`;
}

/**
 * The market: offers from other players, and one's own. The server checks everything (price, balance,
 * ownership); this window only shows the offers and sends the intention to buy or withdraw.
 */
export function createMarket(options: { onToggle(open: boolean): void; onChanged(): void; notify(text: string): void }): Market {
  const root = el('section', 'window navigator market');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Marché');

  const tabs = el('div', 'tabs');
  const tabBuy = el('button', undefined, 'Acheter');
  const tabMine = el('button', undefined, 'Mes ventes');
  for (const b of [tabBuy, tabMine]) b.type = 'button';
  tabs.append(tabBuy, tabMine);

  const filters = el('form', 'market-filters');
  const search = el('input');
  search.type = 'search';
  search.maxLength = 60;
  search.placeholder = 'Un nom d’objet ou de créateur';
  search.setAttribute('aria-label', 'Rechercher');
  const sort = el('select');
  sort.setAttribute('aria-label', 'Trier');
  for (const [value, label] of [
    ['recent', 'Les plus récents'],
    ['price_asc', 'Prix croissant'],
    ['price_desc', 'Prix décroissant'],
    ['serial', 'Numéro'],
  ] as const) {
    const o = el('option', undefined, label);
    o.value = value;
    sort.append(o);
  }
  filters.append(search, sort);

  const status = el('p', 'muted small');
  status.setAttribute('role', 'status');
  const list = el('ul', 'nav-list market-list');
  const more = el('button', undefined, 'Voir la suite');
  more.type = 'button';
  more.hidden = true;
  const body = el('div', 'win-body');
  body.append(filters, status, list, more);
  root.append(windowBar('Marché', () => hide()), tabs, body);

  let mine = false;
  let rules: MarketRules | null = null;
  let offset = 0;
  let seq = 0;

  const query = (): MarketQuery => ({ q: search.value.trim(), sort: sort.value as MarketQuery['sort'], mine, offset });

  const card = (l: MarketListing) => {
    const li = el('li', 'market-card');
    const img = el('img');
    img.src = itemSpriteUrl(l.item.id);
    img.alt = '';
    img.width = 48;
    img.height = 56;
    const info = el('div', 'info');
    info.append(
      el('strong', undefined, l.item.name),
      el('span', 'muted small', `n° ${serialLabel(l.item.serial)} · ${l.item.editionNumber}/${l.item.editionSize} · par ${l.item.creator}`),
      el('span', 'muted small', mine ? (l.underReview ? 'En revue : invisible pour les autres' : 'En vente') : `Vendu par ${l.seller}`),
    );
    const price = el('strong', 'market-price', `${l.price} Coloxs`);
    const action = el('button', mine ? undefined : 'primary', mine ? 'Retirer' : 'Acheter');
    action.type = 'button';
    action.addEventListener('click', async () => {
      if (mine) {
        action.disabled = true;
        const res = await api.withdraw(l.id);
        options.notify(res.ok ? `« ${l.item.name} » est de retour dans ton inventaire.` : res.error);
        options.onChanged();
        await load(true);
        return;
      }
      confirmBuy(li, l, action);
    });
    li.append(img, info, price, action);
    return li;
  };

  // A second look before paying: number, creator and price, so nobody buys the wrong thing in a hurry.
  function confirmBuy(li: HTMLElement, l: MarketListing, action: HTMLButtonElement) {
    if (l.price > wallet.get().coloxs) {
      options.notify(`Il te manque ${l.price - wallet.get().coloxs} Coloxs pour cet objet.`);
      return;
    }
    li.querySelector('.market-confirm')?.remove();
    const box = el('div', 'market-confirm');
    box.append(
      el('p', undefined, `Acheter « ${l.item.name} », n° ${serialLabel(l.item.serial)} (${l.item.editionNumber}/${l.item.editionSize}), créé par ${l.item.creator}, pour ${l.price} Coloxs ?`),
    );
    const yes = el('button', 'primary', 'Oui, acheter');
    const no = el('button', undefined, 'Non');
    yes.type = no.type = 'button';
    no.addEventListener('click', () => box.remove());
    yes.addEventListener('click', async () => {
      yes.disabled = no.disabled = action.disabled = true;
      const res = await api.buyListing(l.id);
      if (res.ok) {
        wallet.setColoxs(res.data.coloxs);
        options.notify(`« ${l.item.name} » est à toi !`);
        options.onChanged();
      } else {
        options.notify(res.error);
      }
      await load(true);
    });
    box.append(yes, no);
    li.append(box);
  }

  async function load(reset: boolean) {
    if (reset) offset = 0;
    const mySeq = ++seq;
    status.textContent = 'Chargement…';
    if (!rules) {
      const r = await api.marketRules();
      if (r.ok) rules = r.data;
    }
    const res = await api.marketListings(query());
    if (mySeq !== seq) return;
    if (!res.ok) {
      status.textContent = res.error;
      return;
    }
    if (reset) list.replaceChildren();
    list.append(...res.data.listings.map(card));
    offset += res.data.listings.length;
    more.hidden = offset >= res.data.total;
    status.textContent = res.data.total
      ? `${res.data.total} offre${res.data.total > 1 ? 's' : ''}`
      : mine
        ? 'Tu n’as rien en vente. Mets une création en vente depuis ton inventaire.'
        : 'Aucune offre pour le moment.';
  }

  const setTab = (isMine: boolean) => {
    mine = isMine;
    tabBuy.classList.toggle('active', !isMine);
    tabMine.classList.toggle('active', isMine);
    void load(true);
  };
  tabBuy.addEventListener('click', () => setTab(false));
  tabMine.addEventListener('click', () => setTab(true));
  filters.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void load(true);
  });
  sort.addEventListener('change', () => void load(true));
  more.addEventListener('click', () => void load(false));

  function hide() {
    if (root.hidden) return;
    root.hidden = true;
    options.onToggle(false);
  }
  const open = () => {
    root.hidden = false;
    setTab(false);
    options.onToggle(true);
  };
  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') hide();
  });
  addEventListener('pointerdown', (ev) => {
    const t = ev.target as Node;
    if (!root.hidden && !root.contains(t) && !(t as HTMLElement).closest?.('[data-market-toggle]')) hide();
  });

  return { element: root, isOpen: () => !root.hidden, toggle: () => (root.hidden ? open() : hide()), close: hide };
}
