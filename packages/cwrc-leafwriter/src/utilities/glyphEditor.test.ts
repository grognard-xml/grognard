import { placeCaretAfterElement } from './glyphEditor';
import type Writer from '../js/Writer';

/**
 * Regression test for the glyph-insert caret bug: inserting a second glyph
 * right after a first one piled it inside the first instead of placing it
 * beside it, because addStructureTag's default ADD path leaves the
 * selection *inside* the newly-inserted (content-forbidden) glyph element.
 * placeCaretAfterElement is the fix - this checks it actually moves the
 * range to just after the element, not merely that it doesn't throw.
 */
describe('placeCaretAfterElement', () => {
  const makeFakeWriter = (body: HTMLElement): { writer: Writer; setRng: jest.Mock } => {
    const setRng = jest.fn();
    const writer = {
      editor: {
        getBody: () => body,
        dom: { createRng: () => document.createRange() },
        selection: { setRng },
      },
    } as unknown as Writer;
    return { writer, setRng };
  };

  it('collapses the selection to just after the given element', () => {
    document.body.innerHTML = '<div id="root">before<span id="glyph">x</span>after</div>';
    const root = document.getElementById('root')!;
    const glyph = document.getElementById('glyph')!;
    const { writer, setRng } = makeFakeWriter(root);

    placeCaretAfterElement(writer, glyph);

    expect(setRng).toHaveBeenCalledTimes(1);
    const rng = setRng.mock.calls[0][0] as Range;
    expect(rng.collapsed).toBe(true);
    expect(rng.startContainer).toBe(root);
    expect(rng.startOffset).toBe(Array.from(root.childNodes).indexOf(glyph) + 1);
  });

  it('does nothing when the element is not attached to the document', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const detached = document.createElement('span');
    const { writer, setRng } = makeFakeWriter(root);

    placeCaretAfterElement(writer, detached);

    expect(setRng).not.toHaveBeenCalled();
  });

  it('does nothing when given a null element', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const { writer, setRng } = makeFakeWriter(root);

    placeCaretAfterElement(writer, null);

    expect(setRng).not.toHaveBeenCalled();
  });
});
