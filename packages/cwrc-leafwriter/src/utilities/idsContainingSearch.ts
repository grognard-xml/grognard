/**
 * "Find characters containing…" for the Compose dialog Discover panel
 * (plugins/marinaMoji-composer-parity.md Phase 1). Port of marinaMoji
 * IdsTable::FindContaining / ParseLookupQuery: every encoded character whose
 * IDS decomposition contains the typed components (at any depth), with radical
 * forms treated as one family, optional Unihan stroke filter, sorted by
 * stroke count.
 */

import idsUnicodeIndexData from '../resources/ids/idsUnicodeIndex.json';
import { getCharInfoSync } from './charInfo';
import { formsOf } from './radicalForms';

type RawEntry = [ids: string, char: string];
const RAW_ENTRIES = idsUnicodeIndexData as unknown as RawEntry[];

const isIdsOperator = (char: string): boolean => /[\u2FF0-\u2FFF\u31EF]/u.test(char);

/** One non-ASCII scalar that is not an IDS operator (marinaMoji IsComponent). */
const isComponent = (char: string): boolean => {
  const cp = char.codePointAt(0) ?? 0;
  return cp > 0x7f && !isIdsOperator(char);
};

const baseOf = (char: string): string => formsOf(char)[0] ?? char;

export interface StrokeRange {
  min: number;
  max: number;
}

export interface LookupQuery {
  components: string;
  strokes: StrokeRange | null;
}

const FULLWIDTH: Record<string, string> = {
  '０': '0',
  '１': '1',
  '２': '2',
  '３': '3',
  '４': '4',
  '５': '5',
  '６': '6',
  '７': '7',
  '８': '8',
  '９': '9',
  '＜': '<',
  '＞': '>',
  '＝': '=',
  '－': '-',
  '—': '-',
};

const normalizeQueryChar = (char: string): string => FULLWIDTH[char] ?? char;

/**
 * Split components from stroke filters: `木12`, `木<12`, `木>8`, `木9-12`,
 * `木>=8`, several filters (`木>3 <9`), filter alone (`9-12`).
 */
export const parseLookupQuery = (text: string): LookupQuery => {
  const chars = Array.from(text.trim()).map(normalizeQueryChar);
  let components = '';
  let strokes: StrokeRange | null = null;

  const asciiAt = (i: number): string =>
    i < chars.length && chars[i]!.length === 1 && chars[i]!.charCodeAt(0) < 128 ? chars[i]! : '';

  const isDigit = (c: string) => c >= '0' && c <= '9';

  for (let i = 0; i < chars.length;) {
    const c = asciiAt(i);
    if (c !== '<' && c !== '>' && !isDigit(c)) {
      if (chars[i] && chars[i]!.charCodeAt(0) > 127) components += chars[i];
      i += 1;
      continue;
    }
    let op = '';
    let inclusive = false;
    if (c === '<' || c === '>') {
      op = c;
      i += 1;
      if (asciiAt(i) === '=') {
        inclusive = true;
        i += 1;
      }
    }
    const readNumber = (): number | null => {
      if (!isDigit(asciiAt(i))) return null;
      let n = 0;
      for (; isDigit(asciiAt(i)); i += 1) {
        n = Math.min(n * 10 + (asciiAt(i).charCodeAt(0) - 48), 999);
      }
      return n;
    };
    const first = readNumber();
    if (first === null) continue;
    let range: StrokeRange = { min: 0, max: Number.MAX_SAFE_INTEGER };
    if (op === '<') {
      range.max = inclusive ? first : first - 1;
    } else if (op === '>') {
      range.min = inclusive ? first : first + 1;
    } else if (asciiAt(i) === '-' && isDigit(asciiAt(i + 1))) {
      i += 1;
      const second = readNumber() ?? first;
      range.min = Math.min(first, second);
      range.max = Math.max(first, second);
    } else {
      range.min = first;
      range.max = first;
    }
    if (strokes) {
      range = {
        min: Math.max(range.min, strokes.min),
        max: Math.min(range.max, strokes.max),
      };
    }
    strokes = range;
  }

  return { components, strokes };
};

/** Stroke counts from char_info (first Unihan value). Empty if unknown / not preloaded. */
export const strokeCountsFor = (char: string): number[] => {
  const raw = getCharInfoSync(char)?.strokes;
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n));
};

export const primaryStrokeCount = (char: string): number | null => {
  const counts = strokeCountsFor(char);
  return counts[0] ?? null;
};

let byChar: Map<string, string[]> | null = null;

const reverseByChar = (): Map<string, string[]> => {
  if (byChar) return byChar;
  byChar = new Map();
  for (const [rawIds, char] of RAW_ENTRIES) {
    const ids = rawIds.replace(/\[[A-Z,]*\]"?$/, '');
    if (ids === char) continue;
    const list = byChar.get(char);
    if (!list) byChar.set(char, [ids]);
    else if (!list.includes(ids)) list.push(ids);
  }
  return byChar;
};

interface ParentGraph {
  /** base component → characters with it as a direct part (forms merged). */
  directByBase: Map<string, string[]>;
  /** exact part character → characters with it as a direct part. */
  byPart: Map<string, string[]>;
}

let graph: ParentGraph | null = null;

/** One cheap pass (milliseconds): who contains whom directly. Transitive
 * containment is resolved per query by walking up from the component, so there
 * is no multi-second full-closure index to build. */
const buildParentGraph = (): ParentGraph => {
  if (graph) return graph;
  const directByBase = new Map<string, string[]>();
  const byPart = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, ch: string) => {
    const list = map.get(key);
    if (!list) map.set(key, [ch]);
    else if (list[list.length - 1] !== ch) list.push(ch);
  };
  for (const [ch, idsList] of reverseByChar()) {
    for (const ids of idsList) {
      for (const part of Array.from(ids)) {
        if (!isComponent(part) || part === ch) continue;
        add(directByBase, baseOf(part), ch);
        add(byPart, part, ch);
      }
    }
  }
  graph = { directByBase, byPart };
  return graph;
};

