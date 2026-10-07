import '../env';
import { createPool } from './pool';
import { ROLES, STAFF_ROLES, isRole, type RoleId } from '../staff/roles';

// The first staff accounts are given by hand: `npm run staff:grant -- <nickname> [role]` (administrateur by default),
// and `npm run staff:revoke -- <nickname>` to take it back. After that the administrators and managers hand out the
// roles from the administration. There is no way to become staff from the game itself.
const [action, nickname, roleArg] = process.argv.slice(2);
const role = roleArg ?? 'administrateur';

async function main() {
  if ((action !== 'grant' && action !== 'revoke') || !nickname || (action === 'grant' && (!isRole(role) || role === 'user'))) {
    console.error(`Usage: npm run staff:grant -- <pseudo> [${STAFF_ROLES.map((r) => r.id).join('|')}]   |   npm run staff:revoke -- <pseudo>`);
    process.exit(1);
  }
  const pool = createPool();
  try {
    const to = action === 'grant' ? role : 'user';
    const { rows } = await pool.query<{ id: string; role: string }>(
      `UPDATE users u SET role = $1 FROM (SELECT id, role FROM users WHERE lower(nickname) = lower($2)) old
        WHERE u.id = old.id RETURNING u.id, old.role`,
      [to, nickname],
    );
    const rowCount = rows.length;
    if (rows[0]) await pool.query('INSERT INTO role_log (user_id, from_role, to_role) VALUES ($1, $2, $3)', [rows[0].id, rows[0].role, to]);
    if (!rowCount) {
      console.error(`Aucun joueur nommé « ${nickname} ».`);
      process.exit(1);
    }
    console.log(`${nickname} : ${action === 'grant' ? ROLES[role as RoleId].title : 'joueur ordinaire'}.`);
  } finally {
    await pool.end();
  }
}

void main();
