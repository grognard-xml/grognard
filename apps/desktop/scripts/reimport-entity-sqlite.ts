/**
 * Rebuild entities.sqlite from a sibling entities.xml (replace semantics).
 *
 * Usage:
 *   node -r ts-node/register/transpile-only apps/desktop/scripts/reimport-entity-sqlite.ts \
 *     [/path/to/folder-or-entities.xml]
 *
 * Defaults to the live CEDB folder when no path is given.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EntitySqliteRepository } from '../src/entityDbSqlite/repository';
import { importEntitiesXml } from '../src/entityDbSqlite/xmlCodec';

const DEFAULT_CEDB_DIR = '/Users/daniel/ShareDocs/@Home/ljb_test_root';

const resolvePaths = (input?: string): { xmlPath: string; sqlitePath: string } => {
  const raw = input?.trim() || DEFAULT_CEDB_DIR;
  if (raw.toLowerCase().endsWith('entities.xml')) {
    return {
      xmlPath: path.resolve(raw),
      sqlitePath: path.resolve(raw.replace(/entities\.xml$/i, 'entities.sqlite')),
    };
  }
  if (raw.toLowerCase().endsWith('entities.sqlite')) {
    return {
      xmlPath: path.resolve(raw.replace(/entities\.sqlite$/i, 'entities.xml')),
      sqlitePath: path.resolve(raw),
    };
  }
  return {
    xmlPath: path.resolve(raw, 'entities.xml'),
    sqlitePath: path.resolve(raw, 'entities.sqlite'),
  };
};

const main = async () => {
  const { xmlPath, sqlitePath } = resolvePaths(process.argv[2]);
  if (!fs.existsSync(xmlPath)) {
    console.error(`Missing entities.xml: ${xmlPath}`);
    process.exit(1);
  }
  if (fs.existsSync(sqlitePath)) {
    console.error(`Refusing to overwrite existing ${sqlitePath}. Delete it (and -wal/-shm) first.`);
    process.exit(1);
  }

  const xml = fs.readFileSync(xmlPath, 'utf8');
  console.log(`Importing ${xmlPath}`);
  console.log(`     into ${sqlitePath}`);

  const repository = await EntitySqliteRepository.open(sqlitePath);
  try {
    const report = await importEntitiesXml(repository, xml, { replace: true });
    const activeCount = (await repository.listEntityIds()).length;
    const integrity = await repository.integrityCheck();
    console.log(
      JSON.stringify(
        {
          databaseId: report.databaseId,
          entitiesImported: report.entitiesImported,
          activeEntityIds: activeCount,
          namesImported: report.namesImported,
          authoritiesImported: report.authoritiesImported,
          duplicateEntityIds: report.duplicateEntityIds,
          unresolvedReferences: report.unresolvedReferences.slice(0, 20),
          warnings: report.warnings.slice(0, 20),
          integrity,
        },
        null,
        2,
      ),
    );
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      process.exitCode = 2;
    }
  } finally {
    await repository.close();
  }
};

main();
