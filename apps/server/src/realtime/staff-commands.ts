import type pg from 'pg';
import { withTransaction } from '../db/pool';
import { USER_TOPIC, liveSql, type SanctionKind, type UserEvent } from '../moderation/sanctions';
import { extraWords, flatWord, setExtraWord } from '../moderation/words';
import { ROLES, can, outranks, type Permission, type StaffMember } from '../staff/roles';
import { announceSanction, issueSanction, sanctionSchema } from '../staff/sanctions';
import { grantPixels } from '../wallet/routes';
import type { Location } from './where';

// Commands for the staff, typed in the chat bar of any room and starting with ":" (":ha", ":kick"…). A player who is not
// staff, or whose role does not allow a command, is typing plain chat as far as the room can tell. Every command is answered
// to its author alone, checked against the role's permissions, and written in the journal of the staff.

/** Presence topic carrying announcements to every room, wherever it runs. */
export const HOTEL_TOPIC = 'coloxel:hotel';

export interface HotelAlert {
  kind: 'hotel' | 'event';
  text: string;
  from: string;
  /** A page of the website the alert points to (":hal"). */
  link?: string;
  /** Where an event is held, so that the alert can take people there. */
  target?: Location;
}

/** What a command may ask of the room it is typed in. */
export interface CommandRoom {
  location: Location;
  /** The players here, by nickname (case does not matter). */
  findPlayer(nickname: string): { id: string; nickname: string } | undefined;
  alertRoom(text: string, from: string): void;
  kick(id: string, reason: string): void;
  roomMuted(): boolean;
  setRoomMuted(on: boolean): void;
  massDance(on: boolean): void;
  setDisco(on: boolean): void;
  confetti(): void;
  freeze(id: string, seconds: number): void;
}

export interface CommandEnv {
  pool: pg.Pool;
  publish(topic: string, data: unknown): void;
  /** Where each of these players is, among those connected (for ":goto"). */
  locate(ids: string[]): Promise<Map<string, Location>>;
  setMaintenance(on: boolean, staffId: string): Promise<void>;
}

export interface CommandContext {
  staff: StaffMember;
  /** What was typed after the command's name. */
  rest: string;
  args: string[];
  room: CommandRoom;
  env: CommandEnv;
  /** Tell the author something. */
  reply(text: string): void;
  /** Ask the author's screen to go somewhere. */
  send(type: string, data: unknown): void;
}

interface Command {
  name: string;
  aliases?: string[];
  permission: Permission;
  usage: string;
  summary: string;
  run(ctx: CommandContext): Promise<void>;
}

const tell = (env: CommandEnv, event: UserEvent) => env.publish(USER_TOPIC, event);

interface Target {
  id: string;
  nickname: string;
  role: string;
}

async function findUser(pool: pg.Pool, nickname: string | undefined): Promise<Target | null> {
  if (!nickname) return null;
  const { rows } = await pool.query<Target>('SELECT id, nickname, role FROM users WHERE lower(nickname) = lower($1)', [nickname]);
  return rows[0] ?? null;
}

