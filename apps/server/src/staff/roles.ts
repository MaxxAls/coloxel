import type pg from 'pg';
import type { SanctionKind } from '../moderation/sanctions';

// The staff roles and what each of them may do. A player has exactly one role; the higher the level,
// the more it can do, and nobody can act on somebody of the same level or above (a moderator cannot
// sanction another moderator, only a higher role can).

export const PERMISSIONS = [
  /** Open the administration (every staff role). */
  'admin.access',
  'dashboard.view',
  'reports.view',
  'reports.resolve',
  'chat.view',
  'players.view',
  'sanction.warning',
  'sanction.mute',
  'sanction.suspension',
  'sanction.ban',
  'sanction.revoke',
  'items.moderate',
  'news.write',
  'events.manage',
  /** Switch the maintenance mode on or off. */
  'maintenance.toggle',
  /** Keep playing while the game is in maintenance. */
  'maintenance.bypass',
  /** See the team and its changes of role. */
  'roles.view',
  // Commands typed in a room (":ha", ":kick"…): see apps/server/src/realtime/staff-commands.ts.
  /** Alert the people of the room one is in, or one player. */
  'alerts.room',
  'alerts.user',
  /** Announce an event to everybody, with a button to join it. */
  'alerts.event',
  /** Alert every player who is connected. */
  'alerts.hotel',
  /** Show somebody out of the room, or silence the whole room. */
  'room.kick',
  'room.mute',
  /** Lights, confetti, dancing, freezing: what a host does to liven a room up. */
  'room.fun',
  /** Ask a player to come to where one is. */
  'players.summon',
  /** Add or remove a word of the chat filter. */
  'words.manage',
  /** Read the journal of everything the staff did. */
  'staff.log',
  /** Give Pixels as a gift of the team. */
  'gift.pixels',
  /** Give or take a role below one's own. */
  'roles.manage',
  /** See the market's suspicious operations, a player's transactions and the economy page. */
  'market.view',
  /** Undo a sale, shut a player out of the market. */
  'market.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_IDS = ['user', 'animateur', 'moderateur', 'super_moderateur', 'gerant', 'administrateur'] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export interface RoleDef {
  id: RoleId;
  title: string;
  /** What this role is for, in one sentence. */
  summary: string;
  level: number;
  permissions: readonly Permission[];
  /** The longest mute and suspension this role may give, in minutes. Absent: no limit. */
  maxMuteMinutes?: number;
  maxSuspensionMinutes?: number;
}

const DAY = 24 * 60;

const ANIMATEUR: readonly Permission[] = [
  'admin.access',
  'dashboard.view',
  'players.view',
  'sanction.warning',
  'news.write',
  'events.manage',
  'alerts.event',
  'alerts.room',
  'alerts.user',
  'room.fun',
];
const MODERATEUR: readonly Permission[] = [
  ...ANIMATEUR.filter((p) => !['news.write', 'events.manage', 'alerts.event', 'room.fun'].includes(p)),
  'reports.view',
  'reports.resolve',
  'chat.view',
  'sanction.mute',
  'sanction.suspension',
  'sanction.revoke',
  'items.moderate',
  'roles.view',
  'room.kick',
  'room.mute',
  'players.summon',
  'words.manage',
  'market.view',
];
const SUPER_MODERATEUR: readonly Permission[] = [...MODERATEUR, 'sanction.ban', 'news.write', 'alerts.hotel'];
const GERANT: readonly Permission[] = [...SUPER_MODERATEUR, 'events.manage', 'alerts.event', 'room.fun', 'staff.log', 'maintenance.toggle', 'maintenance.bypass', 'roles.manage', 'market.manage'];

