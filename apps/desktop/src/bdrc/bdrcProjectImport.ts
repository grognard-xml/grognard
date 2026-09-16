import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  uniqueBdrcXmlPath,
  wrapBdrcTeiDocument,
  type BdrcHeaderFields,
} from '../../../commons/src/desktop/bdrcImportXml';
import type { ProjectFileConfig } from '../../../commons/src/desktop/projectTypes';
import { resolveProjectFileName } from '../projectTypes';
import { loadBdrcImport } from './bdrcRuntime';

export interface BdrcProjectImportOptions {
  projectRoot: string;
  forceRefresh?: boolean;
  split?: boolean;
  windowSize?: number;
}

export interface BdrcProjectImportResult {
  restricted: boolean;
  unsupported: boolean;
  warnings: string[];
  fromCache: boolean;
  split?: boolean;
  partCount: number;
  meta: { utId: string; instanceId?: string; workId?: string };
  written: string[];
  pbCount: number;
}

const joinPath = (...parts: string[]): string =>
  parts.filter(Boolean).join('/').replace(/\\/g, '/');

const parentDir = (filePath: string): string => {
  const n = filePath.replace(/\\/g, '/');
  const i = n.lastIndexOf('/');
  return i === -1 ? '' : n.slice(0, i);
};

const xmlLooksWellFormed = (xml: string): boolean => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return !doc.getElementsByTagName('parsererror').length;
};

const readProjectConfig = async (projectRoot: string): Promise<ProjectFileConfig> => {
  const raw = await fs.readFile(
    path.join(projectRoot, await resolveProjectFileName(projectRoot)),
    'utf8',
  );
  return JSON.parse(raw) as ProjectFileConfig;
};

const ipcMeta = (meta: { utId?: string; instanceId?: string; workId?: string }) => ({
  utId: String(meta?.utId ?? ''),
  instanceId: meta?.instanceId,
  workId: meta?.workId,
});

const collectUsedXmlPaths = async (destDir: string): Promise<Set<string>> => {
  const used = new Set<string>();
  try {
    const entries = await fs.readdir(destDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.xml')) continue;
      used.add(joinPath(destDir, entry.name));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return used;
};

/** Fetch BDRC text and write wrapped TEI into the project (no body XML over IPC). */
export const importBdrcToProject = async (
  input: string,
  opts: BdrcProjectImportOptions,
): Promise<BdrcProjectImportResult> => {
  const config = await readProjectConfig(opts.projectRoot);
  const mod = await loadBdrcImport();
  const result = (await mod.runBdrcImport(String(input || '').trim(), {
    forceRefresh: opts.forceRefresh,
    split: opts.split,
    windowSize: opts.windowSize,
  })) as {
    restricted: boolean;
    unsupported?: boolean;
    warnings: string[];
    fromCache: boolean;
    split?: boolean;
    partCount: number;
    meta: { utId: string; instanceId?: string; workId?: string };
    headerFields: BdrcHeaderFields;
    sections: {
      n: number | null;
      label: string;
      bodyXml: string;
      utId?: string;
      pbCount: number;
      structure: 'flat' | 'outline';
    }[];
  };

  const base = {
    restricted: result.restricted,
    unsupported: result.unsupported === true,
    warnings: result.warnings ?? [],
    fromCache: result.fromCache === true,
    split: result.split,
    partCount: result.partCount,
    meta: ipcMeta(result.meta),
    written: [] as string[],
    pbCount: 0,
  };

  if (result.restricted || result.unsupported || !result.sections?.length) {
    return base;
  }

  const instance = result.meta.instanceId || result.meta.workId || 'work';
  const destDir = joinPath(opts.projectRoot, 'imported', 'bdrc', instance);
  await fs.mkdir(destDir, { recursive: true });
  const used = await collectUsedXmlPaths(destDir);

  const written: string[] = [];
  let pbCount = 0;

  for (const section of result.sections) {
    const suffix = section.n != null ? ` — བམ་པོ་ ${section.n}` : undefined;
    const xml = wrapBdrcTeiDocument({
      config,
      headerFields: result.headerFields,
      bodyXml: section.bodyXml,
      titleSuffix: suffix,
    });
    if (!xmlLooksWellFormed(xml)) {
      throw new Error('Wrapped TEI is not well-formed XML.');
    }
    const stem =
      section.utId ??
      (section.n != null
        ? `${result.meta.utId}_${String(section.n).padStart(3, '0')}`
        : result.meta.utId);
    const outputPath = uniqueBdrcXmlPath(destDir, stem, used);
    const dir = parentDir(outputPath);
    if (dir) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(outputPath, xml, 'utf8');
    written.push(outputPath);
    pbCount += section.pbCount;
  }

  return { ...base, written, pbCount };
};