const minutesOf = (text: string | undefined): number | null => {
  const n = Number(text);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The sanction commands share everything: only the kind, and whether there is a duration, change. */
function sanctionCommand(name: string, kind: SanctionKind, aliases: string[] = []): Command {
  const timed = kind === 'mute' || kind === 'suspension';
  return {
    name,
    aliases,
    permission: `sanction.${kind}` as Permission,
    usage: timed ? `:${name} <pseudo> <minutes> <motif>` : `:${name} <pseudo> <motif>`,
    summary: { warning: 'Avertir un joueur', mute: 'Mettre un joueur en sourdine', suspension: 'Suspendre un compte', ban: 'Bannir un compte' }[kind],
    async run(ctx) {
      const target = await findUser(ctx.env.pool, ctx.args[0]);
      if (!target) return ctx.reply(`Joueur introuvable. Usage : ${timed ? `:${name} <pseudo> <minutes> <motif>` : `:${name} <pseudo> <motif>`}`);
      const minutes = timed ? minutesOf(ctx.args[1]) : null;
      if (timed && minutes === null) return ctx.reply('La durée est un nombre de minutes (ex. 60).');
      const reason = ctx.args.slice(timed ? 2 : 1).join(' ');
      const parsed = sanctionSchema.safeParse({ kind, ...(minutes === null ? {} : { minutes }), reason });
      if (!parsed.success) return ctx.reply(parsed.error.issues[0]?.message ?? 'Sanction invalide');
      const issued = await withTransaction(ctx.env.pool, (client) => issueSanction(client, ctx.staff, target.id, parsed.data));
      if ('error' in issued) return ctx.reply(issued.error);
      announceSanction((e) => tell(ctx.env, e), issued);
      ctx.reply(`${target.nickname} : ${issued.text.split('.')[0]}.`);
    },
  };
}

const HAL_LINK = /^\/(site|admin\.html)[A-Za-z0-9/_.#?=-]*$/;

const COMMANDS: Command[] = [
  {
    name: 'commandes',
    aliases: ['aide', 'commands', 'help'],
    permission: 'admin.access',
    usage: ':commandes',
    summary: 'Lister les commandes de ton rôle',
    async run(ctx) {
      const mine = COMMANDS.filter((c) => can(ctx.staff.role, c.permission));
      ctx.reply(`Commandes de ${ROLES[ctx.staff.role].title} : ${mine.map((c) => `:${c.name}`).join(' ')}`);
      ctx.reply('Écris la commande sans rien d’autre pour voir comment s’en servir.');
    },
  },
  {
    name: 'ha',
    aliases: ['alertejeu'],
    permission: 'alerts.hotel',
    usage: ':ha <message>',
    summary: 'Alerte tous les joueurs connectés',
    async run(ctx) {
      if (!ctx.rest) return ctx.reply('Usage : :ha <message>');
      ctx.env.publish(HOTEL_TOPIC, { kind: 'hotel', text: ctx.rest.slice(0, 200), from: ctx.staff.nickname } satisfies HotelAlert);
      ctx.reply('Alerte envoyée à tout le jeu.');
    },
  },
  {
    name: 'hal',
    permission: 'alerts.hotel',
    usage: ':hal </site/page> <message>',
    summary: 'Alerte tous les joueurs, avec un lien vers une page du site',
    async run(ctx) {
      const [link, ...words] = ctx.args;
      if (!link || !HAL_LINK.test(link) || !words.length) return ctx.reply('Usage : :hal /site/evenements <message>. Le lien est une page du site (/site…).');
      ctx.env.publish(HOTEL_TOPIC, { kind: 'hotel', text: words.join(' ').slice(0, 200), from: ctx.staff.nickname, link } satisfies HotelAlert);
      ctx.reply('Alerte avec lien envoyée à tout le jeu.');
    },
  },
  {
    name: 'ea',
    aliases: ['evenement'],
    permission: 'alerts.event',
    usage: ':ea <message>',
    summary: 'Annonce un événement à tous, avec un bouton pour rejoindre cette salle',
    async run(ctx) {
      if (!ctx.rest) return ctx.reply('Usage : :ea <message> (les joueurs pourront te rejoindre ici).');
      ctx.env.publish(HOTEL_TOPIC, { kind: 'event', text: ctx.rest.slice(0, 200), from: ctx.staff.nickname, target: ctx.room.location } satisfies HotelAlert);
      ctx.reply('Événement annoncé à tout le jeu.');
    },
  },
  {
    name: 'ra',
    aliases: ['alertesalle'],
    permission: 'alerts.room',
    usage: ':ra <message>',
    summary: 'Alerte les joueurs de la salle où tu es',
    async run(ctx) {
      if (!ctx.rest) return ctx.reply('Usage : :ra <message>');
      ctx.room.alertRoom(ctx.rest.slice(0, 200), ctx.staff.nickname);
    },
  },
  {
    name: 'alert',
    aliases: ['al'],
    permission: 'alerts.user',
    usage: ':alert <pseudo> <message>',
    summary: 'Envoie une alerte à un joueur connecté, où qu’il soit',
    async run(ctx) {
      const target = await findUser(ctx.env.pool, ctx.args[0]);
      const text = ctx.args.slice(1).join(' ');
      if (!target || !text) return ctx.reply('Usage : :alert <pseudo> <message>');
      tell(ctx.env, { userId: target.id, kind: 'alert', text: text.slice(0, 200), from: ctx.staff.nickname });
      ctx.reply(`Alerte envoyée à ${target.nickname} (s’il est connecté).`);
    },
  },
  {
    name: 'kick',
    permission: 'room.kick',
    usage: ':kick <pseudo> [motif]',
    summary: 'Fait sortir un joueur de la salle où tu es',
    async run(ctx) {
      const here = ctx.room.findPlayer(ctx.args[0] ?? '');
      if (!here) return ctx.reply('Ce joueur n’est pas dans cette salle.');
      const target = await findUser(ctx.env.pool, here.nickname);
      if (!target || !outranks(ctx.staff.role, target.role)) return ctx.reply('Tu ne peux pas faire sortir quelqu’un de ton niveau ou au-dessus.');
      ctx.room.kick(target.id, ctx.args.slice(1).join(' ') || 'Un membre de l’équipe t’a fait sortir.');
      ctx.reply(`${target.nickname} est sorti de la salle.`);
    },
  },
  {
    name: 'roommute',
    aliases: ['rm'],
    permission: 'room.mute',
    usage: ':roommute',
    summary: 'Réduit la salle au silence : seule l’équipe peut parler',
    async run(ctx) {
      ctx.room.setRoomMuted(true);
      ctx.reply('La salle est en sourdine. :roomunmute pour rendre la parole.');
    },
  },
  {
    name: 'roomunmute',
    aliases: ['ru'],
    permission: 'room.mute',
    usage: ':roomunmute',
    summary: 'Rend la parole à la salle',
    async run(ctx) {
      ctx.room.setRoomMuted(false);
      ctx.reply('La salle peut de nouveau parler.');
    },
  },
  sanctionCommand('warn', 'warning', ['avert']),
  sanctionCommand('mute', 'mute'),
  sanctionCommand('suspend', 'suspension'),
  sanctionCommand('ban', 'ban'),
  {
    name: 'unsanction',
    aliases: ['unmute', 'unban', 'levee'],
    permission: 'sanction.revoke',
    usage: ':unsanction <pseudo>',
    summary: 'Lève les sanctions en cours d’un joueur',
    async run(ctx) {
      const target = await findUser(ctx.env.pool, ctx.args[0]);
      if (!target) return ctx.reply('Usage : :unsanction <pseudo>');
      if (!outranks(ctx.staff.role, target.role)) return ctx.reply('Tu ne peux pas agir sur quelqu’un de ton niveau ou au-dessus.');
      // A ban is lifted only by a role that may give one.
      const kinds: SanctionKind[] = can(ctx.staff.role, 'sanction.ban') ? ['mute', 'suspension', 'ban'] : ['mute', 'suspension'];
      const { rowCount } = await ctx.env.pool.query(
        `UPDATE sanctions s SET revoked_at = now(), revoked_by = $2 WHERE s.user_id = $1 AND s.kind = ANY($3) AND ${liveSql('s')}`,
        [target.id, ctx.staff.id, kinds],
      );
      ctx.reply(rowCount ? `${rowCount} sanction(s) levée(s) pour ${target.nickname}.` : `Aucune sanction à lever pour ${target.nickname}.`);
    },
  },
  {
    name: 'info',
    aliases: ['ui', 'userinfo'],
    permission: 'players.view',
    usage: ':info <pseudo>',
    summary: 'Résumé d’un joueur : rôle, sanctions, signalements, où il est',
    async run(ctx) {
      const target = await findUser(ctx.env.pool, ctx.args[0]);
      if (!target) return ctx.reply('Usage : :info <pseudo>');
      const { pool } = ctx.env;
      const [about, sanctions, reports, where] = await Promise.all([
        pool.query<{ created_at: Date; items: string }>('SELECT u.created_at, (SELECT count(*) FROM items WHERE creator_id = u.id) AS items FROM users u WHERE u.id = $1', [target.id]),
        pool.query<{ kind: string }>(`SELECT DISTINCT s.kind FROM sanctions s WHERE s.user_id = $1 AND s.kind <> 'warning' AND ${liveSql('s')}`, [target.id]),
        pool.query<{ open: string; total: string }>(`SELECT count(*) FILTER (WHERE status = 'open') AS open, count(*) AS total FROM reports WHERE target_user_id = $1`, [target.id]),
        ctx.env.locate([target.id]),
      ]);
      const at = where.get(target.id);
      ctx.reply(`${target.nickname} — ${target.role === 'user' ? 'joueur' : ROLES[target.role as keyof typeof ROLES]?.title ?? target.role} · inscrit le ${about.rows[0]!.created_at.toLocaleDateString('fr-FR')} · ${about.rows[0]!.items} objet(s)`);
      ctx.reply(`Sanctions en cours : ${sanctions.rows.map((r) => r.kind).join(', ') || 'aucune'} · signalements : ${reports.rows[0]!.open} en attente sur ${reports.rows[0]!.total}`);
      ctx.reply(`Connecté : ${!at ? 'non' : at.kind === 'hall' ? 'dans le hall' : 'dans un appart'}`);
    },
  },
  {
    name: 'summon',
    aliases: ['come'],
    permission: 'players.summon',
    usage: ':summon <pseudo>',
    summary: 'Demande à un joueur de te rejoindre dans cette salle',
    async run(ctx) {
      const target = await findUser(ctx.env.pool, ctx.args[0]);
      if (!target) return ctx.reply('Usage : :summon <pseudo>');
      if (!outranks(ctx.staff.role, target.role)) return ctx.reply('Tu ne peux pas convoquer quelqu’un de ton niveau ou au-dessus.');
      tell(ctx.env, { userId: target.id, kind: 'summon', from: ctx.staff.nickname, target: ctx.room.location });
      ctx.reply(`${target.nickname} est invité à te rejoindre (s’il est connecté).`);
    },
  },
  {
    name: 'goto',
    aliases: ['follow'],
    permission: 'players.view',
    usage: ':goto <pseudo>',
    summary: 'Te rend là où est un joueur (dans une salle où tu peux entrer)',
    async run(ctx) {
      const target = await findUser(ctx.env.pool, ctx.args[0]);
      if (!target) return ctx.reply('Usage : :goto <pseudo>');
      const at = (await ctx.env.locate([target.id])).get(target.id);
      if (!at) return ctx.reply(`${target.nickname} n’est pas connecté.`);
      ctx.send('goto', { target: at, who: target.nickname });
    },
  },
  {
    name: 'massdance',
    aliases: ['dansetous'],
    permission: 'room.fun',
    usage: ':massdance',
    summary: 'Fait danser toute la salle',
    async run(ctx) {
      ctx.room.massDance(true);
    },
  },
  {
    name: 'stopdance',
    permission: 'room.fun',
    usage: ':stopdance',
    summary: 'Arrête la danse de la salle',
    async run(ctx) {
      ctx.room.massDance(false);
    },
  },
  {
    name: 'disco',
    permission: 'room.fun',
    usage: ':disco [on|off]',
    summary: 'Allume ou éteint les lumières de fête de la salle',
    async run(ctx) {
      ctx.room.setDisco(ctx.args[0]?.toLowerCase() !== 'off');
    },
  },
  {
    name: 'confetti',
    aliases: ['confettis'],
    permission: 'room.fun',
    usage: ':confetti',
    summary: 'Fait pleuvoir des confettis',
    async run(ctx) {
      ctx.room.confetti();
    },
  },
  {
    name: 'freeze',
    aliases: ['gel'],
    permission: 'room.fun',
    usage: ':freeze <pseudo> [secondes]',
    summary: 'Immobilise un joueur de la salle (60 secondes au plus)',
    async run(ctx) {
      const here = ctx.room.findPlayer(ctx.args[0] ?? '');
      if (!here) return ctx.reply('Ce joueur n’est pas dans cette salle.');
      const seconds = Math.min(60, minutesOf(ctx.args[1]) ?? 15);
      const target = await findUser(ctx.env.pool, here.nickname);
      if (!target || !outranks(ctx.staff.role, target.role)) return ctx.reply('Tu ne peux pas immobiliser quelqu’un de ton niveau ou au-dessus.');
      ctx.room.freeze(target.id, seconds);
      ctx.reply(`${target.nickname} est immobilisé ${seconds} s.`);
    },
  },
  {
    name: 'unfreeze',
    aliases: ['degel'],
    permission: 'room.fun',
    usage: ':unfreeze <pseudo>',
    summary: 'Libère un joueur immobilisé',
    async run(ctx) {
      const here = ctx.room.findPlayer(ctx.args[0] ?? '');
      if (!here) return ctx.reply('Ce joueur n’est pas dans cette salle.');
      ctx.room.freeze(here.id, 0);
      ctx.reply(`${here.nickname} est libre.`);
    },
  },
  {
    name: 'addword',
    aliases: ['mot+'],
    permission: 'words.manage',
    usage: ':addword <mot>',
    summary: 'Ajoute un mot au filtre du chat',
    async run(ctx) {
      const word = flatWord(ctx.args[0] ?? '');
      if (!/^[a-z0-9]{3,30}$/.test(word)) return ctx.reply('Un mot de 3 à 30 lettres ou chiffres. Usage : :addword <mot>');
      await ctx.env.pool.query('INSERT INTO banned_words (word, added_by) VALUES ($1, $2) ON CONFLICT DO NOTHING', [word, ctx.staff.id]);
      setExtraWord(word, true);
      ctx.reply(`« ${word} » est maintenant filtré (${extraWords().length} mot(s) ajouté(s)).`);
    },
  },
  {
    name: 'delword',
    aliases: ['mot-'],
    permission: 'words.manage',
    usage: ':delword <mot>',
    summary: 'Retire un mot ajouté au filtre du chat',
    async run(ctx) {
      const word = flatWord(ctx.args[0] ?? '');
      const { rowCount } = await ctx.env.pool.query('DELETE FROM banned_words WHERE word = $1', [word]);
      setExtraWord(word, false);
      ctx.reply(rowCount ? `« ${word} » n’est plus filtré.` : 'Ce mot n’avait pas été ajouté (ceux du code ne se retirent pas ici).');
    },
  },
  {
    name: 'gift',
    aliases: ['cadeau'],
    permission: 'gift.pixels',
    usage: ':gift <pseudo> <pixels>',
    summary: 'Offre des Pixels de la part de l’équipe (1000 au plus)',
    async run(ctx) {
      const target = await findUser(ctx.env.pool, ctx.args[0]);
      const amount = minutesOf(ctx.args[1]);
      if (!target || amount === null || amount > 1000) return ctx.reply('Usage : :gift <pseudo> <pixels> (de 1 à 1000)');
      await withTransaction(ctx.env.pool, (client) => grantPixels(client, target.id, amount, 'Cadeau de l’équipe'));
      tell(ctx.env, { userId: target.id, kind: 'quest', text: `Cadeau de l’équipe : +${amount} Pixels !` });
      ctx.reply(`${amount} Pixels offerts à ${target.nickname}.`);
    },
  },
  {
    name: 'maintenance',
    permission: 'maintenance.toggle',
    usage: ':maintenance on|off',
    summary: 'Met le jeu en maintenance, ou le rouvre',
    async run(ctx) {
      const word = ctx.args[0]?.toLowerCase();
      if (word !== 'on' && word !== 'off') return ctx.reply('Usage : :maintenance on|off');
      await ctx.env.setMaintenance(word === 'on', ctx.staff.id);
      ctx.reply(word === 'on' ? 'Le jeu est en maintenance.' : 'Le jeu est rouvert.');
    },
  },
];

const BY_NAME = new Map<string, Command>();
for (const c of COMMANDS) {
  BY_NAME.set(c.name, c);
  for (const a of c.aliases ?? []) BY_NAME.set(a, c);
}

export const staffCommandNames = (): string[] => COMMANDS.map((c) => c.name);

const SHAPE = /^:([a-z][a-z0-9+-]{1,19})(?:\s+(.*))?$/is;

/** Does this chat text look like a command (a smiley such as ":)" does not)? */
export function parseStaffCommand(text: string): { name: string; rest: string } | null {
  const m = SHAPE.exec(text.trim());
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), rest: (m[2] ?? '').replace(/\s+/g, ' ').trim() };
}

