import '../env';
import { createPool, withTransaction } from './pool';

// Until payment is open, the VIP Atelier is given by hand:
//   npm run vip:grant -- <pseudo> <days>     adds days (from now, or from the end of the current VIP)
//   npm run vip:revoke -- <pseudo>           ends it now
// Each change is written in vip_log.
const [action, nickname, daysArg] = process.argv.slice(2);
const days = Number(daysArg);

async function main() {
  const grant = action === 'grant';
  if ((!grant && action !== 'revoke') || !nickname || (grant && (!Number.isInteger(days) || days < 1 || days > 3650))) {
    console.error('Usage: npm run vip:grant -- <pseudo> <jours entre 1 et 3650>   |   npm run vip:revoke -- <pseudo>');
    process.exit(1);
  }
  const pool = createPool();
  try {
    const until = await withTransaction(pool, async (client) => {
      const { rows } = await client.query<{ id: string; vip_until: Date | null }>('SELECT id, vip_until FROM users WHERE lower(nickname) = lower($1) FOR UPDATE', [nickname]);
      const user = rows[0];
      if (!user) return null;
      if (grant) {
        const updated = await client.query<{ vip_until: Date }>(
          `UPDATE users SET vip_until = greatest(coalesce(vip_until, now()), now()) + make_interval(days => $2) WHERE id = $1 RETURNING vip_until`,
          [user.id, days],
        );
        await client.query("INSERT INTO vip_log (user_id, days, source, detail) VALUES ($1, $2, 'staff', 'Don en ligne de commande')", [user.id, days]);
        return updated.rows[0]!.vip_until;
      }
      if (user.vip_until && user.vip_until > new Date()) {
        const left = Math.max(1, Math.ceil((user.vip_until.getTime() - Date.now()) / 86_400_000));
        await client.query('UPDATE users SET vip_until = now() WHERE id = $1', [user.id]);
        await client.query("INSERT INTO vip_log (user_id, days, source, detail) VALUES ($1, $2, 'staff', 'Retrait en ligne de commande')", [user.id, -left]);
      }
      return new Date();
    });
    if (until === null) {
      console.error(`Aucun joueur nommé « ${nickname} ».`);
      process.exit(1);
    }
    console.log(grant ? `${nickname} : VIP jusqu’au ${until.toISOString()}.` : `${nickname} : VIP terminé.`);
  } finally {
    await pool.end();
  }
}

void main();
