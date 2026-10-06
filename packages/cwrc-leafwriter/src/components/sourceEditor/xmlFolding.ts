import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { loadFoldState, saveFoldState } from './foldStateStorage';
import { analyzeXmlFolds, getFoldLabel, type XmlFoldRegion } from './xmlFoldingParser';

const FOLD_LABEL_CLASS = 'xml-fold-label';

// One analysis per model version, shared by the provider, the label
// decorations and the fold commands.
const analysisCache = new WeakMap<
  monaco.editor.ITextModel,
  { version: number; regions: XmlFoldRegion[] }
>();

const getRegions = (model: monaco.editor.ITextModel): XmlFoldRegion[] => {
  const version = model.getVersionId();
  const cached = analysisCache.get(model);
  if (cached?.version === version) return cached.regions;
  const regions = analyzeXmlFolds(model.getValue());
  analysisCache.set(model, { version, regions });
  return regions;
};

/** Fold ranges that follow element nesting instead of indentation. */
export const registerXmlFolding = (): monaco.IDisposable =>
  monaco.languages.registerFoldingRangeProvider('xml', {
    provideFoldingRanges: (model) =>
      getRegions(model).map((region) => ({
        start: region.startLine,
        end: region.endLine,
        kind: region.kind === 'comment' ? monaco.languages.FoldingRangeKind.Comment : undefined,
      })),
  });

interface FoldingModelLike {
  regions: {
    length: number;
    isCollapsed(index: number): boolean;
    getStartLineNumber(index: number): number;
  };
}
interface FoldingControllerLike {
  getFoldingModel(): Promise<FoldingModelLike | null> | null;
}
// Monaco's folding contribution is not part of the public typings.
const getFoldingController = (editor: monaco.editor.ICodeEditor) =>
  editor.getContribution('editor.contrib.folding') as FoldingControllerLike | null;

const foldLines = (editor: monaco.editor.ICodeEditor, lines: number[]) => {
  if (lines.length === 0) return;
  // `editor.fold` takes 0-based line numbers and folds the region starting there.
  void editor
    .getAction('editor.fold')
    ?.run({ levels: 1, selectionLines: lines.map((line) => line - 1) });
};

const foldElements = (
  editor: monaco.editor.ICodeEditor,
  matches: (region: XmlFoldRegion) => boolean,
) => {
  const model = editor.getModel();
  if (!model) return;
  foldLines(
    editor,
    getRegions(model)
      .filter(matches)
      .map((region) => region.startLine),
  );
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** 1-based start lines of every collapsed region, from Monaco's folding model. */
const getCollapsedStartLines = async (editor: monaco.editor.ICodeEditor): Promise<number[]> => {
  const foldingModel = await getFoldingController(editor)?.getFoldingModel();
  if (!foldingModel) return [];
  const lines: number[] = [];
  const { regions } = foldingModel;
  for (let index = 0; index < regions.length; index += 1) {
    if (regions.isCollapsed(index)) lines.push(regions.getStartLineNumber(index));
  }
  return lines;
};

/**
 * Applies the folds saved for `key`, or, for a document never seen before,
 * collapses the `teiHeader` (long metadata that is rarely edited). Returns false
 * when the document has nothing foldable yet or changed while waiting, so the
 * caller can try again after the next content sync.
 */
export const restoreFolds = async (
  editor: monaco.editor.ICodeEditor,
  key: string,
): Promise<boolean> => {
  const model = editor.getModel();
  if (!model) return false;
  const version = model.getVersionId();
  const regions = getRegions(model);
  if (regions.length === 0) return false;

  const saved = loadFoldState(key);
  const lines = saved
    ? saved
        .filter((fold) =>
          regions.some((region) => region.startLine === fold.line && region.name === fold.name),
        )
        .map((fold) => fold.line)
    : regions.filter((region) => region.name === 'teiHeader').map((region) => region.startLine);

  // The folding model is rebuilt asynchronously after a content change. Folding
  // before it knows these regions would hit the previous document's ranges.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (editor.getModel() !== model || model.getVersionId() !== version) return false;
    const foldingModel = await getFoldingController(editor)?.getFoldingModel();
    if (foldingModel) {
      const known = new Set<number>();
      for (let index = 0; index < foldingModel.regions.length; index += 1) {
        known.add(foldingModel.regions.getStartLineNumber(index));
      }
      if (lines.every((line) => known.has(line))) {
        foldLines(editor, lines);
        return true;
      }
    }
    await sleep(150);
  }
  return false;
};

