/**
 * Runs the real EntitySqliteRepository/migration code path against a live
 * Turso database — not just raw @libsql/client (see check-turso-connection.mjs)
 * and not just a local file: URL (see entityDbSqlite/openBackend.test.ts).
 * Confirms the full schema migrates and basic CRUD works against the actual
 * hosted database, where PRAGMA/transaction behavior can differ from a local file.
 *
 * Usage from apps/desktop, with TURSO_URL and TURSO_AUTH_TOKEN set:
 *
 *   node -r ts-node/register/transpile-only scripts/check-turso-repository.ts
 *
 * Safe to delete once you've confirmed this works.
 */
import { EntitySqliteRepository } from '../src/entityDbSqlite/repository';

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error('Set TURSO_URL and TURSO_AUTH_TOKEN environment variables first.');
  process.exit(1);
}

const main = async () => {
  console.log(`Opening (and migrating) ${url} ...`);
  const repository = await EntitySqliteRepository.open({ backend: 'turso', url, authToken });

  const id = `person-check-${Date.now()}`;
  await repository.createEntity({ id, kind: 'person' });
  await repository.addName({ entityId: id, text: 'Zhang Heng', isPrimary: true });

  const entity = await repository.getEntity(id);
  const names = await repository.listNames(id);
  const integrity = await repository.integrityCheck();

  console.log('createEntity + getEntity:', entity?.kind === 'person' ? 'ok' : 'FAILED');
  console.log('addName + listNames:', names.some((n) => n.text === 'Zhang Heng') ? 'ok' : 'FAILED');
  console.log('integrityCheck:', integrity);

  // Also exercise a transaction explicitly, since that's the piece most
  // likely to behave differently against a real remote connection.
  await repository.transaction(async () => {
    await repository.updateDescription(id, 'created by check-turso-repository.ts');
  });
  const afterTx = await repository.getEntity(id);
  console.log(
    'transaction() commit:',
    afterTx?.description === 'created by check-turso-repository.ts' ? 'ok' : 'FAILED',
  );

  await repository.softDeleteEntity(id);
  await repository.close();
  console.log('\nAll checks ran. Review any FAILED lines above.');
};

main().catch((error) => {
  console.error('Check failed:', error);
  process.exit(1);
});
