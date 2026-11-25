import { repairMissingGlyphDeclarations } from '../../../../packages/cwrc-leafwriter/src/utilities/glyphCharDecl';
import { getParentPath, joinPath } from '@src/desktop/explorer/treeUtils';

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await window.electronAPI?.statFile(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Before a save, gives every `<g ref="#id">` that lost its `<charDecl>` entry a new one, when the
 * glyph's SVG is in `_glyphs/` beside the document or at the project root. Keeps references from
 * dangling in the saved file and lets other tools find the glyph.
 */
export const repairGlyphDeclarationsForSave = async (
  xml: string,
  filePath: string,
  projectRoot: string | null,
): Promise<string> => {
  if (!window.electronAPI?.statFile || !/<g\s[^>]*\bref="#/.test(xml)) return xml;
  const folders = [getParentPath(filePath), projectRoot].filter((dir): dir is string => !!dir);
  return repairMissingGlyphDeclarations(xml, async (glyphId) => {
    for (const folder of folders) {
      if (await fileExists(joinPath(folder, '_glyphs', `${glyphId}.svg`))) return true;
    }
    return false;
  });
};
