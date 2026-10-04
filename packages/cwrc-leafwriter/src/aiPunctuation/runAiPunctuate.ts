import type { KanripoNormalizeMode } from '../../../../apps/commons/src/desktop/kanripoImportXml';
import type { LlmClient } from '../autoTagging/llmClient';
import { emptyAiPunctStats, mergeAiPunctStats, type AiPunctApplyStats } from './formatAiProvenance';
import { llmPunctuatePlainSegment } from './llmPunctuatePlain';
import { applyAiParallelPunct, listAiPunctSegments, type AiPunctSegment } from './pluginBridge';
import { segmentNeedsAiGap, selectTargetsForAi, type HanRange } from './selectionScope';

export interface RunAiPunctuateOptions {
  client: LlmClient;
  normalize?: KanripoNormalizeMode | 'none';
  segmentIds?: number[];
  /** When set, only punctuate this Han index range (editor selection). */
  hanRange?: HanRange;
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
  const targets = selectTargetsForAi(segments, {
    segmentIds: options.segmentIds,
    hanRange: options.hanRange,
    gapsOnly: options.gapsOnly,
  });
  const skipped = options.gapsOnly
    ? segments.filter((s) => !segmentNeedsAiGap(s)).length
    : segments.filter((s) => s.has_punct).length;

  let stats = emptyAiPunctStats(segments.length);
  stats = mergeAiPunctStats(stats, { skipped_punctuated: skipped });

  if (!targets.length) {
    return { body_xml: xml, stats, applied: false, targets_considered: 0, llm_segments: 0 };
  }

  const segmentParallels: { parallel_text: string; han_start: number; han_end: number }[] = [];
  let done = 0;
  const total = targets.length;

  for (const seg of targets) {
    options.signal?.throwIfAborted();
    const { plainText } = await llmPunctuatePlainSegment(
      {
        kind: seg.kind,
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
    done += 1;
    options.onProgress?.(done, total);
  }

  let applied = await applyAiParallelPunct(xml, segmentParallels, {
    reflow: !options.hanRange,
  });
  if (!applied.applied && options.hanRange) {
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
    align_failed: applied.stats.align_failed,
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
