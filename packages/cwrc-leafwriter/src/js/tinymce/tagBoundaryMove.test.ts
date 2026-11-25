import {
  boundaryZones,
  chooseBoundaryEdge,
  dragTagBoundaryTo,
  matchesTagBoundaryMove,
  moveTagBoundary,
  zoneAt,
} from './tagBoundaryMove';

const setup = (html: string) => {
  document.body.innerHTML = `<p id="p">${html}</p>`;
  const p = document.getElementById('p')!;
  const tag = p.querySelector('[_tag="seg"]') as Element;
  return { p, tag };
};

const html = (p: Element) => p.innerHTML;

describe('moveTagBoundary', () => {
  test('opening boundary grows left and shrinks right, one character at a time', () => {
    const { p, tag } = setup('ab<span _tag="seg">cd</span>ef');
    expect(moveTagBoundary(tag, 'start', 'left', document).moved).toBe(true);
    expect(html(p)).toBe('a<span _tag="seg">bcd</span>ef');
    expect(moveTagBoundary(tag, 'start', 'right', document).moved).toBe(true);
    expect(html(p)).toBe('ab<span _tag="seg">cd</span>ef');
  });

  test('closing boundary grows right and shrinks left', () => {
    const { p, tag } = setup('ab<span _tag="seg">cd</span>ef');
    moveTagBoundary(tag, 'end', 'right', document);
    expect(html(p)).toBe('ab<span _tag="seg">cde</span>f');
    moveTagBoundary(tag, 'end', 'left', document);
    moveTagBoundary(tag, 'end', 'left', document);
    expect(html(p)).toBe('ab<span _tag="seg">c</span>def');
  });

  test('a tag keeps at least one visible character', () => {
    const { p, tag } = setup('a<span _tag="seg">b</span>c');
    expect(moveTagBoundary(tag, 'end', 'left', document).moved).toBe(false);
    expect(moveTagBoundary(tag, 'start', 'right', document).moved).toBe(false);
    expect(html(p)).toBe('a<span _tag="seg">b</span>c');
  });

  test('stops at the parent edge', () => {
    const { p, tag } = setup('<span _tag="seg">cd</span>ef');
    expect(moveTagBoundary(tag, 'start', 'left', document).moved).toBe(false);
    expect(html(p)).toBe('<span _tag="seg">cd</span>ef');
  });

  test('moves whole graphemes, not code units', () => {
    const { p, tag } = setup('é<span _tag="seg">x</span>\u{20000}y');
    moveTagBoundary(tag, 'start', 'left', document);
    expect(html(p)).toBe('<span _tag="seg">éx</span>\u{20000}y');
    moveTagBoundary(tag, 'end', 'right', document);
    expect(html(p)).toBe('<span _tag="seg">éx\u{20000}</span>y');
  });

  test('takes a whole neighbouring inline element in, and pushes a nested one out', () => {
    const { p, tag } = setup('<span _tag="a">A</span><span _tag="seg">cd</span>');
    moveTagBoundary(tag, 'start', 'left', document);
    expect(html(p)).toBe('<span _tag="seg"><span _tag="a">A</span>cd</span>');
    moveTagBoundary(tag, 'start', 'right', document);
    expect(html(p)).toBe('<span _tag="a">A</span><span _tag="seg">cd</span>');
  });

  test('refuses to cross a block element', () => {
    const { p, tag } = setup('<span _tag="p">B</span><span _tag="seg">cd</span>');
    const isBlock = (node: Node) => (node as Element).getAttribute('_tag') === 'p';
    expect(moveTagBoundary(tag, 'start', 'left', document, isBlock).moved).toBe(false);
    expect(html(p)).toBe('<span _tag="p">B</span><span _tag="seg">cd</span>');
  });

  test('returns a caret just inside the boundary that moved', () => {
    const { tag } = setup('ab<span _tag="seg">cd</span>ef');
    const start = moveTagBoundary(tag, 'start', 'left', document).caret!;
    expect(start.node.parentElement).toBe(tag);
    expect(start.offset).toBe(0);
    const end = moveTagBoundary(tag, 'end', 'right', document).caret!;
    expect(end.node.parentElement).toBe(tag);
    expect(end.offset).toBe(end.node.length);
  });
});

