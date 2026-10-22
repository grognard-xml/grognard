import {
  boundaryArrowAction,
  caretAtEndOfTag,
  caretFromSelection,
  deleteFirstVisibleCodePoint,
  ensureOutsideText,
  insideStartText,
  insertAt,
  placeTypedText,
  pullCompositionInside,
  relocateCompositionOutside,
  tagEdgeText,
  type InsideStartSnapshot,
  type OutsideInsertSnapshot,
} from './tagBoundaryInput';

const host = (html: string): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};

describe('insideStartText', () => {
  it('finds offset 0 of an inline tag and ignores a paragraph', () => {
    const root = host('<span _tag="persName">Jean</span>');
    const text = root.querySelector('span')!.firstChild as Text;
    expect(insideStartText(text, 0)).toBe(text);
    expect(insideStartText(text, 1)).toBeNull();

    const block = host('<div _tag="p">Jean</div>');
    const blockText = block.querySelector('div')!.firstChild as Text;
    expect(insideStartText(blockText, 0)).toBeNull();
  });

  it('treats a combined entity div as an inline edge', () => {
    const root = host('<div _tag="p" _entity="true">Jean</div>');
    const text = root.querySelector('div')!.firstChild as Text;
    expect(insideStartText(text, 0)).toBe(text);
  });
});

describe('caretAtEndOfTag', () => {
  it("is true only at the end of the tag's own content", () => {
    const root = host('<span _tag="persName">Jean<em>x</em></span>');
    const tag = root.querySelector('span')!;
    const jean = tag.firstChild as Text;
    const nested = tag.querySelector('em')!.firstChild as Text;

    expect(caretAtEndOfTag(tag, jean, jean.length)).toBe(false);
    expect(caretAtEndOfTag(tag, jean, 0)).toBe(false);
    expect(caretAtEndOfTag(tag, nested, nested.length)).toBe(true);
  });
});

describe('deleteFirstVisibleCodePoint', () => {
  it('deletes one character and keeps a surrogate pair intact', () => {
    const text = document.createTextNode('Jean');
    expect(deleteFirstVisibleCodePoint(text)).toBe(true);
    expect(text.data).toBe('ean');

    const rare = document.createTextNode('𠀀子');
    expect(deleteFirstVisibleCodePoint(rare)).toBe(true);
    expect(rare.data).toBe('子');
  });

  it('leaves a one-character tag alone and skips a leading word-joiner', () => {
    const only = document.createTextNode('子');
    expect(deleteFirstVisibleCodePoint(only)).toBe(false);
    expect(only.data).toBe('子');

    const marked = document.createTextNode('\uFEFFJean');
    expect(deleteFirstVisibleCodePoint(marked)).toBe(true);
    expect(marked.data).toBe('\uFEFFean');
  });
});

describe('insert and caret helpers', () => {
  it('inserts outside a tag and creates a missing text node', () => {
    const root = host('ab<span _tag="persName">Jean</span>');
    const tag = root.querySelector('span')!;
    const before = tag.previousSibling as Text;
    const next = insertAt({ node: before, offset: before.length }, '子');
    expect(before.data).toBe('ab子');
    expect(next.offset).toBe(3);

    const after = ensureOutsideText(tag, 'after', document);
    expect(after.data).toBe('');
    expect(tag.nextSibling).toBe(after);
  });

  it('reads a caret that sits between element children', () => {
    const root = host('ab<span _tag="persName">Jean</span>cd');
    const atAfter = caretFromSelection(root, 2);
    expect(atAfter?.node.data).toBe('cd');
    expect(atAfter?.offset).toBe(0);

    const atBefore = caretFromSelection(root, 1);
    expect(atBefore?.node.data).toBe('ab');
    expect(atBefore?.offset).toBe(2);
  });

  it('finds the edge text TinyMCE would insert into', () => {
    const root = host('<span _tag="persName">Jean</span>');
    const tag = root.querySelector('span')!;
    expect(tagEdgeText(tag, 'after')?.data).toBe('Jean');
    expect(tagEdgeText(tag, 'before')?.data).toBe('Jean');
  });
});

