'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Checkbox from '@mui/material/Checkbox';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import SaveIcon from '@mui/icons-material/Save';
import type { JiraSprint, PiSprintAssignment } from '@/shared/types';

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

const formatDateShort = (dateStr: string): string => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
};

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
  developerCount?: number;
  supportPercent?: number;
  piDaysOff?: Record<string, number>;
  isGenerating?: boolean;
  /** Whether each PI's sprint story exists in Jira (undefined = still loading). When omitted, Save buttons are hidden. */
  piSprintsExistInJira?: Record<string, boolean | undefined>;
  onSavePiSprints?: (piLabel: string) => void;
  isSavingPiSprints?: Record<string, boolean>;
  /** When true, sprint assignments are required (not optional) */
  sprintsRequired?: boolean;
  /** When false, hides the manual Team Size / Support% / Days Off controls (used when capacity comes from Jira) */
  showCapacityControls?: boolean;
  onPILabelsChange: (labels: string[]) => void;
  onPiSprintsChange: (assignments: PiSprintAssignment[]) => void;
  onDeveloperCountChange?: (count: number) => void;
  onSupportPercentChange?: (pct: number) => void;
  onPiDaysOffChange?: (piDaysOff: Record<string, number>) => void;
}

const CapacityDemandSidebarContent = ({
  projectKey,
  piLabels,
  boardId,
  piSprints,
  developerCount = 5,
  supportPercent = 10,
  piDaysOff = {},
  isGenerating = false,
  piSprintsExistInJira = {},
  onSavePiSprints,
  isSavingPiSprints = {},
  sprintsRequired = false,
  showCapacityControls = true,
  onPILabelsChange,
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

  // ── Sprint loading ────────────────────────────────────────────────

  const [allSprints, setAllSprints] = useState<JiraSprint[]>([]);
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [sprintsError, setSprintsError] = useState<string | null>(null);

  useEffect(() => {
    if (!boardId) { setAllSprints([]); return; }
    let cancelled = false;
    const fetchSprints = async () => {
      setSprintsLoading(true);
      setSprintsError(null);
      try {
        const params = new URLSearchParams({ boardId: boardId.toString() });
        if (projectKey) params.set('projectKey', projectKey);
        const res = await fetch(`/api/sprints?${params}`);
        const json = await res.json();
        if (cancelled) return;
        if (json.error) {
          setSprintsError(json.message || json.error);
          setAllSprints([]);
        } else {
          setAllSprints((json.sprints ?? []).filter((s: JiraSprint) => s.startDate && s.endDate));
        }
      } catch {
        if (!cancelled) { setSprintsError('Failed to load sprints'); setAllSprints([]); }
      } finally {
        if (!cancelled) setSprintsLoading(false);
      }
    };
    fetchSprints();
    return () => { cancelled = true; };
  }, [boardId, projectKey]);

  const sprintMap = useMemo(() => {
    const map = new Map<number, JiraSprint>();
    for (const s of allSprints) map.set(s.id, s);
    return map;
  }, [allSprints]);

  const getSelectedSprints = useCallback((piLabel: string): JiraSprint[] => {
    const assignment = piSprints.find((a) => a.piLabel === piLabel);
    return (assignment?.sprintIds ?? [])
      .map((id) => sprintMap.get(id))
      .filter((s): s is JiraSprint => s !== undefined);
  }, [piSprints, sprintMap]);

  const handleSprintChange = useCallback((piLabel: string, sprints: JiraSprint[]) => {
    const ids = sprints.map((s) => s.id);
    const updated = [...piSprints];
    const idx = updated.findIndex((a) => a.piLabel === piLabel);
    if (idx >= 0) {
      updated[idx] = { piLabel, sprintIds: ids };
    } else {
      updated.push({ piLabel, sprintIds: ids });
    }
    onPiSprintsChange(updated.filter((a) => a.sprintIds.length > 0));
  }, [piSprints, onPiSprintsChange]);

  // Find selected PI option objects from the labels
  const selectedPIOptions = PI_OPTIONS.filter((opt) => piLabels.includes(opt.label));

  // ── Sprint assignment section ─────────────────────────────────────

  const sprintStepNumber = showCapacityControls ? 3 : 2;

  const sprintSection = hasBoardSelected && hasPIsSelected && (
    <Box>
      <Typography
        variant="subtitle2"
        gutterBottom
        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
      >
        <StepCircle step={sprintStepNumber} done={hasSprintsAssigned} />
        Associate Sprints to PIs
      </Typography>

      {sprintsLoading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">Loading sprints...</Typography>
        </Box>
      )}
      {sprintsError && (
        <Typography variant="body2" color="error" sx={{ py: 1 }}>{sprintsError}</Typography>
      )}

      {!sprintsLoading && !sprintsError && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {piLabels.map((piLabel) => {
            const selectedSprints = getSelectedSprints(piLabel);
            const count = selectedSprints.length;
            const existsInJira = piSprintsExistInJira[piLabel];
            const isSaving = isSavingPiSprints[piLabel] ?? false;

            return (
              <Box key={piLabel}>
                <Typography variant="caption" fontWeight="bold" sx={{ mb: 0.5, display: 'block' }}>
                  {piLabel}
                  {count > 0 && (
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      ({count} sprint{count !== 1 ? 's' : ''})
                    </Typography>
                  )}
                </Typography>
                <Autocomplete
                  multiple
                  disableCloseOnSelect
                  size="small"
                  options={allSprints}
                  value={selectedSprints}
                  getOptionLabel={(option) => option.name}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  onChange={(_e, newValue) => handleSprintChange(piLabel, newValue)}
                  renderOption={(props, option, { selected }) => {
                    const { key, ...rest } = props;
                    return (
                      <li key={key} {...rest}>
                        <Checkbox icon={icon} checkedIcon={checkedIcon} sx={{ mr: 1 }} checked={selected} />
                        <Box>
                          <Typography variant="body2">{option.name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDateShort(option.startDate)} – {formatDateShort(option.endDate)}
                          </Typography>
                        </Box>
                      </li>
                    );
                  }}
                  renderInput={(params) => (
                    <TextField {...params} placeholder={count > 0 ? '' : 'Select sprints...'} />
                  )}
                />
                {/* Show Save button only when onSavePiSprints is provided and this PI's story doesn't yet exist in Jira */}
                {onSavePiSprints && existsInJira === false && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={isSaving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                    onClick={() => onSavePiSprints(piLabel)}
                    disabled={isSaving || !projectKey}
                    sx={{ mt: 0.75 }}
                  >
                    Save to JIRA
                  </Button>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {!hasSprintsAssigned && sprintsRequired && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Assign sprints to at least one PI to view data
        </Typography>
      )}
    </Box>
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

      <Divider />

      {/* Step 3: Sprint Assignment */}
      {sprintsRequired ? (
        sprintSection
      ) : (
        <>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontSize: 10 }}>
            Sprint Filtering (Optional)
          </Typography>
          {hasBoardSelected && hasPIsSelected && (
            <>
              <Divider />
              {sprintSection}
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
