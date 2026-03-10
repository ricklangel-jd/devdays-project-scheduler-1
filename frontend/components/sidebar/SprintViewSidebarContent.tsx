'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import EditIcon from '@mui/icons-material/Edit';
import RestoreIcon from '@mui/icons-material/Restore';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { JiraSprint, SprintDateOverride } from '@/shared/types';
import { applySprintDateOverrides, getSprintDateOverride, autoAdjustSprintDates } from '@/shared/utils/sprints';
import { parseDate } from '@/shared/utils/dates';

/* ─── Helpers ─────────────────────────────────────────── */

const toDateInputValue = (dateStr: string): string =>
  parseDate(dateStr).toFormat('yyyy-MM-dd');

const formatDateDisplay = (dateStr: string): string =>
  parseDate(dateStr).toFormat('MMM d');

interface SprintOverlap {
  sprint1: JiraSprint;
  sprint2: JiraSprint;
}

function detectSprintOverlaps(
  sprints: JiraSprint[],
  selectedSprintIds: number[],
): SprintOverlap[] {
  const selected = sprints
    .filter((s) => selectedSprintIds.includes(s.id))
    .filter((s) => s.startDate && s.endDate)
    .sort((a, b) => parseDate(a.startDate).toMillis() - parseDate(b.startDate).toMillis());

  const overlaps: SprintOverlap[] = [];
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      const s1 = selected[i];
      const s2 = selected[j];
      const start1 = parseDate(s1.startDate).toMillis();
      const end1 = parseDate(s1.endDate).toMillis();
      const start2 = parseDate(s2.startDate).toMillis();
      const end2 = parseDate(s2.endDate).toMillis();
      if (start1 <= end2 && start2 <= end1) {
        overlaps.push({ sprint1: s1, sprint2: s2 });
      }
    }
  }
  return overlaps;
}

/* ─── SprintChipWithDateEdit ─────────────────────────── */

interface SprintChipWithDateEditProps {
  sprint: JiraSprint;
  originalSprint: JiraSprint;
  isOverridden: boolean;
  onSaveDates: (startDate: string, endDate: string) => void;
  onResetDates: () => void;
}

const SprintChipWithDateEdit = ({
  sprint,
  originalSprint,
  isOverridden,
  onSaveDates,
  onResetDates,
}: SprintChipWithDateEditProps) => {
  const [expanded, setExpanded] = useState(false);
  const sprintStartDate = toDateInputValue(sprint.startDate);
  const sprintEndDate = toDateInputValue(sprint.endDate);
  const [startDate, setStartDate] = useState(sprintStartDate);
  const [endDate, setEndDate] = useState(sprintEndDate);

  const handleToggleExpanded = () => {
    if (expanded) {
      setStartDate(sprintStartDate);
      setEndDate(sprintEndDate);
    }
    setExpanded(!expanded);
  };

  const handleSave = () => {
    onSaveDates(startDate, endDate);
    setExpanded(false);
  };

  const handleReset = () => {
    onResetDates();
    setStartDate(toDateInputValue(originalSprint.startDate));
    setEndDate(toDateInputValue(originalSprint.endDate));
    setExpanded(false);
  };

  const chipLabel = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <span>{sprint.name}</span>
      <Typography component="span" variant="caption" sx={{ opacity: 0.8, fontSize: '10px' }}>
        ({formatDateDisplay(sprint.startDate)} - {formatDateDisplay(sprint.endDate)})
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ width: '100%' }}>
      <Chip
        label={chipLabel}
        size="small"
        onClick={handleToggleExpanded}
        icon={isOverridden ? <EditIcon sx={{ fontSize: 14 }} /> : undefined}
        sx={{
          maxWidth: '100%',
          '& .MuiChip-label': { display: 'flex', alignItems: 'center' },
          bgcolor: isOverridden ? 'warning.light' : undefined,
          '&:hover': { bgcolor: isOverridden ? 'warning.main' : undefined },
        }}
      />
      <Collapse in={expanded}>
        <Paper variant="outlined" sx={{ p: 1.5, mt: 0.5, bgcolor: 'grey.50' }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Edit sprint dates (JIRA: {formatDateDisplay(originalSprint.startDate)} - {formatDateDisplay(originalSprint.endDate)})
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <TextField
              label="Start"
              type="date"
              size="small"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ flex: 1 }}
            />
            <TextField
              label="End"
              type="date"
              size="small"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ flex: 1 }}
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            {isOverridden && (
              <Button size="small" variant="outlined" startIcon={<RestoreIcon />} onClick={handleReset}>
                Reset
              </Button>
            )}
            <Button size="small" variant="contained" onClick={handleSave}>
              Save
            </Button>
          </Box>
        </Paper>
      </Collapse>
    </Box>
  );
};