/**
 * Runs a command typed by a staff member. Returns false when the text is not a command this role may use: the room then
 * treats it as ordinary chat, so that nobody can learn which commands exist by trying.
 */
export async function runStaffCommand(parsed: { name: string; rest: string }, ctx: Omit<CommandContext, 'rest' | 'args'>): Promise<boolean> {
  const command = BY_NAME.get(parsed.name);
  if (!command || !can(ctx.staff.role, command.permission)) return false;
  const args = parsed.rest ? parsed.rest.split(' ') : [];
  const full: CommandContext = { ...ctx, rest: parsed.rest, args };
  try {
    await command.run(full);
  } catch {
    full.reply('La commande a échoué, réessaie.');
  }
  // The journal, whatever the answer: the staff leaves a trace of what it typed.
  await ctx.env.pool
    .query('INSERT INTO staff_log (staff_id, command, args, room) VALUES ($1, $2, $3, $4)', [
      ctx.staff.id,
      command.name,
      parsed.rest.slice(0, 400),
      ctx.room.location.kind === 'hall' ? 'hall' : `apartment:${ctx.room.location.ownerId}`,
    ])
    .catch(() => {});
  return true;
}

/** The usage lines of a command, for a staff member who typed it without anything. */
export const usageOf = (name: string): string | undefined => BY_NAME.get(name)?.usage;
