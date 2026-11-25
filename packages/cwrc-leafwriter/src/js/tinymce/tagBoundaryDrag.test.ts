import { attachTagBoundaryDrag } from './tagBoundaryDrag';

const rect = (left: number, right: number) =>
  ({ left, right, top: 0, bottom: 20, width: right - left, height: 20 }) as DOMRect;

/**
 * The editor is an iframe: its elements, events and ranges belong to another window.
 * jsdom has no layout: the tag spans 10-80. With labels its text spans 25-65; without, 10-80.
 */
const makeEditorFrame = (labels: boolean) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const win = iframe.contentWindow!;
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = `<p>ab<span _tag="seg">cdefgh</span>ij</p>`;
  if (labels) doc.body.classList.add('showTags');
  (win as unknown as { Element: typeof Element }).Element.prototype.getClientRects = () =>
    [rect(10, 80)] as unknown as DOMRectList;
  (win as unknown as { Range: typeof Range }).Range.prototype.getClientRects = function (
    this: Range,
  ) {
    const atStart = this.startOffset === 0;
    if (labels) return [atStart ? rect(25, 33) : rect(57, 65)] as unknown as DOMRectList;
    return [atStart ? rect(10, 18) : rect(72, 80)] as unknown as DOMRectList;
  };
  // Pointer over the previous text, between "a" and "b".
  (doc as unknown as { caretRangeFromPoint: () => Range }).caretRangeFromPoint = () => {
    const range = doc.createRange();
    range.setStart(doc.querySelector('p')!.firstChild!, 1);
    return range;
  };
  return { doc, win, tag: doc.querySelector('[_tag="seg"]') as HTMLElement };
};

const setup = (labels: boolean) => {
  const frame = makeEditorFrame(labels);
  const onFinish = jest.fn();
  const beginUndoStep = jest.fn();
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as typeof window.requestAnimationFrame;
  attachTagBoundaryDrag({
    body: frame.doc.body,
    doc: frame.doc,
    isEnabled: () => true,
    tagsVisible: () => labels,
    isInlineTag: (el) => el.hasAttribute('_tag'),
    isImmovable: () => false,
    beginUndoStep,
    withoutUndo: (fn) => fn(),
    onFinish,
  });
  const mouse = (type: string, init: MouseEventInit) =>
    new (frame.win as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    });
  const drag = (x: number, altKey = false) => {
    frame.tag.dispatchEvent(
      mouse('mousedown', { button: 0, buttons: 1, clientX: x, clientY: 10, altKey }),
    );
    frame.doc.dispatchEvent(mouse('mousemove', { buttons: 1, clientX: 2, clientY: 10, altKey }));
    frame.tag.dispatchEvent(mouse('mouseup', { button: 0, clientX: 2, clientY: 10, altKey }));
  };
  return { ...frame, onFinish, beginUndoStep, drag };
};

const paragraph = (doc: Document) => doc.querySelector('p')!.innerHTML;

describe('attachTagBoundaryDrag', () => {
  test('finds a label in an iframe document and drags the boundary', () => {
    const { doc, tag, drag, beginUndoStep, onFinish } = setup(true);
    drag(15); // between the tag's left edge (10) and its text (25)
    expect(beginUndoStep).toHaveBeenCalledTimes(1);
    expect(paragraph(doc)).toBe('a<span _tag="seg">bcdefgh</span>ij');
    expect(onFinish).toHaveBeenCalledWith(tag, 'start');
  });

  test('a press on the text, not a label, does not start a drag', () => {
    const { drag, beginUndoStep } = setup(true);
    drag(45);
    expect(beginUndoStep).not.toHaveBeenCalled();
  });

  test('with the labels hidden, only an Alt press at the tag edge drags', () => {
    const plain = setup(false);
    plain.drag(12);
    expect(plain.beginUndoStep).not.toHaveBeenCalled();

    const withAlt = setup(false);
    withAlt.drag(12, true);
    expect(withAlt.beginUndoStep).toHaveBeenCalledTimes(1);
    expect(paragraph(withAlt.doc)).toBe('a<span _tag="seg">bcdefgh</span>ij');
    expect(withAlt.onFinish).toHaveBeenCalledWith(withAlt.tag, 'start');
  });

  test('Alt away from the edge does nothing, and Alt also works with labels shown', () => {
    const middle = setup(false);
    middle.drag(45, true);
    expect(middle.beginUndoStep).not.toHaveBeenCalled();

    const shown = setup(true);
    shown.drag(15, true);
    expect(shown.beginUndoStep).toHaveBeenCalledTimes(1);
  });
});
