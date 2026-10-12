import { buildSearchText, hashText, type SearchText } from './normalize';
import type { Anchor, ResolvedAnchor, WhitespacePolicy } from './types';

const CONTEXT_LENGTH = 12;

interface DocTextNode {
  node: Text;
  search: SearchText;
}

/**
 * Document-level search index: all text nodes in document order plus their
 * concatenated search text, so context can span node boundaries (a tagged
 * name is often a text node containing nothing but the name itself).
 */
export interface DocIndex {
  nodes: DocTextNode[];
  /** Concatenation of every node's search text, in document order. */
  text: string;
  /** nodeStart[i] = offset of nodes[i]'s search text within `text`. */
  nodeStart: number[];
}

/** All non-empty text nodes under root, in document order, with their search text. */
export function collectTextNodes(root: Node, policy: WhitespacePolicy): DocTextNode[] {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const result: DocTextNode[] = [];
  let node = walker.nextNode();
  while (node) {
    const search = buildSearchText((node as Text).data, policy);
    if (search.text.length > 0) result.push({ node: node as Text, search });
    node = walker.nextNode();
  }
  return result;
}

export function buildDocIndex(root: Node, policy: WhitespacePolicy): DocIndex {
  const nodes = collectTextNodes(root, policy);
  const nodeStart: number[] = [];
  let total = 0;
  for (const { search } of nodes) {
    nodeStart.push(total);
    total += search.text.length;
  }
  return { nodes, text: nodes.map((n) => n.search.text).join(''), nodeStart };
}

/** Structural path to a text node, e.g. /TEI/text/body/div[1]/p[3]/text()[1]. */
export function xpathForTextNode(node: Text): string {
  const steps: string[] = [];

  const textSiblings = node.parentNode
    ? Array.from(node.parentNode.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE)
    : [node];
  steps.unshift(`text()[${textSiblings.indexOf(node) + 1}]`);

  let el: Element | null = node.parentElement;
  while (el) {
    const parent: Element | null = el.parentElement;
    if (!parent) {
      steps.unshift(el.nodeName);
      break;
    }
    const sameName = Array.from(parent.children).filter((c) => c.nodeName === el!.nodeName);
    steps.unshift(
      sameName.length > 1 ? `${el.nodeName}[${sameName.indexOf(el) + 1}]` : el.nodeName,
    );
    el = parent;
  }

  return `/${steps.join('/')}`;
}

