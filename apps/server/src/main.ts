import './env';
import { createPool } from './db/pool';
import { buildServer } from './index';
import { startRealtime } from './realtime';

const port = Number(process.env.PORT ?? 3000);
const pool = createPool();

Promise.all([buildServer({ pool }).listen({ port, host: '0.0.0.0' }), startRealtime({ pool })]).then(
  ([, realtime]) => console.log(`realtime (Colyseus) on port ${realtime.port}`),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