type CountMap = Map<string, number>;
const countMemo = new Map<string, CountMap>();

/** How many times each base component occurs inside `ch` (max over its
 * decompositions, at any depth). Memoised; only called for query candidates. */
const componentCounts = (ch: string, visiting: Set<string> = new Set()): CountMap => {
  const cached = countMemo.get(ch);
  if (cached) return cached;
  const result: CountMap = new Map();
  const idsList = reverseByChar().get(ch);
  if (!idsList || visiting.has(ch)) return result;
  visiting.add(ch);
  for (const ids of idsList) {
    const local: CountMap = new Map();
    for (const part of Array.from(ids)) {
      if (!isComponent(part)) continue;
      const key = baseOf(part);
      local.set(key, (local.get(key) ?? 0) + 1);
      if (part === ch) continue;
      for (const [below, count] of componentCounts(part, visiting)) {
        local.set(below, (local.get(below) ?? 0) + count);
      }
    }
    for (const [comp, count] of local) {
      result.set(comp, Math.max(result.get(comp) ?? 0, count));
    }
  }
  visiting.delete(ch);
  // Results computed inside a cycle guard may be partial; only cache top-level.
  if (visiting.size === 0) countMemo.set(ch, result);
  return result;
};

/** Every character containing `base` at any depth (walk up the parent graph). */
const containingSet = (base: string): Set<string> => {
  const { directByBase, byPart } = buildParentGraph();
  const found = new Set<string>();
  const queue: string[] = [...(directByBase.get(base) ?? [])];
  for (const ch of queue) {
    if (found.has(ch)) continue;
    found.add(ch);
    for (const up of byPart.get(ch) ?? []) if (!found.has(up)) queue.push(up);
  }
  for (const ch of [...found]) if (baseOf(ch) === base) found.delete(ch);
  return found;
};

/** Cheap to call (no heavy index any more); kept so callers can warm it. */
export const preloadContainingIndex = (): void => {
  buildParentGraph();
};

const inStrokeRange = (char: string, strokes: StrokeRange | null): boolean => {
  if (!strokes) return true;
  const counts = strokeCountsFor(char);
  if (counts.length === 0) return false;
  return counts.some((n) => n >= strokes.min && n <= strokes.max);
};

/**
 * Characters whose decomposition contains every typed component (whitespace
 * ignored; a component typed twice must occur twice). Radical forms count as
 * one. Never returns the component itself. With only a stroke filter, every
 * char_info character in that range. Empty components and no strokes → [].
 */
export const findCharactersContaining = (
  components: string,
  strokes: StrokeRange | null = null,
): string[] => {
  const wanted: { key: string; count: number }[] = [];

  for (const ch of Array.from(components.replace(/\s+/g, ''))) {
    if (!isComponent(ch)) continue;
    const key = baseOf(ch);
    const existing = wanted.find((w) => w.key === key);
    if (existing) existing.count += 1;
    else wanted.push({ key, count: 1 });
  }

  if (wanted.length === 0) {
    if (!strokes) return [];
    // Stroke-only: scan char_info via getCharInfoSync — we need all keys.
    // Build once from the containing index's characters is incomplete; use
    // RAW_ENTRIES characters that have stroke data, plus index keys.
    const seen = new Set<string>();
    const all: string[] = [];
    for (const [, char] of RAW_ENTRIES) {
      if (seen.has(char)) continue;
      seen.add(char);
      if (inStrokeRange(char, strokes)) all.push(char);
    }
    all.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return all;
  }

  const sets = wanted.map((w) => ({ ...w, set: containingSet(w.key) }));
  sets.sort((x, y) => x.set.size - y.set.size);
  const [first, ...rest] = sets;
  if (!first) return [];

  const result: string[] = [];
  for (const ch of first.set) {
    if (!rest.every((w) => w.set.has(ch))) continue;
    if (!inStrokeRange(ch, strokes)) continue;
    // A component typed twice must occur twice.
    if (sets.some((w) => w.count > 1 && (componentCounts(ch).get(w.key) ?? 0) < w.count)) continue;
    result.push(ch);
  }
  return result.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
};

/** Sort by primary stroke count ascending, then code point. Unknown strokes last. */
export const sortByStrokes = (chars: string[]): string[] =>
  [...chars].sort((a, b) => {
    const sa = primaryStrokeCount(a) ?? 1000;
    const sb = primaryStrokeCount(b) ?? 1000;
    if (sa !== sb) return sa - sb;
    return a < b ? -1 : a > b ? 1 : 0;
  });

/** Cap for the results grid (marinaMoji kMaxShown). */
export const FIND_RESULTS_CAP = 500;

export const findAndSortContaining = (
  queryText: string,
): {
  lookup: LookupQuery;
  matches: string[];
  shown: string[];
  truncated: boolean;
} => {
  const lookup = parseLookupQuery(queryText);
  const matches = sortByStrokes(findCharactersContaining(lookup.components, lookup.strokes));
  const truncated = matches.length > FIND_RESULTS_CAP;
  return {
    lookup,
    matches,
    shown: truncated ? matches.slice(0, FIND_RESULTS_CAP) : matches,
    truncated,
  };
};
