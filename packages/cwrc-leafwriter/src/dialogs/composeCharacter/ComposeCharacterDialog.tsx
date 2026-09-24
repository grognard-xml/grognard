import { Alert, Box, Button, MenuItem, Select, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import type Writer from '../../js/Writer';
import { IDS_OPERATORS, type IdsOperator } from '../../utilities/kageCompose';
import {
  emptyProjectGlyphRegistry,
  type ProjectGlyphRegistry,
} from '../../utilities/projectGlyphRegistry';
import {
  composeAndInsertProjectGlyph,
  getProjectRootPath,
  loadProjectGlyphRegistryFromDisk,
  previewComposition,
} from '../../utilities/projectGlyphStore';

/**
 * Phase 1 CHHIV glyph composer (see plugins/glyph_maker.md): compose an
 * unencoded character from two existing components - each either an
 * ordinary Unicode character (typed/pasted directly) or an already-composed
 * project glyph's id - under one of the basic IDS layouts, preview the
 * result, and save it as a new project glyph inserted at the cursor.
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
  const [firstInput, setFirstInput] = useState('');
  const [secondInput, setSecondInput] = useState('');
  const [registry, setRegistry] = useState<ProjectGlyphRegistry>(emptyProjectGlyphRegistry());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

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
    if (!firstInput.trim() || !secondInput.trim()) return null;
    return previewComposition(operator, firstInput.trim(), secondInput.trim(), registry);
  }, [operator, firstInput, secondInput, registry]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSavedId(null);
    const result = await composeAndInsertProjectGlyph(
      writer,
      operator,
      firstInput.trim(),
      secondInput.trim(),
    );
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setFirstInput('');
    setSecondInput('');
    setSavedId(result.glyph.id);
    const projectRoot = getProjectRootPath();
    if (projectRoot) setRegistry(await loadProjectGlyphRegistryFromDisk(projectRoot));
  };

  const canSave = Boolean(preview) && preview!.unresolvedComponents.length === 0 && !saving;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 320 }}>
      <Typography variant="body2" color="text.secondary">
        Compose a character from two existing components - a Unicode character you can type or
        paste, or an existing project glyph id (e.g. chhiv-0003).
      </Typography>

      <Select
        value={operator}
        onChange={(e) => setOperator(e.target.value as IdsOperator)}
        size="small"
      >
        {IDS_OPERATORS.map(({ operator: op, label }) => (
          <MenuItem key={op} value={op}>
            {op} {label}
          </MenuItem>
        ))}
      </Select>

      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          label="First component"
          size="small"
          value={firstInput}
          onChange={(e) => setFirstInput(e.target.value)}
          fullWidth
        />
        <TextField
          label="Second component"
          size="small"
          value={secondInput}
          onChange={(e) => setSecondInput(e.target.value)}
          fullWidth
        />
      </Box>

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
          <Box
            sx={{
              width: 160,
              height: 160,
              overflow: 'hidden',
              // kage-engine's raw SVG carries its own width="200" height="200"
              // attributes; without this, the browser honors those over the
              // wrapper's size and the glyph renders at full size, overflowing
              // everything below it instead of scaling to fit the preview box.
              '& svg': { width: '100%', height: '100%', display: 'block' },
            }}
            dangerouslySetInnerHTML={{ __html: preview.svg }}
          />
        </Box>
      )}

      {preview && preview.unresolvedComponents.length > 0 && (
        <Alert severity="warning">
          No geometry found for: {preview.unresolvedComponents.join(', ')}
        </Alert>
      )}
      {saveError && <Alert severity="error">{saveError}</Alert>}
      {savedId && !saveError && (
        <Alert severity="success">
          Inserted {savedId} - compose another, or close this dialog.
        </Alert>
      )}

      <Button variant="contained" disabled={!canSave} onClick={() => void handleSave()}>
        Save and insert
      </Button>
    </Box>
  );
};

export default ComposeCharacterDialog;
