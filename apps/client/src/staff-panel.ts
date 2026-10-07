import {
  api,
  itemSpriteUrl,
  type ChatQuery,
  type ReportKind,
  type SanctionKind,
  type SanctionOrder,
  type StaffHandledReport,
  type StaffPlayerRow,
  type StaffPlayerSheet,
  type StaffReportGroup,
} from './api';
import { REASONS } from './report-dialog';
import { windowBar } from './window';

type Tab = 'reports' | 'chat' | 'players';
const TABS: [Tab, string][] = [
  ['reports', 'Signalements'],
  ['chat', 'Journal du chat'],
  ['players', 'Joueurs'],
];

const KIND_LABELS: Record<ReportKind, string> = {
  player: 'Joueur',
  message: 'Message',
  item: 'Création',
  apartment_name: 'Nom d’appart',
  apartment: 'Appart',
};
const REASON_LABELS = Object.fromEntries(REASONS) as Record<string, string>;
const SANCTION_LABELS: Record<SanctionKind, string> = { warning: 'Avertissement', mute: 'Sourdine', suspension: 'Suspension', ban: 'Bannissement' };
const DURATIONS: [number, string][] = [
  [10, '10 minutes'],
  [60, '1 heure'],
  [24 * 60, '24 heures'],
  [7 * 24 * 60, '7 jours'],
  [30 * 24 * 60, '30 jours'],
];

