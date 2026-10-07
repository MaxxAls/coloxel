import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ageOn, containsBannedWord, loginSchema, MIN_AGE, parseBirthDate, registerSchema } from './rules';

export const SESSION_COOKIE = 'coloxel_sid';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  nickname: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const sha256 = (token: string) => createHash('sha256').update(token).digest();

/** The user behind a session cookie value, or null (unknown or expired). Shared by HTTP and WebSocket auth. */
export async function findSessionUser(pool: pg.Pool, token: string): Promise<SessionUser | null> {
  const { rows } = await pool.query<SessionUser>(
    `SELECT u.id, u.nickname FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

// Verified against when the email is unknown, so login time does not reveal it.
const dummyHashPromise = hash('coloxel-dummy-password');

async function openSession(pool: pg.Pool, userId: string, reply: FastifyReply) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    sha256(token),
    userId,
    expires,
  ]);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
}

export function registerAuthRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    req.user = await findSessionUser(pool, token);
  });

  app.post('/api/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Données invalides' });
    }
    const { email, password, nickname, birthDate } = parsed.data;

    const birth = parseBirthDate(birthDate);
    if (!birth || birth.y < 1900 || ageOn(birth, new Date()) < 0) {
      return reply.code(400).send({ error: 'Date de naissance invalide' });
    }
    if (ageOn(birth, new Date()) < MIN_AGE) {
      return reply.code(403).send({
        error: "Coloxel est réservé aux adultes (18 ans et plus) pendant l'alpha. Reviens nous voir bientôt !",
      });
    }
    if (containsBannedWord(nickname)) {
      return reply.code(400).send({ error: 'Ce pseudo n’est pas autorisé' });
    }

    const passwordHash = await hash(password);
    try {
      const { rows } = await pool.query<SessionUser>(
        `INSERT INTO users (email, password_hash, nickname, birth_date)
         VALUES ($1, $2, $3, $4) RETURNING id, nickname`,
        [email, passwordHash, nickname, birthDate],
      );
      const user = rows[0]!;
      await openSession(pool, user.id, reply);
      return reply.code(201).send({ user });
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e.code === '23505') {
        const msg = e.constraint === 'users_nickname_key' ? 'Ce pseudo est déjà pris' : 'Cet email est déjà utilisé';
        return reply.code(409).send({ error: msg });
      }
      throw err;
    }
  });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    const invalid = () => reply.code(401).send({ error: 'Email ou mot de passe incorrect' });
    if (!parsed.success) return invalid();

    const { rows } = await pool.query<SessionUser & { password_hash: string }>(
      'SELECT id, nickname, password_hash FROM users WHERE lower(email) = lower($1)',
      [parsed.data.email],
    );
    const found = rows[0];
    const ok = await verify(found?.password_hash ?? (await dummyHashPromise), parsed.data.password).catch(() => false);
    if (!found || !ok) return invalid();

    await openSession(pool, found.id, reply);
    return { user: { id: found.id, nickname: found.nickname } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    return { user: req.user };
  });
}
