import {
  AI_PUNCT_MARKS,
  CHUNK_HAN,
  CHUNK_OVERLAP,
  MIN_SEGMENT_HAN,
  type AiPunctMark,
} from './punctSchema';
import {
  consumeCapturedEditorSelection,
  peekCapturedEditorSelection,
} from './editorSelectionCapture';

const PUNCT_SET = new Set<string>(AI_PUNCT_MARKS);

/**
 * Han indices are Unicode code points: the Kanripo plugin (Python) counts them that way, and a
 * character outside the BMP (Extension B and later, e.g. 𪁺) is one index but two UTF-16 units in
 * JavaScript. Every length, slice and offset on Han text here goes through these so the two sides
 * stay in step; plain `.length` / `.slice` / `[i]` would drift by one per astral character.
 */
export const cpLength = (text: string): number => {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
};

const cpSlice = (text: string, start: number, end?: number): string =>
  Array.from(text).slice(start, end).join('');

/** Han: Ext A, the main block, CJK compatibility ideographs, and planes 2-3 (Ext B through H). */
const HAN_CLASS = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u{20000}-\\u{323af}';
const NON_HAN = new RegExp(`[^${HAN_CLASS}]`, 'gu');

/** Match Python `MIN_PUNCT_PER_100_HAN` in parallel quality assessment. */
export const MIN_PUNCT_PER_100_HAN = 0.75;

export function hanTextHasPunct(han: string): boolean {
  return [...han].some((ch) => PUNCT_SET.has(ch as AiPunctMark));
}

/**
 * `han` is Han-only (used as the density denominator); `text` is the same
 * span with punctuation kept, and is what the numerator must be counted
 * from -- `han` can never contain a punctuation mark by construction (see
 * Python's `_atoms_han`), so counting from it always yields zero density
 * regardless of how well the segment is actually punctuated. Defaults to
 * `han` for callers that don't have the punctuated text, which reproduces
 * the previous (broken) behavior rather than throwing.
 */
export function punctPer100Han(han: string, text?: string): number {
  const hanChars = cpLength(selectionHanOnly(han));
  if (hanChars === 0) return 0;
  const punctSource = text ?? han;
  const punctCount = [...punctSource].filter((ch) => PUNCT_SET.has(ch as AiPunctMark)).length;
  return (punctCount / hanChars) * 100;
}

/** True when a segment still needs AI after parallel transfer (unpunctuated or sparse marks). */
export function segmentNeedsAiGap(seg: {
  han: string;
  has_punct: boolean;
  text?: string;
  kind?: 'text' | 'comm' | 'head';
}): boolean {
  if (seg.kind === 'head') return false;
  // Base-text fragments are punctuated as runs (see punctRuns.ts), so a short unpunctuated one is
  // a gap however short; the run as a whole is length-checked later. Notes stay atomic.
  if (seg.kind === 'text' && !seg.has_punct) return true;
  if (cpLength(seg.han) < MIN_SEGMENT_HAN) return false;
  if (!seg.has_punct) return true;
  return punctPer100Han(seg.han, seg.text) < MIN_PUNCT_PER_100_HAN;
}

export interface HanChunk {
  text: string;
  offset: number;
}

export interface HanRange {
  start: number;
  end: number;
}

