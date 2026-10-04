import { isDesktop } from '@src/types/desktop';
import { mergeEditorBodyWithStoredHeader, stripTeiHeaderForVisualEditor } from '../teiHeaderXml';

const isSourceEditorMode = () => window.writer?.overmindState?.ui?.editorViewMode === 'source';

/**
 * Visual-mode edits don't update the open tab's stored content, so offsets computed against the
 * tab snapshot drift after any edit. This reads the live editor XML (with the stored teiHeader
 * re-attached, matching what is saved) and pushes it into the tab so search, jump and replace
 * all work from the same text.
 */
export const syncActiveVisualTabContent = async (
  filePath: string | null | undefined,
): Promise<string | null> => {
  if (!filePath || isSourceEditorMode() || !window.writer?.getContent) return null;

  const activePath =
    window.writer.overmindState?.editor?.resource?.filePath ??
    window.writer.overmindState?.project?.activeTabPath;
  if (activePath !== filePath) return null;

  try {
    const live = await window.writer.getContent();
    if (!live) return null;

    let content = live;
    if (isDesktop()) {
      const baseXml =
        window.__desktopStoredDocumentXml ?? window.writer.overmindState?.document?.xml ?? live;
      content = mergeEditorBodyWithStoredHeader(stripTeiHeaderForVisualEditor(live), baseXml);
    }

    const tab = window.writer.overmindState?.project?.openTabs?.find(
      (item: { filePath: string }) => item.filePath === filePath,
    );
    if (tab && tab.content !== content) {
      window.writer.overmindActions?.project?.updateTabContent?.({ filePath, content });
    }
    return content;
  } catch {
    return null;
  }
};
