import { app } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ensureCbetaCorpusInBackground } from '../cbetaCorpus';
import { packPath, packsRoot } from '../authorityPacks';
import { loadProjectFile, writeProjectConfig } from '../projectFile';
import { toLocalFileUrl } from '../../../commons/src/desktop/localFileUrl';
import {
  PLUGIN_MANIFEST_FILENAME,
  type PluginHostSnapshot,
  type PluginHostState,
  type PluginManifest,
  type PluginRecord,
} from './pluginTypes';

const STATE_FILENAME = 'plugin-state.json';

let cachedState: PluginHostState | null = null;
let cachedSnapshot: PluginHostSnapshot | null = null;
let activeProjectFilePath: string | null = null;
let activeEnabledPluginIds: string[] = [];

/** Plugins are installed for the app, but their enabled state belongs to the open project. */
export function setPluginProject(
  projectFilePath: string | null,
  enabledPluginIds: string[] = [],
): void {
  activeProjectFilePath = projectFilePath;
  activeEnabledPluginIds = enabledPluginIds;
  cachedSnapshot = null;
}

function pluginsRoot(): string {
  return path.join(app.getPath('userData'), 'plugins');
}

function statePath(): string {
  return path.join(app.getPath('userData'), STATE_FILENAME);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function loadState(): Promise<PluginHostState> {
  const stored = await readJsonFile<PluginHostState>(statePath());
  cachedState = {
    enabled: stored?.enabled ?? [],
    dismissedLanguagePrompts: stored?.dismissedLanguagePrompts ?? [],
  };
  return cachedState;
}

async function saveState(state: PluginHostState): Promise<void> {
  cachedState = state;
  await fsp.writeFile(statePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** Sync check for main-process backends (sanmiao bridge, schema merge). */
export function isPluginEnabledInMain(pluginId: string): boolean {
  return activeEnabledPluginIds.includes(pluginId);
}

export function resolvePluginPythonBinary(pluginId: string): string | null {
  const root = path.join(pluginsRoot(), pluginId, 'python');
  const python =
    process.platform === 'win32'
      ? path.join(root, 'python.exe')
      : path.join(root, 'bin', 'python3');
  return fs.existsSync(python) ? python : null;
}

function coreBundledPythonCandidates(): string[] {
  const roots = [
    process.resourcesPath ? path.join(process.resourcesPath, 'python') : null,
    path.resolve(__dirname, '../../resources/python'),
  ].filter((root): root is string => Boolean(root));
  return roots
    .map((root) =>
      process.platform === 'win32'
        ? path.join(root, 'python.exe')
        : path.join(root, 'bin', 'python3'),
    )
    .filter((candidate) => fs.existsSync(candidate));
}

async function ensurePluginBundledAssets(plugin: PluginRecord): Promise<void> {
  const runtimePath = plugin.manifest.entry?.python?.runtimePath;
  if (!runtimePath) return;

  const destPython = path.join(plugin.installPath, runtimePath);
  const pythonBin =
    process.platform === 'win32'
      ? path.join(destPython, 'python.exe')
      : path.join(destPython, 'bin', 'python3');
  if (fs.existsSync(pythonBin)) return;

  const downloadScript = path.join(plugin.installPath, 'scripts/download-python-runtime.mjs');
  if (fs.existsSync(downloadScript)) {
    try {
      execFileSync('node', [downloadScript], { cwd: plugin.installPath, stdio: 'inherit' });
    } catch {
      // Fall through to legacy core symlink.
    }
    if (fs.existsSync(pythonBin)) return;
  }

  const [corePython] = coreBundledPythonCandidates();
  const coreRoot = corePython
    ? process.platform === 'win32'
      ? path.dirname(corePython)
      : path.dirname(path.dirname(corePython))
    : null;
  if (!coreRoot || !fs.existsSync(coreRoot)) return;

  try {
    await fsp.symlink(coreRoot, destPython, 'dir');
  } catch {
    await copyDir(coreRoot, destPython);
  }
}

function isValidManifest(raw: unknown): raw is PluginManifest {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as PluginManifest;
  return (
    m.manifestVersion === '1.0.0' &&
    typeof m.id === 'string' &&
    typeof m.name === 'string' &&
    typeof m.version === 'string' &&
    typeof m.description === 'string' &&
    typeof m.license === 'string' &&
    !!m.grognard?.minVersion &&
    !!m.entry?.kind
  );
}

/** Plugins installed before the Le Jean-Baptiste → Grognard rename key their manifest's
 *  app-compat block as `ljb` instead of `grognard`. Accept either. */
function normalizeLegacyAppKey(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const m = raw as PluginManifest & { ljb?: { minVersion: string; maxVersion?: string } };
  if (!m.grognard && m.ljb) m.grognard = m.ljb;
  return m;
}

async function readManifest(
  installDir: string,
  options?: { requireFolderMatch?: boolean },
): Promise<{ manifest?: PluginManifest; error?: string }> {
  const manifestPath = path.join(installDir, PLUGIN_MANIFEST_FILENAME);
  try {
    const raw = normalizeLegacyAppKey(JSON.parse(await fsp.readFile(manifestPath, 'utf8')));
    if (!isValidManifest(raw)) {
      return { error: 'Invalid or unsupported plugin.manifest.json' };
    }
    if (options?.requireFolderMatch !== false && raw.id !== path.basename(installDir)) {
      return { error: `Plugin folder name must match manifest id (${raw.id})` };
    }
    return { manifest: raw };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function listInstalledPluginDirs(): Promise<string[]> {
  const root = pluginsRoot();
  await fsp.mkdir(root, { recursive: true });
  const entries = await fsp.readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(root, e.name));
}

export async function getPluginHostSnapshot(): Promise<PluginHostSnapshot> {
  const storedState = await loadState();
  const project = activeProjectFilePath ? await loadProjectFile(activeProjectFilePath) : null;
  const state: PluginHostState = {
    ...storedState,
    enabled: project?.config.plugins ?? [],
  };
  activeEnabledPluginIds = state.enabled;
  const dirs = await listInstalledPluginDirs();
  /** @type {PluginRecord[]} */
  const plugins: PluginRecord[] = [];

  for (const installPath of dirs) {
    const { manifest, error } = await readManifest(installPath, { requireFolderMatch: true });
    if (!manifest) {
      plugins.push({
        id: path.basename(installPath),
        name: path.basename(installPath),
        version: '?',
        description: error ?? 'Missing manifest',
        license: '',
        languages: [],
        enabled: false,
        installPath,
        manifest: {
          manifestVersion: '1.0.0',
          id: path.basename(installPath),
          name: path.basename(installPath),
          version: '0.0.0',
          description: error ?? 'Invalid manifest',
          license: '',
          grognard: { minVersion: '0.0.0' },
          entry: { kind: 'javascript', module: '' },
        },
        manifestError: error,
      });
      continue;
    }

    plugins.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      license: manifest.license,
      author: manifest.author,
      homepage: manifest.homepage,
      languages: manifest.languages ?? [],
      enabled: state.enabled.includes(manifest.id),
      installPath,
      manifest,
    });
  }

  plugins.sort((a, b) => a.name.localeCompare(b.name));
  cachedSnapshot = { plugins, state };
  return cachedSnapshot;
}

export function getCachedPluginHostSnapshot(): PluginHostSnapshot | null {
  return cachedSnapshot;
}

export function getPluginEntryModulePath(plugin: PluginRecord): string | null {
  const rel = plugin.manifest.entry?.module?.trim();
  if (!rel) return null;
  const abs = path.join(plugin.installPath, rel);
  return fs.existsSync(abs) ? abs : null;
}

export function getPluginEntryModuleUrl(pluginId: string): string | null {
  const plugin = cachedSnapshot?.plugins.find((p) => p.id === pluginId && !p.manifestError);
  if (!plugin?.enabled) return null;
  const filePath = getPluginEntryModulePath(plugin);
  if (!filePath) return null;
  return toLocalFileUrl(filePath);
}

export async function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<PluginHostSnapshot> {
  if (!activeProjectFilePath) throw new Error('Open a project before changing plugin settings.');
  const snapshot = await getPluginHostSnapshot();
  const plugin = snapshot.plugins.find((p) => p.id === pluginId);
  if (!plugin || plugin.manifestError) {
    throw new Error(`Plugin not found or invalid: ${pluginId}`);
  }

  const enabledSet = new Set(snapshot.state.enabled);
  if (enabled) enabledSet.add(pluginId);
  else enabledSet.delete(pluginId);

  await writeProjectConfig(activeProjectFilePath, { plugins: [...enabledSet] });
  activeEnabledPluginIds = [...enabledSet];

  if (enabled) {
    await ensurePluginBundledAssets(plugin);
    await applyPluginContributions(plugin);
    if (pluginId === 'cbeta-import') ensureCbetaCorpusInBackground();
  }

  return getPluginHostSnapshot();
}

export async function dismissPluginLanguagePrompt(pluginId: string): Promise<void> {
  const state = await loadState();
  if (state.dismissedLanguagePrompts.includes(pluginId)) return;
  await saveState({
    ...state,
    dismissedLanguagePrompts: [...state.dismissedLanguagePrompts, pluginId],
  });
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else await fsp.copyFile(from, to);
  }
}

export async function installPluginFromDirectory(sourceDir: string): Promise<PluginHostSnapshot> {
  const manifestPath = path.join(sourceDir, PLUGIN_MANIFEST_FILENAME);
  const raw = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) as unknown;
  if (!isValidManifest(raw)) {
    throw new Error('Invalid plugin.manifest.json in selected folder');
  }

  const dest = path.join(pluginsRoot(), raw.id);
  await fsp.rm(dest, { recursive: true, force: true });
  await copyDir(sourceDir, dest);
  const { manifest, error } = await readManifest(dest, { requireFolderMatch: true });
  if (error || !manifest) throw new Error(error ?? 'Installed plugin failed validation');

  const installed: PluginRecord = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    license: manifest.license,
    author: manifest.author,
    homepage: manifest.homepage,
    languages: manifest.languages ?? [],
    enabled: false,
    installPath: dest,
    manifest,
  };
  await ensurePluginBundledAssets(installed);
  await applyPluginContributions(installed);
  if (manifest.id === 'cbeta-import') ensureCbetaCorpusInBackground();
  return getPluginHostSnapshot();
}

