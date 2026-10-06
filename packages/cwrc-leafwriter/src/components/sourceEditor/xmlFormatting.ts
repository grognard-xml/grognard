import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { prettyPrintXml } from './xmlPrettyPrint';

// The schema decides where line breaks may be added; without a loaded schema the
// printer falls back to re-indenting only.
const schemaCanContainText = (name: string): boolean | undefined =>
  window.writer?.schemaManager?.canTagContainText(name);

const prettyPrintText = (text: string) =>
  prettyPrintXml(text, { canContainText: schemaCanContainText });

export type PrettyPrintResult = 'ok' | 'unchanged' | 'malformed';

/** Pretty-prints the whole document as a single undoable edit. */
export const prettyPrintEditor = (
  editor: monaco.editor.IStandaloneCodeEditor,
): PrettyPrintResult => {
  const model = editor.getModel();
  if (!model) return 'malformed';
  const formatted = prettyPrintText(model.getValue());
  if (formatted === null) return 'malformed';
  if (formatted === model.getValue()) return 'unchanged';

  editor.pushUndoStop();
  editor.executeEdits('pretty-print', [{ range: model.getFullModelRange(), text: formatted }]);
  editor.pushUndoStop();
  return 'ok';
};

/** Backs Monaco's Format Document command (Shift+Alt+F, as in VS Code). */
export const registerXmlFormatting = (): monaco.IDisposable =>
  monaco.languages.registerDocumentFormattingEditProvider('xml', {
    provideDocumentFormattingEdits: (model) => {
      const formatted = prettyPrintText(model.getValue());
      if (formatted === null || formatted === model.getValue()) return [];
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  });