/** Resolve a path produced by xpathForTextNode. Returns null if the path no longer exists. */
export function resolveXPath(doc: Document, xpath: string): Text | null {
  const steps = xpath.replace(/^\//, '').split('/');
  const textStep = steps.pop();
  if (!textStep) return null;

  let el: Element | null = null;
  for (const step of steps) {
    const match = /^([^[]+)(?:\[(\d+)\])?$/.exec(step);
    if (!match) return null;
    const [, name, index] = match;
    const candidates: Element[] = el
      ? Array.from(el.children).filter((c) => c.nodeName === name)
      : doc.documentElement?.nodeName === name
        ? [doc.documentElement]
        : [];
    el = candidates[index ? parseInt(index, 10) - 1 : 0] ?? null;
    if (!el) return null;
  }

  const textMatch = /^text\(\)\[(\d+)\]$/.exec(textStep);
  if (!textMatch || !el) return null;
  const textNodes = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE);
  return (textNodes[parseInt(textMatch[1]!, 10) - 1] as Text | undefined) ?? null;
}

interface Occurrence {
  /** Index into DocIndex.nodes. */
  nodeIndex: number;
  /** Index of the match in that node's search text. */
  searchIndex: number;
}

/** Reuse occurrence lists when building many anchors in one document. */
export type OccurrenceCache = Map<string, Occurrence[]>;

function cachedOccurrences(
  index: DocIndex,
  surface: string,
  cache?: OccurrenceCache,
): Occurrence[] {
  if (!cache) return occurrences(index, surface);
  const hit = cache.get(surface);
  if (hit) return hit;
  const list = occurrences(index, surface);
  cache.set(surface, list);
  return list;
}

/**
 * Occurrences of surface within single nodes, in document order. Matches
 * spanning node boundaries are excluded — insertion targets one text node.
 */
function occurrences(index: DocIndex, surface: string, nodeIndex?: number): Occurrence[] {
  const result: Occurrence[] = [];
  const scan = nodeIndex === undefined ? index.nodes.keys() : [nodeIndex];
  for (const i of scan) {
    const docNode = index.nodes[i];
    if (!docNode) continue;
    let from = 0;
    while (true) {
      const searchIndex = docNode.search.text.indexOf(surface, from);
      if (searchIndex === -1) break;
      result.push({ nodeIndex: i, searchIndex });
      from = searchIndex + 1;
    }
  }
  return result;
}

/** Raw start/end offsets in node.data for a match at searchIndex of the given length. */
function rawRange(search: SearchText, searchIndex: number, length: number) {
  return {
    start: search.map[searchIndex]!,
    end: search.map[searchIndex + length - 1]! + 1,
  };
}

/** Context around an occurrence, drawn from the document-level search text. */
function contextsAt(index: DocIndex, occ: Occurrence, surfaceLength: number) {
  const pos = index.nodeStart[occ.nodeIndex]! + occ.searchIndex;
  return {
    before: index.text.slice(Math.max(0, pos - CONTEXT_LENGTH), pos),
    after: index.text.slice(pos + surfaceLength, pos + surfaceLength + CONTEXT_LENGTH),
  };
}

/** Number of context chars agreeing with the anchor, counted outward from the match. */
function contextScore(index: DocIndex, anchor: Anchor, occ: Occurrence): number {
  const { before, after } = contextsAt(index, occ, anchor.surface.length);
  let score = 0;
  for (let i = 1; i <= Math.min(anchor.contextBefore.length, before.length); i++) {
    if (anchor.contextBefore[anchor.contextBefore.length - i] !== before[before.length - i]) break;
    score++;
  }
  for (let i = 0; i < Math.min(anchor.contextAfter.length, after.length); i++) {
    if (anchor.contextAfter[i] !== after[i]) break;
    score++;
  }
  return score;
}

/**
 * Create an anchor for the raw range [rawStart, rawEnd) inside a text node.
 * The document must already be NFC-normalized (see normalizeDomText).
 * Producers creating many anchors should pass a prebuilt DocIndex — it is
 * only valid while the document is unmodified. Pass an OccurrenceCache when
 * building anchors for many mentions in the same document.
 */
export function createAnchor(
  documentId: string,
  root: Node,
  node: Text,
  rawStart: number,
  rawEnd: number,
  policy: WhitespacePolicy,
  prebuiltIndex?: DocIndex,
  occurrenceCache?: OccurrenceCache,
): Anchor {
  const index = prebuiltIndex ?? buildDocIndex(root, policy);
  const nodeIndex = index.nodes.findIndex((n) => n.node === node);
  if (nodeIndex === -1) throw new Error('createAnchor: node is not under root or is empty');

  const { text, map } = index.nodes[nodeIndex]!.search;
  const searchStart = map.findIndex((raw) => raw >= rawStart);
  let searchEnd = searchStart;
  while (searchEnd < map.length && map[searchEnd]! < rawEnd) searchEnd++;
  if (searchStart === -1 || searchEnd === searchStart) {
    throw new Error('createAnchor: range contains no matchable characters');
  }

  const surface = text.slice(searchStart, searchEnd);
  const all = cachedOccurrences(index, surface, occurrenceCache);
  const occurrence =
    all.findIndex((o) => o.nodeIndex === nodeIndex && o.searchIndex === searchStart) + 1;
  if (occurrence === 0) throw new Error('createAnchor: could not locate own occurrence');

  const { before, after } = contextsAt(
    index,
    { nodeIndex, searchIndex: searchStart },
    surface.length,
  );

  return {
    documentId,
    xpath: xpathForTextNode(node),
    offset: map[searchStart]!,
    surface,
    occurrence,
    contextBefore: before,
    contextAfter: after,
    nodeHash: hashText(text),
  };
}

/**
 * Create an anchor whose surface crosses text-node boundaries.  This is used
 * only by the post-component person-wrapper pass: the ordinary tagger keeps
 * insertions inside one text node, while this pass wraps existing sibling
 * elements as a unit.
 */
export function createCompoundAnchor(
  documentId: string,
  root: Node,
  startNode: Text,
  startRaw: number,
  endNode: Text,
  endRaw: number,
  surface: string,
  policy: WhitespacePolicy,
  prebuiltIndex?: DocIndex,
): Anchor {
  const index = prebuiltIndex ?? buildDocIndex(root, policy);
  const startIndex = index.nodes.findIndex((entry) => entry.node === startNode);
  const endIndex = index.nodes.findIndex((entry) => entry.node === endNode);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error('createCompoundAnchor: boundary node is not under root');
  }
  const startSearch = index.nodes[startIndex]!.search;
  const localStart = startSearch.map.findIndex((raw) => raw >= startRaw);
  if (localStart < 0) throw new Error('createCompoundAnchor: invalid start boundary');
  const endSearch = index.nodes[endIndex]!.search;
  // Snap the end like the start: the exclusive raw end just after the last
  // search character that lies before `endRaw` (what `rawRange` computes for
  // a single-node anchor). A boundary at the node's own end is left exact -
  // the wrap step requires the span to bound its last component entirely,
  // including any trailing whitespace or invisible characters the search text
  // omits.
  let lastBefore = endSearch.map.length - 1;
  while (lastBefore >= 0 && endSearch.map[lastBefore]! >= endRaw) lastBefore--;
  const endOffset =
    endRaw >= endNode.data.length || lastBefore < 0 ? endRaw : endSearch.map[lastBefore]! + 1;

  const flatStart = index.nodeStart[startIndex]! + localStart;
  const occurrence = (() => {
    let seen = 0;
    let from = 0;
    while (true) {
      const at = index.text.indexOf(surface, from);
      if (at < 0) return 0;
      seen++;
      if (at === flatStart) return seen;
      from = at + 1;
    }
  })();
  if (!occurrence) throw new Error('createCompoundAnchor: surface does not match boundary');
  const before = index.text.slice(Math.max(0, flatStart - CONTEXT_LENGTH), flatStart);
  const after = index.text.slice(
    flatStart + surface.length,
    flatStart + surface.length + CONTEXT_LENGTH,
  );
  return {
    documentId,
    xpath: xpathForTextNode(startNode),
    offset: startSearch.map[localStart]!,
    surface,
    occurrence,
    contextBefore: before,
    contextAfter: after,
    nodeHash: hashText(startSearch.text),
    endXpath: xpathForTextNode(endNode),
    endOffset,
  };
}