export interface StaffPanel {
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

const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const roomName = (room: string) => (room === 'hall' ? 'Hall' : room.startsWith('apartment:') ? 'Appart' : room);

/** The staff panel: reports to review, the chat journal, player sheets with their sanctions. Only shown to staff; the server checks the role anyway. */
export function createStaffPanel(options: { onToggle(open: boolean): void; notify(text: string): void }): StaffPanel {
  const root = el('section', 'window staff');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Panel staff');

  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  const tabButtons = new Map<Tab, HTMLButtonElement>();
  const content = el('div', 'staff-content');
  const body = el('div', 'win-body');
  body.append(tabs, content);
  root.append(windowBar('Panel staff', () => hide()), body);

  let tab: Tab = 'reports';
  let showHandled = false;
  let chatQuery: ChatQuery = {};
  let playerId: string | null = null;
  let playerSearch = '';

  const button = (label: string, run: () => void | Promise<void>, className?: string) => {
    const b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', () => void run());
    return b;
  };
  const link = (label: string, run: () => void) => button(label, run, 'link');
  const say = (text: string) => options.notify(text);
  const failure = (error: string) => say(error);

  function select<T extends string | number>(choices: [T, string][], value: T): HTMLSelectElement {
    const s = el('select');
    for (const [v, label] of choices) {
      const o = el('option', undefined, label);
      o.value = String(v);
      o.selected = v === value;
      s.append(o);
    }
    return s;
  }

  /** Kind, duration and reason of a sanction. The server decides whether it is valid. */
  function sanctionForm(submitLabel: string, onSubmit: (order: SanctionOrder) => Promise<void>): HTMLFormElement {
    const form = el('form', 'sanction-form');
    const kinds = select<SanctionKind>(
      (Object.keys(SANCTION_LABELS) as SanctionKind[]).map((k) => [k, SANCTION_LABELS[k]]),
      'warning',
    );
    kinds.setAttribute('aria-label', 'Sanction');
    const duration = select(DURATIONS, 60);
    duration.setAttribute('aria-label', 'Durée');
    const reason = el('input');
    reason.placeholder = 'Motif (obligatoire, le joueur le verra)';
    reason.maxLength = 300;
    reason.setAttribute('aria-label', 'Motif');
    const submit = button(submitLabel, () => {}, 'primary');
    submit.type = 'submit';
    const sync = () => {
      duration.hidden = !(kinds.value === 'mute' || kinds.value === 'suspension');
    };
    kinds.addEventListener('change', sync);
    sync();
    form.append(kinds, duration, reason, submit);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      submit.disabled = true;
      await onSubmit({
        kind: kinds.value as SanctionKind,
        minutes: duration.hidden ? undefined : Number(duration.value),
        reason: reason.value,
      });
      submit.disabled = false;
    });
    return form;
  }

  // ----- Reports -----------------------------------------------------------
  function reportCard(g: StaffReportGroup, reload: () => void): HTMLElement {
    const card = el('article', 'staff-card');
    const head = el('div', 'staff-card-head');
    head.append(el('strong', undefined, KIND_LABELS[g.kind]), el('span', 'badge', `× ${g.count}`));
    if (g.kind === 'item') {
      if (g.itemState === 'hidden') head.append(el('span', 'chip bad', 'Masquée par le staff'));
      else if (g.itemState === 'cleared') head.append(el('span', 'chip good', 'Validée'));
      else if (g.masked) head.append(el('span', 'chip bad', 'Masquée (3 signalements)'));
    }
    card.append(head);

    const main = el('div', 'staff-card-main');
    if (g.kind === 'item') {
      const img = el('img');
      img.src = itemSpriteUrl(g.targetKey);
      img.alt = '';
      img.width = 64;
      img.height = 75;
      main.append(img);
    }
    const text = el('div');
    text.append(el('p', undefined, g.snapshot));
    const reasons = Object.entries(g.reasons)
      .map(([r, n]) => `${REASON_LABELS[r] ?? r}${n > 1 ? ` ×${n}` : ''}`)
      .join(' · ');
    text.append(el('p', 'muted small', `Motifs : ${reasons} — depuis le ${when(g.firstAt)}`));
    const who = el('details', 'small');
    who.append(el('summary', undefined, 'Qui a signalé'));
    for (const r of g.reports) {
      who.append(el('p', 'muted small', `${when(r.at)} · ${r.reporter} · ${REASON_LABELS[r.reason] ?? r.reason}${r.details ? ` — « ${r.details} »` : ''}`));
    }
    text.append(who);
    if (g.targetUser) {
      const user = g.targetUser;
      text.append(link(`Fiche de ${user.nickname}`, () => openPlayer(user.id)));
    }
    main.append(text);
    card.append(main);

    const note = el('input');
    note.placeholder = 'Note (facultatif)';
    note.maxLength = 300;
    note.setAttribute('aria-label', 'Note');
    const decide = async (decision: 'dismiss' | 'confirm', sanction?: SanctionOrder) => {
      const res = await api.staffResolve({ kind: g.kind, targetKey: g.targetKey, decision, note: note.value.trim() || undefined, sanction });
      if (!res.ok) return failure(res.error);
      say(decision === 'dismiss' ? 'Classé sans suite.' : sanction ? 'Confirmé et sanction appliquée.' : 'Confirmé.');
      reload();
    };
    const sanctionBox = el('div');
    sanctionBox.hidden = true;
    if (g.targetUser) sanctionBox.append(sanctionForm('Confirmer et sanctionner', (order) => decide('confirm', order)));
    const actions = el('div', 'staff-actions');
    actions.append(
      button('Classer sans suite', () => decide('dismiss')),
      button(g.kind === 'item' ? 'Confirmer (masquer la création)' : 'Confirmer', () => decide('confirm'), 'primary'),
    );
    if (g.targetUser) actions.append(button('Sanctionner…', () => void (sanctionBox.hidden = !sanctionBox.hidden)));
    card.append(note, actions, sanctionBox);
    return card;
  }

  function handledRow(h: StaffHandledReport): HTMLElement {
    const row = el('article', 'staff-card');
    const head = el('div', 'staff-card-head');
    head.append(el('strong', undefined, `${KIND_LABELS[h.kind]} · ${h.target ?? '—'}`), el('span', h.status === 'confirmed' ? 'chip bad' : 'chip good', h.status === 'confirmed' ? 'Confirmé' : 'Sans suite'));
    row.append(head, el('p', undefined, h.snapshot));
    row.append(el('p', 'muted small', `Signalé par ${h.reporter} (${REASON_LABELS[h.reason] ?? h.reason}) · traité par ${h.handler ?? '?'} le ${when(h.handledAt)}${h.note ? ` — « ${h.note} »` : ''}`));
    return row;
  }

  async function renderReports() {
    const bar = el('div', 'staff-bar');
    bar.append(
      button('En attente', () => ((showHandled = false), render()), showHandled ? undefined : 'primary'),
      button('Traités', () => ((showHandled = true), render()), showHandled ? 'primary' : undefined),
      button('Actualiser', () => render()),
    );
    const list = el('div', 'staff-list');
    content.replaceChildren(bar, list);
    list.append(el('p', 'muted', 'Chargement…'));
    if (showHandled) {
      const res = await api.staffHandled();
      list.replaceChildren();
      if (!res.ok) return void list.append(el('p', 'error', res.error));
      if (!res.data.handled.length) list.append(el('p', 'muted', 'Rien de traité pour l’instant.'));
      for (const h of res.data.handled) list.append(handledRow(h));
      return;
    }
    const res = await api.staffReports();
    list.replaceChildren();
    if (!res.ok) return void list.append(el('p', 'error', res.error));
    if (!res.data.groups.length) list.append(el('p', 'muted', 'Aucun signalement en attente. 🎉'));
    for (const g of res.data.groups) list.append(reportCard(g, () => void renderReports()));
  }

  // ----- Chat journal ------------------------------------------------------
  async function renderChat() {
    const form = el('form', 'staff-bar');
    const nickname = el('input');
    nickname.placeholder = 'Pseudo';
    nickname.value = chatQuery.nickname ?? '';
    nickname.setAttribute('aria-label', 'Pseudo');
    const where = select<string>(
      [
        ['', 'Toutes les salles'],
        ['hall', 'Le hall'],
        ['owner', 'Chez…'],
      ],
      chatQuery.room === 'hall' ? 'hall' : chatQuery.owner ? 'owner' : '',
    );
    where.setAttribute('aria-label', 'Salle');
    const owner = el('input');
    owner.placeholder = 'Pseudo du propriétaire';
    owner.value = chatQuery.owner ?? '';
    owner.setAttribute('aria-label', 'Propriétaire de l’appart');
    const text = el('input');
    text.placeholder = 'Contient…';
    text.value = chatQuery.q ?? '';
    text.setAttribute('aria-label', 'Texte');
    const blocked = select<string>(
      [
        ['', 'Tous les messages'],
        ['true', 'Bloqués'],
        ['false', 'Passés'],
      ],
      chatQuery.blocked ?? '',
    );
    blocked.setAttribute('aria-label', 'Bloqués ou passés');
    const go = el('button', 'primary', 'Chercher');
    go.type = 'submit';
    const syncOwner = () => (owner.hidden = where.value !== 'owner');
    where.addEventListener('change', syncOwner);
    syncOwner();
    form.append(nickname, where, owner, text, blocked, go);

    const list = el('div', 'staff-list');
    content.replaceChildren(form, list);

    const load = async (query: ChatQuery, append = false) => {
      if (!append) list.replaceChildren(el('p', 'muted', 'Chargement…'));
      const res = await api.staffChat(query);
      if (!append) list.replaceChildren();
      list.querySelector('.more')?.remove();
      if (!res.ok) return void list.append(el('p', 'error', res.error));
      if (!res.data.messages.length && !append) list.append(el('p', 'muted', 'Aucun message pour ces critères.'));
      for (const m of res.data.messages) {
        const row = el('div', m.blocked ? 'chat-row blocked' : 'chat-row');
        row.append(el('span', 'muted small', `${when(m.at)} · ${roomName(m.room)}`));
        row.append(link(m.nickname, () => openPlayer(m.userId)), el('span', undefined, m.text));
        if (m.blocked) row.append(el('span', 'chip bad', `bloqué : ${m.reason ?? '?'}`));
        list.append(row);
      }
      if (res.data.next !== null) list.append(button('Plus anciens', () => load({ ...query, before: res.data.next! }, true), 'more'));
    };
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      chatQuery = {
        nickname: nickname.value.trim() || undefined,
        room: where.value === 'hall' ? 'hall' : undefined,
        owner: where.value === 'owner' ? owner.value.trim() || undefined : undefined,
        q: text.value.trim() || undefined,
        blocked: (blocked.value as 'true' | 'false' | '') || undefined,
      };
      void load(chatQuery);
    });
    await load(chatQuery);
  }

  // ----- Players -----------------------------------------------------------
  function playerRow(p: StaffPlayerRow): HTMLElement {
    const row = el('div', 'friend-row');
    const name = el('span', 'nav-text');
    name.append(el('strong', undefined, p.nickname), el('span', 'muted small', `inscrit le ${when(p.createdAt)}${p.role === 'staff' ? ' · équipe' : ''}`));
    row.append(name);
    for (const s of p.sanctions) row.append(el('span', 'chip bad', SANCTION_LABELS[s]));
    row.append(button('Fiche', () => openPlayer(p.id)));
    return row;
  }

  async function renderPlayers() {
    if (playerId) return renderSheet(playerId);
    const form = el('form', 'staff-bar');
    const q = el('input');
    q.placeholder = 'Chercher un pseudo…';
    q.value = playerSearch;
    q.setAttribute('aria-label', 'Pseudo');
    const go = el('button', 'primary', 'Chercher');
    go.type = 'submit';
    form.append(q, go);
    const list = el('div', 'staff-list');
    content.replaceChildren(form, list);
    const load = async () => {
      playerSearch = q.value.trim();
      list.replaceChildren(el('p', 'muted', 'Chargement…'));
      const res = await api.staffPlayers(playerSearch);
      list.replaceChildren();
      if (!res.ok) return void list.append(el('p', 'error', res.error));
      if (!res.data.players.length) list.append(el('p', 'muted', 'Aucun joueur trouvé.'));
      for (const p of res.data.players) list.append(playerRow(p));
    };
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void load();
    });
    await load();
  }

  function sheetView(sheet: StaffPlayerSheet): HTMLElement {
    const view = el('div', 'staff-list');
    const p = sheet.player;
    const head = el('div', 'staff-bar');
    head.append(button('← Joueurs', () => ((playerId = null), render())), el('strong', undefined, p.nickname));
    if (p.role === 'staff') head.append(el('span', 'chip good', 'Équipe'));
    view.append(head);
    const flat = p.apartment ? `appart n° ${p.apartment.id}${p.apartment.name ? ` « ${p.apartment.name} »` : ''} (${p.apartment.access})` : 'sans appart';
    view.append(
      el('p', 'muted small', `Inscrit le ${when(p.createdAt)} · ${flat}`),
      el('p', 'small', `Signalements : ${sheet.reports.againstOpen} en attente contre lui, ${sheet.reports.againstTotal} au total ; ${sheet.reports.made} faits par lui.`),
    );

    if (p.role !== 'staff') {
      view.append(el('h3', undefined, 'Sanctionner'));
      view.append(
        sanctionForm('Appliquer', async (order) => {
          const res = await api.staffSanction(p.id, order);
          if (!res.ok) return failure(res.error);
          say(`${SANCTION_LABELS[order.kind]} appliqué${order.kind === 'warning' || order.kind === 'mute' ? 'e' : ''}.`);
          void render();
        }),
      );
    }

    view.append(el('h3', undefined, `Sanctions (${sheet.sanctions.length})`));
    if (!sheet.sanctions.length) view.append(el('p', 'muted small', 'Aucune.'));
    for (const s of sheet.sanctions) {
      const row = el('div', 'friend-row');
      const t = el('span', 'nav-text');
      const until = s.expiresAt ? ` jusqu’au ${when(s.expiresAt)}` : '';
      t.append(
        el('strong', undefined, `${SANCTION_LABELS[s.kind]}${until}`),
        el('span', 'muted small', `${s.reason} — par ${s.issuer} le ${when(s.createdAt)}${s.revokedAt ? ` · levée par ${s.revoker} le ${when(s.revokedAt)}` : ''}`),
      );
      row.append(t);
      if (s.live) {
        row.append(el('span', 'chip bad', 'En cours'), button('Lever', async () => {
          const res = await api.staffRevoke(s.id);
          if (!res.ok) return failure(res.error);
          say('Sanction levée.');
          void render();
        }));
      }
      view.append(row);
    }

    view.append(el('h3', undefined, `Créations (${sheet.creations.length})`));
    if (!sheet.creations.length) view.append(el('p', 'muted small', 'Aucune.'));
    for (const c of sheet.creations) {
      const row = el('div', 'friend-row');
      const img = el('img');
      img.src = itemSpriteUrl(c.id);
      img.alt = '';
      img.width = 32;
      img.height = 37;
      const t = el('span', 'nav-text');
      t.append(el('strong', undefined, `N° ${String(c.serial).padStart(4, '0')} · ${c.name}`), el('span', 'muted small', when(c.createdAt)));
      row.append(img, t);
      if (c.masked) row.append(el('span', 'chip bad', 'Masquée'));
      else if (c.state === 'cleared') row.append(el('span', 'chip good', 'Validée'));
      const change = (state: 'hidden' | 'cleared' | 'none', label: string) =>
        button(label, async () => {
          const res = await api.staffItem(c.id, state);
          if (!res.ok) return failure(res.error);
          say('Création mise à jour.');
          void render();
        });
      row.append(c.masked ? change('none', 'Rétablir') : change('hidden', 'Masquer'));
      view.append(row);
    }

    view.append(el('h3', undefined, 'Derniers messages'));
    if (!sheet.chat.length) view.append(el('p', 'muted small', 'Aucun.'));
    for (const m of sheet.chat) {
      const row = el('div', m.blocked ? 'chat-row blocked' : 'chat-row');
      row.append(el('span', 'muted small', `${when(m.at)} · ${roomName(m.room)}`), el('span', undefined, m.text));
      if (m.blocked) row.append(el('span', 'chip bad', `bloqué : ${m.reason ?? '?'}`));
      view.append(row);
    }
    view.append(link('Tout le journal de ce joueur', () => openChat({ nickname: p.nickname })));
    return view;
  }

  async function renderSheet(id: string) {
    content.replaceChildren(el('p', 'muted', 'Chargement…'));
    const res = await api.staffPlayer(id);
    if (!res.ok) {
      playerId = null;
      content.replaceChildren(el('p', 'error', res.error));
      return;
    }
    content.replaceChildren(sheetView(res.data));
  }

  // ----- Shell -------------------------------------------------------------
  function openPlayer(id: string) {
    playerId = id;
    tab = 'players';
    void render();
  }
  function openChat(query: ChatQuery) {
    chatQuery = query;
    tab = 'chat';
    void render();
  }

  async function render() {
    for (const [key, b] of tabButtons) {
      b.classList.toggle('active', key === tab);
      b.setAttribute('aria-selected', String(key === tab));
    }
    if (tab === 'reports') await renderReports();
    else if (tab === 'chat') await renderChat();
    else await renderPlayers();
  }

  for (const [key, label] of TABS) {
    const b = el('button', undefined, label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = key;
      if (key === 'players') playerId = null;
      void render();
    });
    tabButtons.set(key, b);
    tabs.append(b);
  }

  function hide() {
    if (root.hidden) return;
    root.hidden = true;
    options.onToggle(false);
  }
  const open = () => {
    root.hidden = false;
    void render();
    options.onToggle(true);
  };
  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !document.querySelector('.modal-back')) hide();
  });

  return {
    element: root,
    isOpen: () => !root.hidden,
    toggle: () => (root.hidden ? open() : hide()),
    close: hide,
  };
}
