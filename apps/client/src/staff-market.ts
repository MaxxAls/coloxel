import { api, type Economy, type MarketFlag, type MarketPlayerSheet } from './api';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const serialLabel = (n: number) => String(n).padStart(4, '0');

const FLAG_LABELS: Record<string, string> = {
  back_and_forth: 'Va-et-vient d’un objet',
  new_account_spree: 'Compte neuf qui achète beaucoup',
  price_outlier: 'Prix anormal',
  one_sided_trade: 'Échange à sens unique',
};

const button = (label: string, run: () => void | Promise<void>, className?: string) => {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', () => void run());
  return b;
};

/**
 * The market tab of the staff panel: the economy at a glance (what tells whether the market holds), the
 * suspicious operations to look at, and one player's transactions with the means to act. The server checks
 * every right again; `manage` only decides which buttons are drawn.
 */
export async function renderStaffMarket(content: HTMLElement, options: { manage: boolean; say(text: string): void }): Promise<void> {
  const economy = el('div', 'staff-list');
  const flags = el('div', 'staff-list');
  const player = el('div', 'staff-list');
  const search = el('form', 'staff-bar');
  const who = el('input');
  who.placeholder = 'Pseudo d’un joueur : ses ventes, ses échanges, son registre';
  who.setAttribute('aria-label', 'Joueur');
  const go = el('button', 'primary', 'Voir');
  go.type = 'submit';
  search.append(who, go);
  content.replaceChildren(el('h3', undefined, 'Économie'), economy, el('h3', undefined, 'Opérations à regarder'), flags, el('h3', undefined, 'Un joueur'), search, player);

  const card = (label: string, value: string | number, hint?: string) => {
    const box = el('div', 'dash-card');
    box.append(el('strong', undefined, String(value)), el('span', undefined, label));
    if (hint) box.append(el('small', 'muted', hint));
    return box;
  };

  async function loadEconomy() {
    const res = await api.staffEconomy();
    if (!res.ok) return void economy.replaceChildren(el('p', 'error', res.error));
    const d: Economy = res.data;
    const grid = el('div', 'dash-grid');
    grid.append(
      card('Coloxs en circulation', d.coloxs.circulating),
      card('Coloxs achetés', d.coloxs.bought, `${d.coloxs.givenByStaff} offerts par l’équipe`),
      card('Coloxs détruits', d.coloxs.destroyed, 'commissions du marché'),
      card('Ventes (24 h)', d.last24h.sales, `${d.last24h.volume} Coloxs, prix médian ${d.last24h.medianPrice ?? '—'}`),
      card('Offres en cours', d.activity.listings, `${d.activity.salesTotal} ventes au total`),
      card('Échanges', d.activity.tradesDone, `${d.activity.tradesOpen} en cours`),
      card('Alertes ouvertes', d.flagsOpen, `${d.marketBlocks} joueur(s) sans marché`),
      card('Registre', d.ledgerMismatches ? `${d.ledgerMismatches} écart(s)` : 'cohérent', 'solde = somme du registre'),
    );
    const days = el('table', 'staff-table');
    const head = el('tr');
    head.append(el('th', undefined, 'Jour'), el('th', undefined, 'Ventes'), el('th', undefined, 'Volume'), el('th', undefined, 'Prix médian'));
    days.append(head);
    for (const day of d.perDay.slice().reverse()) {
      const row = el('tr');
      row.append(el('td', undefined, day.day), el('td', undefined, String(day.sales)), el('td', undefined, String(day.volume)), el('td', undefined, day.medianPrice === null ? '—' : String(day.medianPrice)));
      days.append(row);
    }
    const held = el('p', 'small', `Plus gros détenteurs : ${d.topHolders.map((h) => `${h.nickname} (${h.items})`).join(', ') || 'personne'}.`);
    const corner = el('p', 'small', d.concentration.length ? `Séries accaparées : ${d.concentration.map((c) => `« ${c.name} » ${c.held}/${c.size} chez ${c.nickname}`).join(' ; ')}.` : 'Aucune série accaparée par un seul compte.');
    economy.replaceChildren(grid, held, corner, days);
  }

  async function loadFlags() {
    const res = await api.staffMarketFlags('open');
    if (!res.ok) return void flags.replaceChildren(el('p', 'error', res.error));
    if (!res.data.flags.length) return void flags.replaceChildren(el('p', 'muted', 'Rien de suspect pour l’instant.'));
    flags.replaceChildren(
      ...res.data.flags.map((f: MarketFlag) => {
        const row = el('div', 'chat-row');
        const who2 = f.other ? `${f.player} ↔ ${f.other}` : f.player;
        row.append(
          el('span', 'muted small', when(f.at)),
          el('strong', undefined, FLAG_LABELS[f.kind] ?? f.kind),
          el('span', undefined, `${who2} : ${f.detail}`),
          button('Voir le joueur', () => void showPlayer(f.player), 'link'),
          button('Traité', async () => {
            const done = await api.staffHandleFlag(f.id);
            if (!done.ok) options.say(done.error);
            await loadFlags();
          }),
        );
        return row;
      }),
    );
  }

  async function showPlayer(nickname: string) {
    who.value = nickname;
    player.replaceChildren(el('p', 'muted', 'Chargement…'));
    const res = await api.staffMarketPlayer(nickname);
    if (!res.ok) return void player.replaceChildren(el('p', 'error', res.error));
    const d: MarketPlayerSheet = res.data;
    const nodes: HTMLElement[] = [el('p', undefined, `${d.player.nickname} : ${d.player.coloxs} Coloxs, inscrit le ${new Date(d.player.since).toLocaleDateString('fr-FR')}.`)];

    if (d.block) {
      const line = el('p', 'error', `Marché fermé : ${d.block.reason}${d.block.until ? ` (jusqu’au ${when(d.block.until)})` : ''}.`);
      nodes.push(line);
      if (options.manage) {
        nodes.push(
          button('Rouvrir le marché', async () => {
            const done = await api.staffMarketUnblock(d.player.nickname);
            options.say(done.ok ? 'Marché rouvert.' : done.error);
            await showPlayer(d.player.nickname);
          }),
        );
      }
    } else if (options.manage) {
      const form = el('form', 'staff-bar');
      const reason = el('input');
      reason.placeholder = 'Raison (obligatoire)';
      reason.maxLength = 300;
      reason.setAttribute('aria-label', 'Raison');
      const submit = el('button', undefined, 'Fermer le marché à ce joueur');
      submit.type = 'submit';
      form.append(reason, submit);
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const done = await api.staffMarketBlock(d.player.nickname, reason.value);
        options.say(done.ok ? 'Marché fermé à ce joueur.' : done.error);
        await showPlayer(d.player.nickname);
      });
      nodes.push(form);
    }

    nodes.push(el('h4', undefined, 'Ventes'));
    if (!d.sales.length) nodes.push(el('p', 'muted small', 'Aucune.'));
    for (const s of d.sales) {
      const row = el('div', 'chat-row');
      row.append(
        el('span', 'muted small', when(s.at)),
        el('strong', undefined, `n° ${serialLabel(s.serial)} ${s.name}`),
        el('span', undefined, `${s.seller} → ${s.buyer} pour ${s.price} (commission ${s.commission}, royalties ${s.royalty})${s.reversed ? ' · annulée' : ''}`),
      );
      if (options.manage && !s.reversed) {
        row.append(
          button('Annuler la vente', async () => {
            const note = prompt('Pourquoi annuler cette vente ? (le motif est gardé)');
            if (!note) return;
            const done = await api.staffReverseSale(s.id, note);
            options.say(done.ok ? 'Vente annulée.' : done.error);
            await showPlayer(d.player.nickname);
            await loadEconomy();
          }),
        );
      }
      nodes.push(row);
    }

    nodes.push(el('h4', undefined, 'Échanges'));
    if (!d.trades.length) nodes.push(el('p', 'muted small', 'Aucun.'));
    for (const t of d.trades) {
      const row = el('div', 'chat-row');
      row.append(el('span', 'muted small', when(t.at)), el('strong', undefined, `${t.a} (${t.gaveA}) ↔ ${t.b} (${t.gaveB})`), el('span', undefined, t.status));
      nodes.push(row);
    }

    nodes.push(el('h4', undefined, 'Offres en cours'));
    if (!d.listings.length) nodes.push(el('p', 'muted small', 'Aucune.'));
    for (const l of d.listings) {
      const row = el('div', 'chat-row');
      row.append(el('strong', undefined, `n° ${serialLabel(l.serial)} ${l.name}`), el('span', undefined, `${l.price} Coloxs, jusqu’au ${when(l.expiresAt)}`));
      nodes.push(row);
    }

    nodes.push(el('h4', undefined, 'Registre des Coloxs'));
    for (const l of d.ledger) {
      const row = el('div', 'chat-row');
      row.append(el('span', 'muted small', when(l.at)), el('strong', undefined, `${l.delta > 0 ? '+' : ''}${l.delta}`), el('span', undefined, `${l.kind}${l.detail ? ` · ${l.detail}` : ''}`));
      nodes.push(row);
    }
    player.replaceChildren(...nodes);
  }

  search.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (who.value.trim()) void showPlayer(who.value.trim());
  });
  await Promise.all([loadEconomy(), loadFlags()]);
}