describe('chooseBoundaryEdge', () => {
  test('picks the nearer boundary, ties going to the closing one', () => {
    const { tag } = setup('<span _tag="seg">abcd</span>');
    const text = tag.firstChild!;
    expect(chooseBoundaryEdge(tag, text, 0)).toBe('start');
    expect(chooseBoundaryEdge(tag, text, 1)).toBe('start');
    expect(chooseBoundaryEdge(tag, text, 2)).toBe('end');
    expect(chooseBoundaryEdge(tag, text, 4)).toBe('end');
  });
});

describe('matchesTagBoundaryMove', () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

  test('uses Ctrl+Option on Mac and Alt+Shift elsewhere, clear of the punctuation jump', () => {
    expect(
      matchesTagBoundaryMove(key({ code: 'ArrowLeft', ctrlKey: true, altKey: true }), true),
    ).toBe(true);
    expect(
      matchesTagBoundaryMove(key({ code: 'ArrowRight', altKey: true, shiftKey: true }), false),
    ).toBe(true);
    expect(matchesTagBoundaryMove(key({ code: 'ArrowRight', altKey: true }), true)).toBe(false);
    expect(matchesTagBoundaryMove(key({ code: 'ArrowRight', ctrlKey: true }), false)).toBe(false);
    expect(
      matchesTagBoundaryMove(key({ code: 'ArrowUp', altKey: true, shiftKey: true }), false),
    ).toBe(false);
  });
});

describe('dragTagBoundaryTo', () => {
  const textOf = (p: Element, selector: string) => p.querySelector(selector)!.firstChild as Text;

  test('drags the opening boundary left over text, and back right', () => {
    const { p, tag } = setup('abcd<span _tag="seg">ef</span>gh');
    const first = p.firstChild as Text;
    dragTagBoundaryTo(tag, 'start', { node: first, offset: 1 }, document);
    expect(html(p)).toBe('a<span _tag="seg">bcdef</span>gh');
    dragTagBoundaryTo(tag, 'start', { node: textOf(p, '[_tag="seg"]'), offset: 3 }, document);
    expect(html(p)).toBe('abcd<span _tag="seg">ef</span>gh');
  });

  test('drags the closing boundary right over text, and back left', () => {
    const { p, tag } = setup('ab<span _tag="seg">cd</span>efgh');
    dragTagBoundaryTo(tag, 'end', { node: p.lastChild!, offset: 3 }, document);
    expect(html(p)).toBe('ab<span _tag="seg">cdefg</span>h');
    dragTagBoundaryTo(tag, 'end', { node: textOf(p, '[_tag="seg"]'), offset: 3 }, document);
    expect(html(p)).toBe('ab<span _tag="seg">cde</span>fgh');
  });

  test('does nothing when the target is already at the boundary', () => {
    const { p, tag } = setup('ab<span _tag="seg">cd</span>ef');
    expect(dragTagBoundaryTo(tag, 'end', { node: p.lastChild!, offset: 0 }, document)).toBe(0);
    expect(dragTagBoundaryTo(tag, 'start', { node: p.firstChild!, offset: 2 }, document)).toBe(0);
    expect(html(p)).toBe('ab<span _tag="seg">cd</span>ef');
  });

  test('stops at the parent edge and never empties the tag', () => {
    const { p, tag } = setup('ab<span _tag="seg">cd</span>ef');
    dragTagBoundaryTo(tag, 'start', { node: p, offset: 0 }, document);
    expect(html(p)).toBe('<span _tag="seg">abcd</span>ef');
    dragTagBoundaryTo(tag, 'end', { node: tag, offset: 0 }, document);
    expect(html(p)).toBe('<span _tag="seg">a</span>bcdef');
  });

  test('takes a neighbouring element in whole and leaves it while the target is inside it', () => {
    const { p, tag } = setup('<span _tag="a">xyz</span><span _tag="seg">cd</span>');
    const inner = textOf(p, '[_tag="a"]');
    dragTagBoundaryTo(tag, 'start', { node: inner, offset: 1 }, document);
    expect(html(p)).toBe('<span _tag="seg"><span _tag="a">xyz</span>cd</span>');
    // The target is still inside the absorbed element: no flicker back out.
    expect(dragTagBoundaryTo(tag, 'start', { node: inner, offset: 1 }, document)).toBe(0);
    // Now past the element, it is pushed out again.
    dragTagBoundaryTo(tag, 'start', { node: tag.lastChild!, offset: 1 }, document);
    expect(html(p)).toBe('<span _tag="a">xyz</span>c<span _tag="seg">d</span>');
  });
});

