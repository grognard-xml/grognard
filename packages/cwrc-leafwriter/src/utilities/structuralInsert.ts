import type Writer from '../js/Writer';
import { placeCaretAfterElement } from './glyphEditor';

/**
 * Every `_tag`-bearing ancestor of `node`, innermost first, stopping at
 * (not including) `root` - the same boundary convention as
 * `findTagNameFromNode` in tinymceWrapper.ts, so "where does the document's
 * structure start" stays consistent across the codebase.
 */
const taggedAncestors = (node: Node, root: Node): Element[] => {
  const chain: Element[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE && (current as Element).hasAttribute('_tag')) {
      chain.push(current as Element);
    }
    current = current.parentNode;
  }
  return chain;
};

const tagOf = (el: Element): string => el.getAttribute('_tag') ?? '';

const seedIfEmpty = (el: Element) => {
  if (el.childNodes.length === 0) {
    el.appendChild(el.ownerDocument.createTextNode('﻿'));
  }
};

/**
 * Reassigns a fresh tagger id to `clone` (a shallow copy of a split
 * element) and strips any `xml:id` it inherited from the original - an
 * `xml:id` must be document-unique, so duplicating it onto the split-off
 * half would corrupt the document even though the DOM `id`/`_attributes`
 * copy cleanly otherwise.
 */
