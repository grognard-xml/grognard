/**
 * One-off connectivity check for a Turso database — not wired into the app.
 * Run from apps/desktop with TURSO_URL and TURSO_AUTH_TOKEN set:
 *
 *   TURSO_URL="libsql://..." TURSO_AUTH_TOKEN="..." node scripts/check-turso-connection.mjs
 *
 * Safe to delete once you've confirmed the database is reachable.
 */
import { createClient } from '@libsql/client';

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error('Set TURSO_URL and TURSO_AUTH_TOKEN environment variables first.');
  process.exit(1);
}

const client = createClient({ url, authToken });

try {
  await client.execute(
    'CREATE TABLE IF NOT EXISTS connectivity_check (id INTEGER PRIMARY KEY, note TEXT)',
  );
  await client.execute({
    sql: 'INSERT INTO connectivity_check (note) VALUES (?)',
    args: [`checked at ${new Date().toISOString()}`],
  });
  const result = await client.execute('SELECT COUNT(*) AS n FROM connectivity_check');
  console.log('Connected successfully.');
  console.log('Row count in connectivity_check:', result.rows[0].n);
} finally {
  client.close();
}