describe('boundaryZones', () => {
  const rect = (left: number, right: number, top = 0, bottom = 20) =>
    ({ left, right, top, bottom, width: right - left, height: bottom - top }) as DOMRect;

  beforeEach(() => {
    // jsdom has no layout: the tag spans 10-80, its text 25-65.
    jest
      .spyOn(Element.prototype, 'getClientRects')
      .mockReturnValue([rect(10, 80)] as unknown as DOMRectList);
    (Range.prototype as unknown as { getClientRects: () => DOMRect[] }).getClientRects = function (
      this: Range,
    ) {
      return [this.startOffset === 0 ? rect(25, 33) : rect(57, 65)];
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
  });

  test('finds the labels as the gaps either side of the content', () => {
    const { tag } = setup('<span _tag="seg">abcdefgh</span>');
    const zones = boundaryZones(tag);
    expect(zones.start).toEqual({ left: 10, right: 25, top: 0, bottom: 20 });
    expect(zones.end).toEqual({ left: 65, right: 80, top: 0, bottom: 20 });
    expect(zoneAt(zones, 15, 10)).toBe('start');
    expect(zoneAt(zones, 70, 10)).toBe('end');
    expect(zoneAt(zones, 40, 10)).toBeNull();
    expect(zoneAt(zones, 15, 40)).toBeNull();
  });

  test('has no label zones when the tags are hidden (no gap)', () => {
    (Range.prototype as unknown as { getClientRects: () => DOMRect[] }).getClientRects = () => [
      rect(10, 18),
    ];
    const { tag } = setup('<span _tag="seg">abcdefgh</span>');
    expect(boundaryZones(tag).start).toBeNull();
  });
});

describe('boundaryZones with edge grab (labels hidden)', () => {
  const rect = (left: number, right: number) =>
    ({ left, right, top: 0, bottom: 20, width: right - left, height: 20 }) as DOMRect;

  beforeEach(() => {
    jest
      .spyOn(Element.prototype, 'getClientRects')
      .mockReturnValue([rect(10, 80)] as unknown as DOMRectList);
    (Range.prototype as unknown as { getClientRects: () => DOMRect[] }).getClientRects = function (
      this: Range,
    ) {
      return [this.startOffset === 0 ? rect(10, 18) : rect(72, 80)];
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
  });

  test('a narrow band at each end counts, and none without edge grab', () => {
    const { tag } = setup('<span _tag="seg">abcdefgh</span>');
    expect(boundaryZones(tag).start).toBeNull();
    const zones = boundaryZones(tag, true);
    expect(zoneAt(zones, 12, 10)).toBe('start');
    expect(zoneAt(zones, 8, 10)).toBe('start'); // a little outside the tag still counts
    expect(zoneAt(zones, 78, 10)).toBe('end');
    expect(zoneAt(zones, 45, 10)).toBeNull();
  });
});
