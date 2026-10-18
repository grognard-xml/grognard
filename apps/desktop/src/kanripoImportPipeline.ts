/**
 * Per-juan Kanripo convert → punctuate → wrap → write, for the main-process
 * import job runner. Mirrors the loop in the Kanripo import dialog.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import {
  convertKanripoGaiji,
  gaijiModeForCatalog,
} from '../../commons/src/desktop/documentImportGaiji';
import {
  formatParallelProvenance,
  uniqueKanripoXmlPath,
  wrapKanripoTeiDocument,
  type KanripoNormalizeMode,
  type KanripoTeiMeta,
} from '../../commons/src/desktop/kanripoImportXml';
import type {
  ImportJobAlignedParagraphMatch,
  ImportJuanCoverage,
  KanripoImportJobOptions,
} from '../../commons/src/desktop/importJobTypes';
import {
  createLlmClientFromSettings,
  effectiveAiConcurrency,
} from '../../../packages/cwrc-leafwriter/src/autoTagging/llmClientFromSettings';
import { formatAiProvenance } from '../../../packages/cwrc-leafwriter/src/aiPunctuation/formatAiProvenance';
import { AI_PUNCT_PROMPT_VERSION } from '../../../packages/cwrc-leafwriter/src/aiPunctuation/prompts';
import {
  fetchPunctCoverage,
  finalizeKanripoBody,
  setPluginPythonInvoker,
} from '../../../packages/cwrc-leafwriter/src/aiPunctuation/pluginBridge';
import { runAiPunctuate } from '../../../packages/cwrc-leafwriter/src/aiPunctuation/runAiPunctuate';
import { invokePluginPython } from './pluginPythonBridge';

const PLUGIN_ID = 'kanripo-import';

interface ConvertPayload {
  meta: KanripoTeiMeta;
  body_xml: string;
  metadata_xml?: string;
  entities?: Pick<KanripoTeiMeta, 'authorship'>;
}

interface ParallelPunctPayload {
  body_xml: string;
  coverage: ImportJuanCoverage;
  applied: boolean;
  matched_chapter_ids?: string[];
  quality?: {
    warnings: { code: string; severity: 'info' | 'warning'; message: string }[];
  };
}

export interface ProcessJuanResult {
  stem: string;
  outputPath: string;
  coverage?: ImportJuanCoverage;
  warnings?: { code: string; severity: 'info' | 'warning'; message: string }[];
  cost?: number;
  needsAttention?: boolean;
  attentionReason?: string;
  matchedChapterIds?: string[];
}

export class ImportJobBlockedError extends Error {
  constructor(
    message: string,
    readonly code: 'api_key' | 'quota' | 'disk' | 'spend_cap',
  ) {
    super(message);
    this.name = 'ImportJobBlockedError';
  }
}

const xmlLooksWellFormed = (xml: string): boolean => {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const errors = doc.getElementsByTagName('parsererror');
    return errors.length === 0;
  } catch {
    return false;
  }
};

const isDiskFullError = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message : String(error);
  return /ENOSPC|no space left|disk full/i.test(msg);
};

const isQuotaOrAuthError = (error: unknown): 'api_key' | 'quota' | null => {
  const msg = error instanceof Error ? error.message : String(error);
  if (/401|invalid.?api.?key|incorrect api key|unauthorized/i.test(msg)) return 'api_key';
  if (/402|403|429|quota|rate.?limit|billing|insufficient/i.test(msg)) return 'quota';
  return null;
};

/** Install the leafwriter pluginBridge invoker for this process (idempotent). */
export function ensurePluginBridgeWired(): void {
  setPluginPythonInvoker((pluginId, payload) => invokePluginPython(pluginId, payload));
}

const invokeParallel = async (
  bodyXml: string,
  options: KanripoImportJobOptions,
  chapterIdsUsed: string[],
  overrideSources?: KanripoImportJobOptions['sources'],
): Promise<ParallelPunctPayload> => {
  const sourceList = overrideSources ?? options.sources;
  return (await invokePluginPython(PLUGIN_ID, {
    op: 'parallel_punct',
    mode: options.alignMode,
    body_xml: bodyXml,
    used_chapter_ids: chapterIdsUsed,
    sources: sourceList.map((source) => ({
      id: source.id,
      label: source.label,
      text: source.text,
      kind: source.kind ?? '',
      chapters: source.chapters,
    })),
  })) as ParallelPunctPayload;
};

