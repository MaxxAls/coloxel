import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { CATALOGUE, FLOORS, STARTER_KIT, WALLS, catalogueEntry, isSwitchable, normalizeSize, renderRecipe, rotatedSize } from '@coloxel/render';
import type { NotifyApartment } from '../building/routes';
import { NO_GUARDS, type RateGuards } from '../rate-limit';
import { spriteToPng } from '../sprite-png';
import { loadAppearance } from '../avatar/routes';
import { FILTER_MESSAGES, filterText } from '../moderation/text-filter';

const lightSchema = z.object({ on: z.boolean() }).strict();
const textSchema = z.object({ text: z.string().max(400) }).strict();

/** Longest text on a sign. */
export const SIGN_MAX = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A generous ceiling per player: "unlimited" in practice, but not a way to fill the database. */
export const MAX_FURNITURE_PER_PLAYER = 500;

/** Furnish a new apartment: the starter kit, already placed. Run inside the sign-up transaction. */
export async function giveStarterKit(client: pg.PoolClient, userId: string): Promise<void> {
  for (const piece of STARTER_KIT) {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO furniture (owner_id, catalogue_key) VALUES ($1, $2) RETURNING id',
      [userId, piece.key],
    );
    // A wall piece hangs on the left (layer 1) or right (layer 2) wall; a big piece covers its turned footprint.
    const entry = catalogueEntry(piece.key);
    const rot = piece.rot ?? 0;
    const onWall = !!entry?.wall;
    const [w, h] = onWall ? [1, 1] : rotatedSize(normalizeSize(entry?.recipe.size), rot);
    await client.query('INSERT INTO placements (furniture_id, user_id, i, j, rot, w, h, layer) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
      rows[0]!.id,
      userId,
      piece.i,
      piece.j,
      rot,
      w,
      h,
      onWall ? 1 + rot : 0,
    ]);
  }
}

const takeSchema = z.object({ key: z.string('Meuble invalide') }).strict();

