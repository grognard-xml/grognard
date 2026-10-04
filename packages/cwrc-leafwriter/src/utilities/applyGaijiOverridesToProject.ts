import { collectXmlFiles } from '../../../../apps/commons/src/desktop/xpath/collectXmlFiles';
import { loadGaijiOverrides, type GaijiOverrides } from './gaijiOverrides';

const GAIJI_ELEMENT = /<g\b([^>]*)>\s*<graphic\b[^>]*?\/>\s*<\/g>/g;

const attr = (attrs: string, name: string): string | null =>
  new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;

const escapeText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const GLYPH_DECL = /<glyph\b([^>]*)>([\s\S]*?)<\/glyph>/g;
const KANRIPO_MAPPING = /<mapping\b[^>]*\btype="kanripo"[^>]*>\s*(KR\d{4})\s*<\/mapping>/g;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Glyph ids (xml:id) whose Kanripo mapping has an entry in the table, with that character. */
const overriddenGlyphs = (xml: string, overrides: GaijiOverrides): Map<string, string> => {
  const glyphs = new Map<string, string>();
  for (const decl of xml.matchAll(GLYPH_DECL)) {
    const glyphId = attr(decl[1], 'xml:id');
    if (!glyphId) continue;
    for (const mapping of decl[2].matchAll(KANRIPO_MAPPING)) {
      const character = overrides[mapping[1]];
      if (character) {
        glyphs.set(glyphId, character);
        break;
      }
    }
  }
  return glyphs;
};

/**
 * Replaces every Kanripo gaiji whose id is in `overrides` with the override character as plain
 * text. Two forms are handled: the bare `<g type="kanripo" n="KRnnnn"><graphic/></g>`, and a
 * vectorised `<g ref="#glyph-...">` whose `<charDecl>` entry carries a
 * `<mapping type="kanripo">KRnnnn</mapping>`. A glyph declaration left with no references is
 * removed (and an emptied `<charDecl>`/`<encodingDesc>` with it). Anything else is untouched.
 */
export const applyGaijiOverridesToXml = (
  xml: string,
  overrides: GaijiOverrides,
): { xml: string; replaced: number } => {
  let replaced = 0;
  let next = xml.replace(GAIJI_ELEMENT, (whole, attrs: string) => {
    if (attr(attrs, 'type') !== 'kanripo') return whole;
    const id = attr(attrs, 'n');
    const character = id ? overrides[id] : undefined;
    if (!character) return whole;
    replaced += 1;
    return escapeText(character);
  });

  for (const [glyphId, character] of overriddenGlyphs(next, overrides)) {
    const reference = new RegExp(
      `<g\\b(?=[^>]*\\bref="#${escapeRegExp(glyphId)}")[^>]*?(?:/>|>\\s*</g>)`,
      'g',
    );
    next = next.replace(reference, () => {
      replaced += 1;
      return escapeText(character);
    });
    if (!next.includes(`#${glyphId}"`)) {
      next = next.replace(
        new RegExp(
          `[ \\t]*<glyph\\b[^>]*\\bxml:id="${escapeRegExp(glyphId)}"[^>]*>[\\s\\S]*?</glyph>[ \\t]*\\n?`,
        ),
        '',
      );
      next = next
        .replace(/[ \t]*<charDecl\b[^>]*>\s*<\/charDecl>[ \t]*\n?/, '')
        .replace(/[ \t]*<encodingDesc\b[^>]*>\s*<\/encodingDesc>[ \t]*\n?/, '');
    }
  }
  return { xml: next, replaced };
};

export type ApplyGaijiTableOutcome =
  { ok: true; message: string } | { ok: false; message: string; cancelled?: boolean };

interface PendingFile {
  filePath: string;
  xml: string;
  replaced: number;
}

export const runApplyGaijiTableToProject = async (): Promise<ApplyGaijiTableOutcome> => {
  const project = window.__leafWriterProject;
  const api = window.electronAPI;
  const rootPath = project?.getProjectRootPath?.();
  if (!project || !api?.readFile || !api.writeFile || !rootPath) {
    return { ok: false, message: 'Open a project first.' };
  }

  const overrides = await loadGaijiOverrides(rootPath);
  if (Object.keys(overrides).length === 0) {
    return {
      ok: false,
      message:
        'The project gaiji table is empty. Use “Set Kanripo gaiji character” on a gaiji image first.',
    };
  }

  const activePath = project.getActiveFilePath?.() ?? null;
  const openTabs = new Map((project.getOpenTabs?.() ?? []).map((tab) => [tab.filePath, tab]));

  const pending: PendingFile[] = [];
  const skippedUnsaved: string[] = [];
  for (const filePath of await collectXmlFiles(rootPath)) {
    let diskXml: string;
    try {
      diskXml = await api.readFile(filePath);
    } catch {
      continue;
    }
    // The open editor's live text is the source of truth for the active file; for other open
    // tabs, a tab that differs from disk holds unsaved edits that a write would discard.
    let source = diskXml;
    if (filePath === activePath) {
      source = project.getActiveFileXml?.() || diskXml;
    } else if (openTabs.has(filePath) && openTabs.get(filePath)!.content !== diskXml) {
      if (applyGaijiOverridesToXml(diskXml, overrides).replaced > 0) skippedUnsaved.push(filePath);
      continue;
    }
    const { xml, replaced } = applyGaijiOverridesToXml(source, overrides);
    if (replaced > 0) pending.push({ filePath, xml, replaced });
  }

  const total = pending.reduce((sum, file) => sum + file.replaced, 0);
  const skippedNote = skippedUnsaved.length
    ? `\n\n${skippedUnsaved.length} open file(s) with unsaved changes will be skipped - save them and run this again.`
    : '';
  if (total === 0) {
    return {
      ok: false,
      message: skippedUnsaved.length
        ? `Nothing applied: ${skippedUnsaved.length} matching file(s) have unsaved changes. Save them and run this again.`
        : 'No gaiji images in the project match the gaiji table.',
    };
  }

  const confirmed = window.confirm(
    `Replace ${total} gaiji image(s) with characters in ${pending.length} file(s)?${skippedNote}\n\nA project snapshot is taken first.`,
  );
  if (!confirmed) return { ok: false, message: 'Cancelled.', cancelled: true };

  const snapshot = await project.createTimeMachineSnapshot?.('Before applying gaiji table');
  if (snapshot && !snapshot.ok) {
    return { ok: false, message: 'Could not create the safety snapshot; nothing was changed.' };
  }

  let written = 0;
  let failed = 0;
  for (const file of pending) {
    try {
      await api.writeFile(file.filePath, file.xml);
      await project.reloadFileFromDisk?.(file.filePath);
      written += file.replaced;
    } catch {
      failed += 1;
    }
  }

  const parts = [`Replaced ${written} gaiji image(s) in ${pending.length - failed} file(s).`];
  if (failed) parts.push(`${failed} file(s) failed to write.`);
  if (skippedUnsaved.length)
    parts.push(`${skippedUnsaved.length} file(s) skipped (unsaved changes).`);
  return { ok: true, message: parts.join(' ') };
};
