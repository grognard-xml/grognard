import type { NodeDetail, Target as PossibleNodesAtTarget } from '@cwrc/leafwriter-validator';
import { TAG_TO_KIND } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import type { CustomThingType } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/thingTypePolicy';
import { DEFAULT_INSERT_TAG } from './keybindings';
import type { TagCommandMode } from './tagCommand';
import { getSelectionRange } from './taggerRuntime';

export interface EditorTagContext {
  element: Element;
  hasContentSelection: boolean;
  rng: Range;
  tagElement: Element | null;
}

const getWriter = () => window.writer;

const childIndexInElement = (element: Element, range: Range, end = false): number => {
  const container = end ? range.endContainer : range.startContainer;
  let node: Node | null = container;
  while (node && node.parentNode !== element) {
    node = node.parentNode;
  }
  if (!node) return 0;
  return Math.max(0, Array.from(element.childNodes).indexOf(node as ChildNode));
};

const ensureValidatorReady = async (): Promise<boolean> => {
  const writer = getWriter();
  const validatorActions = writer?.overmindActions?.validator;
  if (!validatorActions) return false;

  await validatorActions.loadValidator();

  return Boolean(
    writer?.overmindState?.validator?.hasWorkerValidator &&
    writer?.overmindState?.validator?.hasSchema,
  );
};

const syncValidatorState = async (): Promise<void> => {
  const validatorActions = getWriter()?.overmindActions?.validator;
  if (!validatorActions) return;
  await validatorActions.validate();
};

const findTaggedAncestor = (start: Node | null, body: Node): Element | null => {
  let node: Node | null = start;
  while (node && node !== body) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.hasAttribute('_tag')) return el;
    }
    node = node.parentNode;
  }
  return null;
};

export const getEditorTagContext = (): EditorTagContext | null => {
  const writer = getWriter();
  const editor = writer?.editor;
  // editor.selection doesn't exist until TinyMCE finishes initializing;
  // writer.editor is assigned earlier, in the init `setup` callback.
  if (!editor?.selection) return null;

  const body = editor.getBody();
  const rng = getSelectionRange(editor);
  const hasContentSelection = !rng.collapsed && rng.toString().length > 0;

  const tagElement =
    findTaggedAncestor(editor.selection.getNode(), body) ??
    findTaggedAncestor(rng.startContainer, body) ??
    findTaggedAncestor(rng.endContainer, body);

  const elementFromAncestor =
    rng.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (rng.commonAncestorContainer as Element)
      : rng.commonAncestorContainer.parentElement;

  const element =
    tagElement ?? (elementFromAncestor?.hasAttribute('_tag') ? elementFromAncestor : null);

  if (!element) return null;

  return { element, hasContentSelection, rng, tagElement: tagElement ?? element };
};

export const buildValidatorTarget = (
  mode: TagCommandMode,
  ctx: EditorTagContext,
): PossibleNodesAtTarget | null => {
  const writer = getWriter();
  if (!writer) return null;

  const { element, hasContentSelection, rng, tagElement } = ctx;

  if (mode === 'rename') {
    if (!tagElement?.parentNode) return null;
    const parentNode = tagElement.parentNode as Element;
    const xpath = writer.utilities.getElementXPath(parentNode);
    if (!xpath) return null;

    const elementChildren = Array.from(parentNode.childNodes);
    const index = elementChildren.findIndex((child) => child === tagElement);
    const selectionXpath = writer.utilities.getElementXPath(tagElement);
    const skip = tagElement.getAttribute('_tag') ?? undefined;

    return {
      xpath,
      index,
      selection: {
        type: 'change',
        xpath: selectionXpath ?? '',
        startContainerIndex: 0,
        endContainerIndex: elementChildren.length,
        skip,
      },
    };
  }

  if (mode === 'wrap' && hasContentSelection) {
    const xpath = writer.utilities.getElementXPath(element);
    if (!xpath) return null;

    const index = childIndexInElement(element, rng);
    const endContainerIndex = childIndexInElement(element, rng, true);

    const request: PossibleNodesAtTarget = { xpath, index };
    request.selection = {
      type: 'span',
      startContainerIndex: index,
      startOffset: rng.startOffset,
      endContainerIndex,
      endOffset: rng.endOffset,
    };
    return request;
  }

  // insert / lineBreak — tags valid inside the current structural element (match context menu)
  const targetElement = tagElement ?? element;
  const xpath = writer.utilities.getElementXPath(targetElement);
  if (!xpath) return null;

  const elementChildren = Array.from(targetElement.childNodes);
  let startContainerIndex = 0;
  let endContainerIndex = Math.max(0, elementChildren.length - 1);

  const childIndexForNode = (node: Node): number => {
    if (node.nodeType === Node.TEXT_NODE) {
      return elementChildren.indexOf(node as ChildNode);
    }
    let current: Node | null = node;
    while (current && current.parentNode !== targetElement) {
      current = current.parentNode;
    }
    return current ? elementChildren.indexOf(current as ChildNode) : -1;
  };

  if (rng.collapsed && rng.startContainer.nodeType === Node.TEXT_NODE) {
    const textIndex = childIndexForNode(rng.startContainer);
    if (textIndex >= 0) {
      startContainerIndex = textIndex;
      endContainerIndex = textIndex;
    }
  } else if (!rng.collapsed) {
    const startIdx = childIndexForNode(rng.startContainer);
    const endIdx = childIndexForNode(rng.endContainer);
    if (startIdx >= 0) startContainerIndex = startIdx;
    if (endIdx >= 0) endContainerIndex = endIdx;
  }

  return {
    xpath,
    index: 0,
    selection: {
      type: 'inside',
      xpath,
      startContainerIndex,
      endContainerIndex,
    },
  };
};

