import type { Types } from '@cwrc/leafwriter';
import { toLocalFileUrl } from './localFileUrl';
import { type ProjectBundle, type ProjectFileConfig } from './projectTypes';

export {
  DEFAULT_METADATA_PATH,
  PROJECT_FILE_NAME,
  LEGACY_PROJECT_FILE_NAME,
  type ProjectBundle,
  type ProjectFileConfig,
  type ProjectMetadataFile,
  type ProjectSchemaConfig,
} from './projectTypes';

export const joinProjectPath = (rootPath: string, relativePath: string) => {
  const separator = rootPath.includes('\\') ? '\\' : '/';
  return [rootPath, ...relativePath.split(/[/\\]/)].join(separator);
};

const toSchemaId = (schemaPath: string) => {
  const base =
    schemaPath
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.(rng|rnc|xsd)$/i, '') ?? 'project';
  return `project-${base.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
};

/** Build LEAF-Writer schema entries from a project file (paths relative to project root). */
export const buildProjectSchemas = (
  rootPath: string,
  config: ProjectFileConfig,
): Types.Schema[] => {
  if (!config.schema?.rng) return [];

  const rngPath = joinProjectPath(rootPath, config.schema.rng);
  const cssPath = config.schema.css ? joinProjectPath(rootPath, config.schema.css) : null;

  const schemaName =
    config.schema.catalogId === 'cbeta'
      ? 'CBETA P5'
      : (config.schema.rng
          .split(/[/\\]/)
          .pop()
          ?.replace(/\.(rng|rnc|xsd)$/i, '') ?? config.name);

  const mapping =
    config.schema.catalogId === 'teiLite' || schemaName.toLowerCase().includes('lite')
      ? 'teiLite'
      : config.schema.catalogId === 'orlando' || schemaName.toLowerCase().includes('orlando')
        ? 'orlando'
        : 'tei';

  const cssUrl = cssPath ? toLocalFileUrl(cssPath) : 'https://cwrc.ca/templates/css/tei.css';

  return [
    {
      id: toSchemaId(rngPath),
      name: schemaName.slice(0, 20),
      mapping,
      rng: [toLocalFileUrl(rngPath)],
      css: [cssUrl],
      editable: true,
    },
  ];
};

export const getMetadataRelativePath = (config: ProjectFileConfig): string =>
  config.metadata ?? 'schema/project-metadata.json';

export const getMetadataAbsolutePath = (bundle: ProjectBundle): string =>
  joinProjectPath(bundle.rootPath, getMetadataRelativePath(bundle.config));

export const getTranslationSettingsRelativePath = (config: ProjectFileConfig): string =>
  config.translationSettings ?? 'schema/translation-settings.json';

export const getTranslationSettingsAbsolutePath = (bundle: ProjectBundle): string =>
  joinProjectPath(bundle.rootPath, getTranslationSettingsRelativePath(bundle.config));

/** Recovery snapshot of alignment-unit ids/content hashes (derived data, never source of truth). */
export const getTranslationIndexAbsolutePath = (bundle: ProjectBundle): string =>
  joinProjectPath(bundle.rootPath, 'schema/translation-index.json');

/**
 * Reads a project file that may legitimately not exist yet, without triggering the
 * main-process "Error occurred in handler for 'readFile'" console noise that a bare
 * readFile of a missing path produces.
 */
export const readProjectFileIfExists = async (absolutePath: string): Promise<string | null> => {
  if (!window.electronAPI?.readFile) return null;
  if (window.electronAPI.pathExists && !(await window.electronAPI.pathExists(absolutePath))) {
    return null;
  }
  try {
    return await window.electronAPI.readFile(absolutePath);
  } catch {
    return null;
  }
};

/** Creates the project's schema/ directory if missing, quietly no-op'ing when it exists. */
export const ensureSchemaDirectory = async (bundle: ProjectBundle): Promise<void> => {
  if (!window.electronAPI?.createDirectory) return;
  const schemaDir = joinProjectPath(bundle.rootPath, 'schema');
  if (window.electronAPI.pathExists && (await window.electronAPI.pathExists(schemaDir))) return;
  try {
    await window.electronAPI.createDirectory(bundle.rootPath, 'schema');
  } catch {
    // Lost the race with another writer — the directory exists either way.
  }
};
