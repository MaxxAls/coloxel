import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

export async function migrate(
  direction: 'up' | 'down' = 'up',
  databaseUrl = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel',
) {
  return runner({
    databaseUrl,
    dir: migrationsDir,
    direction,
    count: direction === 'up' ? Infinity : 1,
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  migrate(direction).then(
    (done) => console.log(`migrate ${direction}: ${done.length} migration(s)`),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
