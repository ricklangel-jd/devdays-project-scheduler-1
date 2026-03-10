'use client';

import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';
import Alert from '@mui/material/Alert';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import PiSprintAssigner from './PiSprintAssigner';
import type { PiSprintAssignment } from '@/shared/types';

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

interface TimeSpentSidebarContentProps {
  projectKey?: string;
  piLabels: string[];
  boardId?: number;
  piSprints: PiSprintAssignment[];
  isLoading?: boolean;
  onPILabelsChange: (labels: string[]) => void;
  onPiSprintsChange: (assignments: PiSprintAssignment[]) => void;
}

const TimeSpentSidebarContent = ({
  projectKey,
  piLabels,
  boardId,
  piSprints,
  isLoading = false,
  onPILabelsChange,
  onPiSprintsChange,
}: TimeSpentSidebarContentProps) => {
  const hasProjectSelected = !!projectKey;
  const hasPIsSelected = piLabels.length > 0;
  const hasBoardSelected = !!boardId;
  const hasSprintsAssigned = piSprints.some((ps) => ps.sprintIds.length > 0);

  const selectedPIOptions = PI_OPTIONS.filter((opt) =>
    piLabels.includes(opt.label)
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
                <Checkbox
                  icon={icon}
                  checkedIcon={checkedIcon}
                  sx={{ mr: 1 }}
                  checked={selected}
                />
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

      {/* Step 2: Associate Sprints to PIs */}
      {hasBoardSelected && hasPIsSelected && (
        <Box>
          <Typography
            variant="subtitle2"
            gutterBottom
            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <StepCircle step={2} done={hasSprintsAssigned} />
            Associate Sprints to PIs
          </Typography>
          <PiSprintAssigner
            piLabels={piLabels}
            boardId={boardId!}
            piSprints={piSprints}
            onChange={onPiSprintsChange}
          />
          {!hasSprintsAssigned && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1, display: 'block' }}
            >
              Assign sprints to at least one PI to view data
            </Typography>
          )}
        </Box>
      )}

      {!hasBoardSelected && hasPIsSelected && (
        <Typography variant="caption" color="text.secondary">
          Select a board to assign sprints
        </Typography>
      )}

      {/* Status indicator */}
      {isLoading && (
        <Alert severity="info" sx={{ mt: 1 }}>
          Loading Time Spent data...
        </Alert>
      )}
    </Box>
  );
};

export default TimeSpentSidebarContent;