/** Split long Han strings at natural boundaries with overlap. */
export function chunkHanText(han: string, maxLen = CHUNK_HAN, overlap = CHUNK_OVERLAP): HanChunk[] {
  const chars = Array.from(han);
  if (chars.length <= maxLen) {
    return [{ text: han, offset: 0 }];
  }
  const chunks: HanChunk[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = Math.min(start + maxLen, chars.length);
    if (end < chars.length) {
      const window = chars.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
      );
      if (breakAt > maxLen * 0.4) {
        end = start + breakAt + 1;
      }
    }
    chunks.push({ text: chars.slice(start, end).join(''), offset: start });
    if (end >= chars.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/**
 * Base-text fragments (`kind: 'text'`) are exempt from the per-segment minimum length: interlinear
 * notes cut base text into fragments far shorter than {@link MIN_SEGMENT_HAN}, and they are
 * punctuated as runs whose total length is checked in `buildPunctUnits`. Notes keep the minimum.
 */
export function filterSegmentsForAi<
  T extends { han: string; has_punct: boolean; id: number; kind?: 'text' | 'comm' | 'head' },
>(segments: T[], segmentIds?: number[]): T[] {
  const idSet = segmentIds ? new Set(segmentIds) : null;
  return segments.filter((seg) => {
    if (idSet && !idSet.has(seg.id)) return false;
    if (seg.has_punct || seg.kind === 'head') return false;
    if (seg.kind !== 'text' && cpLength(seg.han) < MIN_SEGMENT_HAN) return false;
    return true;
  });
}

export function filterSegmentsForAiGaps<
  T extends { han: string; has_punct: boolean; id: number; kind?: 'text' | 'comm' | 'head' },
>(segments: T[], segmentIds?: number[]): T[] {
  const idSet = segmentIds ? new Set(segmentIds) : null;
  return segments.filter((seg) => {
    if (idSet && !idSet.has(seg.id)) return false;
    return segmentNeedsAiGap(seg);
  });
}

export function selectTargetsForAi<
  T extends {
    han: string;
    has_punct: boolean;
    id: number;
    han_start: number;
    han_end: number;
    kind?: 'text' | 'comm' | 'head';
  },
>(
  segments: T[],
  options?: { segmentIds?: number[]; hanRange?: HanRange; gapsOnly?: boolean },
): T[] {
  const idSet = options?.segmentIds ? new Set(options.segmentIds) : null;
  if (options?.hanRange) {
    return segments
      .filter((seg) => !idSet || idSet.has(seg.id))
      .map((seg) => clipSegmentToHanRange(seg, options.hanRange!))
      .filter((seg): seg is T =>
        Boolean(
          seg &&
          seg.kind !== 'head' &&
          (seg.kind === 'text' || cpLength(seg.han) >= MIN_SEGMENT_HAN),
        ),
      );
  }
  if (options?.gapsOnly) {
    return filterSegmentsForAiGaps(segments, options.segmentIds);
  }
  return filterSegmentsForAi(segments, options?.segmentIds);
}

/**
 * Span of the juan content: the first `<div type="juan">` through its
 * matching close, extended over any further `<div type="juan">` siblings that
 * follow it directly. A file with several headings can legitimately hold
 * several top-level divs, and parallel punctuation / AI fill must see all of
 * them, not just the first. Nested `<div>`s are matched by depth.
 */
export const matchJuanDiv = (xml: string): { start: number; end: number } | null => {
  const openRe = /<div\b[^>]*type="juan"[^>]*>/gi;
  const first = openRe.exec(xml);
  if (!first) return null;
  const closeOf = (from: number): number | null => {
    const tagRe = /<(\/?)div\b[^>]*>/gi;
    tagRe.lastIndex = from;
    let depth = 0;
    for (let t = tagRe.exec(xml); t; t = tagRe.exec(xml)) {
      if (/\/>\s*$/.test(t[0])) continue; // self-closing <div/>
      depth += t[1] ? -1 : 1;
      if (depth === 0) return t.index + t[0].length;
    }
    return null;
  };
  let end = closeOf(first.index);
  if (end === null) return null;
  for (;;) {
    const next = /^\s*(<div\b[^>]*type="juan"[^>]*>)/i.exec(xml.slice(end));
    if (!next) break;
    const nextStart = end + next[0].length - next[1].length;
    const nextEnd = closeOf(nextStart);
    if (nextEnd === null) break;
    end = nextEnd;
  }
  return { start: first.index, end };
};

export function extractJuanDiv(xml: string): string | null {
  const juan = matchJuanDiv(xml);
  if (juan) return xml.slice(juan.start, juan.end);
  const body = xml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return body?.[1]?.trim() || null;
}

export function replaceJuanDiv(xml: string, bodyXml: string): string {
  const juan = matchJuanDiv(xml);
  if (juan) return xml.slice(0, juan.start) + bodyXml.trim() + xml.slice(juan.end);
  return xml.replace(/<body\b[^>]*>[\s\S]*?<\/body>/i, `<body>\n${bodyXml.trim()}\n</body>`);
}

/** Selected plain text from the TinyMCE visual editor (not parent-window selection). */
export function getEditorSelectedPlainText(): string {
  const captured = peekCapturedEditorSelection();
  if (captured) return captured;

  const editor = window.writer?.editor;
  if (!editor?.selection) return '';

  const readNonCollapsed = (): string => {
    if (editor.selection.isCollapsed?.()) return '';
    const text = editor.selection.getContent({ format: 'text' }) ?? '';
    return text.replace(/\s+/g, '');
  };

  const direct = readNonCollapsed();
  if (direct) return direct;

  // Toolbar / menu clicks collapse the live selection before the command runs.
  // Fall back to the last editor bookmark (saved on context menu, etc.).
  const bookmark = editor.currentBookmark;
  if (!bookmark) return '';
  try {
    editor.selection.moveToBookmark(bookmark);
    return readNonCollapsed();
  } catch {
    return '';
  }
}

export { consumeCapturedEditorSelection };

export function selectionHanOnly(text: string): string {
  return text.replace(NON_HAN, '');
}

/** Reconstruct the juan Han tape from segment metadata (global han indices). */
export function buildJuanHanTape(segments: { han: string; han_start: number }[]): string {
  if (!segments.length) return '';
  const hanBySegment = segments.map((seg) => Array.from(seg.han));
  const end = Math.max(...segments.map((seg, i) => seg.han_start + hanBySegment[i]!.length));
  const chars = Array<string>(end).fill('');
  segments.forEach((seg, i) => {
    hanBySegment[i]!.forEach((ch, index) => {
      chars[seg.han_start + index] = ch;
    });
  });
  return chars.join('');
}

/**
 * Map editor selection to global Han indices in the juan tape.
 * - `undefined` — no selection (run whole juan)
 * - `null` — selection present but not locatable in the tape
 */
export function findSelectionHanRange(
  segments: { han: string; han_start: number; han_end: number }[],
  selectedPlain: string,
): HanRange | null | undefined {
  if (!selectedPlain.trim()) return undefined;
  const selectedHan = selectionHanOnly(selectedPlain);
  if (!selectedHan) return null;

  const tape = buildJuanHanTape(segments);
  const tapeLength = cpLength(tape);
  const selectedLength = cpLength(selectedHan);
  // indexOf works in UTF-16 units; convert the hit back to a code-point index.
  const cpIndexOf = (needle: string): number => {
    const at = tape.indexOf(needle);
    return at < 0 ? -1 : cpLength(tape.slice(0, at));
  };

  let index = cpIndexOf(selectedHan);
  if (index >= 0) {
    return { start: index, end: index + selectedLength };
  }

  // Anchor on a prefix when the selection includes display punctuation or minor mismatch.
  for (let len = Math.min(selectedLength, 48); len >= 8; len -= 1) {
    index = cpIndexOf(cpSlice(selectedHan, 0, len));
    if (index >= 0) {
      return { start: index, end: Math.min(index + selectedLength, tapeLength) };
    }
  }
  return null;
}

export function clipSegmentToHanRange<
  T extends { han: string; han_start: number; han_end: number },
>(segment: T, range: HanRange): T | null {
  const start = Math.max(segment.han_start, range.start);
  const end = Math.min(segment.han_end, range.end);
  if (start >= end) return null;
  const offset = start - segment.han_start;
  const length = end - start;
  return {
    ...segment,
    han: cpSlice(segment.han, offset, offset + length),
    han_start: start,
    han_end: end,
  };
}

/**
 * The span of `seg.text` (Han plus its punctuation) covering Han indices [range.start, range.end).
 * A mark belongs to the range when it follows a selected Han character, so a mark right after the
 * last selected character counts and one right before the first does not.
 */
export function clipTextToHanRange(
  seg: { text: string; han_start: number; han_end: number },
  range: HanRange,
): string {
  const start = Math.max(seg.han_start, range.start) - seg.han_start;
  const end = Math.min(seg.han_end, range.end) - seg.han_start;
  if (start >= end) return '';
  let hanSeen = 0;
  let out = '';
  for (const ch of seg.text) {
    if (selectionHanOnly(ch)) {
      if (hanSeen >= start && hanSeen < end) out += ch;
      hanSeen += 1;
    } else if (hanSeen > start && hanSeen <= end) {
      out += ch;
    }
  }
  return out;
}

/**
 * Whether the Han range already carries punctuation. Reads each segment's `text`: `han` is
 * Han-only by construction and can never contain a mark, which is why this used to always say no
 * and let AI punctuate pile marks on top of existing ones.
 */
export function punctInHanRange(
  segments: { han: string; text?: string; han_start: number; han_end: number }[],
  range: HanRange,
): boolean {
  for (const seg of segments) {
    const clipped = clipTextToHanRange({ ...seg, text: seg.text ?? seg.han }, range);
    if (clipped && hanTextHasPunct(clipped)) return true;
  }
  return false;
}

/**
 * The parts of `range` that are still unpunctuated, paragraph by paragraph, with touching runs
 * merged so the model gets one stretch of context. A paragraph counts as unpunctuated when its
 * mark density is under the same threshold fill-gaps uses. Paragraphs only partly inside the
 * range contribute just the part inside it.
 */
export function unpunctuatedRanges(
  paragraphs: { han_start: number; han_end: number; han_count: number; punct_count: number }[],
  range: HanRange,
  minPer100Han = MIN_PUNCT_PER_100_HAN,
): HanRange[] {
  const runs: HanRange[] = [];
  for (const paragraph of paragraphs) {
    const start = Math.max(paragraph.han_start, range.start);
    const end = Math.min(paragraph.han_end, range.end);
    if (start >= end || paragraph.han_count === 0) continue;
    if ((paragraph.punct_count / paragraph.han_count) * 100 >= minPer100Han) continue;
    const last = runs[runs.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else runs.push({ start, end });
  }
  return runs;
}

export function segmentsInSelection(
  segments: { id: number; han: string; han_start: number; han_end: number }[],
  selectedPlain: string,
): number[] | undefined {
  const range = findSelectionHanRange(segments, selectedPlain);
  if (range == null) return undefined;
  const ids: number[] = [];
  for (const seg of segments) {
    if (seg.han_start < range.end && seg.han_end > range.start) {
      ids.push(seg.id);
    }
  }
  return ids.length ? ids : undefined;
}