export const ROLES: Record<RoleId, RoleDef> = {
  user: { id: 'user', title: 'Joueur', summary: 'Un joueur ordinaire.', level: 0, permissions: [] },
  animateur: {
    id: 'animateur',
    title: 'Animateur',
    summary: 'Organise des événements et écrit les actualités. Peut avertir un joueur.',
    level: 20,
    permissions: ANIMATEUR,
  },
  moderateur: {
    id: 'moderateur',
    title: 'Modérateur',
    summary: 'Traite les signalements, lit le journal du chat, met en sourdine (24 h au plus) ou suspend (7 jours au plus).',
    level: 40,
    permissions: MODERATEUR,
    maxMuteMinutes: DAY,
    maxSuspensionMinutes: 7 * DAY,
  },
  super_moderateur: {
    id: 'super_moderateur',
    title: 'Super-modérateur',
    summary: 'Comme le modérateur, avec des sanctions plus longues et le bannissement.',
    level: 60,
    permissions: SUPER_MODERATEUR,
    maxMuteMinutes: 7 * DAY,
    maxSuspensionMinutes: 30 * DAY,
  },
  gerant: {
    id: 'gerant',
    title: 'Gérant',
    summary: 'Dirige l’équipe : nomme animateurs et modérateurs, met le jeu en maintenance.',
    level: 80,
    permissions: GERANT,
    maxMuteMinutes: 30 * DAY,
    maxSuspensionMinutes: 90 * DAY,
  },
  administrateur: {
    id: 'administrateur',
    title: 'Administrateur',
    summary: 'Tous les droits. Nomme les gérants.',
    level: 100,
    permissions: PERMISSIONS,
  },
};

export const isRole = (value: unknown): value is RoleId => typeof value === 'string' && (ROLE_IDS as readonly string[]).includes(value);

/** The roles that belong to the staff, from the lowest. */
export const STAFF_ROLES: readonly RoleDef[] = ROLE_IDS.filter((r) => r !== 'user').map((r) => ROLES[r]);

export const can = (role: string, permission: Permission): boolean => isRole(role) && ROLES[role].permissions.includes(permission);
export const levelOf = (role: string): number => (isRole(role) ? ROLES[role].level : 0);
export const isStaffRole = (role: string): boolean => isRole(role) && role !== 'user';

/** The roles somebody with this role may give or take away: strictly below their own, and only with `roles.manage`. */
export function assignableRoles(role: string): RoleDef[] {
  if (!can(role, 'roles.manage')) return [];
  return [ROLES.user, ...STAFF_ROLES].filter((r) => r.level < levelOf(role));
}

/** May a player with this role be sanctioned, or have their role changed, by somebody with `actor`'s role? Only from above. */
export const outranks = (actor: string, target: string): boolean => levelOf(actor) > levelOf(target);

/** Why this role may not give this sanction, or null when it may. */
export function sanctionRefusal(role: string, kind: SanctionKind, minutes: number | undefined): string | null {
  if (!isRole(role)) return 'Tu n’as pas ce droit.';
  const def = ROLES[role];
  if (!def.permissions.includes(`sanction.${kind}` as Permission)) return `Ton rôle (${def.title}) ne permet pas cette sanction.`;
  if (kind === 'mute' && def.maxMuteMinutes !== undefined && (minutes ?? 0) > def.maxMuteMinutes) {
    return `Ton rôle (${def.title}) limite la sourdine à ${def.maxMuteMinutes / 60} h.`;
  }
  if (kind === 'suspension' && def.maxSuspensionMinutes !== undefined && (minutes ?? 0) > def.maxSuspensionMinutes) {
    return `Ton rôle (${def.title}) limite la suspension à ${def.maxSuspensionMinutes / DAY} jours.`;
  }
  return null;
}

export interface StaffMember {
  id: string;
  nickname: string;
  role: RoleId;
}

/** The player behind a session as staff, read from the database every time (a demotion counts at once), or null. */
export async function loadStaff(pool: pg.Pool, userId: string): Promise<StaffMember | null> {
  const { rows } = await pool.query<{ id: string; nickname: string; role: string }>('SELECT id, nickname, role FROM users WHERE id = $1', [userId]);
  const row = rows[0];
  if (!row || !isStaffRole(row.role)) return null;
  return { id: row.id, nickname: row.nickname, role: row.role as RoleId };
}
