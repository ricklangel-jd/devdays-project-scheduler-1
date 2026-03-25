'use client';

import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Checkbox from '@mui/material/Checkbox';
import Alert from '@mui/material/Alert';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';

const icon = <CheckBoxOutlineBlankIcon fontSize="small" />;
const checkedIcon = <CheckBoxIcon fontSize="small" />;

// Generate all PI label options: PI1_2025 through PI4_2027
const PI_OPTIONS = (() => {
  const options: { label: string; year: number; quarter: number }[] = [];
  for (let year = 2025; year <= 2027; year++) {
    for (let q = 1; q <= 4; q++) {
      options.push({ label: `PI${q}_${year}`, year, quarter: q });
    }
  }
  return options;
})();

interface StepCircleProps {
  step: number;
  done: boolean;
}

const StepCircle = ({ step, done }: StepCircleProps) => (
  <Box
    component="span"
    sx={{
      width: 20,
      height: 20,
      borderRadius: '50%',
      bgcolor: done ? 'success.main' : 'grey.400',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 12,
      fontWeight: 'bold',
    }}
  >
    {step}
  </Box>
);

interface CapacityDemandSidebarContentProps {
  projectKey?: string;
  piLabels: string[];
  developerCount?: number;
  supportPercent?: number;
  piDaysOff?: Record<string, number>;
  isGenerating?: boolean;
  /** When false, hides the manual Team Size / Support% / Days Off controls (used when capacity comes from Jira) */
  showCapacityControls?: boolean;
  onPILabelsChange: (labels: string[]) => void;
  onDeveloperCountChange?: (count: number) => void;
  onSupportPercentChange?: (pct: number) => void;
  onPiDaysOffChange?: (piDaysOff: Record<string, number>) => void;
}

const CapacityDemandSidebarContent = ({
  projectKey,
  piLabels,
  developerCount = 5,
  supportPercent = 10,
  piDaysOff = {},
  isGenerating = false,
  showCapacityControls = true,
  onPILabelsChange,
  onDeveloperCountChange,
  onSupportPercentChange,
  onPiDaysOffChange,
}: CapacityDemandSidebarContentProps) => {
  const hasProjectSelected = !!projectKey;
  const hasPIsSelected = piLabels.length > 0;
  const hasTeamSize = developerCount > 0;

  const selectedPIOptions = useMemo(
    () => PI_OPTIONS.filter((opt) => piLabels.includes(opt.label)),
    [piLabels]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Step 1: Select PIs */}
      <Box sx={{ opacity: hasProjectSelected ? 1 : 0.5 }}>
        <Typography
          variant="subtitle2"
          gutterBottom
          sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <StepCircle step={1} done={hasPIsSelected} />
          Select Planning Increments
        </Typography>
        <Autocomplete
          multiple
          disableCloseOnSelect
          disabled={!hasProjectSelected}
          options={PI_OPTIONS}
          value={selectedPIOptions}
          groupBy={(option) => `${option.year}`}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(option, value) => option.label === value.label}
          onChange={(_event, newValue) => {
            onPILabelsChange(newValue.map((opt) => opt.label));
          }}
          renderOption={(props, option, { selected }) => {
            const { key, ...rest } = props;
            return (
              <li key={key} {...rest}>
                <Checkbox icon={icon} checkedIcon={checkedIcon} sx={{ mr: 1 }} checked={selected} />
                {option.label}
              </li>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              placeholder={hasPIsSelected ? '' : 'Select PIs...'}
            />
          )}
          size="small"
        />
        {!hasProjectSelected && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Select a project first
          </Typography>
        )}
      </Box>

      {showCapacityControls && (
        <>
          <Divider />

          {/* Step 2: Team Size */}
          <Box sx={{ opacity: hasPIsSelected ? 1 : 0.5 }}>
            <Typography
              variant="subtitle2"
              gutterBottom
              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <StepCircle step={2} done={hasTeamSize} />
              Team Size
            </Typography>
            <TextField
              type="number"
              size="small"
              fullWidth
              value={developerCount}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 1 && val <= 15) onDeveloperCountChange?.(val);
              }}
              disabled={!hasPIsSelected}
              inputProps={{ min: 1, max: 15 }}
              helperText="Number of developers. Used to calculate capacity per PI quarter."
            />
            <TextField
              type="number"
              size="small"
              fullWidth
              label="% Support Time"
              value={supportPercent}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 0 && val <= 100) onSupportPercentChange?.(val);
              }}
              disabled={!hasPIsSelected}
              inputProps={{ min: 0, max: 100 }}
              helperText="Percentage of capacity reserved for support work."
              sx={{ mt: 1.5 }}
            />
          </Box>

          {/* Per-PI Days Off */}
          {hasPIsSelected && (
            <>
              <Divider />
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Days Off per PI (Optional)
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
                  Subtract days from capacity (e.g., holidays, vacations).
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {piLabels.map((piLabel) => (
                    <Box key={piLabel} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ minWidth: 80, fontWeight: 500 }}>
                        {piLabel}
                      </Typography>
                      <TextField
                        type="number"
                        size="small"
                        value={piDaysOff[piLabel] ?? 0}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          const days = isNaN(val) ? 0 : Math.max(0, Math.min(val, 60));
                          const updated = { ...piDaysOff, [piLabel]: days };
                          if (days === 0) delete updated[piLabel];
                          onPiDaysOffChange?.(updated);
                        }}
                        inputProps={{ min: 0, max: 60 }}
                        sx={{ width: 80 }}
                      />
                      <Typography variant="caption" color="text.secondary">days</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            </>
          )}
        </>
      )}

      {isGenerating && (
        <Alert severity="info" sx={{ mt: 1 }}>Loading PI data...</Alert>
      )}
    </Box>
  );
};

export default CapacityDemandSidebarContent;
