import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  loadOrCreateProject,
  loadProjectFile,
  LEGACY_PROJECT_FILE_NAME,
  PROJECT_FILE_NAME,
} from './projectFile';

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

describe('project file — pedb config', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'grognard-projectfile-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a brand-new project scaffolds a local entities.sqlite (default, unchanged)', async () => {
    await loadOrCreateProject(root);
    expect(await exists(path.join(root, 'entities.xml'))).toBe(true);
    expect(await exists(path.join(root, 'entities.sqlite'))).toBe(true);
  });

  it('round-trips a turso pedb config through load/save, and skips local entities.sqlite', async () => {
    const projectFilePath = path.join(root, PROJECT_FILE_NAME);
    const raw = {
      version: 1,
      name: 'shared-project',
      pedb: { backend: 'turso', url: 'libsql://example-shared.turso.io' },
    };
    await writeFile(projectFilePath, JSON.stringify(raw, null, 2));

    const bundle = await loadProjectFile(projectFilePath);
    expect(bundle?.config.pedb).toEqual({
      backend: 'turso',
      url: 'libsql://example-shared.turso.io',
    });

    // entities.xml is still minted as interchange scaffold...
    expect(await exists(path.join(root, 'entities.xml'))).toBe(true);
    // ...but no local entities.sqlite, since the live database is remote.
    expect(await exists(path.join(root, 'entities.sqlite'))).toBe(false);

    // Re-reading the saved config preserves pedb (the actual on-disk shape,
    // not just what this process held in memory).
    const savedRaw = JSON.parse(await readFile(projectFilePath, 'utf-8'));
    expect(savedRaw.pedb).toEqual({ backend: 'turso', url: 'libsql://example-shared.turso.io' });
  });

  it('ignores a malformed pedb value rather than throwing', async () => {
    const projectFilePath = path.join(root, PROJECT_FILE_NAME);
    const raw = { version: 1, name: 'bad-pedb', pedb: { backend: 'turso' } }; // missing url
    await writeFile(projectFilePath, JSON.stringify(raw, null, 2));

    const bundle = await loadProjectFile(projectFilePath);
    expect(bundle?.config.pedb).toBeUndefined();
    // Falls back to local scaffolding since pedb didn't validate.
    expect(await exists(path.join(root, 'entities.sqlite'))).toBe(true);
  });
});

describe('project file — filename rename (jean-baptiste.project.json -> grognard.project.json)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'grognard-projectfile-rename-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('gives a brand-new project the current filename', async () => {
    const bundle = await loadOrCreateProject(root);
    expect(path.basename(bundle.projectFilePath)).toBe(PROJECT_FILE_NAME);
    expect(await exists(path.join(root, PROJECT_FILE_NAME))).toBe(true);
    expect(await exists(path.join(root, LEGACY_PROJECT_FILE_NAME))).toBe(false);
  });

  it('keeps loading and saving an existing project under its legacy filename', async () => {
    const legacyPath = path.join(root, LEGACY_PROJECT_FILE_NAME);
    await writeFile(legacyPath, JSON.stringify({ version: 1, name: 'legacy-project' }, null, 2));

    const bundle = await loadOrCreateProject(root);

    expect(path.basename(bundle.projectFilePath)).toBe(LEGACY_PROJECT_FILE_NAME);
    // No forced rename: the old file is still there, and no new-named
    // duplicate was created alongside it.
    expect(await exists(legacyPath)).toBe(true);
    expect(await exists(path.join(root, PROJECT_FILE_NAME))).toBe(false);

    // A write against a dirty legacy project (projectId assignment) also
    // lands back on the legacy filename, not a new one.
    const raw = JSON.parse(await readFile(legacyPath, 'utf-8'));
    expect(raw.projectId).toBeTruthy();
  });
});
