import {
  api,
  itemSpriteUrl,
  type ChatQuery,
  type ReportKind,
  type SanctionKind,
  type SanctionOrder,
  type Announcement,
  type StaffHandledReport,
  type StaffMe,
  type StaffRoleDef,
  type StaffPlayerRow,
  type StaffPlayerSheet,
  type StaffReportGroup,
} from './api';
import { REASONS } from './report-dialog';
import { windowBar } from './window';

type Tab = 'dashboard' | 'reports' | 'chat' | 'players' | 'news' | 'events' | 'team' | 'log';
const TABS: [Tab, string][] = [
  ['dashboard', 'Tableau de bord'],
  ['reports', 'Signalements'],
  ['chat', 'Journal du chat'],
  ['players', 'Joueurs'],
  ['news', 'Annonces'],
  ['events', 'Événements'],
  ['team', 'Équipe'],
  ['log', 'Journal staff'],
];
/** What a role must hold to see a tab: the server checks it again on every request. */
const TAB_PERMISSION: Record<Tab, string> = {
  dashboard: 'dashboard.view',
  reports: 'reports.view',
  chat: 'chat.view',
  players: 'players.view',
  news: 'news.write',
  events: 'events.manage',
  team: 'roles.view',
  log: 'staff.log',
};

/** What each permission means, for the table of the roles. */
const PERMISSION_LABELS: [string, string][] = [
  ['dashboard.view', 'Voir le tableau de bord'],
  ['players.view', 'Consulter les fiches des joueurs'],
  ['reports.view', 'Voir les signalements'],
  ['reports.resolve', 'Traiter les signalements'],
  ['chat.view', 'Lire le journal du chat'],
  ['sanction.warning', 'Avertir'],
  ['sanction.mute', 'Mettre en sourdine'],
  ['sanction.suspension', 'Suspendre'],
  ['sanction.ban', 'Bannir'],
  ['sanction.revoke', 'Lever une sanction'],
  ['items.moderate', 'Masquer ou valider une création'],
  ['news.write', 'Écrire les actualités'],
  ['events.manage', 'Organiser des événements'],
  ['maintenance.toggle', 'Activer la maintenance'],
  ['maintenance.bypass', 'Jouer pendant la maintenance'],
  ['roles.view', 'Voir l’équipe'],
  ['roles.manage', 'Nommer des membres de l’équipe'],
  ['alerts.room', 'Alerter une salle (:ra)'],
  ['alerts.user', 'Alerter un joueur (:alert)'],
  ['alerts.event', 'Annoncer un événement (:ea)'],
  ['alerts.hotel', 'Alerter tout le jeu (:ha, :hal)'],
  ['room.kick', 'Faire sortir un joueur (:kick)'],
  ['room.mute', 'Réduire une salle au silence'],
  ['room.fun', 'Lumières, confettis, danse, gel'],
  ['players.summon', 'Convoquer un joueur (:summon)'],
  ['words.manage', 'Ajouter ou retirer un mot filtré'],
  ['staff.log', 'Lire le journal du staff'],
  ['gift.pixels', 'Offrir des Pixels (:gift)'],
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
/** Ready-made sanctions for the usual cases: they fill the form, the staff member can still change anything. */
const TEMPLATES: { label: string; order: SanctionOrder }[] = [
  { label: 'Insultes : sourdine 1 h', order: { kind: 'mute', minutes: 60, reason: 'Insultes envers d’autres joueurs.' } },
  { label: 'Spam : sourdine 10 min', order: { kind: 'mute', minutes: 10, reason: 'Messages répétés ou publicité.' } },
  { label: 'Infos personnelles : avertissement', order: { kind: 'warning', reason: 'Ne partage jamais d’informations personnelles (téléphone, adresse, réseaux sociaux).' } },
  { label: 'Contenu inapproprié : avertissement', order: { kind: 'warning', reason: 'Ce que tu as créé ou écrit ne respecte pas les règles du jeu.' } },
  { label: 'Harcèlement : suspension 24 h', order: { kind: 'suspension', minutes: 24 * 60, reason: 'Harcèlement envers d’autres joueurs.' } },
  { label: 'Récidive grave : suspension 7 jours', order: { kind: 'suspension', minutes: 7 * 24 * 60, reason: 'Comportement répété malgré les avertissements.' } },
];

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
export function createStaffPanel(options: { me: StaffMe; onToggle(open: boolean): void; notify(text: string): void; start?: Tab }): StaffPanel {
  const { me } = options;
  const allowed = (permission: string) => me.permissions.includes(permission);
  const visibleTabs = TABS.filter(([key]) => allowed(TAB_PERMISSION[key]));
  /** The sanctions this role may give. */
  const sanctionKinds = (): SanctionKind[] => (Object.keys(SANCTION_LABELS) as SanctionKind[]).filter((k) => allowed(`sanction.${k}`));
  const roleLevels = new Map<string, number>();
  async function loadRoles(): Promise<StaffRoleDef[]> {
    const res = await api.staffRoles();
    if (!res.ok) return [];
    for (const r of res.data.roles) roleLevels.set(r.id, r.level);
    return res.data.roles;
  }
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
  root.append(windowBar(`Panel staff · ${me.title}`, () => hide()), body);

  let tab: Tab = options.start && allowed(TAB_PERMISSION[options.start]) ? options.start : (visibleTabs[0]?.[0] ?? 'dashboard');
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
      sanctionKinds().map((k) => [k, SANCTION_LABELS[k]]),
      sanctionKinds()[0] ?? 'warning',
    );
    kinds.setAttribute('aria-label', 'Sanction');
    const duration = select(DURATIONS, 60);
    duration.setAttribute('aria-label', 'Durée');
    // A role has its limits: only the durations it may give are offered.
    const fillDurations = () => {
      const max = kinds.value === 'mute' ? me.maxMuteMinutes : me.maxSuspensionMinutes;
      duration.replaceChildren(
        ...DURATIONS.filter(([minutes]) => max === null || minutes <= max).map(([minutes, label]) => {
          const o = el('option', undefined, label);
          o.value = String(minutes);
          return o;
        }),
      );
    };
    fillDurations();
    const reason = el('input');
    reason.placeholder = 'Motif (obligatoire, le joueur le verra)';
    reason.maxLength = 300;
    reason.setAttribute('aria-label', 'Motif');
    const template = select<number>([[-1, 'Modèle…'], ...TEMPLATES.map((t, k) => [k, t.label] as [number, string])], -1);
    template.setAttribute('aria-label', 'Modèle de sanction');
    const submit = button(submitLabel, () => {}, 'primary');
    submit.type = 'submit';
    const sync = () => {
      duration.hidden = !(kinds.value === 'mute' || kinds.value === 'suspension');
    };
    kinds.addEventListener('change', () => {
      fillDurations();
      sync();
    });
    sync();
    template.addEventListener('change', () => {
      const t = TEMPLATES[Number(template.value)];
      if (!t) return;
      if (!sanctionKinds().includes(t.order.kind)) return say('Ton rôle ne permet pas cette sanction.');
      kinds.value = t.order.kind;
      fillDurations();
      if (t.order.minutes !== undefined) duration.value = String(t.order.minutes);
      reason.value = t.order.reason;
      sync();
    });
    form.append(template, kinds, duration, reason, submit);
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

  // ----- Dashboard ---------------------------------------------------------
  async function renderDashboard() {
    content.replaceChildren(el('p', 'muted', 'Chargement…'));
    const res = await api.staffDashboard();
    if (!res.ok) return void content.replaceChildren(el('p', 'error', res.error));
    const d = res.data;
    const view = el('div', 'staff-list');

    const card = (label: string, value: number | string, hint?: string, go?: () => void) => {
      const box = el(go ? 'button' : 'div', 'dash-card');
      if (box instanceof HTMLButtonElement) box.type = 'button';
      box.append(el('strong', undefined, String(value)), el('span', undefined, label));
      if (hint) box.append(el('small', 'muted', hint));
      if (go) box.addEventListener('click', go);
      return box;
    };
    const grid = el('div', 'dash-grid');
    grid.append(
      card('joueurs', d.players, `${d.newToday} inscrit(s) aujourd’hui`),
      card('objets créés', d.creations),
      card('signalements en attente', d.reportsOpen, d.reportsOpen ? 'à traiter' : 'rien à traiter', allowed('reports.view') ? () => ((tab = 'reports'), render()) : undefined),
      card('sanctions en cours', d.sanctionsLive, 'sourdines, suspensions, bannissements'),
      card('messages (24 h)', d.messages24h, `${d.blocked24h} bloqué(s) par le filtre`, allowed('chat.view') ? () => ((chatQuery = { blocked: 'true' }), (tab = 'chat'), render()) : undefined),
      card('annonces publiées', d.announcements, undefined, allowed('news.write') ? () => ((tab = 'news'), render()) : undefined),
    );
    view.append(grid);

    const manage = allowed('news.write') && allowed('maintenance.toggle');
    const state = el('div', d.maintenance ? 'staff-card dash-alert' : 'staff-card');
    state.append(
      el('strong', undefined, d.maintenance ? 'Le jeu est EN MAINTENANCE' : 'Le jeu est ouvert'),
      el('p', 'muted small', d.maintenance ? 'Seuls les membres de l’équipe peuvent jouer.' : 'Tout est normal.'),
    );
    if (manage) state.append(button('Gérer', () => ((tab = 'news'), render())));
    view.append(state);

    view.append(el('h3', undefined, 'Inscriptions des 7 derniers jours'));
    const max = Math.max(1, ...d.signups.map((s) => s.count));
    const chart = el('div', 'dash-chart');
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', `Inscriptions par jour : ${d.signups.map((s) => `${s.day} ${s.count}`).join(', ')}`);
    for (const s of d.signups) {
      const col = el('div', 'dash-bar');
      const bar = el('span');
      bar.style.height = `${Math.round((s.count / max) * 100)}%`;
      col.append(el('b', undefined, String(s.count)), bar, el('small', 'muted', new Date(`${s.day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })));
      chart.append(col);
    }
    view.append(chart);
    content.replaceChildren(view);
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
    const context = g.reports.find((r) => r.context)?.context;
    if (context) {
      const around = el('details', 'small');
      around.append(el('summary', undefined, 'Ce qui se disait juste avant'));
      around.append(el('pre', 'chat-context', context));
      text.append(around);
    }
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
    const canSanction = !!g.targetUser && sanctionKinds().length > 0;
    if (canSanction) sanctionBox.append(sanctionForm('Confirmer et sanctionner', (order) => decide('confirm', order)));
    const actions = el('div', 'staff-actions');
    actions.append(
      button('Classer sans suite', () => decide('dismiss')),
      button(g.kind === 'item' ? 'Confirmer (masquer la création)' : 'Confirmer', () => decide('confirm'), 'primary'),
    );
    if (canSanction) actions.append(button('Sanctionner…', () => void (sanctionBox.hidden = !sanctionBox.hidden)));
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

  function sheetView(sheet: StaffPlayerSheet, roles: StaffRoleDef[]): HTMLElement {
    const view = el('div', 'staff-list');
    const p = sheet.player;
    const head = el('div', 'staff-bar');
    head.append(button('← Joueurs', () => ((playerId = null), render())), el('strong', undefined, p.nickname));
    const roleTitle = roles.find((r) => r.id === p.role)?.title;
    if (roleTitle) head.append(el('span', `role-tag ${p.role}`, roleTitle));
    view.append(head);
    // Only down the ladder: the same rule as the server's.
    const below = (roleLevels.get(p.role) ?? 0) < me.level;
    const flat = p.apartment ? `appart n° ${p.apartment.id}${p.apartment.name ? ` « ${p.apartment.name} »` : ''} (${p.apartment.access})` : 'sans appart';
    view.append(
      el('p', 'muted small', `Inscrit le ${when(p.createdAt)} · ${flat}`),
      el('p', 'small', `Signalements : ${sheet.reports.againstOpen} en attente contre lui, ${sheet.reports.againstTotal} au total ; ${sheet.reports.made} faits par lui.`),
    );

    if (me.assignable.length && below) {
      view.append(el('h3', undefined, 'Rôle'));
      const choices: [string, string][] = [['user', 'Joueur ordinaire'], ...roles.filter((r) => me.assignable.includes(r.id)).map((r) => [r.id, r.title] as [string, string])];
      const picker = select<string>(choices, p.role);
      picker.setAttribute('aria-label', 'Rôle');
      const row = el('div', 'staff-bar');
      row.append(
        picker,
        button('Changer le rôle', async () => {
          const res = await api.staffSetRole(p.id, picker.value);
          if (!res.ok) return failure(res.error);
          say(`${p.nickname} : ${res.data.title}.`);
          void render();
        }, 'primary'),
      );
      view.append(row);
    }

    if (below && sanctionKinds().length) {
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
        row.append(el('span', 'chip bad', 'En cours'));
        if (allowed('sanction.revoke') && below) row.append(button('Lever', async () => {
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
      if (allowed('items.moderate')) row.append(c.masked ? change('none', 'Rétablir') : change('hidden', 'Masquer'));
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
    content.replaceChildren(sheetView(res.data, await loadRoles()));
  }

  // ----- News and maintenance ----------------------------------------------
  let editing: Announcement | null = null;

  async function renderNews() {
    content.replaceChildren(el('p', 'muted', 'Chargement…'));
    const res = await api.staffAnnouncements();
    if (!res.ok) return void content.replaceChildren(el('p', 'error', res.error));
    const view = el('div', 'staff-list');

    // Maintenance: players are shown the door, the staff still plays.
    const maintenance = el('div', 'staff-card');
    const state = el('p', undefined, res.data.maintenance ? 'Le jeu est EN MAINTENANCE : seuls les membres de l’équipe peuvent jouer.' : 'Le jeu est ouvert à tous.');
    maintenance.append(
      el('strong', undefined, 'Mode maintenance'),
      state,
      button(res.data.maintenance ? 'Rouvrir le jeu' : 'Passer en maintenance', async () => {
        const next = await api.staffMaintenance(!res.data.maintenance);
        if (!next.ok) return failure(next.error);
        say(next.data.maintenance ? 'Maintenance activée.' : 'Le jeu est rouvert.');
        void renderNews();
      }, res.data.maintenance ? 'primary' : undefined),
    );
    if (allowed('maintenance.toggle')) view.append(maintenance);

    const form = el('form', 'staff-card');
    form.append(el('strong', undefined, editing ? 'Modifier l’annonce' : 'Nouvelle annonce'));
    const title = el('input');
    title.placeholder = 'Titre';
    title.maxLength = 80;
    title.value = editing?.title ?? '';
    title.setAttribute('aria-label', 'Titre');
    const body = el('textarea');
    body.rows = 5;
    body.maxLength = 4000;
    body.placeholder = 'Texte (une ligne vide sépare les paragraphes)';
    body.value = editing?.body ?? '';
    body.setAttribute('aria-label', 'Texte');
    const checkbox = (label: string, checked: boolean) => {
      const row = el('label', 'check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = checked;
      row.append(box, document.createTextNode(` ${label}`));
      return { row, box };
    };
    const pinned = checkbox('Épinglée en haut', editing?.pinned ?? false);
    const published = checkbox('Publiée (sinon, brouillon)', editing?.published ?? true);
    const submit = el('button', 'primary', editing ? 'Enregistrer' : 'Publier');
    submit.type = 'submit';
    const actions = el('div', 'staff-actions');
    actions.append(submit);
    if (editing) actions.append(button('Annuler', () => ((editing = null), renderNews())));
    form.append(title, body, pinned.row, published.row, actions);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const draft = { title: title.value, body: body.value, pinned: pinned.box.checked, published: published.box.checked };
      const done = editing ? await api.staffEditAnnouncement(editing.id, draft) : await api.staffAnnounce(draft);
      if (!done.ok) return failure(done.error);
      say(editing ? 'Annonce enregistrée.' : 'Annonce publiée.');
      editing = null;
      void renderNews();
    });
    view.append(form);

    view.append(el('h3', undefined, `Annonces (${res.data.announcements.length})`));
    for (const a of res.data.announcements) {
      const card = el('article', 'staff-card');
      const head = el('div', 'staff-card-head');
      head.append(el('strong', undefined, a.title));
      if (a.pinned) head.append(el('span', 'chip good', 'Épinglée'));
      if (!a.published) head.append(el('span', 'chip bad', 'Brouillon'));
      card.append(head, el('p', 'muted small', `${when(a.createdAt)} · par ${a.author}`), el('p', 'small', a.body.length > 200 ? `${a.body.slice(0, 200)}…` : a.body));
      const row = el('div', 'staff-actions');
      row.append(
        button('Modifier', () => ((editing = a), renderNews())),
        button('Supprimer', async () => {
          if (!confirm(`Supprimer « ${a.title} » ?`)) return;
          const done = await api.staffDeleteAnnouncement(a.id);
          if (!done.ok) return failure(done.error);
          say('Annonce supprimée.');
          void renderNews();
        }),
      );
      card.append(row);
      view.append(card);
    }
    content.replaceChildren(view);
  }

  // ----- Events --------------------------------------------------------------
  async function renderEvents() {
    content.replaceChildren(el('p', 'muted', 'Chargement…'));
    const res = await api.staffEvents();
    if (!res.ok) return void content.replaceChildren(el('p', 'error', res.error));
    const view = el('div', 'staff-list');

    const form = el('form', 'staff-card');
    form.append(el('strong', undefined, 'Nouvel événement'));
    const title = el('input');
    title.placeholder = 'Titre (ex. Chasse aux objets)';
    title.maxLength = 80;
    title.setAttribute('aria-label', 'Titre');
    const description = el('textarea');
    description.rows = 3;
    description.maxLength = 1000;
    description.placeholder = 'Ce qui se passe, les règles, les lots…';
    description.setAttribute('aria-label', 'Description');
    const startsAt = el('input');
    startsAt.type = 'datetime-local';
    startsAt.setAttribute('aria-label', 'Début');
    const place = el('input');
    place.placeholder = 'Lieu (ex. Le hall, Chez Léa)';
    place.maxLength = 60;
    place.setAttribute('aria-label', 'Lieu');
    const submit = el('button', 'primary', 'Programmer');
    submit.type = 'submit';
    const row = el('div', 'staff-bar');
    row.append(startsAt, place);
    form.append(title, description, row, submit);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const done = await api.staffCreateEvent({
        title: title.value,
        description: description.value,
        startsAt: startsAt.value ? new Date(startsAt.value).toISOString() : '',
        place: place.value,
      });
      if (!done.ok) return failure(done.error);
      say('Événement programmé.');
      void renderEvents();
    });
    view.append(form);

    const planned = res.data.events.filter((e) => e.status === 'planned');
    const past = res.data.events.filter((e) => e.status !== 'planned');
    view.append(el('h3', undefined, `À venir (${planned.length})`));
    if (!planned.length) view.append(el('p', 'muted small', 'Rien de prévu.'));
    for (const e of planned) {
      const card = el('article', 'staff-card');
      card.append(el('strong', undefined, e.title), el('p', 'small', e.description), el('p', 'muted small', `${when(e.startsAt)} · ${e.place} · animé par ${e.host}`));
      const actions = el('div', 'staff-actions');
      actions.append(
        button('Il a eu lieu', async () => {
          const done = await api.staffCloseEvent(e.id, 'done');
          if (!done.ok) return failure(done.error);
          say('Bravo ! Un événement de plus au compteur.');
          void renderEvents();
        }, 'primary'),
        button('Annuler', async () => {
          const done = await api.staffCloseEvent(e.id, 'cancelled');
          if (!done.ok) return failure(done.error);
          say('Événement annulé.');
          void renderEvents();
        }),
      );
      card.append(actions);
      view.append(card);
    }
    if (past.length) {
      view.append(el('h3', undefined, 'Passés'));
      for (const e of past) {
        const line = el('div', 'friend-row');
        const text = el('span', 'nav-text');
        text.append(el('strong', undefined, e.title), el('span', 'muted small', `${when(e.startsAt)} · ${e.host}`));
        line.append(text, el('span', e.status === 'done' ? 'chip good' : 'chip bad', e.status === 'done' ? 'Tenu' : 'Annulé'));
        view.append(line);
      }
    }
    if (res.data.ranking.length) {
      view.append(el('h3', undefined, 'Les animateurs les plus actifs'));
      for (const [k, r] of res.data.ranking.entries()) view.append(el('p', 'small', `${k + 1}. ${r.nickname} — ${r.events} événement(s)`));
    }
    content.replaceChildren(view);
  }

  // ----- Team ----------------------------------------------------------------
  async function renderTeam() {
    content.replaceChildren(el('p', 'muted', 'Chargement…'));
    const [team, roles] = await Promise.all([api.staffTeam(), loadRoles()]);
    if (!team.ok) return void content.replaceChildren(el('p', 'error', team.error));
    const view = el('div', 'staff-list');
    view.append(el('h3', undefined, `L’équipe (${team.data.members.length})`));
    for (const m of team.data.members) {
      const row = el('div', 'friend-row');
      const text = el('span', 'nav-text');
      text.append(
        el('strong', undefined, m.nickname),
        el('span', 'muted small', `${m.since ? `depuis le ${when(m.since)}` : 'depuis le début'}${m.eventsHeld ? ` · ${m.eventsHeld} événement(s) tenu(s)` : ''}`),
      );
      row.append(text, el('span', `role-tag ${m.role}`, m.title));
      row.append(button('Fiche', () => openPlayer(m.id)));
      view.append(row);
    }

    view.append(el('h3', undefined, 'Ce que chaque rôle peut faire'));
    const table = el('table', 'role-matrix');
    const head = el('tr');
    head.append(el('th'), ...roles.map((r) => el('th', undefined, r.title)));
    table.append(head);
    for (const [permission, label] of PERMISSION_LABELS) {
      const line = el('tr');
      line.append(el('td', undefined, label));
      for (const r of roles) line.append(el('td', r.permissions.includes(permission) ? 'yes' : 'no', r.permissions.includes(permission) ? '✓' : '·'));
      table.append(line);
    }
    const limits = el('tr');
    limits.append(el('td', undefined, 'Sourdine / suspension la plus longue'));
    for (const r of roles) {
      const fmt = (m: number | null, can: boolean) => (!can ? '·' : m === null ? 'sans limite' : m >= 1440 ? `${m / 1440} j` : `${m / 60} h`);
      limits.append(el('td', undefined, `${fmt(r.maxMuteMinutes, r.permissions.includes('sanction.mute'))} / ${fmt(r.maxSuspensionMinutes, r.permissions.includes('sanction.suspension'))}`));
    }
    table.append(limits);
    const scroll = el('div', 'role-matrix-box');
    scroll.append(table);
    view.append(scroll);
    for (const r of roles) view.append(el('p', 'small', `${r.title} : ${r.summary}`));

    view.append(el('h3', undefined, 'Derniers changements de rôle'));
    if (!team.data.history.length) view.append(el('p', 'muted small', 'Aucun.'));
    for (const h of team.data.history) {
      view.append(el('p', 'small', `${when(h.at)} · ${h.nickname} : ${h.from} → ${h.to}${h.by ? ` (par ${h.by})` : ' (en ligne de commande)'}`));
    }
    content.replaceChildren(view);
  }

  // ----- Journal of the staff ----------------------------------------------------
  let logFilter = '';
  async function renderLog() {
    const form = el('form', 'staff-bar');
    const who = el('input');
    who.placeholder = 'Pseudo du membre (facultatif)';
    who.value = logFilter;
    who.setAttribute('aria-label', 'Membre de l’équipe');
    const go = el('button', 'primary', 'Filtrer');
    go.type = 'submit';
    form.append(who, go);
    const list = el('div', 'staff-list');
    content.replaceChildren(form, list);
    const load = async (before?: number) => {
      const res = await api.staffLog({ staff: logFilter || undefined, before });
      if (!before) list.replaceChildren();
      list.querySelector('.more')?.remove();
      if (!res.ok) return void list.append(el('p', 'error', res.error));
      if (!res.data.entries.length && !before) list.append(el('p', 'muted', 'Aucune commande pour l’instant.'));
      for (const e of res.data.entries) {
        const row = el('div', 'chat-row');
        row.append(el('span', 'muted small', `${when(e.at)} · ${e.room ? roomName(e.room) : ''}`), el('strong', undefined, e.staff), el('span', undefined, `:${e.command} ${e.args}`));
        list.append(row);
      }
      if (res.data.next !== null) list.append(button('Plus anciens', () => load(res.data.next!), 'more'));
    };
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      logFilter = who.value.trim();
      void load();
    });
    await load();
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
    if (tab === 'dashboard') await renderDashboard();
    else if (tab === 'reports') await renderReports();
    else if (tab === 'chat') await renderChat();
    else if (tab === 'news') await renderNews();
    else if (tab === 'events') await renderEvents();
    else if (tab === 'team') await renderTeam();
    else if (tab === 'log') await renderLog();
    else await renderPlayers();
  }

  for (const [key, label] of visibleTabs) {
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