export const buildInsertAfterTarget = (ctx: EditorTagContext): PossibleNodesAtTarget | null => {
  const writer = getWriter();
  if (!writer) return null;

  const targetElement = ctx.tagElement ?? ctx.element;
  const parentNode = targetElement.parentNode as Element | null;
  if (!parentNode) return null;

  const xpath = writer.utilities.getElementXPath(parentNode);
  if (!xpath) return null;

  const elementChildren = Array.from(parentNode.childNodes);
  const index = elementChildren.findIndex((child) => child === targetElement);

  return {
    xpath,
    index: index >= 0 ? index : 0,
    selection: {
      type: 'after',
      xpath,
      containerIndex: index >= 0 ? index : 0,
    },
  };
};

export const syncValidatorDocument = async (): Promise<void> => {
  if (!(await ensureValidatorReady())) return;
  await syncValidatorState();
};

export const fetchTagSuggestions = async (
  target: PossibleNodesAtTarget | null,
): Promise<NodeDetail[]> => {
  if (!target) {
    return [];
  }

  const writer = getWriter();
  const validatorActions = writer?.overmindActions?.validator;

  try {
    const ready = await ensureValidatorReady();
    if (!ready || !validatorActions) return [];

    await syncValidatorState();

    const nodes =
      (await validatorActions.getPossibleNodesAt(target)) ??
      (
        await window.leafwriterValidator?.getPossibleNodesAt(target, {
          speculativeValidate: true,
        })
      )?.nodes?.filter((node: NodeDetail) => node.type === 'tag') ??
      [];

    return nodes.filter((node: NodeDetail) => node.type === 'tag');
  } catch {
    return [];
  }
};

export const pinParagraphInsertOption = (
  tags: NodeDetail[],
  mode: TagCommandMode,
  ctx: EditorTagContext | null,
): NodeDetail[] => {
  if ((mode !== 'insert' && mode !== 'lineBreak') || !ctx) return tags;

  const body = getWriter()?.editor?.getBody();
  if (!body) return tags;

  let current: Node | null = ctx.rng.startContainer;
  let paragraph: Element | null = null;
  while (current && current !== body) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element;
      if (el.getAttribute('_tag') === DEFAULT_INSERT_TAG) {
        paragraph = el;
        break;
      }
    }
    current = current.parentNode;
  }
  if (!paragraph) return tags;

  const pinned: NodeDetail = {
    name: DEFAULT_INSERT_TAG,
    type: 'tag',
    eventType: 'enterStartTag',
    invalid: false,
  };
  return [pinned, ...tags.filter((tag) => tag.name !== DEFAULT_INSERT_TAG)];
};

export const withInsertModeFallbacks = (
  tags: NodeDetail[],
  mode: TagCommandMode,
  ctx: EditorTagContext | null,
): NodeDetail[] => {
  if ((mode !== 'insert' && mode !== 'lineBreak') || tags.length > 0 || !ctx?.tagElement) {
    return tags;
  }

  const parentTag = ctx.tagElement.getAttribute('_tag');
  if (parentTag === DEFAULT_INSERT_TAG) {
    return [
      {
        name: DEFAULT_INSERT_TAG,
        type: 'tag',
        eventType: 'enterStartTag',
        invalid: false,
      },
    ];
  }

  return tags;
};

/**
 * Splice one synthetic suggestion per project-defined thing sub-type into the
 * Enter-popup's suggestion list — e.g. "Medicinal plant" alongside the plain
 * `rs` entry. Each carries `.name === 'rs'` (so schema validity / insert-vs-
 * wrap placement resolution treats it exactly like the real `rs` suggestion)
 * plus a `displayLabel` and `attributeOverrides: { type: <the type's id> }`
 * that override the generic `type="thing"` default on apply. Not from the
 * schema validator — same synthesis pattern as `pinParagraphInsertOption`.
 */