function devPluginPackageRoots(): string[] {
  if (app.isPackaged) return [];
  const candidates = [
    process.env.GROGNARD_PLUGINS_ROOT,
    path.resolve(process.cwd(), '../plugins/packages'),
    path.resolve(process.cwd(), '../../plugins/packages'),
    path.resolve(app.getAppPath(), '../../../plugins/packages'),
  ].filter((p): p is string => !!p);

  return [...new Set(candidates)].filter((p) => fs.existsSync(p));
}

/** Live plugin package in the sibling plugins repo (dev only). */
export function resolveDevPluginSourcePath(pluginId: string): string | null {
  if (app.isPackaged) return null;
  for (const packagesRoot of devPluginPackageRoots()) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(packagesRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'plugin-sdk') continue;
      const pkgDir = path.join(packagesRoot, entry.name);
      const manifestPath = path.join(pkgDir, PLUGIN_MANIFEST_FILENAME);
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { id?: string };
        if (raw.id === pluginId) return pkgDir;
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** In development, seed plugin packages from the sibling plugins repo when none installed. */
export async function seedDevPluginsIfEmpty(): Promise<void> {
  if (app.isPackaged) return;
  const dirs = await listInstalledPluginDirs();
  if (dirs.length > 0) return;

  for (const packagesRoot of devPluginPackageRoots()) {
    const entries = await fsp.readdir(packagesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'plugin-sdk') continue;
      const pkgDir = path.join(packagesRoot, entry.name);
      const manifestPath = path.join(pkgDir, PLUGIN_MANIFEST_FILENAME);
      if (!fs.existsSync(manifestPath)) continue;
      try {
        await installPluginFromDirectory(pkgDir);
      } catch {
        // Skip invalid dev packages silently.
      }
    }
    break;
  }

  // Installed plugins deliberately start disabled. Each project opts in through
  // the Plugins panel, so opening one project never changes another project's tools.
}

