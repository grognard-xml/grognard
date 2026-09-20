import { CHHIV_SYMBOLS, insertAtCursor, insertBracketPair } from './chhivSymbols';
import type Writer from '../js/Writer';

const makeFakeWriter = (selectedText = ''): { writer: Writer; setContent: jest.Mock } => {
  const setContent = jest.fn();
  let rangeStartOffset = 5;
  const editor = {
    selection: {
      setContent,
      getContent: () => selectedText,
      getRng: () => ({
        startContainer: { nodeType: Node.TEXT_NODE },
        startOffset: rangeStartOffset,
        setStart: (_node: unknown, offset: number) => {
          rangeStartOffset = offset;
        },
        setEnd: () => {},
      }),
      setRng: () => {},
    },
    focus: jest.fn(),
  };
  const writer = {
    editor,
    event: () => ({ publish: jest.fn() }),
  } as unknown as Writer;
  return { writer, setContent };
};

describe('CHHIV_SYMBOLS', () => {
  it('has a unique id for every entry', () => {
    const ids = CHHIV_SYMBOLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every bracket-pair entry has distinct, non-empty open/close halves', () => {
    for (const symbol of CHHIV_SYMBOLS) {
      if ('open' in symbol) {
        expect(symbol.open).not.toBe('');
        expect(symbol.close).not.toBe('');
      }
    }
  });
});

describe('insertAtCursor', () => {
  it('sets the symbol as the editor content at the cursor', () => {
    const { writer, setContent } = makeFakeWriter();
    insertAtCursor(writer, '□');
    expect(setContent).toHaveBeenCalledWith('□');
  });
});

describe('insertBracketPair', () => {
  it('wraps the current selection in the open/close pair', () => {
    const { writer, setContent } = makeFakeWriter('some text');
    insertBracketPair(writer, '[', ']');
    expect(setContent).toHaveBeenCalledWith('[some text]');
  });

  it('inserts both halves with nothing selected', () => {
    const { writer, setContent } = makeFakeWriter('');
    insertBracketPair(writer, '[', ']');
    expect(setContent).toHaveBeenCalledWith('[]');
  });
});