export const withCustomThingTypeOptions = (
  tags: NodeDetail[],
  customTypes: readonly CustomThingType[],
): NodeDetail[] => {
  if (customTypes.length === 0) return tags;
  if (!tags.some((tag) => tag.name === 'rs' && !tag.invalid)) return tags;
  return [
    ...tags,
    ...customTypes.map((customType): NodeDetail => ({
      name: 'rs',
      type: 'tag',
      eventType: 'enterStartTag',
      invalid: false,
      displayLabel: customType.label,
      attributeOverrides: { type: customType.id },
    })),
  ];
};

/**
 * `<respStmt>` must contain a `<resp>`, and `<resp>` is only valid inside `<respStmt>`, so
 * the validator can never approve creating a `<respStmt>` around or at plain content.
 * Whenever the schema lists it for this position at all, let it be chosen; the `<resp>`
 * and name are then added inside it, where the validator does accept them.
 */
export const withRespStmtOption = (tags: NodeDetail[]): NodeDetail[] =>
  tags.map((tag) => (tag.name === 'respStmt' && tag.invalid ? { ...tag, invalid: false } : tag));

export const sortTagSuggestions = (
  tags: NodeDetail[],
  tagCounts: Record<string, number>,
  preferredName?: string,
): NodeDetail[] => {
  const sorted = [...tags].sort((a, b) => {
    if (a.invalid !== b.invalid) return a.invalid ? 1 : -1;
    const aCount = tagCounts[a.name] ?? 0;
    const bCount = tagCounts[b.name] ?? 0;
    if (aCount !== bCount) return bCount - aCount;
    return a.name.localeCompare(b.name);
  });

  if (!preferredName) return sorted;

  const preferredIndex = sorted.findIndex((tag) => tag.name === preferredName);
  if (preferredIndex <= 0) return sorted;

  const [preferred] = sorted.splice(preferredIndex, 1);
  return [preferred, ...sorted];
};

/**
 * Entity-kind label → the TEI tag name(s) it's tagged with. Lets a user type
 * the kind's familiar name (e.g. "thing") in the Enter-popup filter even when
 * it shares no substring with its actual tag name — true for `rs`/"thing"
 * (and, less obviously, for `title`/"work" and `roleName`/"office" too).
 */
const KIND_LABEL_TO_TAGS: Record<string, string[]> = (() => {
  const byKind: Record<string, string[]> = {};
  for (const [tagName, kind] of Object.entries(TAG_TO_KIND)) {
    (byKind[kind] ??= []).push(tagName);
  }
  return { ...byKind, organization: byKind.org ?? [] };
})();

export const filterTagSuggestions = (tags: NodeDetail[], query: string): NodeDetail[] => {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return tags;
  const kindAliasedTags = new Set(KIND_LABEL_TO_TAGS[trimmed] ?? []);
  const matchRank = (tag: NodeDetail): number | null => {
    const name = tag.name.toLowerCase();
    const fullName = tag.fullName?.toLowerCase();
    const label = tag.displayLabel?.toLowerCase();
    // Synthetic thing-type entries all share tag.name === 'rs', so they must
    // be matched on their own displayLabel rather than the shared tag name —
    // otherwise typing a custom type's label would also surface every other
    // rs-tagged suggestion, and typing "rs"/"thing" would surface all of them
    // indiscriminately instead of just the plain generic entry.
    if (label?.startsWith(trimmed)) return 0;
    if (kindAliasedTags.has(tag.name) && !tag.displayLabel) return 0;
    if (name.startsWith(trimmed) && !tag.displayLabel) return 0;
    if (fullName?.startsWith(trimmed)) return 1;
    if (label?.includes(trimmed)) return 2;
    if (name.includes(trimmed) && !tag.displayLabel) return 2;
    if (fullName?.includes(trimmed)) return 3;
    return null;
  };

  return tags
    .map((tag, index) => ({ index, rank: matchRank(tag), tag }))
    .filter(
      (entry): entry is { index: number; rank: number; tag: NodeDetail } => entry.rank !== null,
    )
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.tag);
};

export const getDefaultHighlightIndex = (
  tags: NodeDetail[],
  mode: TagCommandMode,
  lastUsedTag: string | null,
): number => {
  if (tags.length === 0) return 0;

  const preferred = mode === 'insert' || mode === 'lineBreak' ? DEFAULT_INSERT_TAG : lastUsedTag;

  if (!preferred) return 0;
  const index = tags.findIndex((tag) => tag.name === preferred && !tag.invalid);
  return index >= 0 ? index : 0;
};