/**
 * Locate the Nth (1-based) occurrence of `surface` in the document search text,
 * returning the text node and raw offsets for as much of that match as sits in
 * the starting node. Used by editor focus jumps — structural xpaths from the
 * XML document do not apply to TinyMCE's HTML body.
 */
export function locateOccurrenceInIndex(
  index: DocIndex,
  surface: string,
  occurrence: number,
): { node: Text; start: number; end: number } | null {
  if (!surface || occurrence < 1) return null;

  let flatStart = -1;
  let from = 0;
  for (let seen = 0; seen < occurrence; seen++) {
    flatStart = index.text.indexOf(surface, from);
    if (flatStart === -1) return null;
    from = flatStart + 1;
  }

  return rangeAtFlatPosition(index, flatStart, surface.length);
}

/** Node + raw offsets for the match starting at `flatStart` in the index text. */
function rangeAtFlatPosition(
  index: DocIndex,
  flatStart: number,
  length: number,
): { node: Text; start: number; end: number } | null {
  for (let i = 0; i < index.nodes.length; i++) {
    const nodeStart = index.nodeStart[i]!;
    const nodeLen = index.nodes[i]!.search.text.length;
    const nodeEnd = nodeStart + nodeLen;
    if (flatStart < nodeStart || flatStart >= nodeEnd) continue;

    const local = flatStart - nodeStart;
    const { node, search } = index.nodes[i]!;
    const endFlat = Math.min(flatStart + length, nodeEnd);
    const rawStart = search.map[local];
    const rawEndMap = search.map[endFlat - nodeStart - 1];
    if (rawStart === undefined || rawEndMap === undefined) return null;
    return { node, start: rawStart, end: rawEndMap + 1 };
  }
  return null;
}

