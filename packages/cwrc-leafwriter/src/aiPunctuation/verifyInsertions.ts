import type { RawPunctInsertion, VerifiedPunctInsertion } from './punctSchema';
import { AI_PUNCT_MARKS } from './punctSchema';
import { cpLength } from './selectionScope';

const MARK_SET = new Set<string>(AI_PUNCT_MARKS);
/** Han incl. planes 2-3 (Ext B-H); see the code-point note in selectionScope.ts. */
const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{323af}]/u;

export function parseValidInsertions(json: string): RawPunctInsertion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as any).insertions)) {
    return [];
  }
  const items: RawPunctInsertion[] = [];
  for (const raw of (parsed as { insertions: unknown[] }).insertions) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const mark = typeof item.mark === 'string' ? item.mark : '';
    if (!MARK_SET.has(mark)) continue;
    const left = typeof item.left === 'string' ? item.left.trim() : '';
    if (!left || cpLength(left) > 3) continue;
    if (![...left].every((ch) => HAN_RE.test(ch))) continue;
    const occurrence =
      typeof item.occurrence === 'number' && item.occurrence >= 1
        ? item.occurrence
        : typeof item.occurrence === 'string' && /^[1-9]\d*$/.test(item.occurrence)
          ? Number(item.occurrence)
          : 1;
    items.push({ mark, left, occurrence });
  }
  return items;
}

/** Offset (in code points) of the nth occurrence of `left` in `chars`, or null. */
const findOccurrenceCp = (chars: string[], left: string[], occurrence: number): number | null => {
  if (left.length === 0) return null;
  let found = 0;
  for (let at = 0; at + left.length <= chars.length; at += 1) {
    if (left.every((ch, k) => chars[at + k] === ch)) {
      found += 1;
      if (found === occurrence) return at;
    }
  }
  return null;
};

/**
 * Resolve left+occurrence against segment Han; compute afterHan internally. Offsets are code
 * points (the plugin's Han indices), so Extension B+ characters count once.
 */
export function verifySegmentInsertions(
  segmentHan: string,
  items: RawPunctInsertion[],
  hanStart: number,
): { verified: VerifiedPunctInsertion[]; dropped: number } {
  const verified: VerifiedPunctInsertion[] = [];
  const chars = Array.from(segmentHan);
  let dropped = 0;
  for (const item of items) {
    const left = Array.from(item.left);
    const offset = findOccurrenceCp(chars, left, item.occurrence);
    if (offset === null) {
      dropped++;
      continue;
    }
    const afterHan = offset + left.length - 1;
    if (afterHan < 0 || afterHan >= chars.length) {
      dropped++;
      continue;
    }
    verified.push({
      afterHan,
      mark: item.mark,
      global_han: hanStart + afterHan,
    });
  }
  return { verified, dropped };
}

export function dedupeInsertions(items: VerifiedPunctInsertion[]): VerifiedPunctInsertion[] {
  const byKey = new Map<string, VerifiedPunctInsertion>();
  for (const item of items) {
    byKey.set(`${item.global_han}:${item.mark}`, item);
  }
  return [...byKey.values()].sort((a, b) => a.global_han - b.global_han);
}
