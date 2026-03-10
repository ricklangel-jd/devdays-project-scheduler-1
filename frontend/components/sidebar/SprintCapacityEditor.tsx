'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import EditIcon from '@mui/icons-material/Edit';
import RestoreIcon from '@mui/icons-material/Restore';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { JiraSprint, SprintCapacity, SprintDateOverride } from '@/shared/types';
import { applySprintDateOverrides, getSprintDateOverride, autoAdjustSprintDates } from '@/shared/utils/sprints';
import { parseDate } from '@/shared/utils/dates';

interface SprintOverlap {
  sprint1: JiraSprint;
  sprint2: JiraSprint;
}

/**
 * Detect overlapping sprints from selected sprints.
 * Uses parseDate to convert UTC dates to NEXT_PUBLIC_TIMEZONE.
 * Overlaps are detected at the date level (not time) - if one sprint ends on
 * the same day another starts, both "own" that day, so it's a conflict.
 */
function detectSprintOverlaps(
  sprints: JiraSprint[],
  selectedSprintIds: number[]
): SprintOverlap[] {
  const selectedSprints = sprints
    .filter((s) => selectedSprintIds.includes(s.id))
    .filter((s) => s.startDate && s.endDate)
    .sort((a, b) => parseDate(a.startDate).toMillis() - parseDate(b.startDate).toMillis());

  const overlaps: SprintOverlap[] = [];

  for (let i = 0; i < selectedSprints.length; i++) {
    for (let j = i + 1; j < selectedSprints.length; j++) {
      const sprint1 = selectedSprints[i];
      const sprint2 = selectedSprints[j];

      // Parse to dates in configured timezone (strips time component)
      const start1 = parseDate(sprint1.startDate).toMillis();
      const end1 = parseDate(sprint1.endDate).toMillis();
      const start2 = parseDate(sprint2.startDate).toMillis();
      const end2 = parseDate(sprint2.endDate).toMillis();

      // Date-based overlap: if sprint1 ends on or after sprint2 starts (and vice versa)
      // Example: Sprint1 ends Feb 4, Sprint2 starts Feb 4 = overlap (both own Feb 4)
      const hasOverlap = start1 <= end2 && start2 <= end1;

      if (hasOverlap) {
        overlaps.push({ sprint1, sprint2 });
      }
    }
  }

  return overlaps;
}

interface SprintCapacityEditorProps {
  sprintCapacities: SprintCapacity[];
  onChange: (capacities: SprintCapacity[]) => void;
  onOverlapError?: (hasOverlap: boolean) => void;
  defaultCapacity?: number;
  boardId?: number;
  projectKey?: string;
  sprintDateOverrides?: SprintDateOverride[];
  onSprintDateOverride?: (sprintId: number, startDate: string, endDate: string) => void;
  onClearSprintDateOverride?: (sprintId: number) => void;
  autoAdjustDates?: boolean;
  onAutoAdjustDatesChange?: (enabled: boolean) => void;
}

const DEBOUNCE_DELAY = 300;

interface SprintChipWithDateEditProps {
  sprint: JiraSprint;
  originalSprint: JiraSprint;
  isOverridden: boolean;
  onRemove: () => void;
  onSaveDates: (startDate: string, endDate: string) => void;
  onResetDates: () => void;
}

/** Convert a date string to YYYY-MM-DD format in the configured timezone */
const toDateInputValue = (dateStr: string): string => {
  return parseDate(dateStr).toFormat('yyyy-MM-dd');
};

/** Format a date string for display (e.g., "Jan 28") in the configured timezone */
const formatDateDisplay = (dateStr: string): string => {
  return parseDate(dateStr).toFormat('MMM d');
};

