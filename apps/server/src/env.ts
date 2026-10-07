import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Load the repo-root .env (scripts run with apps/server as cwd). Real
// environment variables win over the file.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
