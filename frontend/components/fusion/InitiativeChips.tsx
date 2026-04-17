'use client';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import type { JiraInitiative } from '@/shared/types';

interface InitiativeChipsProps {
  initiatives: JiraInitiative[];
  onRemove: (key: string) => void;
}

const truncate = (s: string, max = 40) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

const InitiativeChips = ({ initiatives, onRemove }: InitiativeChipsProps) => {
  if (initiatives.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Typography variant="caption" color="text.secondary">
        Loaded initiatives:
      </Typography>
      {initiatives.map((i) => (
        <Chip
          key={i.key}
          label={`${i.key} — ${truncate(i.summary)}`}
          onDelete={() => onRemove(i.key)}
          size="small"
          variant="outlined"
        />
      ))}
    </Box>
  );
};

export default InitiativeChips;
