import type { KanripoNormalizeMode } from '../../../../apps/commons/src/desktop/kanripoImportXml';
import type { LlmClient } from '../autoTagging/llmClient';
import { emptyAiPunctStats, mergeAiPunctStats, type AiPunctApplyStats } from './formatAiProvenance';
import {
  assembleRunTexts,
  llmPunctuatePlainSegment,
  planRunChunks,
  punctuateRunChunk,
} from './llmPunctuatePlain';
import { buildPunctUnits } from './punctRuns';
import { runPool } from './taskPool';
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
  /** Model requests in flight at once; 1 (the default) runs them one after another. */
  concurrency?: number;
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

  // Every model call of the juan becomes an independent task: one per note, one per chunk of a
  // base-text run. They run through one pool and are put back in document order afterwards.
  let done = 0;
  const calls: ((signal: AbortSignal) => Promise<void>)[] = [];
  const tick = () => {
    done += 1;
    options.onProgress?.(done, calls.length);
  };
  const commText = new Map<number, string>();
  const runPlans = new Map<number, ReturnType<typeof planRunChunks>>();
  const runAnswers = new Map<number, (string[] | null)[]>();

  units.forEach((unit, unitIndex) => {
    if (unit.kind === 'comm') {
      const seg = unit.segment;
      calls.push(async (signal) => {
        const { plainText } = await llmPunctuatePlainSegment(
          {
            kind: 'comm',
            han: seg.han,
            han_start: seg.han_start,
            preceding_comm: seg.preceding_comm,
            following_comm: seg.following_comm,
          },
          options.client,
          signal,
        );
        commText.set(unitIndex, plainText);
        tick();
      });
      return;
    }
    const plans = planRunChunks(unit.fragments);
    const answers: (string[] | null)[] = new Array(plans.length).fill(null);
    runPlans.set(unitIndex, plans);
    runAnswers.set(unitIndex, answers);
    plans.forEach((plan, chunkIndex) => {
      calls.push(async (signal) => {
        answers[chunkIndex] = await punctuateRunChunk(plan, options.client, signal);
        tick();
      });
    });
  });

  await runPool(calls, options.concurrency ?? 1, options.signal);

  let failedChunks = 0;
  units.forEach((unit, unitIndex) => {
    if (unit.kind === 'comm') {
      segmentParallels.push({
        parallel_text: commText.get(unitIndex) ?? '',
        han_start: unit.segment.han_start,
        han_end: unit.segment.han_end,
      });
      return;
    }
    const run = assembleRunTexts(runPlans.get(unitIndex)!, runAnswers.get(unitIndex)!);
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
  });

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