const rekeyClone = (writer: Writer, clone: Element): void => {
  clone.id = writer.getUniqueId('dom_');
  if (!clone.hasAttribute('xml:id')) return;
  clone.removeAttribute('xml:id');
  const rawAttrs = clone.getAttribute('_attributes');
  if (!rawAttrs) return;
  try {
    const attrs = JSON.parse(rawAttrs.replace(/&quot;/g, '"'));
    delete attrs['xml:id'];
    clone.setAttribute('_attributes', JSON.stringify(attrs).replace(/"/g, '&quot;'));
  } catch {
    // Leave _attributes as-is if it doesn't parse - nothing to safely fix up.
  }
};

/**
 * `Range.extractContents()` clones (rather than moves) any ancestor that's
 * only *partially* inside the range - e.g. the cursor sitting in the middle
 * of an inline `<persName>` span that itself isn't being split. That clone
 * keeps the same tagger `id` as the original it was cloned from, which is
 * still live in the document: a real, if rare, id collision (entity
 * lookups and `addStructureTag`'s own `#id` selectors key off this being
 * unique). Anything in `fragment` whose id still resolves elsewhere in the
 * live document is one of these clones, not a moved node - give it a fresh
 * id before it lands in the DOM.
 */
const deduplicateClonedIds = (writer: Writer, fragment: DocumentFragment): void => {
  const doc = fragment.ownerDocument;
  for (const el of Array.from(fragment.querySelectorAll('[id]'))) {
    const id = el.getAttribute('id');
    if (id && doc.getElementById(id)) {
      rekeyClone(writer, el);
    }
  }
};

/**
 * Splits `el` into two sibling elements at the cursor position given by
 * `range` (must be collapsed, inside `el`'s subtree). `el` keeps everything
 * before the cursor; a new element, inserted immediately after it, gets a
 * fresh id and everything from the cursor onward. Neither half is left
 * truly empty (same reasoning as a freshly-inserted structure tag - an
 * empty element can be pruned by TinyMCE) unless it already held nothing
 * to begin with, seeded with a placeholder like `addStructureTag` does.
 */
export const splitElementAtRange = (writer: Writer, el: Element, range: Range): Element => {
  const doc = el.ownerDocument;
  const tailRange = doc.createRange();
  tailRange.setStart(range.startContainer, range.startOffset);
  tailRange.setEnd(el, el.childNodes.length);
  const tailFragment = tailRange.extractContents();
  deduplicateClonedIds(writer, tailFragment);

  const secondHalf = el.cloneNode(false) as Element;
  rekeyClone(writer, secondHalf);
  secondHalf.appendChild(tailFragment);

  el.parentNode?.insertBefore(secondHalf, el.nextSibling);

  seedIfEmpty(el);
  seedIfEmpty(secondHalf);

  return secondHalf;
};

const divTypeOf = (el: Element): string => {
  const direct = el.getAttribute('type');
  if (direct) return direct;
  const raw = el.getAttribute('_attributes');
  if (!raw) return '';
  try {
    return String(JSON.parse(raw.replace(/&quot;/g, '"')).type ?? '');
  } catch {
    return '';
  }
};

/**
 * Moves everything from `range` to the end of `el` into a new, untyped child
 * `<div>` appended inside `el` (instead of a sibling clone, see
 * `splitElementAtRange`), so a `type="juan"` wrapper is never duplicated.
 */
const nestTailInNewDiv = (writer: Writer, el: Element, range: Range, type?: string): Element => {
  const doc = el.ownerDocument;
  const tailRange = doc.createRange();
  tailRange.setStart(range.startContainer, range.startOffset);
  tailRange.setEnd(el, el.childNodes.length);
  const tailFragment = tailRange.extractContents();
  deduplicateClonedIds(writer, tailFragment);

  const child = el.cloneNode(false) as Element;
  rekeyClone(writer, child);
  child.removeAttribute('type');
  if (type) child.setAttribute('type', type);
  const rawAttrs = child.getAttribute('_attributes');
  if (rawAttrs || type) {
    try {
      const attrs = rawAttrs ? JSON.parse(rawAttrs.replace(/&quot;/g, '"')) : {};
      delete attrs.type;
      if (type) attrs.type = type;
      child.setAttribute('_attributes', JSON.stringify(attrs).replace(/"/g, '&quot;'));
    } catch {
      // Leave _attributes as-is if it doesn't parse.
    }
  }
  child.appendChild(tailFragment);
  el.appendChild(child);
  seedIfEmpty(child);
  return child;
};

/**
 * Splits the nearest `paragraphTagName`-tagged ancestor of the cursor into
 * two siblings at the cursor position - a plain structural break, nothing
 * new inserted between them. The cursor ends up at the start of the second
 * half, same as pressing Enter in a plain-text editor.
 */
export const splitParagraphAtCursor = (writer: Writer, paragraphTagName = 'p'): boolean => {
  const editor = writer.editor;
  const body = editor?.getBody();
  if (!editor || !body) return false;

  //@ts-expect-error tinymce types omit getRng(true), which still exists at runtime
  const range: Range = editor.selection.getRng(true);
  const cursor = range.collapsed
    ? range
    : (() => {
        const collapsed = range.cloneRange();
        collapsed.collapse(true);
        return collapsed;
      })();

  const target = taggedAncestors(cursor.startContainer, body).find(
    (el) => tagOf(el) === paragraphTagName,
  );
  if (!target) return false;

  const secondHalf = splitElementAtRange(writer, target, cursor);
  writer.tagger.processNewContent(body);

  const afterRange = editor.dom.createRng();
  afterRange.setStart(secondHalf, 0);
  afterRange.collapse(true);
  editor.selection.setRng(afterRange);

  writer.event('contentChanged').publish();
  return true;
};

/**
 * The text of a non-collapsed selection that lies within a single
 * structural block (e.g. one paragraph), or null. Used to turn selected
 * paragraph text into a heading; selections spanning several blocks are
 * ignored since deleting them would merge or mangle the structure.
 */
/**
 * Shrinks `range` to the text it actually covers. Browsers (and TinyMCE)
 * report whole-line / triple-click selections with the end at offset 0 of
 * the *next* block, or the start at the end of the previous one, which
 * would make a one-paragraph selection look like it spans several.
 */
const trimRangeToText = (range: Range, body: Node): Range => {
  const trimmed = range.cloneRange();
  const doc = body.ownerDocument ?? document;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (trimmed.intersectsNode(n)) textNodes.push(n as Text);
  }
  const isEmptyText = (n: Text) => n.data.replace(/\uFEFF/g, '') === '';
  const within = (n: Text) => {
    const from = n === trimmed.startContainer ? trimmed.startOffset : 0;
    const to = n === trimmed.endContainer ? trimmed.endOffset : n.length;
    return to > from && n.data.slice(from, to).replace(/\uFEFF/g, '') !== '';
  };
  const real = textNodes.filter((n) => !isEmptyText(n) && within(n));
  if (real.length === 0) return trimmed;
  const first = real[0];
  const last = real[real.length - 1];
  trimmed.setStart(first, first === range.startContainer ? range.startOffset : 0);
  trimmed.setEnd(last, last === range.endContainer ? range.endOffset : last.length);
  return trimmed;
};

export const getSingleBlockSelectionText = (writer: Writer): string | null => {
  const editor = writer.editor;
  const body = editor?.getBody();
  if (!editor || !body) return null;
  //@ts-expect-error tinymce types omit getRng(true), which still exists at runtime
  const raw: Range = editor.selection.getRng(true);
  if (raw.collapsed) return null;
  const range = trimRangeToText(raw, body);
  const startOwner = taggedAncestors(range.startContainer, body)[0];
  const endOwner = taggedAncestors(range.endContainer, body)[0];
  if (!startOwner || startOwner !== endOwner) return null;
  const text = range
    .toString()
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
};

const isEmptyShell = (el: Element): boolean =>
  (el.textContent ?? '').replace(/[\uFEFF\s]/g, '') === '' &&
  Array.from(el.querySelectorAll('[_tag]')).every((d) => ['p', 'div'].includes(tagOf(d)));

/**
 * Inserts `tagName` at the cursor in the position the active schema
 * actually allows it, rather than wherever the cursor happens to be. Walks
 * outward from the innermost structural ancestor and splits every level
 * the new element isn't a valid child of (e.g. `<head>` isn't a valid
 * child of `<p>` on any registered schema, but is of `<div>` - so a `<p>`
 * gets split in two around the new `<head>`, exactly like a real editor
 * splitting a paragraph to make room for a heading), stopping at the first
 * level that does validly contain it. Returns false without changing the
 * document if no ancestor (up to the document root) can contain it.
 */
export const insertStructuralElementAtCursor = (
  writer: Writer,
  tagName: string,
  attributes: Record<string, unknown> = {},
  options: { text?: string; replaceSelection?: boolean; nestSubsection?: boolean } = {},
): boolean => {
  const editor = writer.editor;
  const body = editor?.getBody();
  if (!editor || !body) return false;

  //@ts-expect-error tinymce types omit getRng(true), which still exists at runtime
  const rawRange: Range = editor.selection.getRng(true);
  const replacing = Boolean(options.replaceSelection) && !rawRange.collapsed;
  const range = replacing ? trimRangeToText(rawRange, body) : rawRange;
  if (replacing) {
    // The selected text becomes the heading (passed in as options.text), so
    // remove it from the paragraph; the range collapses to where it was.
    range.deleteContents();
  }
  const cursor = range.collapsed
    ? range
    : (() => {
        const collapsed = range.cloneRange();
        collapsed.collapse(true);
        return collapsed;
      })();

  const chain = taggedAncestors(cursor.startContainer, body);
  if (chain.length === 0) return false;

  const schemaManager = writer.schemaManager;
  const targetIndex = chain.findIndex((el) =>
    schemaManager.isTagValidChildOfParent(tagName, tagOf(el)),
  );
  if (targetIndex === -1) return false;

  let boundary = cursor;
  for (let i = 0; i < targetIndex; i++) {
    const secondHalf = splitElementAtRange(writer, chain[i], boundary);
    const parent = chain[i].parentNode;
    if (!parent) return false;
    const index = Array.prototype.indexOf.call(parent.childNodes, secondHalf);
    const nextBoundary = editor.dom.createRng();
    nextBoundary.setStart(parent, index);
    nextBoundary.collapse(true);
    boundary = nextBoundary;
  }

  // In TEI a `<head>` must open its `<div>`: it's schema-valid as a child of
  // `<div>` but not after body content. When the cursor sits mid-section,
  // split the div too so the heading starts a new section instead of
  // landing after the preceding paragraphs ("Tag head not allowed in div").
  const container = chain[targetIndex];
  if (tagName === 'head' && tagOf(container) === 'div') {
    const before = container.ownerDocument.createRange();
    before.setStart(container, 0);
    before.setEnd(boundary.startContainer, boundary.startOffset);
    const prefix = before.cloneContents();
    const hasLeadingContent =
      Array.from(prefix.querySelectorAll('[_tag]')).some((el) => tagOf(el) !== 'head') ||
      (prefix.textContent ?? '').replace(/\uFEFF/g, '').trim() !== '';
    // `nestSubsection` opens a subsection inside the current section div. When the cursor is
    // already inside a subsection, the next one is its sibling (split, which keeps the type),
    // not a child of it.
    if (hasLeadingContent || options.nestSubsection) {
      // A `type="juan"` div is the document's top-level wrapper (the Kanripo
      // dialogs and importers address "the juan div" by that attribute), so
      // it must stay unique: nest the new section inside it rather than
      // cloning it into a sibling juan.
      const secondDiv =
        divTypeOf(container) === 'juan' ||
        (options.nestSubsection && divTypeOf(container) !== 'subsection')
          ? nestTailInNewDiv(
              writer,
              container,
              boundary,
              options.nestSubsection ? 'subsection' : undefined,
            )
          : splitElementAtRange(writer, container, boundary);
      const nextBoundary = editor.dom.createRng();
      nextBoundary.setStart(secondDiv, 0);
      nextBoundary.collapse(true);
      boundary = nextBoundary;
    }
  }
  writer.tagger.processNewContent(body);

  editor.selection.setRng(boundary);
  const bookmark = editor.selection.getBookmark(1);
  const newTag = writer.tagger.addStructureTag({
    action: writer.tagger.ADD,
    tagName,
    attributes,
    bookmark,
  });
  if (!newTag?.id) return false;

  if (!schemaManager.canTagContainText(tagName)) {
    // Milestone-like element (e.g. `pb`/`lb`): addStructureTag always seeds
    // a `\uFEFF` sentinel so the tag isn't pruned, but the schema says this
    // one can never hold text at all. Clear it and treat the tag as an
    // atomic, non-editable widget - the same fix (and for the same reason:
    // a caret left inside a textless element breaks click-to-select and
    // Backspace-to-delete, and piles a second insert into the first) that
    // glyph inserts needed - see placeCaretAfterElement's doc comment.
    newTag.setAttribute('_textallowed', 'false');
    newTag.setAttribute('contenteditable', 'false');
    for (const child of Array.from(newTag.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) newTag.removeChild(child);
    }
    placeCaretAfterElement(writer, newTag);
  } else if (options.text) {
    // Text was already collected up front (e.g. the heading-text prompt) -
    // replace the `\uFEFF` sentinel with it instead of leaving the tag
    // empty for in-place typing.
    newTag.textContent = options.text;
  }
  // Otherwise (e.g. an empty `head`) addStructureTag already leaves the
  // caret inside the new tag's sentinel content, ready for the user to type.

  let trailingParagraph: Element | null = null;
  if (
    tagName === 'head' &&
    !newTag.nextElementSibling &&
    newTag.parentElement &&
    schemaManager.isTagValidChildOfParent('p', tagOf(newTag.parentElement))
  ) {
    // A heading with nothing after it - typically because it was inserted
    // at the very end of a document/section, where there was no following
    // <p> to split - reads as broken (a section that's just a title with no
    // body). Give it an empty paragraph to write into, same as splitting
    // would have produced if there'd been content after the cursor.
    trailingParagraph = writer.tagger.addStructureTag({
      action: writer.tagger.AFTER,
      tagName: 'p',
      attributes: {},
      bookmark: { tagId: newTag.id },
    });
  }

  if (tagName === 'head' && options.text) {
    // The heading's text already came from the prompt, so there's nothing
    // left to type into it - move on to the paragraph after it (either the
    // one just created above, or the one the initial split produced).
    const nextParagraph = trailingParagraph ?? newTag.nextElementSibling;
    if (nextParagraph) {
      const rng = editor.dom.createRng();
      rng.setStart(nextParagraph, 0);
      rng.collapse(true);
      editor.selection.setRng(rng);
    }
  }

  if (replacing) {
    // Selecting from the start of a paragraph leaves an empty shell before
    // the heading (an empty <p>, or a whole <div> holding only one).
    const before =
      newTag.previousElementSibling ??
      (newTag.parentElement && !newTag.previousElementSibling
        ? newTag.parentElement.previousElementSibling
        : null);
    if (before && isEmptyShell(before)) before.remove();
    // ...and likewise when the selection ran to the end of the paragraph.
    const after = newTag.nextElementSibling;
    if (after && tagOf(after) === 'p' && isEmptyShell(after) && after !== trailingParagraph) {
      after.remove();
    }
  }

  writer.event('contentChanged').publish();
  return true;
};
