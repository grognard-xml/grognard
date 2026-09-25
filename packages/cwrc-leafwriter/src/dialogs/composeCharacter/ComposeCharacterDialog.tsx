import { Alert, Box, Button, ButtonBase, Tooltip, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import type Writer from '../../js/Writer';
import { insertAtCursor } from '../../utilities/chhivSymbols';
import {
  applyPaletteOperator,
  draftIds,
  emptyLeafSlot,
  isSlotFilled,
  slotAt,
} from '../../utilities/composerTree';
import type { GlyphwikiCandidate } from '../../utilities/glyphwikiIndex';
import { canonicalUnicodeChar, partCountFor, type IdsOperator } from '../../utilities/kageCompose';
import { renderKageToSvg } from '../../utilities/kageRenderer';
import {
  emptyProjectGlyphRegistry,
  type ProjectGlyphRegistry,
} from '../../utilities/projectGlyphRegistry';
import {
  adoptGlyphwikiCandidateAndInsert,
  composeTreeAndInsertProjectGlyph,
  getProjectRootPath,
  loadProjectGlyphRegistryFromDisk,
  previewComposerTree,
} from '../../utilities/projectGlyphStore';
import { LayoutPalette, LayoutRegion } from './LayoutCanvas';

const GlyphThumbnail = ({ svg, size = 160 }: { svg: string; size?: number }) => (
  <Box
    sx={{
      width: size,
      height: size,
      overflow: 'hidden',
      // kage-engine's raw SVG carries its own width="200" height="200"
      // attributes; without this, the browser honors those over the
      // wrapper's size and the glyph renders at full size, overflowing
      // everything below it instead of scaling to fit the preview box.
      '& svg': { width: '100%', height: '100%', display: 'block' },
    }}
    dangerouslySetInnerHTML={{ __html: svg }}
  />
);

/**
 * CHHIV glyph composer (see plugins/glyph_maker.md, plugins/composer-visual-
 * redesign.md): compose an unencoded character from two components - each
 * either an ordinary Unicode character (typed/pasted directly), an
 * already-composed project glyph's id, or (Phase D) itself an unresolved
 * sub-composition edited inline in the layout square, to arbitrary nesting depth
 * - under one of the basic IDS layouts, preview the result, and save it as
 * a new project glyph inserted at the cursor.
 *
 * Deliberately does not include manual drag/scale geometry editing or
 * stroke-level editing (both explicitly deferred) - each operator uses a
 * fixed default layout (see kageCompose.ts).
 *
 * Stays open after a successful save (matching the other two CHHIV dialogs'
 * "keep going without reopening" interaction) rather than closing itself -
 * there's no host API for a dialog body to close its own SimpleDialog
 * wrapper from the inside; only its own action-button/backdrop handlers can.
 */
export const ComposeCharacterDialog = ({ writer }: { writer: Writer }) => {
  const [operator, setOperator] = useState<IdsOperator>('⿰');
  const [parts, setParts] = useState<ComposerSlot[]>([emptyLeafSlot(), emptyLeafSlot()]);
  const [registry, setRegistry] = useState<ProjectGlyphRegistry>(emptyProjectGlyphRegistry());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [insertedMessage, setInsertedMessage] = useState<string | null>(null);
  const [flattenNotice, setFlattenNotice] = useState<string | null>(null);
  // [] means the outer square is selected. A field's path, e.g. [1], means
  // the next palette click builds a layout inside that field. Kept in a ref
  // as well as state so a palette click sees the field the scholar just
  // focused, even before React has re-rendered.
  const [selection, setSelection] = useState<number[]>([]);
  const selectionRef = useRef<number[]>([]);

  useEffect(() => {
    const projectRoot = getProjectRootPath();
    if (!projectRoot) return;
    let cancelled = false;
    void loadProjectGlyphRegistryFromDisk(projectRoot).then((loaded) => {
      if (!cancelled) setRegistry(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const preview = useMemo(() => {
    if (!parts.every(isSlotFilled)) return null;
    return previewComposerTree(operator, parts, registry);
  }, [operator, parts, registry]);

  const resetSlots = () => {
    setParts(Array.from({ length: partCountFor(operator) }, emptyLeafSlot));
    select([]);
  };

  const select = (path: number[]) => {
    selectionRef.current = path;
    setSelection(path);
  };

  const handlePalette = (next: IdsOperator) => {
    setFlattenNotice(null);
    const applied = applyPaletteOperator(operator, parts, selectionRef.current, next);
    setOperator(applied.operator);
    setParts(applied.parts);
    if (selectionRef.current.length > 0 && !slotAt(applied.parts, selectionRef.current)) {
      select([]);
    }
  };

  const selectedSlot = slotAt(parts, selection);
  const activeOperator: IdsOperator | null =
    selection.length === 0
      ? operator
      : selectedSlot?.kind === 'nested'
        ? selectedSlot.operator
        : null;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setInsertedMessage(null);
    const result = await composeTreeAndInsertProjectGlyph(writer, operator, parts);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    resetSlots();
    setInsertedMessage(result.glyph.id);
    const projectRoot = getProjectRootPath();
    if (projectRoot) setRegistry(await loadProjectGlyphRegistryFromDisk(projectRoot));
  };

  const handleAdopt = async (candidate: GlyphwikiCandidate) => {
    setSaving(true);
    setSaveError(null);
    setInsertedMessage(null);
    const result = await adoptGlyphwikiCandidateAndInsert(writer, candidate);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    resetSlots();
    setInsertedMessage(result.glyph.id);
    const projectRoot = getProjectRootPath();
    if (projectRoot) setRegistry(await loadProjectGlyphRegistryFromDisk(projectRoot));
  };

  /** Route A (plugins/glyph_maker.md): this candidate already IS an ordinary
   * encoded Unicode character - insert the plain character directly, no SVG
   * gaiji/registry entry at all. No file I/O, so no error path to handle. */
  const handleInsertUnicode = (char: string, codepointLabel: string) => {
    setSaveError(null);
    setInsertedMessage(null);
    insertAtCursor(writer, char);
    resetSlots();
    setInsertedMessage(`${char} (${codepointLabel}, plain text)`);
  };

  const canSave = Boolean(preview) && preview!.unresolvedComponents.length === 0 && !saving;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Pick a layout, then type one character or a project glyph id (e.g. chhiv-0003) in each box.
        Click a box and pick another layout to compose inside it. Click the square itself to change
        the outer layout again.
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <Box sx={{ width: 280, flexShrink: 0 }}>
          <LayoutPalette activeOperator={activeOperator} onPick={handlePalette} />
          <Box sx={{ width: 280, height: 280, mt: 1 }}>
            <LayoutRegion
              operator={operator}
              parts={parts}
              path={[]}
              selectedPath={selection}
              onSelect={select}
              onPartsChange={setParts}
              onFlattenRefused={() =>
                setFlattenNotice(
                  'This layout has more than one part filled in. Clear the extras, then remove it.',
                )
              }
            />
          </Box>
        </Box>

        <Box sx={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="body2" sx={{ fontFamily: 'serif', fontSize: 20 }}>
            {draftIds(operator, parts)}
          </Typography>

          {preview && preview.existingUnicodeChar && (
            // Phase A (composer-visual-redesign.md §3-4): this exact IDS
            // composition already has a standard Unicode decomposition on
            // record - a stronger, qualitatively different result than a
            // GlyphWiki candidate (which only means *some* non-standard glyph
            // happens to combine the same parts). Foregrounded above the plain
            // preview/candidates, not shown as one tile among several.
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                border: '2px solid',
                borderColor: 'success.main',
                borderRadius: 1,
                p: 2,
              }}
            >
              <Typography sx={{ fontSize: 48, lineHeight: 1 }}>
                {preview.existingUnicodeChar}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="body2">
                  This is already an encoded Unicode character (U+
                  {preview.existingUnicodeChar.codePointAt(0)?.toString(16).toUpperCase()}) - no
                  need to compose a new glyph.
                </Typography>
                <Button
                  variant="contained"
                  color="success"
                  size="small"
                  disabled={saving}
                  onClick={() =>
                    handleInsertUnicode(
                      preview.existingUnicodeChar as string,
                      `U+${preview.existingUnicodeChar?.codePointAt(0)?.toString(16).toUpperCase()}`,
                    )
                  }
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Insert as plain text
                </Button>
              </Box>
            </Box>
          )}

          {preview && (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1,
              }}
            >
              <GlyphThumbnail svg={preview.svg} />
            </Box>
          )}

          {preview && preview.unresolvedComponents.length > 0 && (
            <Alert severity="warning">
              No geometry found for: {preview.unresolvedComponents.join(', ')}
            </Alert>
          )}

          {preview && preview.glyphwikiCandidates.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                GlyphWiki already has {preview.glyphwikiCandidates.length} matching{' '}
                {preview.glyphwikiCandidates.length === 1 ? 'glyph' : 'glyphs'} - adopt one instead
                of composing a new one:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {preview.glyphwikiCandidates.map((candidate) => {
                  const unicodeChar = canonicalUnicodeChar(candidate.name);
                  if (unicodeChar) {
                    // This candidate already IS an ordinary encoded character -
                    // show it as plain text in the document's own font, not a
                    // KAGE-rendered SVG, and insert exactly that on click. No
                    // gaiji object, no registry entry: Route A.
                    const codepointLabel = `U+${unicodeChar.codePointAt(0)?.toString(16).toUpperCase()}`;
                    return (
                      <Tooltip
                        key={candidate.name}
                        title={`Insert ${codepointLabel} as plain text`}
                      >
                        <ButtonBase
                          disabled={saving}
                          onClick={() => handleInsertUnicode(unicodeChar, codepointLabel)}
                          sx={{
                            width: 64,
                            height: 64,
                            border: '2px solid',
                            borderColor: 'success.main',
                            borderRadius: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 0.25,
                          }}
                        >
                          <Typography sx={{ fontSize: 32, lineHeight: 1 }}>
                            {unicodeChar}
                          </Typography>
                          <Typography variant="caption" color="success.main">
                            Unicode
                          </Typography>
                        </ButtonBase>
                      </Tooltip>
                    );
                  }

                  const { svg } = renderKageToSvg(candidate.kageData);
                  return (
                    <Tooltip key={candidate.name} title={`Adopt ${candidate.name}`}>
                      <ButtonBase
                        disabled={saving}
                        onClick={() => void handleAdopt(candidate)}
                        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                      >
                        <GlyphThumbnail svg={svg} size={64} />
                      </ButtonBase>
                    </Tooltip>
                  );
                })}
              </Box>
            </Box>
          )}

          {flattenNotice && <Alert severity="info">{flattenNotice}</Alert>}
          {saveError && <Alert severity="error">{saveError}</Alert>}
          {insertedMessage && !saveError && (
            <Alert severity="success">
              Inserted {insertedMessage} - compose another, or close this dialog.
            </Alert>
          )}

          <Button variant="contained" disabled={!canSave} onClick={() => void handleSave()}>
            Save and insert
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default ComposeCharacterDialog;