const invokeParagraphScoped = async (
  bodyXml: string,
  juanId: string,
  matches: ImportJobAlignedParagraphMatch[],
  sourcesPayload: { id: string; label: string; text: string }[],
): Promise<ParallelPunctPayload> =>
  (await invokePluginPython(PLUGIN_ID, {
    op: 'apply_paragraph_scoped',
    body_xml: bodyXml,
    juan_id: juanId,
    matches,
    sources: sourcesPayload,
  })) as ParallelPunctPayload;

const coverageNeedsAttention = (coverage: ImportJuanCoverage | undefined): string | undefined => {
  if (!coverage) return undefined;
  if (coverage.empty) return 'No punctuation applied';
  if (coverage.ratio < 0.85) {
    return `Low coverage (${Math.round(coverage.ratio * 100)}%)`;
  }
  return undefined;
};

export async function processKanripoJuan(params: {
  options: KanripoImportJobOptions;
  sourcePath: string;
  stem: string;
  usedPaths: Set<string>;
  usedChapterIds: string[];
  convertedCache?: Map<string, ConvertPayload>;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
  currentCost: number;
}): Promise<ProcessJuanResult> {
  ensurePluginBridgeWired();
  const {
    options,
    sourcePath,
    stem,
    usedPaths,
    usedChapterIds,
    convertedCache,
    signal,
    onStatus,
    currentCost,
  } = params;

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const normalize = options.normalize as KanripoNormalizeMode;
  onStatus?.(`Converting ${stem}…`);

  let converted = convertedCache?.get(sourcePath);
  if (!converted) {
    converted = (await invokePluginPython(PLUGIN_ID, {
      path: sourcePath,
      normalize,
      gaiji_dest_dir: path.join(options.destDir, '_gaiji'),
      gaiji_overrides: options.gaijiOverrides ?? {},
    })) as ConvertPayload;
    convertedCache?.set(sourcePath, converted);
  }
  if (!converted?.body_xml || !converted.meta) {
    throw new Error('Python conversion returned no TEI body.');
  }

  let bodyXml = converted.body_xml;
  let punctNote: string | undefined;
  let coverage: ImportJuanCoverage | undefined;
  let warnings: ProcessJuanResult['warnings'];
  let matchedChapterIds: string[] | undefined;
  let cost = 0;

  try {
    if (options.punctMode === 'parallel') {
      onStatus?.(`Punctuating ${stem}…`);
      const juanId = converted.meta.juan || converted.meta.stem || stem;
      const overrideSources = options.alignedJuanSources
        ? (options.alignedJuanSources[juanId] ?? [])
        : undefined;
      const punct =
        options.alignedMatches && options.alignedSourcesPayload
          ? await invokeParagraphScoped(
              bodyXml,
              juanId,
              options.alignedMatches,
              options.alignedSourcesPayload,
            )
          : await invokeParallel(bodyXml, options, usedChapterIds, overrideSources);
      matchedChapterIds = punct.matched_chapter_ids;
      if (punct.quality?.warnings?.length) warnings = punct.quality.warnings;
      if (punct.applied) {
        bodyXml = punct.body_xml;
        punctNote = formatParallelProvenance(overrideSources ?? options.sources, options.alignMode);
      }
      coverage = await fetchPunctCoverage(bodyXml);
    } else if (options.punctMode === 'ai' && options.aiSettings) {
      if (options.spendCap != null && currentCost >= options.spendCap) {
        throw new ImportJobBlockedError(
          `Spending cap of $${options.spendCap.toFixed(2)} reached.`,
          'spend_cap',
        );
      }
      onStatus?.(`AI punctuation ${stem}…`);
      const client = createLlmClientFromSettings({
        apiKey: options.aiSettings.apiKey,
        baseUrl: options.aiSettings.baseUrl,
        model: options.aiSettings.model,
        concurrency: options.aiSettings.concurrency ?? 0,
      });
      const concurrency =
        options.aiSettings.concurrency && options.aiSettings.concurrency > 0
          ? options.aiSettings.concurrency
          : effectiveAiConcurrency({
              apiKey: options.aiSettings.apiKey,
              baseUrl: options.aiSettings.baseUrl,
              model: options.aiSettings.model,
              concurrency: options.aiSettings.concurrency ?? 0,
            });
      try {
        const aiResult = await runAiPunctuate(bodyXml, {
          client,
          concurrency,
          signal,
        });
        if (aiResult.applied) {
          bodyXml = aiResult.body_xml;
          punctNote = formatAiProvenance({
            modelId: client.modelId,
            promptVersion: AI_PUNCT_PROMPT_VERSION,
            normalize,
            stats: aiResult.stats,
          });
          // Rough cost estimate: ~$0.15 / 1M tokens blended placeholder from stats if present.
          const tokens =
            (aiResult.stats as { input_tokens?: number; output_tokens?: number }).input_tokens ?? 0;
          const outTokens =
            (aiResult.stats as { input_tokens?: number; output_tokens?: number }).output_tokens ?? 0;
          cost = ((tokens + outTokens) / 1_000_000) * 0.5;
        }
      } catch (aiError) {
        const blocked = isQuotaOrAuthError(aiError);
        if (blocked) {
          throw new ImportJobBlockedError(
            aiError instanceof Error ? aiError.message : String(aiError),
            blocked,
          );
        }
        throw aiError;
      }
    }
  } catch (error) {
    if (error instanceof ImportJobBlockedError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (isDiskFullError(error)) {
      throw new ImportJobBlockedError(
        error instanceof Error ? error.message : String(error),
        'disk',
      );
    }
    throw error;
  }

  bodyXml = await finalizeKanripoBody(bodyXml);
  let xml = wrapKanripoTeiDocument({
    config: options.projectConfig as unknown as Parameters<
      typeof wrapKanripoTeiDocument
    >[0]['config'],
    meta: {
      ...converted.meta,
      normalize,
      stem: converted.meta.stem || stem,
      authorship: converted.entities?.authorship ?? converted.meta.authorship,
    },
    bodyXml,
    metadataXml: converted.metadata_xml,
    punctNote,
  });
  if (!xmlLooksWellFormed(xml)) {
    throw new Error('Wrapped TEI is not well-formed XML.');
  }

  const outputPath = uniqueKanripoXmlPath(options.destDir, converted.meta.stem || stem, usedPaths);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const catalogId = options.projectConfig.schema?.catalogId;
  const gaijiMode = gaijiModeForCatalog(catalogId);
  if (gaijiMode && converted.meta.gaiji_ids?.length) {
    onStatus?.(`Vectorising gaiji in ${stem}…`);
    try {
      const glyphs = await convertKanripoGaiji({
        api: {
          ensureDirectory: async (dir: string) => {
            await fs.mkdir(dir, { recursive: true });
          },
          writeBinaryFile: async (filePath: string, bytes: Uint8Array) => {
            await fs.writeFile(filePath, Buffer.from(bytes));
          },
        },
        readBytes: async (filePath: string) => new Uint8Array(await fs.readFile(filePath)),
        gaijiDir: path.join(options.destDir, '_gaiji'),
        mode: gaijiMode,
        outputPath,
        xml,
      });
      if (xmlLooksWellFormed(glyphs.xml)) xml = glyphs.xml;
    } catch (gaijiError) {
      if (isDiskFullError(gaijiError)) {
        throw new ImportJobBlockedError(
          gaijiError instanceof Error ? gaijiError.message : String(gaijiError),
          'disk',
        );
      }
      // Keep PNG form if vectorisation fails.
    }
  }

  try {
    await fs.writeFile(outputPath, xml, 'utf8');
  } catch (writeError) {
    if (isDiskFullError(writeError)) {
      throw new ImportJobBlockedError(
        writeError instanceof Error ? writeError.message : String(writeError),
        'disk',
      );
    }
    throw writeError;
  }

  if (options.spendCap != null && currentCost + cost > options.spendCap) {
    throw new ImportJobBlockedError(
      `Spending cap of $${options.spendCap.toFixed(2)} would be exceeded.`,
      'spend_cap',
    );
  }

  const attentionFromCoverage = coverageNeedsAttention(coverage);
  const attentionFromWarnings =
    warnings?.some((w) => w.severity === 'warning') && !attentionFromCoverage
      ? warnings.find((w) => w.severity === 'warning')?.message
      : undefined;

  return {
    stem: converted.meta.stem || stem,
    outputPath,
    coverage,
    warnings,
    cost,
    needsAttention: Boolean(attentionFromCoverage || attentionFromWarnings),
    attentionReason: attentionFromCoverage ?? attentionFromWarnings,
    matchedChapterIds,
  };
}

export function stemFromSourcePath(filePath: string): string {
  return (
    filePath
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.txt$/i, '') ?? 'juan'
  );
}