const SprintChipWithDateEdit = ({
  sprint,
  originalSprint,
  isOverridden,
  onRemove,
  onSaveDates,
  onResetDates,
}: SprintChipWithDateEditProps) => {
  const [expanded, setExpanded] = useState(false);
  // Use sprint dates as initial value, converted to the configured timezone
  const sprintStartDate = toDateInputValue(sprint.startDate);
  const sprintEndDate = toDateInputValue(sprint.endDate);
  const [startDate, setStartDate] = useState(sprintStartDate);
  const [endDate, setEndDate] = useState(sprintEndDate);

  // Reset form values when collapsing or when sprint data changes externally
  const handleToggleExpanded = () => {
    if (expanded) {
      // Reset to current sprint values when collapsing
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
    const originalStart = toDateInputValue(originalSprint.startDate);
    const originalEnd = toDateInputValue(originalSprint.endDate);
    setStartDate(originalStart);
    setEndDate(originalEnd);
    setExpanded(false);
  };

  const chipLabel = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <span>{sprint.name}</span>
      <Typography
        component="span"
        variant="caption"
        sx={{ opacity: 0.8, fontSize: '10px' }}
      >
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
        onDelete={onRemove}
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
              slotProps={{
                inputLabel: { shrink: true },
              }}
              sx={{ flex: 1 }}
            />
            <TextField
              label="End"
              type="date"
              size="small"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              slotProps={{
                inputLabel: { shrink: true },
              }}
              sx={{ flex: 1 }}
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            {isOverridden && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<RestoreIcon />}
                onClick={handleReset}
              >
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

const SprintCapacityEditor = ({
  sprintCapacities,
  onChange,
  onOverlapError,
  defaultCapacity = 20,
  boardId,
  projectKey,
  sprintDateOverrides = [],
  onSprintDateOverride,
  onClearSprintDateOverride,
  autoAdjustDates = true,
  onAutoAdjustDatesChange,
}: SprintCapacityEditorProps) => {
  const [options, setOptions] = useState<JiraSprint[]>([]);
  const [selectedSprintsCache, setSelectedSprintsCache] = useState<Map<number, JiraSprint>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchedSprintIdsRef = useRef<Set<number>>(new Set());

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Fetch selected sprint details on mount/when sprintCapacities changes
  useEffect(() => {
    const missingSprintIds = sprintCapacities
      .map((sc) => sc.sprintId)
      .filter((id) => !fetchedSprintIdsRef.current.has(id));

    if (missingSprintIds.length === 0) return;

    // Mark these IDs as being fetched
    for (const id of missingSprintIds) {
      fetchedSprintIdsRef.current.add(id);
    }

    const fetchMissingSprints = async () => {
      try {
        const response = await fetch('/api/sprints/by-ids', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sprintIds: missingSprintIds }),
        });
        const data = await response.json();

        if (data.sprints && Array.isArray(data.sprints)) {
          setSelectedSprintsCache((prev) => {
            const newCache = new Map(prev);
            for (const sprint of data.sprints) {
              newCache.set(sprint.id, sprint);
            }
            return newCache;
          });
        }
      } catch (err) {
        console.error('Failed to fetch selected sprints:', err);
      }
    };

    fetchMissingSprints();
  }, [sprintCapacities]);

  const selectedSprintIds = useMemo(
    () => sprintCapacities.map((sc) => sc.sprintId),
    [sprintCapacities]
  );

  // Debounced fetch sprints
  const fetchSprints = useCallback(async (query: string) => {
    if (boardId === undefined) {
      setOptions([]);
      return;
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('boardId', boardId.toString());
      if (projectKey) {
        params.set('projectKey', projectKey);
      }
      if (query) {
        params.set('q', query);
      }

      const response = await fetch(`/api/sprints?${params}`, {
        signal: abortControllerRef.current?.signal,
      });
      const data = await response.json();

      if (data.error) {
        setError(data.message || data.error);
        setOptions([]);
      } else {
        const sprintsWithDates = (data.sprints || []).filter(
          (sprint: JiraSprint) => sprint.startDate && sprint.endDate
        );
        setOptions(sprintsWithDates);

        // Cache all sprints we receive
        setSelectedSprintsCache((prev) => {
          const newCache = new Map(prev);
          for (const sprint of sprintsWithDates) {
            newCache.set(sprint.id, sprint);
          }
          return newCache;
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return; // Ignore abort errors
      }
      setError('Failed to load sprints');
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  // Debounced input change handler
  const handleInputChange = useCallback((_event: React.SyntheticEvent, value: string, reason: string) => {
    // Only update input value and fetch on actual user input, not on selection changes ("reset") or blur ("clear")
    if (reason !== 'input') {
      return;
    }

    setInputValue(value);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchSprints(value);
    }, DEBOUNCE_DELAY);
  }, [fetchSprints]);

  // Fetch initial sprints when dropdown opens
  const handleOpen = useCallback(() => {
    setOpen(true);
    fetchSprints(inputValue);
  }, [fetchSprints, inputValue]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  // Get selected sprints from cache (original JIRA data)
  const selectedSprintsOriginal = useMemo(() => {
    return selectedSprintIds
      .map((id) => selectedSprintsCache.get(id))
      .filter((sprint): sprint is JiraSprint => sprint !== undefined)
      .sort((a, b) => {
        if (!a.startDate) return 1;
        if (!b.startDate) return -1;
        return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
      });
  }, [selectedSprintIds, selectedSprintsCache]);

  // Apply auto-adjust and date overrides to get effective sprint dates
  // Order: original -> auto-adjust (if enabled) -> manual overrides (take precedence)
  const selectedSprints = useMemo(() => {
    let sprints = selectedSprintsOriginal;
    if (autoAdjustDates) {
      sprints = autoAdjustSprintDates(sprints);
    }
    return applySprintDateOverrides(sprints, sprintDateOverrides);
  }, [selectedSprintsOriginal, sprintDateOverrides, autoAdjustDates]);

  // Use effective sprints (with overrides) for overlap detection
  const overlaps = useMemo(
    () => detectSprintOverlaps(selectedSprints, selectedSprintIds),
    [selectedSprints, selectedSprintIds]
  );

  // Notify parent of overlap state changes
  useEffect(() => {
    onOverlapError?.(overlaps.length > 0);
  }, [overlaps.length, onOverlapError]);

  // Handle sprint selection from dropdown (multi-select)
  const handleSelect = useCallback((_event: React.SyntheticEvent, values: JiraSprint[]) => {
    // Cache all selected sprints
    setSelectedSprintsCache((prev) => {
      const newCache = new Map(prev);
      for (const sprint of values) {
        newCache.set(sprint.id, sprint);
      }
      return newCache;
    });

    // Build new capacities list - keep existing capacities for sprints still selected
    const newSprintIds = new Set(values.map(v => v.id));
    const existingCapacities = sprintCapacities.filter(sc => newSprintIds.has(sc.sprintId));
    const existingIds = new Set(existingCapacities.map(sc => sc.sprintId));

    // Add new sprints with default capacity
    const newCapacities = values
      .filter(v => !existingIds.has(v.id))
      .map(v => ({ sprintId: v.id, devDaysCapacity: defaultCapacity }));

    onChange([...existingCapacities, ...newCapacities]);
  }, [onChange, sprintCapacities, defaultCapacity]);

  // Handle removing a selected sprint
  const handleRemove = useCallback((sprintId: number) => {
    onChange(sprintCapacities.filter((sc) => sc.sprintId !== sprintId));
  }, [onChange, sprintCapacities]);

  if (boardId === undefined) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Select a board to view sprints
        </Typography>
      </Paper>
    );
  }

  return (
    <Box>
      <Autocomplete
        multiple
        open={open}
        onOpen={handleOpen}
        onClose={handleClose}
        options={options}
        loading={loading}
        value={selectedSprintsOriginal}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        onChange={handleSelect}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        filterOptions={(x) => x}
        disableCloseOnSelect
        noOptionsText={error || (inputValue.length === 0 ? 'Type to search sprints...' : 'No sprints found')}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={selectedSprintsOriginal.length === 0 ? "Search sprints..." : "Add more sprints..."}
            size="small"
            error={!!error}
            slotProps={{
              input: {
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loading && <CircularProgress color="inherit" size={16} />}
                    {params.InputProps.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
        renderOption={(props, option) => {
          const { key: _key, ...restProps } = props;
          return (
            <Box component="li" key={option.id} {...restProps}>
              <Box>
                <Typography variant="body2">{option.name}</Typography>
                {option.startDate && option.endDate && (
                  <Typography variant="caption" color="text.secondary">
                    {new Date(option.startDate).toLocaleDateString()} - {new Date(option.endDate).toLocaleDateString()}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        }}
        renderTags={() => null}
        sx={{ mb: 1 }}
      />

      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
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

      {overlaps.length > 0 && (
        <Alert severity="error" sx={{ mb: 1 }}>
          Sprint overlap detected: {overlaps.map((o) =>
            `"${o.sprint1.name}" and "${o.sprint2.name}"`
          ).join(', ')}. Please resolve overlapping sprint dates before generating.
        </Alert>
      )}

      {selectedSprints.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1 }}>
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
                  onRemove={() => handleRemove(sprint.id)}
                  onSaveDates={(startDate, endDate) => {
                    onSprintDateOverride?.(sprint.id, startDate, endDate);
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
  );
};

export default SprintCapacityEditor;
