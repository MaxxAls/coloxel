import './env';
import { Redis } from 'ioredis';
import { createPool } from './db/pool';
import { buildServer } from './index';
import { startRealtime } from './realtime';

const port = Number(process.env.PORT ?? 3000);
const pool = createPool();
const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl) : undefined;

async function main() {
  const realtime = await startRealtime({ pool });
  await buildServer({ pool, redis, occupancy: () => realtime.occupancy() }).listen({ port, host: '0.0.0.0' });
  console.log(`realtime (Colyseus) on port ${realtime.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
