import '../env';
import { createPool } from './pool';

// Staff accounts are given by hand: `npm run staff:grant -- <nickname>` (and staff:revoke to take it back).
// There is no way to become staff from the game itself.
const [action, nickname] = process.argv.slice(2);

async function main() {
  if ((action !== 'grant' && action !== 'revoke') || !nickname) {
    console.error('Usage: npm run staff:grant -- <pseudo>   |   npm run staff:revoke -- <pseudo>');
    process.exit(1);
  }
  const pool = createPool();
  try {
    const { rowCount } = await pool.query('UPDATE users SET role = $1 WHERE lower(nickname) = lower($2)', [
      action === 'grant' ? 'staff' : 'user',
      nickname,
    ]);
    if (!rowCount) {
      console.error(`Aucun joueur nommé « ${nickname} ».`);
      process.exit(1);
    }
    console.log(`${nickname} : ${action === 'grant' ? 'membre de l’équipe' : 'joueur ordinaire'}.`);
  } finally {
    await pool.end();
  }
}

void main();
