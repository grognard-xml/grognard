import type { KanripoNormalizeMode } from '../../../../apps/commons/src/desktop/kanripoImportXml';
import type { LlmClient } from '../autoTagging/llmClient';
import { emptyAiPunctStats, mergeAiPunctStats, type AiPunctApplyStats } from './formatAiProvenance';
import { llmPunctuatePlainRun, llmPunctuatePlainSegment } from './llmPunctuatePlain';
import { buildPunctUnits, chunkRunFragments } from './punctRuns';
import { applyAiParallelPunct, listAiPunctSegments, type AiPunctSegment } from './pluginBridge';
import { segmentNeedsAiGap, selectTargetsForAi, type HanRange } from './selectionScope';

export interface RunAiPunctuateOptions {
  client: LlmClient;
  normalize?: KanripoNormalizeMode | 'none';
  segmentIds?: number[];
  /** When set, only punctuate this Han index range (editor selection). */
  hanRange?: HanRange;
  /** Several ranges (e.g. only the still-unpunctuated paragraphs of a selection). */
  hanRanges?: HanRange[];
  /** Hybrid import: only segments still unpunctuated or below punct-density threshold. */
  gapsOnly?: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface RunAiPunctuateResult {
  body_xml: string;
  stats: AiPunctApplyStats;
  applied: boolean;
  targets_considered: number;
  llm_segments: number;
}

export async function runAiPunctuate(
  bodyXml: string,
  options: RunAiPunctuateOptions,
): Promise<RunAiPunctuateResult> {
  const listed = await listAiPunctSegments(bodyXml);
  let xml = listed.body_xml;
  const segments = listed.segments;
  const targets = options.hanRanges
    ? options.hanRanges.flatMap((hanRange) => selectTargetsForAi(segments, { hanRange }))
    : selectTargetsForAi(segments, {
        segmentIds: options.segmentIds,
        hanRange: options.hanRange,
        gapsOnly: options.gapsOnly,
      });
  const scoped = Boolean(options.hanRange || options.hanRanges);
  const skipped = options.gapsOnly
    ? segments.filter((s) => !segmentNeedsAiGap(s)).length
    : segments.filter((s) => s.has_punct).length;

  let stats = emptyAiPunctStats(segments.length);
  stats = mergeAiPunctStats(stats, { skipped_punctuated: skipped });

  const units = buildPunctUnits(segments, targets);
  if (!units.length) {
    return { body_xml: xml, stats, applied: false, targets_considered: 0, llm_segments: 0 };
  }

  const segmentParallels: { parallel_text: string; han_start: number; han_end: number }[] = [];
  // Progress counts model calls: a base-text run is several chunks, a note is one.
  const total = units.reduce(
    (sum, unit) => sum + (unit.kind === 'text' ? chunkRunFragments(unit.fragments).length : 1),
    0,
  );
  let done = 0;
  const tick = () => {
    done += 1;
    options.onProgress?.(done, total);
  };
  let failedChunks = 0;

  for (const unit of units) {
    options.signal?.throwIfAborted();
    if (unit.kind === 'comm') {
      const seg = unit.segment;
      const { plainText } = await llmPunctuatePlainSegment(
        {
          kind: 'comm',
          han: seg.han,
          han_start: seg.han_start,
          preceding_comm: seg.preceding_comm,
          following_comm: seg.following_comm,
        },
        options.client,
        options.signal,
      );
      segmentParallels.push({
        parallel_text: plainText,
        han_start: seg.han_start,
        han_end: seg.han_end,
      });
      tick();
      continue;
    }
    const run = await llmPunctuatePlainRun(unit.fragments, options.client, options.signal, tick);
    failedChunks += run.failedChunks;
    unit.fragments.forEach((fragment, index) => {
      const text = run.texts[index];
      if (!text) return;
      segmentParallels.push({
        parallel_text: text,
        han_start: fragment.han_start,
        han_end: fragment.han_end,
      });
    });
  }

  if (!segmentParallels.length) {
    stats = mergeAiPunctStats(stats, { align_failed: failedChunks });
    return {
      body_xml: xml,
      stats,
      applied: false,
      targets_considered: targets.length,
      llm_segments: 0,
    };
  }

  let applied = await applyAiParallelPunct(xml, segmentParallels, {
    reflow: !scoped,
  });
  if (!applied.applied && scoped) {
    // Scoped Han range can disagree with model output (extra context, selection drift).
    // Retry with global infix overlap — same path as parallel import paste.
    applied = await applyAiParallelPunct(
      xml,
      segmentParallels.map(({ parallel_text }) => ({ parallel_text })),
      // Never reflow a selection-scoped run: it would merge paragraphs outside the selection.
      { reflow: false },
    );
  }
  xml = applied.body_xml;
  stats = mergeAiPunctStats(stats, {
    applied: applied.stats.marks_added,
    segments_applied: applied.stats.segments_applied,
    align_failed: applied.stats.align_failed + failedChunks,
    reflowed: applied.stats.reflowed,
  });

  return {
    body_xml: xml,
    stats,
    applied: applied.applied,
    targets_considered: targets.length,
    llm_segments: segmentParallels.length,
  };
}

export type { AiPunctSegment };
