/** Where a connected player is right now, kept in the presence store so that every process can answer. */
export const WHERE_KEY = 'coloxel:where';

export type Location = { kind: 'hall' } | { kind: 'apartment'; ownerId: string };

/** What a room writes for each player inside it. */
export interface WhereEntry {
  room: string;
  roomId: string;
}

export const roomLabel = (location: Location) => (location.kind === 'hall' ? 'hall' : `apartment:${location.ownerId.toLowerCase()}`);

export function locationOf(room: string): Location | null {
  if (room === 'hall') return { kind: 'hall' };
  const m = /^apartment:([0-9a-f-]{36})$/.exec(room);
  return m ? { kind: 'apartment', ownerId: m[1]! } : null;
}

/** Where each of these players is, among those connected. Supplied by the realtime server. */
export type Locate = (userIds: string[]) => Promise<Map<string, Location>>;
