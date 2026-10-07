import { api, itemSpriteUrl, type TradeData, type TradeSide } from './api';
import { openReportDialog } from './report-dialog';
import { windowBar } from './window';

export interface Trade {
  element: HTMLElement;
  close(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const serialLabel = (n: number) => String(n).padStart(4, '0');

/**
 * The trade window. The server keeps the table; this polls it, shows both sides, and sends the
 * intentions: change my offer, accept, confirm, cancel. It opens by itself when somebody starts a trade with the player.
 */
export function createTrade(options: { notify(text: string): void; onChanged(): void; closeOthers(): void }): Trade {
  const root = el('section', 'window navigator trade');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Échange');
  const body = el('div', 'win-body');
  const status = el('p', 'muted small');
  status.setAttribute('role', 'status');
  const columns = el('div', 'trade-columns');
  const mineBox = el('div', 'trade-side');
  const theirsBox = el('div', 'trade-side');
  columns.append(mineBox, theirsBox);
  const picker = el('ul', 'nav-list trade-picker');
  const actions = el('div', 'trade-actions');
  body.append(status, columns, actions, picker);
  root.append(windowBar('Échange', () => hide()), body);

  let trade: TradeData | null = null;
  let timer = 0;
  let known: string | null = null;
  let inventory: { id: string; name: string; serial: number; editionNumber: number; editionSize: number; listed: boolean; review: boolean }[] = [];

  const line = (item: TradeSide['items'][number], onRemove?: () => void) => {
    const li = el('li', 'trade-item');
    const img = el('img');
    img.src = itemSpriteUrl(item.id);
    img.alt = '';
    img.width = 36;
    img.height = 42;
    const text = el('span', 'small', `${item.name} · n° ${serialLabel(item.serial)} (${item.editionNumber}/${item.editionSize}) · par ${item.creator}`);
    li.append(img, text);
    if (onRemove) {
      const x = el('button', 'link', 'Retirer');
      x.type = 'button';
      x.addEventListener('click', onRemove);
      li.append(x);
    }
    return li;
  };

  const side = (box: HTMLElement, title: string, data: TradeSide, onRemove?: (id: string) => void) => {
    const list = el('ul', 'trade-list');
    list.append(...data.items.map((i) => line(i, onRemove ? () => onRemove(i.id) : undefined)));
    if (!data.items.length) list.append(el('li', 'muted small', 'Rien pour l’instant'));
    const state = data.confirmed ? 'A confirmé' : data.accepted ? 'A accepté' : '';
    box.replaceChildren(el('strong', undefined, title), list, el('span', 'badge', state));
    (box.lastChild as HTMLElement).hidden = !state;
  };

  const run = async (call: () => Promise<{ ok: true; data: { trade: TradeData | null; done?: boolean } } | { ok: false; error: string }>) => {
    const res = await call();
    if (!res.ok) {
      options.notify(res.error);
      await poll();
      return;
    }
    if (res.data.done) {
      options.notify('Échange terminé !');
      options.onChanged();
    }
    trade = res.data.trade;
    render();
  };

  function render() {
    if (!trade) {
      hide();
      return;
    }
    const t = trade;
    status.textContent = `Échange avec ${t.partner}`;
    side(mineBox, 'Tu donnes', t.mine, (id) => void run(() => api.offerTrade(t.id, t.mine.items.filter((i) => i.id !== id).map((i) => i.id))));
    side(theirsBox, `${t.partner} donne`, t.theirs);

    const buttons: HTMLElement[] = [];
    const cancel = el('button', undefined, 'Annuler l’échange');
    cancel.type = 'button';
    cancel.addEventListener('click', async () => {
      await api.cancelTrade(t.id);
      trade = null;
      render();
    });
    if (t.stage === 'offer') {
      const accept = el('button', 'primary', t.mine.accepted ? 'En attente de l’autre joueur…' : 'Accepter');
      accept.type = 'button';
      accept.disabled = t.mine.accepted || (!t.mine.items.length && !t.theirs.items.length);
      accept.addEventListener('click', () => void run(() => api.acceptTrade(t.id, t.version)));
      buttons.push(accept);
    } else {
      // Last look: every object with its number and its creator, before anything changes hands.
      const sum = el('p', 'small', `Tu donnes ${t.mine.items.length} objet${t.mine.items.length > 1 ? 's' : ''} et tu reçois ${t.theirs.items.length}. Vérifie les numéros et les créateurs ci-dessus.`);
      const confirm = el('button', 'primary', t.mine.confirmed ? 'En attente de l’autre joueur…' : 'Confirmer l’échange');
      confirm.type = 'button';
      confirm.disabled = t.mine.confirmed;
      confirm.addEventListener('click', () => void run(() => api.confirmTrade(t.id, t.version)));
      buttons.push(sum, confirm);
    }
    buttons.push(cancel);
    const report = el('button', 'link flag', 'Signaler');
    report.type = 'button';
    report.addEventListener('click', () => openReportDialog({ kind: 'trade', id: t.id, label: `cet échange avec ${t.partner}` }, (text) => options.notify(text)));
    buttons.push(report);
    actions.replaceChildren(...buttons);

    // My offer can only change before anything is accepted.
    picker.replaceChildren();
    if (t.stage === 'offer' && !t.mine.accepted) {
      const onTable = new Set(t.mine.items.map((i) => i.id));
      picker.append(el('li', 'muted small', 'Ajoute une de tes créations :'));
      for (const item of inventory.filter((i) => !onTable.has(i.id) && !i.listed && !i.review)) {
        const li = el('li', 'trade-item');
        const add = el('button', undefined, `${item.name} · n° ${serialLabel(item.serial)} (${item.editionNumber}/${item.editionSize})`);
        add.type = 'button';
        add.addEventListener('click', () => void run(() => api.offerTrade(t.id, [...onTable, item.id])));
        li.append(add);
        picker.append(li);
      }
    }
  }

  async function poll() {
    const res = await api.currentTrade();
    if (!res.ok) return;
    const next = res.data.trade;
    // A trade started by the other player: open the window to show it.
    if (next && next.id !== known) {
      known = next.id;
      options.notify(`${next.partner} veut échanger avec toi.`);
      await show();
    }
    if (!next) known = null;
    if (next && JSON.stringify(next) !== JSON.stringify(trade)) {
      trade = next;
      render();
    } else if (!next && trade) {
      trade = null;
      if (!root.hidden) options.notify('L’échange est terminé ou annulé.');
      options.onChanged();
      hide();
    }
  }

  async function loadInventory() {
    const res = await api.inventory();
    if (!res.ok) return;
    inventory = res.data.items.map((i) => ({
      id: i.id,
      name: i.name,
      serial: i.serial,
      editionNumber: i.editionNumber,
      editionSize: i.editionSize,
      listed: !!i.listing,
      review: !!i.underReview,
    }));
  }

  async function show() {
    options.closeOthers();
    await loadInventory();
    root.hidden = false;
    if (trade) render();
  }
  function hide() {
    root.hidden = true;
  }

  // Looks at the table now and then; faster while the window is open.
  const tick = () => {
    void poll().finally(() => {
      timer = window.setTimeout(tick, root.hidden ? 5000 : 1500);
    });
  };
  // "Échanger" on a player's card, or the window closed by mistake: bring it back.
  addEventListener('coloxel:trade', async () => {
    await poll();
    if (trade) await show();
  });
  tick();
  void timer;

  return { element: root, close: hide };
}
