/**
 * Drops every table in a Turso database, leaving it empty but otherwise
 * intact (same URL, same tokens still valid) — the next time anything opens
 * it, `applyEntityDbMigrations`'s `CREATE TABLE IF NOT EXISTS` migrations
 * recreate a clean schema at the current version.
 *
 * Drops in reverse foreign-key order (a table that REFERENCES another is
 * dropped before the table it references) — Turso's remote engine validates
 * the whole schema's FK references on every DDL statement, so dropping a
 * referenced table while a dangling REFERENCES to it still exists elsewhere
 * in the schema fails every subsequent DROP with a confusing
 * "no such table" error, not just the current statement's own table.
 * (Confirmed empirically: dropping alphabetically hit exactly this.)
 *
 * Run from apps/desktop with TURSO_URL and TURSO_AUTH_TOKEN set:
 *
 *   TURSO_URL="libsql://..." TURSO_AUTH_TOKEN="..." node scripts/wipe-turso-database.mjs
 *
 * Destructive and irreversible — double-check TURSO_URL before running.
 * Idempotent: safe to re-run if it's interrupted partway. Safe to delete
 * once you've used it.
 */
import { createClient } from '@libsql/client';

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error('Set TURSO_URL and TURSO_AUTH_TOKEN environment variables first.');
  process.exit(1);
}

console.log(`About to drop every table in: ${url}`);

const client = createClient({ url, authToken });

const referencedTables = (sql, knownTables) => {
  const found = new Set();
  const pattern = /REFERENCES\s+"?(\w+)"?\s*\(/gi;
  let match;
  while ((match = pattern.exec(sql))) {
    if (knownTables.has(match[1])) found.add(match[1]);
  }
  return [...found];
};

/** Parents (referenced tables) first — the insertion-safe order. */
const topologicalOrder = (tables) => {
  const knownTables = new Set(tables.map((t) => t.name));
  const dependsOn = new Map(
    tables.map((t) => [t.name, referencedTables(t.sql, knownTables).filter((n) => n !== t.name)]),
  );
  const ordered = [];
  const done = new Set();
  const inProgress = new Set();
  const visit = (name) => {
    if (done.has(name) || inProgress.has(name)) return;
    inProgress.add(name);
    for (const dep of dependsOn.get(name) ?? []) visit(dep);
    inProgress.delete(name);
    done.add(name);
    ordered.push(name);
  };
  for (const table of [...tables].sort((a, b) => a.name.localeCompare(b.name))) visit(table.name);
  return ordered;
};

try {
  const result = await client.execute(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  const tables = result.rows.map((row) => ({ name: row.name, sql: row.sql ?? '' }));

  if (tables.length === 0) {
    console.log('No tables found — already empty.');
  } else {
    // Reverse of the parents-first order: children (referencing tables) drop
    // before the parents they reference.
    const dropOrder = topologicalOrder(tables).reverse();
    console.log(`Dropping ${dropOrder.length} table(s) in dependency-safe order:`);
    for (const table of dropOrder) {
      await client.execute(`DROP TABLE IF EXISTS "${table}"`);
      console.log(`  dropped ${table}`);
    }
  }

  const remaining = await client.execute(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  console.log(`Done. Remaining tables: ${remaining.rows[0].n}`);
} finally {
  client.close();
}
