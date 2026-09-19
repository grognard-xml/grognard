import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RoomIcon from '@mui/icons-material/Room';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import type { CompareCardModel } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/hygiene';
import { SourceBadges } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/SourceBadges';

const Field = ({
  label,
  children,
  highlight,
}: {
  label: string;
  children: ReactNode;
  highlight?: boolean;
}) => (
  <Box
    sx={{
      display: 'grid',
      gridTemplateColumns: 'max-content minmax(0, 1fr)',
      columnGap: 1,
      alignItems: 'center',
      px: 0.5,
      py: 0.25,
      borderRadius: 0.5,
      bgcolor: highlight ? 'warning.light' : 'transparent',
    }}
  >
    <Typography
      variant="body2"
      color="text.secondary"
      component="div"
      sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}
    >
      {label}
    </Typography>
    <Box sx={{ minWidth: 0 }}>{children}</Box>
  </Box>
);

const dash = (
  <Typography variant="caption" color="text.disabled">
    —
  </Typography>
);

const DetailAccordion = ({ title, children }: { title: string; children: ReactNode }) => (
  <Accordion
    disableGutters
    elevation={0}
    sx={{
      border: 1,
      borderColor: 'divider',
      borderRadius: 1,
      '&:before': { display: 'none' },
    }}
  >
    <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ minHeight: 0 }}>
      <Typography variant="body2">{title}</Typography>
    </AccordionSummary>
    <AccordionDetails sx={{ pt: 0 }}>{children}</AccordionDetails>
  </Accordion>
);