describe('IME relocation', () => {
  const outsideSnap = (
    root: HTMLElement,
    side: 'before' | 'after',
    lengths: { outside: number; inside: number },
  ): OutsideInsertSnapshot => {
    const tag = root.querySelector('span')!;
    const outside = (side === 'after' ? tag.nextSibling : tag.previousSibling) as Text;
    return {
      kind: 'outside',
      outside,
      offset: side === 'after' ? 0 : outside.length,
      side,
      tag,
      insideEdge: tag.firstChild as Text,
      outsideLength: lengths.outside,
      insideLength: lengths.inside,
    };
  };

  it('leaves a commit that already landed outside the tag', () => {
    const root = host('<span _tag="persName">Jean</span>子cd');
    const snap = outsideSnap(root, 'after', { outside: 2, inside: 4 });
    const caret = relocateCompositionOutside('子', snap);
    expect(caret?.node.data).toBe('子cd');
    expect(caret?.offset).toBe(1);
    expect(root.querySelector('span')!.textContent).toBe('Jean');
  });

  it('moves a commit that grew the end of the tag', () => {
    const root = host('ab<span _tag="persName">Jean子</span>cd');
    const snap = outsideSnap(root, 'after', { outside: 2, inside: 4 });
    // The outside node in this fixture is "cd", and the caret offset for
    // "after" is 0. The snapshot offset must be 0, which outsideSnap sets.
    snap.offset = 0;
    const caret = relocateCompositionOutside('子', snap);
    expect(root.querySelector('span')!.textContent).toBe('Jean');
    expect(caret?.node.data).toBe('子cd');
    expect(caret?.offset).toBe(1);
  });

  it('does not steal a character that was already in the tag', () => {
    const root = host('ab<span _tag="persName">子</span>cd');
    const snap = outsideSnap(root, 'after', { outside: 2, inside: 1 });
    expect(relocateCompositionOutside('子', snap)).toBeNull();
    expect(root.querySelector('span')!.textContent).toBe('子');
    expect((root.querySelector('span')!.nextSibling as Text).data).toBe('cd');
  });

  it('pulls a commit from the previous text node back inside the tag', () => {
    const root = host('王子<span _tag="persName">Jean</span>');
    const tag = root.querySelector('span')!;
    const inside = tag.firstChild as Text;
    const previous = tag.previousSibling as Text;
    const snap: InsideStartSnapshot = {
      kind: 'inside-start',
      inside,
      previous,
      insideLength: 4,
      previousLength: 1,
    };
    const caret = pullCompositionInside('子', snap);
    expect(previous.data).toBe('王');
    expect(inside.data).toBe('子Jean');
    expect(caret?.offset).toBe(1);
  });

  it('inserts once, and does not insert again when the character is already there', () => {
    const root = host('ab<span _tag="persName">Jean</span>cd');
    const tag = root.querySelector('span')!;
    const outside = tag.nextSibling as Text;
    const inside = tag.firstChild as Text;
    const snap: OutsideInsertSnapshot = {
      kind: 'outside',
      outside,
      offset: 0,
      side: 'after',
      tag,
      insideEdge: inside,
      outsideLength: outside.length,
      insideLength: inside.length,
    };

    const typed = placeTypedText('子', snap, document);
    expect(typed?.node.data).toBe('子cd');
    expect(root.querySelector('span')!.textContent).toBe('Jean');

    const already: OutsideInsertSnapshot = {
      ...snap,
      offset: 0,
      outsideLength: 2,
      insideLength: 4,
    };
    const again = placeTypedText('子', already, document);
    expect(again?.offset).toBe(1);
    expect(outside.data).toBe('子cd');
  });
});

describe('boundaryArrowAction', () => {
  const inline = (el: Element) => el.getAttribute('_tag') !== 'p';

  it('steps into the next inline segment, and back out', () => {
    const root = host('用之是也。<span _tag="quote">秦曰了</span>');
    const before = root.firstChild as Text;
    const tag = root.querySelector('span')!;
    const inside = tag.firstChild as Text;

    expect(
      boundaryArrowAction({
        direction: 'forward',
        external: true,
        side: 'before',
        boundaryTag: tag,
        container: before,
        offset: before.length,
        isInlineEdge: inline,
      }),
    ).toBe('enter-start');

    expect(
      boundaryArrowAction({
        direction: 'backward',
        external: false,
        side: null,
        boundaryTag: null,
        container: inside,
        offset: 0,
        isInlineEdge: inline,
      }),
    ).toBe('leave-to-before');

    expect(
      boundaryArrowAction({
        direction: 'forward',
        external: false,
        side: null,
        boundaryTag: null,
        container: inside,
        offset: 0,
        isInlineEdge: inline,
      }),
    ).toBeNull();
  });

  it('does not invent a second position on a paragraph', () => {
    const root = host('<div _tag="p">用之是也。</div>');
    const paragraph = root.querySelector('div')!;
    const text = paragraph.firstChild as Text;
    expect(
      boundaryArrowAction({
        direction: 'forward',
        external: true,
        side: 'before',
        boundaryTag: paragraph,
        container: text,
        offset: text.length,
        isInlineEdge: inline,
      }),
    ).toBeNull();
  });

  it('steps out of the end of a segment into the following text', () => {
    const root = host('<span _tag="quote">秦曰了</span>今江東');
    const tag = root.querySelector('span')!;
    const inside = tag.firstChild as Text;
    expect(
      boundaryArrowAction({
        direction: 'forward',
        external: false,
        side: null,
        boundaryTag: null,
        container: inside,
        offset: inside.length,
        isInlineEdge: inline,
      }),
    ).toBe('leave-to-after');
  });
});