/** Flat-text context around a match, in the shape contextScore compares. */
function flatContextsAt(index: DocIndex, flatStart: number, surfaceLength: number) {
  return {
    before: index.text.slice(Math.max(0, flatStart - CONTEXT_LENGTH), flatStart),
    after: index.text.slice(flatStart + surfaceLength, flatStart + surfaceLength + CONTEXT_LENGTH),
  };
}

function flatContextScore(index: DocIndex, anchor: Anchor, flatStart: number): number {
  const { before, after } = flatContextsAt(index, flatStart, anchor.surface.length);
  let score = 0;
  for (let i = 1; i <= Math.min(anchor.contextBefore.length, before.length); i++) {
    if (anchor.contextBefore[anchor.contextBefore.length - i] !== before[before.length - i]) break;
    score++;
  }
  for (let i = 0; i < Math.min(anchor.contextAfter.length, after.length); i++) {
    if (anchor.contextAfter[i] !== after[i]) break;
    score++;
  }
  return score;
}

/**
 * Locate an anchor in an index that was NOT built from the anchor's own
 * document — the editor holds a converted HTML copy, so structural xpaths and
 * node hashes don't apply and the occurrence count can drift (hidden readings,
 * editor-only text). Prefer the recorded occurrence, but fall back to the
 * best context match, so a jump still lands on the right mention when the
 * counts disagree instead of landing on the wrong one or nowhere at all.
 */
export function locateAnchorInIndex(
  index: DocIndex,
  anchor: Pick<Anchor, 'surface' | 'occurrence' | 'contextBefore' | 'contextAfter'>,
  surfaceOverride?: string,
): { node: Text; start: number; end: number } | null {
  const surface = surfaceOverride ?? anchor.surface;
  if (!surface) return null;

  const starts: number[] = [];
  for (let at = index.text.indexOf(surface); at !== -1; at = index.text.indexOf(surface, at + 1)) {
    starts.push(at);
  }
  if (starts.length === 0) return null;

  const scoreOf = (flatStart: number) =>
    flatContextScore(index, { ...anchor, surface } as Anchor, flatStart);

  const recorded = starts[anchor.occurrence - 1];
  if (recorded !== undefined) {
    const recordedScore = scoreOf(recorded);
    const contextLength = anchor.contextBefore.length + anchor.contextAfter.length;
    // The recorded occurrence wins unless its surroundings clearly disagree
    // and some other occurrence matches them better.
    if (contextLength === 0 || recordedScore >= Math.min(contextLength, CONTEXT_LENGTH)) {
      return rangeAtFlatPosition(index, recorded, surface.length);
    }
    let best = recorded;
    let bestScore = recordedScore;
    for (const start of starts) {
      const score = scoreOf(start);
      if (score > bestScore) {
        best = start;
        bestScore = score;
      }
    }
    return rangeAtFlatPosition(index, best, surface.length);
  }

  // Occurrence past the end of this index: fall back to the best context match.
  let best = starts[0]!;
  let bestScore = scoreOf(best);
  for (const start of starts) {
    const score = scoreOf(start);
    if (score > bestScore) {
      best = start;
      bestScore = score;
    }
  }
  return rangeAtFlatPosition(index, best, surface.length);
}

/**
 * Resolve an anchor against a (possibly edited) document, in tiers:
 * 1. XPath resolves and node hash matches → use stored offset.
 * 2. XPath resolves, hash differs → search within that node, context as tiebreaker.
 * 3. Whole-document search by occurrence index, context as tiebreaker.
 * Returns null when nothing verifies — the suggestion must then be marked unresolvable.
 */