async function applyPluginContributions(plugin: PluginRecord): Promise<void> {
  const packs = plugin.manifest.contributions?.authorityPacks ?? [];
  if (!packs.length) return;

  const { getLocalAuthorityAssetsDir } = await import('../projectPrefs');
  const entityDbFolder = await getLocalAuthorityAssetsDir();
  const destRoot = packsRoot(entityDbFolder);

  for (const pack of packs) {
    if (pack.install.source === 'bundled' && pack.install.path) {
      const srcRoot = path.join(plugin.installPath, pack.install.path);
      if (!fs.existsSync(srcRoot)) continue;
      const stat = await fsp.stat(srcRoot);
      if (stat.isDirectory()) {
        const destDir = path.join(destRoot, pack.id.replace(/-persons$/, '') || pack.id);
        await fsp.mkdir(destDir, { recursive: true });
        await copyDir(srcRoot, destDir);
      } else {
        const destFile = packPath(entityDbFolder, pack.id);
        await fsp.mkdir(path.dirname(destFile), { recursive: true });
        await fsp.copyFile(srcRoot, destFile);
        const srcManifest = path.join(path.dirname(srcRoot), 'manifest.json');
        if (fs.existsSync(srcManifest)) {
          await fsp.copyFile(srcManifest, path.join(path.dirname(destFile), 'manifest.json'));
        }
      }
      continue;
    }

    if (pack.install.source === 'authoritypacks-release') {
      const localPack = resolveLocalAuthorityPack(pack.id, pack.install.manifestPath);
      if (!localPack) continue;
      const destDir = path.join(destRoot, path.dirname(localPack.relativePath));
      await fsp.mkdir(destDir, { recursive: true });
      await fsp.copyFile(
        localPack.personsFile,
        path.join(destDir, path.basename(localPack.relativePath)),
      );
      if (localPack.manifestFile) {
        await fsp.copyFile(localPack.manifestFile, path.join(destDir, 'manifest.json'));
      }
    }
  }
}

