/**
 * Generate SQL to seed the entity-sync D1 database directly, bypassing the
 * client's per-chunk push (which trips D1's free-tier 100k-writes/day cap on
 * a first full sync of a large authority file).
 *
 * Walks a local entities.sqlite, exports every non-deleted entity exactly as
 * the client would (`exportEntityElementXml` + `computeEntityContentHash`),
 * and writes numbered `.sql` files of `INSERT`s plus the `sync_counter` row.
 *
 * Usage:
 *   node -r apps/desktop/scripts/node-dom-stub.cjs \
 *     -r ts-node/register/transpile-only \
 *     apps/desktop/scripts/generate-entity-sync-seed.ts \
 *     --owner <github-numeric-id> [--db <path>] [--out <dir>] [--chunk 20000]
 *
 * (or via the .mjs wrapper: `node apps/desktop/scripts/generate-entity-sync-seed.mjs --owner …`)
 *
 * Then, from `workers/entity-sync/` (where wrangler.toml lives), per file and
 * spread over days if you hit the write cap:
 *   wrangler d1 import grognard-entity-sync --remote --file=<abs>/seed-001.sql
 *
 * (`d1 import` batches and retries; `d1 execute --file` can choke on the size.)
 *
 * Afterwards, in the app: **Sync now**. The pull reconciles all rows locally
 * (reads only) and finds nothing dirty to push — zero further D1 writes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openEntitySqliteRepository } from '../src/entityDbSqlite/repository';
import { computeEntityContentHash, exportEntityElementXml } from '../src/entityDbSqlite/xmlCodec';

interface Args {
  owner: string;
  db: string;
  out: string;
  chunk: number;
}

const parseArgs = (argv: string[]): Args => {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const owner = get('--owner');
  if (!owner || !/^\d+$/.test(owner)) {
    console.error('Required: --owner <github numeric id>');
    process.exit(1);
  }
  const defaultDb = path.join(
    os.homedir(),
    'Library/Application Support/Grognard/entity-database/entities.sqlite',
  );
  const chunkRaw = get('--chunk');
  return {
    owner,
    db: path.resolve(get('--db') ?? defaultDb),
    // Default next to wrangler.toml so the printed `--file=` paths are easy to
    // run from `workers/entity-sync/`.
    out: path.resolve(get('--out') ?? 'workers/entity-sync/seed'),
    // ~10k entities/file keeps each SQL file small enough for `d1 import`.
    chunk: chunkRaw ? Math.max(1, Number(chunkRaw)) : 10_000,
  };
};

const sqlStr = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.db)) {
    console.error(`No entities.sqlite at ${args.db}`);
    process.exit(1);
  }
  fs.mkdirSync(args.out, { recursive: true });

  const repo = await openEntitySqliteRepository(args.db);
  const now = new Date().toISOString();
  const rows = (await repo.backend.all(
    `SELECT id, kind FROM entities WHERE deleted_at IS NULL ORDER BY id`,
  )) as { id: string; kind: string }[];

  let seq = 0;
  let fileIndex = 0;
  let handle: number | null = null;
  let skipped = 0;

  const openFile = (): void => {
    fileIndex += 1;
    const filePath = path.join(args.out, `seed-${String(fileIndex).padStart(3, '0')}.sql`);
    handle = fs.openSync(filePath, 'w');
    fs.writeSync(handle, `-- grognard-entity-sync seed, file ${fileIndex}\n`);
    if (fileIndex === 1) {
      fs.writeSync(
        handle,
        `DELETE FROM central_entities WHERE owner_id = ${sqlStr(args.owner)};\n`,
      );
    }
  };
  const closeFile = (): void => {
    if (handle !== null) fs.closeSync(handle);
    handle = null;
  };

  openFile();
  for (const row of rows) {
    if (seq > 0 && seq % args.chunk === 0) {
      closeFile();
      openFile();
    }
    const xml = await exportEntityElementXml(repo, row.id);
    const hash = await computeEntityContentHash(repo, row.id);
    if (!xml || !hash) {
      skipped += 1;
      continue;
    }
    seq += 1;
    fs.writeSync(
      handle!,
      `INSERT INTO central_entities ` +
        `(central_id, owner_id, kind, revision, content_xml, content_hash, deleted, seq, updated_at) ` +
        `VALUES (${sqlStr(row.id)}, ${sqlStr(args.owner)}, ${sqlStr(row.kind)}, 1, ` +
        `${sqlStr(xml)}, ${sqlStr(hash)}, 0, ${seq}, ${sqlStr(now)});\n`,
    );
    if (seq % 5_000 === 0) console.log(`  … ${seq}`);
  }

  // The counter lands in the final file so it is applied last.
  fs.writeSync(
    handle!,
    `INSERT INTO sync_counter (owner_id, last_seq) VALUES (${sqlStr(args.owner)}, ${seq}) ` +
      `ON CONFLICT(owner_id) DO UPDATE SET last_seq = ${seq};\n`,
  );
  closeFile();
  await repo.close();

  console.log(
    `\n${seq} entities → ${fileIndex} file(s) in ${args.out}` +
      (skipped ? ` (${skipped} skipped: no export)` : ''),
  );
  console.log('\nFrom workers/entity-sync/, apply each file (one per day if the write cap trips):');
  console.log('  cd workers/entity-sync');
  for (let i = 1; i <= fileIndex; i += 1) {
    console.log(
      `  npx wrangler d1 import grognard-entity-sync --remote --file=${path.join(
        args.out,
        `seed-${String(i).padStart(3, '0')}.sql`,
      )}`,
    );
  }
  console.log('\nThen in the app: Sync now (reconciles locally, no further D1 writes).');
};

main();
