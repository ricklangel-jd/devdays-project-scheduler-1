'use client';

import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import SaveIcon from '@mui/icons-material/Save';

// Generate PI label options for the current year and next year
const generatePiOptions = (): { label: string; year: number; quarter: number }[] => {
  const currentYear = new Date().getFullYear();
  const options: { label: string; year: number; quarter: number }[] = [];
  for (let year = currentYear; year <= currentYear + 1; year++) {
    for (let q = 1; q <= 4; q++) {
      options.push({ label: `PI${q}_${year}`, year, quarter: q });
    }
  }
  return options;
};

const PI_OPTIONS = generatePiOptions();

interface PiPlanningSidebarContentProps {
  projectKey?: string;
  selectedPi: string | null;
  onPiChange: (pi: string | null) => void;
  checkedCount: number;
  totalPoints: number;
  isSaving: boolean;
  hasChanges: boolean;
  onSave: () => void;
}

const PiPlanningSidebarContent = ({
  projectKey,
  selectedPi,
  onPiChange,
  checkedCount,
  totalPoints,
  isSaving,
  hasChanges,
  onSave,
}: PiPlanningSidebarContentProps) => {
  const hasProjectSelected = !!projectKey;
  const selectedOption = PI_OPTIONS.find((opt) => opt.label === selectedPi) ?? null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* PI Selection */}
      <Box sx={{ opacity: hasProjectSelected ? 1 : 0.5 }}>
        <Typography variant="subtitle2" gutterBottom>
          Select Planning Increment
        </Typography>
        <Autocomplete
          disabled={!hasProjectSelected}
          options={PI_OPTIONS}
          value={selectedOption}
          groupBy={(option) => `${option.year}`}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(option, value) => option.label === value.label}
          onChange={(_event, newValue) => {
            onPiChange(newValue?.label ?? null);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              placeholder="Select a PI..."
            />
          )}
          size="small"
        />
        {!hasProjectSelected && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 1, display: 'block' }}
          >
            Select a project first
          </Typography>
        )}
      </Box>

      <Divider />

      {/* Running Totals */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Summary
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="body2">
            Epics selected: <strong>{checkedCount}</strong>
          </Typography>
          <Typography variant="body2">
            Total PI points: <strong>{totalPoints}</strong>
          </Typography>
        </Box>
      </Box>

      <Divider />

      {/* Save Button */}
      <Button
        variant="contained"
        startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
        disabled={isSaving || !hasChanges || !selectedPi}
        onClick={onSave}
        fullWidth
      >
        {isSaving ? 'Saving...' : 'Save to Jira'}
      </Button>
    </Box>
  );
};

export default PiPlanningSidebarContent;