/**
 * Saves the collapsed regions whenever they change. `getActiveKey` returns the
 * document key only once its saved folds have been restored; until then the
 * editor still shows the previous document or a half-built fold model, and
 * saving would overwrite the real state.
 */
export const registerFoldPersistence = (
  editor: monaco.editor.ICodeEditor,
  getActiveKey: () => string | null,
): monaco.IDisposable => {
  let timer: number | undefined;
  const listener = editor.onDidChangeHiddenAreas(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const key = getActiveKey();
      const model = editor.getModel();
      if (!key || !model) return;
      void getCollapsedStartLines(editor).then((lines) => {
        if (getActiveKey() !== key) return;
        const byStart = new Map(getRegions(model).map((region) => [region.startLine, region]));
        saveFoldState(
          key,
          lines.flatMap((line) => {
            const region = byStart.get(line);
            return region ? [{ line, name: region.name }] : [];
          }),
        );
      });
    }, 300);
  });
  return {
    dispose: () => {
      window.clearTimeout(timer);
      listener.dispose();
    },
  };
};

/**
 * Adds fold commands that understand the document (paragraphs, divisions,
 * header) and paints "head text · N cit" after collapsed regions. Monaco's own
 * Fold All / level commands (Cmd+K Cmd+0, Cmd+K Cmd+1…) keep working.
 */
export const registerXmlFoldingFeatures = (
  editor: monaco.editor.IStandaloneCodeEditor,
): monaco.IDisposable => {
  const actions = [
    // VS Code's Cmd+Alt+[ / ] (fold / unfold at the cursor) and the Cmd+K chords
    // are built into Monaco; these add single-chord fold-all / unfold-all.
    editor.addAction({
      id: 'xml-fold-all',
      label: 'Fold All',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.Digit0],
      run: (ed) => void ed.getAction('editor.foldAll')?.run(),
    }),
    editor.addAction({
      id: 'xml-unfold-all',
      label: 'Unfold All',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.Digit9],
      run: (ed) => void ed.getAction('editor.unfoldAll')?.run(),
    }),
    editor.addAction({
      id: 'xml-fold-paragraphs',
      label: 'Fold All Paragraphs',
      contextMenuGroupId: 'xml-folding',
      contextMenuOrder: 1,
      run: (ed) => foldElements(ed, (region) => region.name === 'p'),
    }),
    editor.addAction({
      id: 'xml-fold-divisions',
      label: 'Fold All Divisions',
      contextMenuGroupId: 'xml-folding',
      contextMenuOrder: 2,
      run: (ed) => foldElements(ed, (region) => region.name === 'div'),
    }),
    editor.addAction({
      id: 'xml-fold-header',
      label: 'Fold TEI Header',
      contextMenuGroupId: 'xml-folding',
      contextMenuOrder: 3,
      run: (ed) => foldElements(ed, (region) => region.name === 'teiHeader'),
    }),
  ];

  const labels = editor.createDecorationsCollection();
  let disposed = false;
  const updateLabels = () => {
    const model = editor.getModel();
    void getFoldingController(editor)
      ?.getFoldingModel()
      ?.then((foldingModel) => {
        if (disposed || !model || !foldingModel) return;
        const byStart = new Map(getRegions(model).map((region) => [region.startLine, region]));
        const { regions } = foldingModel;
        const decorations: monaco.editor.IModelDeltaDecoration[] = [];
        for (let index = 0; index < regions.length; index += 1) {
          if (!regions.isCollapsed(index)) continue;
          const startLine = regions.getStartLineNumber(index);
          const region = byStart.get(startLine);
          const label = region && getFoldLabel(region);
          if (!label || startLine > model.getLineCount()) continue;
          const column = model.getLineMaxColumn(startLine);
          decorations.push({
            range: new monaco.Range(startLine, column, startLine, column),
            options: {
              after: { content: `  ${label}`, inlineClassName: FOLD_LABEL_CLASS },
              showIfCollapsed: true,
            },
          });
        }
        labels.set(decorations);
      });
  };
  const hiddenListener = editor.onDidChangeHiddenAreas(updateLabels);
  const contentListener = editor.onDidChangeModelContent(updateLabels);

  return {
    dispose: () => {
      disposed = true;
      hiddenListener.dispose();
      contentListener.dispose();
      labels.clear();
      for (const action of actions) action.dispose();
    },
  };
};
