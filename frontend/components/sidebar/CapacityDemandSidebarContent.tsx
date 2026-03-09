'use client';

import { useCallback } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Checkbox from '@mui/material/Checkbox';
import Alert from '@mui/material/Alert';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import ProjectSearch from './ProjectSearch';
import BoardSelector from './BoardSelector';
import PiSprintAssigner from './PiSprintAssigner';
import type { JiraProject, PiSprintAssignment } from '@/shared/types';

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
  boardId?: number;
  piSprints: PiSprintAssignment[];
  developerCount: number;
  supportPercent: number;
  piDaysOff: Record<string, number>;
  isGenerating?: boolean;
  onProjectSelect: (project: JiraProject) => void;
  onPILabelsChange: (labels: string[]) => void;
  onBoardSelect: (boardId: number) => void;
  onPiSprintsChange: (assignments: PiSprintAssignment[]) => void;
  onDeveloperCountChange: (count: number) => void;
  onSupportPercentChange: (pct: number) => void;
  onPiDaysOffChange: (piDaysOff: Record<string, number>) => void;
}

const CapacityDemandSidebarContent = ({
  projectKey,
  piLabels,
  boardId,
  piSprints,
  developerCount,
  supportPercent,
  piDaysOff,
  isGenerating = false,
  onProjectSelect,
  onPILabelsChange,
  onBoardSelect,
  onPiSprintsChange,
  onDeveloperCountChange,
  onSupportPercentChange,
  onPiDaysOffChange,
}: CapacityDemandSidebarContentProps) => {
  const hasProjectSelected = !!projectKey;
  const hasPIsSelected = piLabels.length > 0;
  const hasTeamSize = developerCount > 0;
  const hasBoardSelected = !!boardId;
  const hasSprintsAssigned = piSprints.some((ps) => ps.sprintIds.length > 0);

  const handleProjectSelect = useCallback(
    (project: JiraProject) => {
      onProjectSelect(project);
    },
    [onProjectSelect]
  );

  // Find selected PI option objects from the labels
  const selectedPIOptions = PI_OPTIONS.filter((opt) =>
    piLabels.includes(opt.label)
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Step 1: Project Selection */}
      <Box>
        <Typography
          variant="subtitle2"
          gutterBottom
          sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <StepCircle step={1} done={hasProjectSelected} />
          Select Project
        </Typography>
        <ProjectSearch
          onProjectSelect={handleProjectSelect}
          selectedProjectKey={projectKey}
        />
        {projectKey && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 0.5, display: 'block' }}
          >
            Selected: {projectKey}
          </Typography>
        )}
      </Box>

      <Divider />

      {/* Step 2: Select PIs */}
      <Box sx={{ opacity: hasProjectSelected ? 1 : 0.5 }}>
        <Typography
          variant="subtitle2"
          gutterBottom
          sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <StepCircle step={2} done={hasPIsSelected} />
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

      {/* Step 3: Team Size */}
      <Box sx={{ opacity: hasPIsSelected ? 1 : 0.5 }}>
        <Typography
          variant="subtitle2"
          gutterBottom
          sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <StepCircle step={3} done={hasTeamSize} />
          Team Size
        </Typography>
        <TextField
          type="number"
          size="small"
          fullWidth
          value={developerCount}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 1 && val <= 15) {
              onDeveloperCountChange(val);
            }
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
            if (!isNaN(val) && val >= 0 && val <= 100) {
              onSupportPercentChange(val);
            }
          }}
          disabled={!hasPIsSelected}
          inputProps={{ min: 0, max: 100 }}
          helperText="Percentage of capacity reserved for support work."
          sx={{ mt: 1.5 }}
        />
      </Box>

      {/* Per-PI Days Off — only show when PIs are selected */}
      {hasPIsSelected && piLabels.length > 0 && (
        <>
          <Divider />
          <Box>
            <Typography
              variant="subtitle2"
              gutterBottom
            >
              Days Off per PI (Optional)
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mb: 1.5, display: 'block' }}
            >
              Subtract days from capacity (e.g., holidays, vacations).
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {piLabels.map((piLabel) => (
                <Box
                  key={piLabel}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <Typography
                    variant="body2"
                    sx={{ minWidth: 80, fontWeight: 500 }}
                  >
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
                      // Remove zero entries to keep URL clean
                      if (days === 0) delete updated[piLabel];
                      onPiDaysOffChange(updated);
                    }}
                    inputProps={{ min: 0, max: 60 }}
                    sx={{ width: 80 }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    days
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </>
      )}

      <Divider />

      {/* Optional: Sprint Filtering */}
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ letterSpacing: 1.5, fontSize: 10 }}
      >
        Sprint Filtering (Optional)
      </Typography>

      {/* Step 4: Select Board */}
      <Box sx={{ opacity: hasPIsSelected ? 1 : 0.5 }}>
        <Typography
          variant="subtitle2"
          gutterBottom
          sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <StepCircle step={4} done={hasBoardSelected} />
          Select Board
        </Typography>
        <BoardSelector
          projectKey={projectKey}
          selectedBoardId={boardId}
          onBoardSelect={onBoardSelect}
          disabled={!hasPIsSelected}
        />
        {!hasPIsSelected && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 0.5, display: 'block' }}
          >
            Select PIs first
          </Typography>
        )}
      </Box>

      {/* Step 5: Associate Sprints to PIs */}
      {hasBoardSelected && hasPIsSelected && (
        <>
          <Divider />
          <Box>
            <Typography
              variant="subtitle2"
              gutterBottom
              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <StepCircle step={5} done={hasSprintsAssigned} />
              Associate Sprints to PIs
            </Typography>
            <PiSprintAssigner
              piLabels={piLabels}
              boardId={boardId!}
              piSprints={piSprints}
              onChange={onPiSprintsChange}
            />
          </Box>
        </>
      )}

      {/* Status indicator */}
      {isGenerating && (
        <Alert severity="info" sx={{ mt: 1 }}>
          Loading PI data...
        </Alert>
      )}
    </Box>
  );
};

export default CapacityDemandSidebarContent;