export function resolveAnchor(
  doc: Document,
  anchor: Anchor,
  policy: WhitespacePolicy,
): ResolvedAnchor | null {
  const target = resolveXPath(doc, anchor.xpath);

  // Tier 1: unchanged node, verify surface at the stored offset.
  if (target) {
    const search = buildSearchText(target.data, policy);
    if (hashText(search.text) === anchor.nodeHash) {
      const searchIndex = search.map.indexOf(anchor.offset);
      if (searchIndex !== -1 && search.text.startsWith(anchor.surface, searchIndex)) {
        const { start, end } = rawRange(search, searchIndex, anchor.surface.length);
        return { node: target, start, end, tier: 1 };
      }
    }
  }

  const index = buildDocIndex(doc, policy);

  // Tier 2: node found but edited — search within it, context from the document stream.
  if (target) {
    const nodeIndex = index.nodes.findIndex((n) => n.node === target);
    if (nodeIndex !== -1) {
      const best = pickByContext(index, anchor, occurrences(index, anchor.surface, nodeIndex));
      if (best) return toResolved(index, best, anchor, 2);
    }
  }

  // Tier 3: whole-document search.
  const all = occurrences(index, anchor.surface);
  if (all.length === 0) return null;

  const byOccurrence = all[anchor.occurrence - 1];
  const chosen =
    byOccurrence && contextScore(index, anchor, byOccurrence) > 0
      ? byOccurrence
      : pickByContext(index, anchor, all);
  return chosen ? toResolved(index, chosen, anchor, 3) : null;
}

function toResolved(index: DocIndex, occ: Occurrence, anchor: Anchor, tier: 2 | 3): ResolvedAnchor {
  const docNode = index.nodes[occ.nodeIndex]!;
  const { start, end } = rawRange(docNode.search, occ.searchIndex, anchor.surface.length);
  return { node: docNode.node, start, end, tier };
}

/**
 * Pick the candidate whose context best matches the anchor. Requires a unique
 * winner with a positive score — even a lone candidate must show some context
 * agreement, since the xpath may have drifted onto the wrong node entirely.
 */
function pickByContext(
  index: DocIndex,
  anchor: Anchor,
  candidates: Occurrence[],
): Occurrence | null {
  const scored = candidates.map((occ) => ({ occ, score: contextScore(index, anchor, occ) }));
  scored.sort((a, b) => b.score - a.score);
  const [first, second] = scored;
  if (!first || first.score === 0) return null;
  if (second && second.score === first.score) return null;
  return first.occ;
}

interface XPathStep {
  kind: 'element' | 'text';
  name?: string;
  /** 1-based sibling index; omitted `[1]` on elements is treated as 1. */
  index: number;
}

function parseXPathStep(step: string): XPathStep | null {
  const textMatch = /^text\(\)\[(\d+)\]$/.exec(step);
  if (textMatch) return { kind: 'text', index: parseInt(textMatch[1]!, 10) };
  const elementMatch = /^([^[]+)(?:\[(\d+)\])?$/.exec(step);
  if (elementMatch) {
    return {
      kind: 'element',
      name: elementMatch[1]!,
      index: elementMatch[2] ? parseInt(elementMatch[2], 10) : 1,
    };
  }
  return null;
}

/** Compare structural text-node paths in document order (not lexicographic string order). */
export function compareXPath(a: string, b: string): number {
  const stepsA = a.replace(/^\//, '').split('/').filter(Boolean);
  const stepsB = b.replace(/^\//, '').split('/').filter(Boolean);
  const depth = Math.max(stepsA.length, stepsB.length);
  for (let i = 0; i < depth; i++) {
    if (i >= stepsA.length) return -1;
    if (i >= stepsB.length) return 1;
    const stepA = parseXPathStep(stepsA[i]!);
    const stepB = parseXPathStep(stepsB[i]!);
    if (!stepA || !stepB) return stepsA[i]!.localeCompare(stepsB[i]!);
    if (stepA.kind !== stepB.kind) return stepA.kind === 'element' ? -1 : 1;
    if (stepA.kind === 'element' && stepB.kind === 'element') {
      const nameCmp = stepA.name!.localeCompare(stepB.name!);
      if (nameCmp !== 0) return nameCmp;
    }
    if (stepA.index !== stepB.index) return stepA.index - stepB.index;
  }
  return 0;
}

/** Order anchors by where they sit in the document: xpath, then offset within the text node. */
export function compareAnchorsByDocumentPosition(a: Anchor, b: Anchor): number {
  const xpathCmp = compareXPath(a.xpath, b.xpath);
  if (xpathCmp !== 0) return xpathCmp;
  if (a.offset !== b.offset) return a.offset - b.offset;
  const surfaceCmp = a.surface.localeCompare(b.surface);
  if (surfaceCmp !== 0) return surfaceCmp;
  return a.occurrence - b.occurrence;
}