export const EntityCompareCard = ({
  model,
  selected,
  onSelect,
  detail = false,
  onOpenMap,
}: {
  model: CompareCardModel;
  selected?: boolean;
  onSelect?: () => void;
  detail?: boolean;
  /** Called when the map icon next to Coordinates is clicked (place kind, detail mode only). */
  onOpenMap?: () => void;
}) => {
  const hl = new Set(model.highlightFields ?? []);
  const dateLabel =
    model.startYear != null || model.endYear != null
      ? `${model.startYear ?? '?'}–${model.endYear ?? '?'}`
      : null;

  return (
    <Box
      onClick={onSelect}
      sx={{
        flex: 1,
        minWidth: 0,
        ...(detail ? { width: '100%', maxWidth: 840 } : {}),
        border: 1,
        borderColor: selected ? 'primary.main' : 'divider',
        borderRadius: 1,
        p: 1.5,
        cursor: onSelect ? 'pointer' : 'default',
        bgcolor: 'background.paper',
        outline: selected ? '2px solid' : 'none',
        outlineColor: 'primary.main',
      }}
    >
      {detail ? (
        <Stack spacing={1}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
              <Typography variant="h5" component="span" noWrap>
                {model.primaryName ?? model.title}
              </Typography>
              {model.romanized && (
                <Typography variant="h6" component="span" color="text.secondary" noWrap>
                  {model.romanized}
                </Typography>
              )}
            </Stack>
            {model.subtitle && (
              <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {model.subtitle}
              </Typography>
            )}
          </Box>

          <Stack direction="row" flexWrap="wrap" gap={0.5}>
            {model.authorities.length === 0
              ? dash
              : model.authorities.map((auth, index) => (
                  <Chip
                    key={`${auth.type}-${auth.value}-${index}`}
                    size="small"
                    variant="outlined"
                    icon={<SourceBadges label={auth.type} compact />}
                    label={auth.value}
                  />
                ))}
          </Stack>

          <Box
            component="fieldset"
            sx={{
              minWidth: 0,
              m: 0,
              px: 1.5,
              pb: 1,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            <Typography
              component="legend"
              variant="caption"
              color="text.secondary"
              sx={{ px: 0.5 }}
            >
              Description
            </Typography>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
              {model.description?.trim() || dash}
            </Typography>
          </Box>

          {model.subtype && (
            <Box
              component="fieldset"
              sx={{
                minWidth: 0,
                m: 0,
                px: 1.5,
                pb: 1,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              <Typography
                component="legend"
                variant="caption"
                color="text.secondary"
                sx={{ px: 0.5 }}
              >
                Sub-type
              </Typography>
              <Typography variant="body1">{model.subtype}</Typography>
            </Box>
          )}

          {(model.kind === 'person' || model.kind === 'work' || model.kind === 'place') && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'max-content minmax(0, 1fr)',
                gap: 0.25,
                alignItems: 'center',
              }}
            >
              {(model.kind === 'person' || model.kind === 'work') && (
                <>
                  <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Dates:
                  </Typography>
                  <Typography variant="body2">{dateLabel ?? dash}</Typography>
                </>
              )}
              {model.kind === 'person' && (
                <>
                  <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Nationality:
                  </Typography>
                  <Typography variant="body2">
                    {model.nationalities.length ? model.nationalities.join(', ') : dash}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Origin:
                  </Typography>
                  <Typography variant="body2">
                    {model.placesOfOrigin.length ? model.placesOfOrigin.join(', ') : dash}
                  </Typography>
                </>
              )}
              {model.kind === 'place' && (
                <>
                  <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Coordinates:
                  </Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="body2">
                      {model.location
                        ? `${model.location.lat.toFixed(4)}, ${model.location.lon.toFixed(4)}`
                        : dash}
                    </Typography>
                    {model.location && (
                      <SourceBadges label={model.location.source ?? 'authority'} compact />
                    )}
                    {onOpenMap && model.location && (
                      <Tooltip title="Show on map">
                        <IconButton size="small" onClick={onOpenMap}>
                          <RoomIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </>
              )}
            </Box>
          )}

          <DetailAccordion title="Names">
            <Stack spacing={0.25}>
              <Field label="Primary">
                <Typography variant="body2">{model.primaryName ?? dash}</Typography>
              </Field>
              {model.kind === 'person' && (
                <>
                  <Field label="姓">
                    <Typography variant="body2">{model.familyName ?? dash}</Typography>
                  </Field>
                  <Field label="名">
                    <Typography variant="body2">{model.givenName ?? dash}</Typography>
                  </Field>
                </>
              )}
              <Field label="Other names">
                <Stack direction="row" flexWrap="wrap" gap={0.5}>
                  {model.otherNames.length === 0
                    ? dash
                    : model.otherNames.map((name, index) => (
                        <Chip
                          key={`${name.text}-${index}`}
                          size="small"
                          label={name.type ? `${name.text} (${name.type})` : name.text}
                        />
                      ))}
                </Stack>
              </Field>
            </Stack>
          </DetailAccordion>
          {model.kind === 'person' && (
            <DetailAccordion title="Noble titles">
              <Typography variant="body2">
                {model.nobleTitles?.length ? model.nobleTitles.join(', ') : dash}
              </Typography>
            </DetailAccordion>
          )}
          {model.kind === 'person' && (
            <DetailAccordion title="Roles">
              <Typography variant="body2">
                {model.roles?.length ? model.roles.join(', ') : dash}
              </Typography>
            </DetailAccordion>
          )}
        </Stack>
      ) : (
        <Stack spacing={0.5}>
          <Box>
            <Typography variant="subtitle1" noWrap>
              {model.title}
            </Typography>
            {model.subtitle && (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {model.subtitle}
              </Typography>
            )}
          </Box>

          <Field label="Primary" highlight={hl.has('primary')}>
            <Typography variant="body2">{model.primaryName ?? dash}</Typography>
          </Field>

          <Field label="Romanized" highlight={hl.has('romanized')}>
            <Typography variant="body2">{model.romanized ?? dash}</Typography>
          </Field>

          {model.kind === 'person' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
              <Field label="姓" highlight={hl.has('familyName')}>
                <Typography variant="body2">{model.familyName ?? dash}</Typography>
              </Field>
              <Field label="名" highlight={hl.has('givenName')}>
                <Typography variant="body2">{model.givenName ?? dash}</Typography>
              </Field>
            </Box>
          )}

          <Field label="Other names" highlight={hl.has('otherNames')}>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              {model.otherNames.length === 0
                ? dash
                : model.otherNames.map((name, index) => (
                    <Chip
                      key={`${name.text}-${index}`}
                      size="small"
                      label={name.type ? `${name.text} (${name.type})` : name.text}
                    />
                  ))}
            </Stack>
          </Field>

          {(model.kind === 'person' || model.kind === 'work') && (
            <Field label="Dates" highlight={hl.has('dates')}>
              <Typography variant="body2">{dateLabel ?? dash}</Typography>
            </Field>
          )}

          {model.kind === 'person' && (
            <>
              <Field label="Dynasties / nationalities" highlight={hl.has('nationalities')}>
                <Typography variant="body2">
                  {model.nationalities.length ? model.nationalities.join(', ') : dash}
                </Typography>
              </Field>

              <Field label="Origin" highlight={hl.has('origins')}>
                <Typography variant="body2">
                  {model.placesOfOrigin.length ? model.placesOfOrigin.join(', ') : dash}
                </Typography>
              </Field>

              <Field label="Roles" highlight={hl.has('roles')}>
                <Typography variant="body2">
                  {model.roles?.length ? model.roles.join(', ') : dash}
                </Typography>
              </Field>

              <Field label="Noble titles" highlight={hl.has('nobleTitles')}>
                <Typography variant="body2">
                  {model.nobleTitles?.length ? model.nobleTitles.join(', ') : dash}
                </Typography>
              </Field>
            </>
          )}

          {model.kind === 'place' && (
            <Field label="Coordinates" highlight={hl.has('location')}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Typography variant="body2">
                  {model.location
                    ? `${model.location.lat.toFixed(4)}, ${model.location.lon.toFixed(4)}`
                    : dash}
                </Typography>
                {model.location && (
                  <SourceBadges label={model.location.source ?? 'authority'} compact />
                )}
              </Stack>
            </Field>
          )}

          <Field label="Description" highlight={hl.has('description')}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {model.description?.trim() ? model.description : dash}
            </Typography>
          </Field>

          {model.subtype && (
            <Field label="Sub-type" highlight={hl.has('subtype')}>
              <Typography variant="body2">{model.subtype}</Typography>
            </Field>
          )}

          <Field label="Authorities" highlight={hl.has('authorities')}>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              {model.authorities.length === 0
                ? dash
                : model.authorities.map((auth, index) => (
                    <Chip
                      key={`${auth.type}-${auth.value}-${index}`}
                      size="small"
                      variant="outlined"
                      icon={<SourceBadges label={auth.type} compact />}
                      label={auth.value}
                    />
                  ))}
            </Stack>
          </Field>
        </Stack>
      )}
    </Box>
  );
};
