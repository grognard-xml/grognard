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
  const hanChars = selectionHanOnly(han).length;
  if (hanChars === 0) return 0;
  const punctSource = text ?? han;
  const punctCount = [...punctSource].filter((ch) => PUNCT_SET.has(ch as AiPunctMark)).length;
  return (punctCount / hanChars) * 100;
}

/** True when a segment still needs AI after parallel transfer (unpunctuated or sparse marks). */
export function segmentNeedsAiGap(seg: { han: string; has_punct: boolean; text?: string }): boolean {
  if (seg.han.length < MIN_SEGMENT_HAN) return false;
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
  if (han.length <= maxLen) {
    return [{ text: han, offset: 0 }];
  }
  const chunks: HanChunk[] = [];
  let start = 0;
  while (start < han.length) {
    let end = Math.min(start + maxLen, han.length);
    if (end < han.length) {
      const window = han.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
      );
      if (breakAt > maxLen * 0.4) {
        end = start + breakAt + 1;
      }
    }
    chunks.push({ text: han.slice(start, end), offset: start });
    if (end >= han.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export function filterSegmentsForAi<T extends { han: string; has_punct: boolean; id: number }>(
  segments: T[],
  segmentIds?: number[],
): T[] {
  const idSet = segmentIds ? new Set(segmentIds) : null;
  return segments.filter((seg) => {
    if (idSet && !idSet.has(seg.id)) return false;
    if (seg.has_punct) return false;
    if (seg.han.length < MIN_SEGMENT_HAN) return false;
    return true;
  });
}

export function filterSegmentsForAiGaps<T extends { han: string; has_punct: boolean; id: number }>(
  segments: T[],
  segmentIds?: number[],
): T[] {
  const idSet = segmentIds ? new Set(segmentIds) : null;
  return segments.filter((seg) => {
    if (idSet && !idSet.has(seg.id)) return false;
    return segmentNeedsAiGap(seg);
  });
}

export function selectTargetsForAi<
  T extends { han: string; has_punct: boolean; id: number; han_start: number; han_end: number },
>(
  segments: T[],
  options?: { segmentIds?: number[]; hanRange?: HanRange; gapsOnly?: boolean },
): T[] {
  const idSet = options?.segmentIds ? new Set(options.segmentIds) : null;
  if (options?.hanRange) {
    return segments
      .filter((seg) => !idSet || idSet.has(seg.id))
      .map((seg) => clipSegmentToHanRange(seg, options.hanRange!))
      .filter((seg): seg is T => {
        if (!seg || seg.han.length < MIN_SEGMENT_HAN) return false;
        return !hanTextHasPunct(seg.han);
      });
  }
  if (options?.gapsOnly) {
    return filterSegmentsForAiGaps(segments, options.segmentIds);
  }
  return filterSegmentsForAi(segments, options?.segmentIds);
}

export function extractJuanDiv(xml: string): string | null {
  const juan = xml.match(/<div\b[^>]*type="juan"[^>]*>[\s\S]*?<\/div>/i);
  if (juan) return juan[0];
  const body = xml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return body?.[1]?.trim() || null;
}

export function replaceJuanDiv(xml: string, bodyXml: string): string {
  if (/<div\b[^>]*type="juan"/i.test(xml)) {
    return xml.replace(/<div\b[^>]*type="juan"[^>]*>[\s\S]*?<\/div>/i, bodyXml.trim());
  }
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
  return text.replace(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, '');
}

/** Reconstruct the juan Han tape from segment metadata (global han indices). */
export function buildJuanHanTape(segments: { han: string; han_start: number }[]): string {
  if (!segments.length) return '';
  const end = Math.max(...segments.map((seg) => seg.han_start + seg.han.length));
  const chars = Array<string>(end).fill('');
  for (const seg of segments) {
    for (let index = 0; index < seg.han.length; index += 1) {
      chars[seg.han_start + index] = seg.han[index]!;
    }
  }
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
  let index = tape.indexOf(selectedHan);
  if (index >= 0) {
    return { start: index, end: index + selectedHan.length };
  }

  // Anchor on a prefix when the selection includes display punctuation or minor mismatch.
  for (let len = Math.min(selectedHan.length, 48); len >= 8; len -= 1) {
    index = tape.indexOf(selectedHan.slice(0, len));
    if (index >= 0) {
      return { start: index, end: Math.min(index + selectedHan.length, tape.length) };
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
    han: segment.han.slice(offset, offset + length),
    han_start: start,
    han_end: end,
  };
}

export function punctInHanRange(
  segments: { han: string; han_start: number; han_end: number }[],
  range: HanRange,
): boolean {
  for (const seg of segments) {
    const clipped = clipSegmentToHanRange(seg, range);
    if (clipped && hanTextHasPunct(clipped.han)) {
      return true;
    }
  }
  return false;
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