function resolveLocalAuthorityPack(
  packId: string,
  manifestPath?: string,
): { relativePath: string; personsFile: string; manifestFile?: string } | null {
  const candidates = [
    process.env.GROGNARD_AUTHORITYPACKS_ROOT,
    path.resolve(process.cwd(), '../authoritypacks'),
    path.resolve(process.cwd(), '../../authoritypacks'),
    path.resolve(app.getAppPath(), '../../../authoritypacks'),
  ].filter((p): p is string => !!p);

  for (const root of candidates) {
    const norbertFileName =
      packId === 'norbert-persons'
        ? 'persons.ndjson'
        : packId === 'norbert-person-wrappers'
          ? 'person-wrappers.ndjson'
          : packId === 'norbert-offices'
            ? 'offices.ndjson'
            : null;
    if (norbertFileName) {
      const fileName = norbertFileName;
      const dataFile = path.join(root, 'packs/norbert', fileName);
      const manifestFile = path.join(root, 'packs/norbert/manifest.json');
      if (fs.existsSync(dataFile)) {
        return {
          relativePath: `norbert/${fileName}`,
          personsFile: dataFile,
          manifestFile: fs.existsSync(manifestFile) ? manifestFile : undefined,
        };
      }
    }
    if (manifestPath) {
      const manifestFile = path.join(root, 'packs', manifestPath);
      const personsFile = path.join(path.dirname(manifestFile), 'persons.ndjson');
      if (fs.existsSync(personsFile)) {
        return {
          relativePath: path.join(path.dirname(manifestPath), 'persons.ndjson').replace(/\\/g, '/'),
          personsFile,
          manifestFile: fs.existsSync(manifestFile) ? manifestFile : undefined,
        };
      }
    }
  }
  return null;
}

export async function syncEnabledPluginContributions(): Promise<void> {
  const snapshot = await getPluginHostSnapshot();
  for (const plugin of snapshot.plugins) {
    if (plugin.enabled && !plugin.manifestError) {
      await ensurePluginBundledAssets(plugin);
      await applyPluginContributions(plugin);
      if (plugin.id === 'cbeta-import') ensureCbetaCorpusInBackground();
    }
  }
}
