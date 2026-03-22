'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
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

interface TimeSpentSidebarContentProps {
  projectKey?: string;
  piLabels: string[];
  boardId?: number;
  piSprints: PiSprintAssignment[];
  isLoading?: boolean;
  /** undefined = not yet loaded, true = exists in Jira, false = doesn't exist */
  piSprintsExistInJira: Record<string, boolean | undefined>;
  onSavePiSprints: (piLabel: string) => void;
  isSavingPiSprints: Record<string, boolean>;
  onPILabelsChange: (labels: string[]) => void;
  onPiSprintsChange: (assignments: PiSprintAssignment[]) => void;
}

const TimeSpentSidebarContent = ({
  projectKey,
  piLabels,
  boardId,
  piSprints,
  isLoading = false,
  piSprintsExistInJira,
  onSavePiSprints,
  isSavingPiSprints,
  onPILabelsChange,
  onPiSprintsChange,
}: TimeSpentSidebarContentProps) => {
  const hasProjectSelected = !!projectKey;
  const hasPIsSelected = piLabels.length > 0;
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
    if (idx >= 0) updated[idx] = { piLabel, sprintIds: ids };
    else updated.push({ piLabel, sprintIds: ids });
    onPiSprintsChange(updated.filter((a) => a.sprintIds.length > 0));
  }, [piSprints, onPiSprintsChange]);

  const selectedPIOptions = PI_OPTIONS.filter((opt) => piLabels.includes(opt.label));

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
            <TextField {...params} size="small" placeholder={hasPIsSelected ? '' : 'Select PIs...'} />
          )}
          size="small"
        />
        {!hasProjectSelected && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
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
                    {existsInJira === false && (
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

          {!hasSprintsAssigned && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
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

      {isLoading && (
        <Alert severity="info" sx={{ mt: 1 }}>Loading Time Spent data...</Alert>
      )}
    </Box>
  );
};

export default TimeSpentSidebarContent;
