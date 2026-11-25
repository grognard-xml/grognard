import { chooseBoundaryEdge, matchesTagBoundaryMove, moveTagBoundary } from './tagBoundaryMove';

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
