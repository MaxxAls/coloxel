import './env';
import { createPool } from './db/pool';
import { buildServer } from './index';

const port = Number(process.env.PORT ?? 3000);
buildServer({ pool: createPool() })
  .listen({ port, host: '0.0.0.0' })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
