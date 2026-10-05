import { Stack, Typography } from '@mui/material';

export interface LabelProps {
  /** Shown in Collection's side card, not here. */
  documentation?: string;
  fullName?: string;
  invalid?: boolean;
  name: string;
}

export const Label = ({ fullName, invalid, name }: LabelProps) => {
  return (
    <Stack sx={{ flexGrow: 1 }}>
      <Typography
        color={invalid ? 'textSecondary' : 'textPrimary'}
        variant="body2"
        sx={{ fontSize: '0.8125rem', lineHeight: 1.4 }}
      >
        {name}
      </Typography>
      {fullName && (
        <Typography
          color="textSecondary"
          textTransform="capitalize"
          variant="caption"
          sx={{ fontSize: '0.6875rem', lineHeight: 1.3 }}
        >
          {fullName}
        </Typography>
      )}
    </Stack>
  );
};
