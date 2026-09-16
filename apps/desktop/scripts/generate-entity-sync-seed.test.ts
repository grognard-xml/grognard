import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EntitySqliteRepository } from '../src/entityDbSqlite/repository';

/**
 * Regression coverage for the seq/sync_counter ordering bug: seeding is
 * explicitly meant to be spread across several `wrangler d1 import` runs
 * against D1's write cap (docs/entity-sync-planning.md), and a real device
 * can push a genuine edit into that same window. The Worker's push handler
 * only ever consults `sync_counter` to hand out the next `seq` — never what
 * rows are actually present — so if the counter were still at its pre-seed
 * value while only the first file had landed, that push would be handed a
 * `seq` this script had already committed to a row in a later,
 * not-yet-imported file. `seq` has no uniqueness constraint server-side, so
 * the collision wouldn't error; it would silently strand whichever of the two
 * rows a client's cursor doesn't land on (docs/entity-sync-protocol.md's
 * "seq monotonic and unique per owner" invariant, broken).
 *
 * The fix: the counter is reserved for the *whole* range in file 1, before
 * any row lands. This test runs the actual CLI (via its .mjs wrapper) against
 * a real temp entities.sqlite and inspects the generated SQL.
 */
describe('generate-entity-sync-seed', () => {
  jest.setTimeout(30_000);

  it('reserves the whole seq range in the first file, not the last', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-sync-seed-'));
    const dbPath = path.join(tmpDir, 'entities.sqlite');
    const outDir = path.join(tmpDir, 'seed');

    const repo = await EntitySqliteRepository.open(dbPath);
    for (const [id, name] of [
      ['person-a', '張衡'],
      ['person-b', '司馬遷'],
      ['person-c', '王羲之'],
      ['person-d', '陶淵明'],
      ['person-e', '李白'],
    ] as const) {
      await repo.createEntity({ id, kind: 'person' });
      await repo.addName({ entityId: id, text: name, isPrimary: true });
    }
    await repo.close();

    const wrapper = path.join(__dirname, 'generate-entity-sync-seed.mjs');
    const result = spawnSync(
      process.execPath,
      [wrapper, '--owner', '12345', '--db', dbPath, '--out', outDir, '--chunk', '2'],
      { encoding: 'utf-8' },
    );
    expect(result.status).toBe(0);

    const files = fs
      .readdirSync(outDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    // 5 entities at chunk size 2 → 3 files.
    expect(files).toEqual(['seed-001.sql', 'seed-002.sql', 'seed-003.sql']);

    const contents = Object.fromEntries(
      files.map((name) => [name, fs.readFileSync(path.join(outDir, name), 'utf-8')]),
    );

    const counterMatches = files.filter((name) => contents[name]!.includes('sync_counter'));
    expect(counterMatches).toEqual(['seed-001.sql']);

    const counterValueMatch = contents['seed-001.sql']!.match(
      /INSERT INTO sync_counter .*VALUES \('12345', (\d+)\)/,
    );
    expect(counterValueMatch).not.toBeNull();
    const reservedSeq = Number(counterValueMatch![1]);
    expect(reservedSeq).toBeGreaterThanOrEqual(5);

    // Every seeded row's own seq must fall within the reserved range, so a
    // real push landing anywhere during a partial (multi-day) import can
    // never be handed one already committed to an unimported file.
    const allSeqs = files.flatMap((name) =>
      [...contents[name]!.matchAll(/INSERT INTO central_entities .*?, (\d+), '[^']*'\);/g)].map(
        (m) => Number(m[1]),
      ),
    );
    expect(allSeqs).toHaveLength(5);
    for (const seq of allSeqs) expect(seq).toBeLessThanOrEqual(reservedSeq);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