export function registerFurnitureRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  guards: RateGuards = NO_GUARDS,
  notify?: NotifyApartment,
) {
  // Sprites of base furniture never change for a given key: render once, keep.
  const pngCache = new Map<string, Buffer>();

  app.get('/api/catalogue', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    return {
      furniture: CATALOGUE.map((e) => ({ key: e.key, name: e.name, category: e.category, price: e.price })),
      floors: FLOORS.map((f) => ({ id: f.id, name: f.name, a: f.a, b: f.b })),
      walls: WALLS.map((w) => ({ id: w.id, name: w.name, left: w.left, right: w.right })),
    };
  });

  // Same engine as every other sprite, drawn on demand from the catalogue.
  app.get<{ Params: { key: string }; Querystring: { r?: string; s?: string; f?: string } }>('/api/catalogue/:key.png', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const entry = catalogueEntry(req.params.key);
    if (!entry) return reply.code(404).send({ error: 'Meuble introuvable' });
    const turns = Number(req.query.r) | 0;
    // ?s=1 is the second look of a piece that has two, such as a gate that stands open.
    // ?f=k is frame k of a piece that is animated (1 is the first after the recipe itself).
    const frameNo = Number(req.query.f) | 0;
    const frame = frameNo >= 1 && entry.frames ? entry.frames[frameNo - 1] : undefined;
    const alt = frame ?? (req.query.s === '1' && entry.gate ? entry.gate.open : null);
    const cacheKey = `${entry.key}:${((turns % 4) + 4) % 4}${alt ? (frame ? `:f${frameNo}` : ':open') : ''}`;
    let png = pngCache.get(cacheKey);
    if (!png) {
      png = spriteToPng(renderRecipe(alt ?? entry.recipe, turns));
      pngCache.set(cacheKey, png);
    }
    return reply.header('cache-control', 'private, max-age=86400').type('image/png').send(png);
  });

  // Take a piece: free, and as many copies as wanted. Nothing here touches
  // `items` or the numbering sequence.
  app.post('/api/furniture', { preHandler: guards.furniture }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = takeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Meuble invalide' });
    const entry = catalogueEntry(parsed.data.key);
    if (!entry) return reply.code(404).send({ error: 'Meuble introuvable' });
    if (entry.price > 0) return reply.code(402).send({ error: 'Cet article s’achète en boutique, avec des Pixels.' });

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO furniture (owner_id, catalogue_key)
       SELECT $1, $2 WHERE (SELECT count(*) FROM furniture WHERE owner_id = $1) < $3
       RETURNING id`,
      [user.id, entry.key, MAX_FURNITURE_PER_PLAYER],
    );
    if (!rows[0]) {
      return reply.code(409).send({ error: `Tu as déjà ${MAX_FURNITURE_PER_PLAYER} meubles : range-en avant d’en prendre d’autres.` });
    }
    return reply.code(201).send({ furniture: { id: rows[0].id, key: entry.key, name: entry.name, placement: null } });
  });

  // Switch a lamp (or anything that gives light) on or off. Only the owner, only in their own apartment:
  // the player is the session's, the piece must be theirs and placed.
  app.put<{ Params: { id: string } }>('/api/furniture/:id/light', { preHandler: guards.furniture }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Meuble introuvable' });
    const parsed = lightSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Requête invalide' });
    const piece = await pool.query<{ catalogue_key: string }>(
      `SELECT f.catalogue_key FROM furniture f JOIN placements p ON p.furniture_id = f.id
        WHERE f.id = $1 AND f.owner_id = $2 AND p.user_id = $2`,
      [req.params.id, user.id],
    );
    if (!piece.rows[0]) return reply.code(404).send({ error: 'Meuble introuvable ou pas posé' });
    if (!isSwitchable(catalogueEntry(piece.rows[0].catalogue_key))) return reply.code(400).send({ error: 'Cet objet ne s’allume pas.' });
    await pool.query('UPDATE placements SET lit = $2 WHERE furniture_id = $1', [req.params.id, parsed.data.on]);
    notify?.(user.id, 'decor');
    return { on: parsed.data.on };
  });

  /** A placed piece of the player's own apartment, with its catalogue key; null when it is not theirs or not placed. */
  const ownPlaced = async (id: string, userId: string) => {
    const { rows } = await pool.query<{ catalogue_key: string }>(
      `SELECT f.catalogue_key FROM furniture f JOIN placements p ON p.furniture_id = f.id
        WHERE f.id = $1 AND f.owner_id = $2 AND p.user_id = $2`,
      [id, userId],
    );
    return rows[0] ? catalogueEntry(rows[0].catalogue_key) : undefined;
  };

  // A mannequin puts on what the owner wears right now.
  app.post<{ Params: { id: string } }>('/api/furniture/:id/dress', async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Meuble introuvable' });
    const entry = await ownPlaced(req.params.id, user.id);
    if (!entry) return reply.code(404).send({ error: 'Meuble introuvable ou pas posé' });
    if (!entry.mannequin) return reply.code(400).send({ error: 'Cet objet ne se habille pas.' });
    const { look } = await loadAppearance(pool, user.id);
    await pool.query('UPDATE placements SET data = $2 WHERE furniture_id = $1', [req.params.id, JSON.stringify(look)]);
    notify?.(user.id, 'decor');
    return { ok: true };
  });

  // The text of a sign: filtered like any free text, and short. Empty clears it.
  app.put<{ Params: { id: string } }>('/api/furniture/:id/text', async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Meuble introuvable' });
    const parsed = textSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Requête invalide' });
    const entry = await ownPlaced(req.params.id, user.id);
    if (!entry) return reply.code(404).send({ error: 'Meuble introuvable ou pas posé' });
    if (!entry.sign) return reply.code(400).send({ error: 'On ne peut pas écrire sur cet objet.' });
    const text = parsed.data.text.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length > SIGN_MAX) return reply.code(400).send({ error: `Le panneau accepte ${SIGN_MAX} lettres au plus.` });
    if (text) {
      const verdict = filterText(text);
      if (!verdict.ok) return reply.code(422).send({ error: FILTER_MESSAGES[verdict.reason] });
    }
    await pool.query('UPDATE placements SET data = $2 WHERE furniture_id = $1', [req.params.id, text || null]);
    notify?.(user.id, 'decor');
    return { text };
  });

  // Throw a copy away. It costs nothing to take another one.
  app.delete<{ Params: { id: string } }>('/api/furniture/:id', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Meuble introuvable' });
    const { rowCount } = await pool.query('DELETE FROM furniture WHERE id = $1 AND owner_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Meuble introuvable' });
    notify?.(req.user.id, 'decor');
    return reply.code(204).send();
  });
}
