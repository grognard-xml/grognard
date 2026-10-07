import { MIN_SEGMENT_HAN, PLAIN_CHUNK_HAN } from './punctSchema';
import { cpLength } from './selectionScope';

/**
 * Interlinear notes cut a work's base text into short fragments ("多桂", "多金玉有草焉其狀如韭",
 * "而青花其名曰祝餘" ...) that are really one continuous sentence stream. Punctuating each fragment
 * alone starves the model of context, so base-text fragments are punctuated as a *run* and the
 * result is split back onto the fragments afterwards. Commentary notes are self-contained, so each
 * stays its own unit.
 */

export interface RunSegmentLike {
  id: number;
  kind: 'text' | 'comm' | 'head';
  han: string;
  han_start: number;
  han_end: number;
  preceding_comm?: string;
  following_comm?: string;
}

export interface PunctFragment {
  han: string;
  han_start: number;
  han_end: number;
  /** Han of the notes sitting between this fragment and the next one of the run. */
  notes_after?: string;
}

export type PunctUnit<T extends RunSegmentLike = RunSegmentLike> =
  { kind: 'comm'; segment: T } | { kind: 'text'; fragments: PunctFragment[] };

/**
 * Partition AI targets into units: each comm target alone, and base-text targets grouped into runs
 * of fragments that follow one another in the document with nothing but notes in between. A text
 * segment that is not a target (already punctuated, or outside the selection) ends the run, and
 * so does a heading (`kind: 'head'`: title block, section heading, colophon), which is never
 * punctuated and never joined to the text around it.
 * Runs shorter than `minRunHan` are dropped; so are comm targets, which callers have already
 * length-filtered.
 */
export function buildPunctUnits<T extends RunSegmentLike>(
  segments: T[],
  targets: T[],
  minRunHan = MIN_SEGMENT_HAN,
): PunctUnit<T>[] {
  const indexById = new Map(segments.map((seg, index) => [seg.id, index]));

  /** Segments strictly between two ids, or null when either is unknown. */
  const between = (fromId: number, toId: number): T[] | null => {
    const from = indexById.get(fromId);
    const to = indexById.get(toId);
    if (from === undefined || to === undefined) return null;
    return segments.slice(from + 1, to);
  };
  const notesBetween = (fromId: number, toId: number): string =>
    (between(fromId, toId) ?? [])
      .filter((seg) => seg.kind === 'comm')
      .map((seg) => seg.han)
      .join('');
  /** Only notes may sit inside a run: a heading or an untargeted text segment ends it. */
  const onlyNotesBetween = (fromId: number, toId: number): boolean =>
    (between(fromId, toId) ?? [null]).every((seg) => seg?.kind === 'comm');

  const ordered = [...targets].sort((a, b) => a.han_start - b.han_start);
  const units: PunctUnit<T>[] = [];
  let run: PunctFragment[] = [];
  let runLastId = -1;

  const flush = () => {
    if (run.length && run.reduce((sum, f) => sum + cpLength(f.han), 0) >= minRunHan) {
      units.push({ kind: 'text', fragments: run });
    }
    run = [];
    runLastId = -1;
  };

  for (const seg of ordered) {
    if (seg.kind === 'head') {
      flush();
      continue;
    }
    if (seg.kind === 'comm') {
      units.push({ kind: 'comm', segment: seg });
      continue;
    }
    const last = run[run.length - 1];
    const continues =
      last !== undefined &&
      seg.id > runLastId &&
      seg.han_start >= last.han_end &&
      onlyNotesBetween(runLastId, seg.id);
    if (!continues) flush();
    else last.notes_after = notesBetween(runLastId, seg.id);
    run.push({ han: seg.han, han_start: seg.han_start, han_end: seg.han_end });
    runLastId = seg.id;
  }
  flush();

  const firstStart = (unit: PunctUnit<T>) =>
    unit.kind === 'comm' ? unit.segment.han_start : unit.fragments[0]!.han_start;
  return units.sort((a, b) => firstStart(a) - firstStart(b));
}

/**
 * Group a run's fragments into model calls of about `maxHan` characters, cutting only at fragment
 * boundaries so no fragment is ever split between two calls. A single fragment longer than `maxHan`
 * gets a chunk to itself and is cut by the caller's hard splitter.
 */
export function chunkRunFragments(
  fragments: PunctFragment[],
  maxHan = PLAIN_CHUNK_HAN,
): PunctFragment[][] {
  const chunks: PunctFragment[][] = [];
  let current: PunctFragment[] = [];
  let currentHan = 0;
  for (const fragment of fragments) {
    const length = cpLength(fragment.han);
    if (current.length && currentHan + length > maxHan) {
      chunks.push(current);
      current = [];
      currentHan = 0;
    }
    current.push(fragment);
    currentHan += length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Punctuation, separators and whitespace; every other character counts as content. */
const GAP_CHAR = /^[\p{P}\p{Z}\s]$/u;
/** Opening marks hug the character that follows them, so they stay with the next fragment. */
const OPENING_MARKS = new Set(['「', '『', '《', '〈', '（', '(', '“', '‘']);

/**
 * Split a punctuated passage back onto fragments of the given content lengths (code points).
 *
 * Content characters are counted, not matched, so a variant substitution by the model does not
 * shift later fragments; Python's fuzzy scoped aligner absorbs the variants afterwards. Marks
 * between two fragments belong to the earlier one, except opening brackets, which go with the next.
 * Returns null when the passage has a different number of content characters than expected, so
 * the caller can retry instead of mis-assigning every later fragment.
 */
export function splitPunctuatedRun(punctuated: string, lengths: number[]): string[] | null {
  const parts: string[] = lengths.map(() => '');
  let index = 0;
  let count = 0;
  let gap = '';

  const flushGap = (toNext: boolean) => {
    if (!gap) return;
    if (!toNext) {
      parts[index] += gap;
    } else {
      const chars = Array.from(gap);
      let cut = chars.length;
      while (cut > 0 && OPENING_MARKS.has(chars[cut - 1]!)) cut -= 1;
      parts[index] += chars.slice(0, cut).join('');
      parts[index + 1] += chars.slice(cut).join('');
    }
    gap = '';
  };

  for (const char of punctuated) {
    if (GAP_CHAR.test(char)) {
      gap += char;
      continue;
    }
    while (index < lengths.length && count === lengths[index]) {
      flushGap(index + 1 < lengths.length);
      index += 1;
      count = 0;
    }
    if (index >= lengths.length) return null;
    flushGap(false);
    parts[index] += char;
    count += 1;
  }
  while (index < lengths.length - 1 && count === lengths[index]) {
    index += 1;
    count = 0;
  }
  if (index !== lengths.length - 1 || count !== lengths[index]) return null;
  parts[index] += gap;
  return parts;
}

/** Count of content characters (anything that is not punctuation or whitespace). */
export function contentLength(text: string): number {
  let count = 0;
  for (const char of text) if (!GAP_CHAR.test(char)) count += 1;
  return count;
}
