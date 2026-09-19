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
): boolean => {
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
  }
  // Otherwise (e.g. `head`) addStructureTag already leaves the caret inside
  // the new tag's sentinel content, ready for the user to type its text.

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
    writer.tagger.addStructureTag({
      action: writer.tagger.AFTER,
      tagName: 'p',
      attributes: {},
      bookmark: { tagId: newTag.id },
    });
  }

  writer.event('contentChanged').publish();
  return true;
};
