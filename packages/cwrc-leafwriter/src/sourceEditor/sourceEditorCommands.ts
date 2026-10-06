import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import {
  prettyPrintEditor,
  type PrettyPrintResult,
} from '../components/sourceEditor/xmlFormatting';

/**
 * Lets UI outside the Monaco component (the source toolbar) drive the one live
 * source editor, the same way findInSourceEditor does for Find.
 */
let registered: monaco.editor.IStandaloneCodeEditor | null = null;

export const registerSourceEditorForCommands = (
  editor: monaco.editor.IStandaloneCodeEditor | null,
) => {
  registered = editor;
};

export type SourceEditorCommand =
  'foldAll' | 'unfoldAll' | 'foldParagraphs' | 'foldDivisions' | 'foldHeader';

const ACTION_IDS: Record<SourceEditorCommand, string> = {
  foldAll: 'editor.foldAll',
  unfoldAll: 'editor.unfoldAll',
  foldParagraphs: 'xml-fold-paragraphs',
  foldDivisions: 'xml-fold-divisions',
  foldHeader: 'xml-fold-header',
};

export const runSourceEditorCommand = (command: SourceEditorCommand) => {
  void registered?.getAction(ACTION_IDS[command])?.run();
  registered?.focus();
};

export const prettyPrintSourceEditor = (): PrettyPrintResult | 'unavailable' => {
  if (!registered) return 'unavailable';
  const result = prettyPrintEditor(registered);
  registered.focus();
  return result;
};