/* ─── StepCircle ─────────────────────────────────────── */

const StepCircle = ({ step, done }: { step: number; done: boolean }) => (
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

/* ─── Main component ─────────────────────────────────── */

interface SprintViewSidebarContentProps {
  boardId?: number;
  futureSprintCount: number;
  isGenerating?: boolean;
  sprintDateOverrides?: SprintDateOverride[];
  autoAdjustDates?: boolean;
  onFutureSprintCountChange: (count: number) => void;
  onComputedSprintIds: (ids: number[]) => void;
  onSprintOverlapChange?: (hasOverlap: boolean) => void;
  onSprintDateOverride?: (sprintId: number, startDate: string, endDate: string) => void;
  onClearSprintDateOverride?: (sprintId: number) => void;
  onAutoAdjustDatesChange?: (enabled: boolean) => void;
}

const SprintViewSidebarContent = ({
  boardId,
  futureSprintCount,
  isGenerating = false,
  sprintDateOverrides = [],
  autoAdjustDates = true,
  onFutureSprintCountChange,
  onComputedSprintIds,
  onSprintOverlapChange,
  onSprintDateOverride,
  onClearSprintDateOverride,
  onAutoAdjustDatesChange,
}: SprintViewSidebarContentProps) => {
  const [allSprints, setAllSprints] = useState<JiraSprint[]>([]);
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [sprintsError, setSprintsError] = useState<string | null>(null);

  // Fetch sprints when boardId changes
  useEffect(() => {
    if (!boardId) {
      setAllSprints([]);
      return;
    }
    setAllSprints([]);
    let cancelled = false;

    const fetchSprints = async () => {
      setSprintsLoading(true);
      setSprintsError(null);
      try {
        const params = new URLSearchParams();
        params.set('boardId', boardId.toString());
        const response = await fetch(`/api/sprints?${params}`);
        const data = await response.json();
        if (cancelled) return;
        if (data.error) {
          setSprintsError(data.message || data.error);
          setAllSprints([]);
        } else {
          const sprints = (data.sprints || []).filter(
            (s: JiraSprint) => s.startDate && s.endDate,
          );
          setAllSprints(sprints);
        }
      } catch {
        if (!cancelled) {
          setSprintsError('Failed to load sprints');
          setAllSprints([]);
        }
      } finally {
        if (!cancelled) setSprintsLoading(false);
      }
    };

    fetchSprints();
    return () => { cancelled = true; };
  }, [boardId]);

  // Compute sprint IDs: active + N future sprints (by start date)
  const { activeSprint, computedSprintIds, futureCount } = useMemo(() => {
    if (allSprints.length === 0) {
      return { activeSprint: null as JiraSprint | null, computedSprintIds: [] as number[], futureCount: 0 };
    }

    const active = allSprints.find((s) => s.state === 'active') ?? null;

    const future = allSprints
      .filter((s) => s.state === 'future' && s.startDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    const futureSprints = future.slice(0, futureSprintCount);

    const ids: number[] = [];
    const seen = new Set<number>();

    if (active) {
      ids.push(active.id);
      seen.add(active.id);
    }
    for (const s of futureSprints) {
      if (!seen.has(s.id)) {
        ids.push(s.id);
        seen.add(s.id);
      }
    }

    return { activeSprint: active, computedSprintIds: ids, futureCount: futureSprints.length };
  }, [allSprints, futureSprintCount]);

  // Report computed sprint IDs to parent whenever they change
  const prevIdsRef = useRef<string>('');
  useEffect(() => {
    const key = computedSprintIds.join(',');
    if (key !== prevIdsRef.current) {
      prevIdsRef.current = key;
      onComputedSprintIds(computedSprintIds);
    }
  }, [computedSprintIds, onComputedSprintIds]);

  // Get full sprint objects for display (original JIRA data)
  const selectedSprintsOriginal = useMemo(() => {
    const sprintMap = new Map(allSprints.map((s) => [s.id, s]));
    return computedSprintIds
      .map((id) => sprintMap.get(id))
      .filter((s): s is JiraSprint => s !== undefined);
  }, [allSprints, computedSprintIds]);

  // Apply auto-adjust and date overrides for effective dates
  const selectedSprints = useMemo(() => {
    let sprints = selectedSprintsOriginal;
    if (autoAdjustDates) {
      sprints = autoAdjustSprintDates(sprints);
    }
    return applySprintDateOverrides(sprints, sprintDateOverrides);
  }, [selectedSprintsOriginal, sprintDateOverrides, autoAdjustDates]);

  // Overlap detection
  const overlaps = useMemo(
    () => detectSprintOverlaps(selectedSprints, computedSprintIds),
    [selectedSprints, computedSprintIds],
  );

  useEffect(() => {
    onSprintOverlapChange?.(overlaps.length > 0);
  }, [overlaps.length, onSprintOverlapChange]);

  const handleCountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 0 && val <= 20) {
      onFutureSprintCountChange(val);
    }
  }, [onFutureSprintCountChange]);

  const hasBoard = !!boardId;
  const hasData = computedSprintIds.length > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Step 1: Sprint Range */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <StepCircle step={1} done={hasData && overlaps.length === 0} />
          <Typography variant="subtitle2">Sprint Range</Typography>
          {isGenerating && <CircularProgress size={16} />}
        </Box>

        {!hasBoard ? (
          <Typography variant="body2" color="text.secondary" sx={{ pl: 3.5 }}>
            Select a board first
          </Typography>
        ) : sprintsLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 3.5 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              Loading sprints...
            </Typography>
          </Box>
        ) : sprintsError ? (
          <Typography variant="body2" color="error" sx={{ pl: 3.5 }}>
            {sprintsError}
          </Typography>
        ) : (
          <Box sx={{ pl: 3.5 }}>
            <TextField
              type="number"
              size="small"
              label="Future Sprints"
              value={futureSprintCount}
              onChange={handleCountChange}
              inputProps={{ min: 0, max: 20 }}
              sx={{ width: 140 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {activeSprint
                ? `Current: ${activeSprint.name}`
                : 'No active sprint detected'}
              {futureCount > 0 && ` + ${futureCount} future sprint${futureCount !== 1 ? 's' : ''}`}
            </Typography>

            {/* Auto-adjust toggle */}
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={autoAdjustDates}
                    onChange={(e) => onAutoAdjustDatesChange?.(e.target.checked)}
                  />
                }
                label={
                  <Typography variant="caption" color="text.secondary">
                    Auto-adjust sprint dates
                  </Typography>
                }
                sx={{ mr: 0.5 }}
              />
              <Tooltip
                title="When enabled: sprints starting after 5PM are moved to begin the next day, and sprints ending before 8AM are moved to end previous workday."
                arrow
                placement="top"
              >
                <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
              </Tooltip>
            </Box>

            {/* Overlap warning */}
            {overlaps.length > 0 && (
              <Alert severity="error" sx={{ mt: 1 }}>
                Sprint overlap detected: {overlaps.map((o) =>
                  `"${o.sprint1.name}" and "${o.sprint2.name}"`
                ).join(', ')}. Please resolve overlapping sprint dates before generating.
              </Alert>
            )}

            {/* Sprint chips with date editing */}
            {selectedSprints.length > 0 && (
              <Paper variant="outlined" sx={{ p: 1, mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  Selected sprints ({selectedSprints.length}) - click to edit dates
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {selectedSprints.map((sprint, index) => {
                    const originalSprint = selectedSprintsOriginal[index];
                    const override = getSprintDateOverride(sprint.id, sprintDateOverrides);
                    const isOverridden = !!override;

                    return (
                      <SprintChipWithDateEdit
                        key={sprint.id}
                        sprint={sprint}
                        originalSprint={originalSprint}
                        isOverridden={isOverridden}
                        onSaveDates={(sd, ed) => {
                          onSprintDateOverride?.(sprint.id, sd, ed);
                        }}
                        onResetDates={() => {
                          onClearSprintDateOverride?.(sprint.id);
                        }}
                      />
                    );
                  })}
                </Box>
              </Paper>
            )}
          </Box>
        )}
      </Box>

      {/* Status indicator */}
      {isGenerating && (
        <Alert severity="info" sx={{ mt: 1 }}>
          Updating schedule...
        </Alert>
      )}
    </Box>
  );
};

export default SprintViewSidebarContent;
