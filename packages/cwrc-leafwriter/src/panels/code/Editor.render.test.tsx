import { render } from '@testing-library/react';

/**
 * Render smoke test for the source-code panel.
 *
 * Added to give the panel's mount/unmount path any coverage at all — it had none,
 * which is how a broken teardown survived here unnoticed (see the note above the
 * mount effect in Editor.tsx). The dispose assertion below is what pins that
 * down: with the original cleanup, which closed over the initial `editor` state
 * rather than the instance it created, the Monaco editor was never disposed on
 * unmount.
 *
 * THIS VERIFIES LIFECYCLE, NOT EDITING. A green run means the panel mounts,
 * subscribes, and disposes what it created. It says nothing about whether the
 * editor renders or reflects the document — real Monaco cannot run under jsdom,
 * so it is stubbed throughout. Reading this suite as "the source panel works"
 * would be a misread; that still needs the running app.
 */

const mockDispose = jest.fn();
const mockCreate = jest.fn(() => ({
  dispose: mockDispose,
  setValue: jest.fn(),
  updateOptions: jest.fn(),
  getModel: jest.fn(() => null),
  onDidChangeModelContent: jest.fn(),
  layout: jest.fn(),
}));

jest.mock('../../monacoEnvironment', () => ({}), { virtual: true });
jest.mock('monaco-editor/esm/vs/basic-languages/xml/xml.contribution', () => ({}), {
  virtual: true,
});
jest.mock('monaco-editor/esm/vs/editor/editor.main', () => ({}), { virtual: true });
jest.mock(
  'monaco-editor/esm/vs/editor/editor.api',
  () => ({ editor: { create: (...args: unknown[]) => mockCreate(...(args as [])) } }),
  { virtual: true },
);

const subscribe = jest.fn();
const unsubscribe = jest.fn();

// jsdom has no ResizeObserver; the panel observes its container on mount.
class StubResizeObserver {
  observe() {
    return undefined;
  }
  unobserve() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;

beforeEach(() => {
  jest.clearAllMocks();
  (window as unknown as { writer: unknown }).writer = {
    event: () => ({ subscribe, unsubscribe }),
    editor: null,
    converter: { getDocumentContent: jest.fn() },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Editor } = require('./Editor') as typeof import('./Editor');

describe('Editor (source panel)', () => {
  it('mounts and creates a Monaco instance', () => {
    render(<Editor showLOD={false} />);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('subscribes to writer events on mount', () => {
    render(<Editor showLOD={false} />);
    expect(subscribe).toHaveBeenCalled();
  });

  // Regression guard for the teardown bug documented in Editor.tsx: the cleanup
  // must dispose the instance it created, not whatever `editor` state held when
  // the effect first ran (which is null).
  it('disposes the Monaco instance on unmount', () => {
    const { unmount } = render(<Editor showLOD={false} />);
    unmount();
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });
});
