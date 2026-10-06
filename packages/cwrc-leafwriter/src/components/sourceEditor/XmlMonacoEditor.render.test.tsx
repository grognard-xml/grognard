import { render } from '@testing-library/react';

/**
 * Render smoke test for the source XML editor.
 *
 * Its sibling panels/code/Editor.tsx had a teardown that never disposed the
 * Monaco instance; this component does it correctly, off a local binding. The
 * dispose assertion below pins that so the working version does not regress into
 * the broken shape.
 *
 * THIS VERIFIES LIFECYCLE, NOT EDITING. A green run here means the component
 * mounts, wires itself up, and disposes what it created. It says nothing about
 * whether the editor renders text, decorates errors, or validates — real Monaco
 * cannot run under jsdom (workers, canvas measurement, layout), so it is stubbed
 * throughout. Treating this suite as "the source editor works" would be a
 * misread; that still needs the running app.
 *
 * The stub below answers any member, so it cannot catch a call to a method that
 * does not exist. `tsc` covers that instead: the mock is jest-only, so the
 * component is typechecked against the real monaco-editor types, and a renamed
 * or removed API fails the typecheck gate.
 */

const mockDispose = jest.fn();

/**
 * Monaco's editor instance has a wide surface and this component touches a lot of
 * it (commands, cursor and focus listeners, decorations, actions). Enumerating
 * those one failure at a time is brittle, so unknown members answer with a
 * jest.fn returning a disposable — the shape almost every Monaco `onX`/`registerX`
 * returns. Only `dispose` is pinned, because that is what the test asserts on.
 */
const disposable = { dispose: jest.fn() };
const makeEditorStub = () =>
  new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => {
      if (key === 'dispose') return mockDispose;
      if (key === 'getValue') return () => '';
      if (key === 'getModel') return () => null;
      if (key === 'getPosition') return () => ({ lineNumber: 1, column: 1 });
      if (key === 'createDecorationsCollection')
        return () => ({ clear: jest.fn(), set: jest.fn() });
      if (key === 'then') return undefined; // not a thenable
      if (!(key in target)) target[key] = jest.fn(() => disposable);
      return target[key];
    },
  });

const mockCreate = jest.fn(() => makeEditorStub());

jest.mock('../../monacoEnvironment', () => ({}), { virtual: true });
jest.mock('monaco-editor/esm/vs/basic-languages/xml/xml.contribution', () => ({}), {
  virtual: true,
});
jest.mock('monaco-editor/esm/vs/editor/editor.main', () => ({}), { virtual: true });
jest.mock(
  'monaco-editor/esm/vs/editor/contrib/linkedEditing/browser/linkedEditing.js',
  () => ({}),
  { virtual: true },
);
jest.mock(
  'monaco-editor/esm/vs/editor/editor.api',
  () => ({
    // Same reasoning as the instance stub: answer any namespace member rather
    // than enumerating Monaco's static API one failure at a time.
    editor: new Proxy({} as Record<string, unknown>, {
      get: (target, key: string) => {
        if (key === 'create') return (...args: unknown[]) => mockCreate(...(args as []));
        if (!(key in target)) target[key] = jest.fn(() => disposable);
        return target[key];
      },
    }),
    languages: {
      registerCompletionItemProvider: jest.fn(() => ({ dispose: jest.fn() })),
      registerFoldingRangeProvider: jest.fn(() => ({ dispose: jest.fn() })),
      registerLinkedEditingRangeProvider: jest.fn(() => ({ dispose: jest.fn() })),
      registerDocumentFormattingEditProvider: jest.fn(() => ({ dispose: jest.fn() })),
      setLanguageConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
      register: jest.fn(),
      CompletionItemKind: { Snippet: 1, Text: 2 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    },
    KeyMod: { CtrlCmd: 1, Shift: 2, Alt: 4 },
    KeyCode: { KeyF: 1, KeyS: 2, Enter: 3 },
    Range: class {},
    MarkerSeverity: { Error: 8, Warning: 4 },
  }),
  { virtual: true },
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { XmlMonacoEditor } = require('./XmlMonacoEditor') as typeof import('./XmlMonacoEditor');

describe('XmlMonacoEditor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mounts and creates a Monaco instance', () => {
    render(<XmlMonacoEditor value="<TEI/>" onChange={jest.fn()} />);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('disposes the instance it created on unmount', () => {
    const { unmount } = render(<XmlMonacoEditor value="<TEI/>" onChange={jest.fn()} />);
    unmount();
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });
});
