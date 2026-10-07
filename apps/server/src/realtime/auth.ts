import { ServerError, type AuthContext } from '@colyseus/core';
import type pg from 'pg';
import { SESSION_COOKIE, findSessionUser, type SessionUser } from '../auth/routes';
import { MAINTENANCE_MESSAGE, isMaintenance, isStaff } from '../site/settings';

function cookieValue(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Identify the player behind a realtime connection. The identity comes only
 * from the same session cookie as the HTTP API: nothing the client puts in the
 * join options is trusted. No valid session, no connection.
 */
export async function authenticateConnection(
  pool: pg.Pool,
  context: AuthContext,
  allowedOrigins: readonly string[],
): Promise<SessionUser> {
  // A browser always sends Origin on cross-site requests: refuse foreign pages
  // (cross-site WebSocket hijacking). Non-browser clients send none and still
  // need a valid session.
  const origin = context.headers.get('origin');
  if (origin && !allowedOrigins.includes(origin)) throw new ServerError(403, 'Origine non autorisée');

  const token = cookieValue(context.headers.get('cookie') ?? '', SESSION_COOKIE);
  const user = token ? await findSessionUser(pool, token) : null;
  if (!user) throw new ServerError(401, 'Non connecté');
  // During maintenance only the staff comes in.
  if ((await isMaintenance(pool)) && !(await isStaff(pool, user.id))) throw new ServerError(503, MAINTENANCE_MESSAGE);
  return user;
}
