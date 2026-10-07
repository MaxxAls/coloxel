import '../env';
import { createPool, withTransaction } from './pool';
import { creditColoxs } from '../wallet/coloxs';

// Until payment is open, testers get Coloxs by hand: `npm run colox:grant -- <pseudo> <amount>`.
// The grant goes through the ledger like everything else (kind "staff").
const [action, nickname, amountArg] = process.argv.slice(2);
const amount = Number(amountArg);

async function main() {
  if (action !== 'grant' || !nickname || !Number.isInteger(amount) || amount <= 0 || amount > 1_000_000) {
    console.error('Usage: npm run colox:grant -- <pseudo> <montant entier entre 1 et 1000000>');
    process.exit(1);
  }
  const pool = createPool();
  try {
    const balance = await withTransaction(pool, async (client) => {
      const { rows } = await client.query<{ id: string }>('SELECT id FROM users WHERE lower(nickname) = lower($1)', [nickname]);
      if (!rows[0]) return null;
      return creditColoxs(client, rows[0].id, amount, 'staff', 'Don en ligne de commande');
    });
    if (balance === null) {
      console.error(`Aucun joueur nommé « ${nickname} ».`);
      process.exit(1);
    }
    console.log(`${nickname} : +${amount} Coloxs, solde ${balance}.`);
  } finally {
    await pool.end();
  }
}

void main();
