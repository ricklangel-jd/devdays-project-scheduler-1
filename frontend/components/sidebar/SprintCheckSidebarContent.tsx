'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { EPIC_COLORS } from '@/shared/constants';
import type { JiraSprint } from '@/shared/types';

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

interface SprintCheckSidebarContentProps {
  boardId?: number;
  projectKey?: string;
  sprintCount: number;
  isLoading: boolean;
  engineers: string[];
  selectedEngineers: Set<string>;
  highlightedEngineer: string | null;
  onSprintCountChange: (count: number) => void;
  onComputedSprintIds: (ids: number[]) => void;
  onEngineerToggle: (engineer: string) => void;
  onSelectAllEngineers: () => void;
  onDeselectAllEngineers: () => void;
  onEngineerHighlight: (engineer: string) => void;
}

const SprintCheckSidebarContent = ({
  boardId,
  projectKey,
  sprintCount,
  isLoading,
  engineers,
  selectedEngineers,
  highlightedEngineer,
  onSprintCountChange,
  onComputedSprintIds,
  onEngineerToggle,
  onSelectAllEngineers,
  onDeselectAllEngineers,
  onEngineerHighlight,
}: SprintCheckSidebarContentProps) => {
  const [allSprints, setAllSprints] = useState<JiraSprint[]>([]);
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [sprintsError, setSprintsError] = useState<string | null>(null);

  // Fetch sprints when boardId changes
  useEffect(() => {
    if (!boardId) {
      setAllSprints([]);
      return;
    }

    // Clear old board's sprints immediately so computed IDs reset
    setAllSprints([]);

    let cancelled = false;

    const fetchSprints = async () => {
      setSprintsLoading(true);
      setSprintsError(null);

      try {
        const params = new URLSearchParams();
        params.set('boardId', boardId.toString());
        if (projectKey) {
          params.set('projectKey', projectKey);
        }

        const response = await fetch(`/api/sprints?${params}`);
        const data = await response.json();

        if (cancelled) return;

        if (data.error) {
          setSprintsError(data.message || data.error);
          setAllSprints([]);
        } else {
          const sprints = (data.sprints || []).filter(
            (s: JiraSprint) => s.startDate && s.endDate
          );
          setAllSprints(sprints);
        }
      } catch {
        if (!cancelled) {
          setSprintsError('Failed to load sprints');
          setAllSprints([]);
        }
      } finally {
        if (!cancelled) {
          setSprintsLoading(false);
        }
      }
    };

    fetchSprints();
    return () => { cancelled = true; };
  }, [boardId, projectKey]);

  // Compute which sprint IDs to use based on count + fetched sprints
  const { activeSprint, computedSprintIds, pastSprintCount } = useMemo(() => {
    if (allSprints.length === 0) {
      return { activeSprint: null as JiraSprint | null, computedSprintIds: [] as number[], pastSprintCount: 0 };
    }

    // Find the active sprint
    const active = allSprints.find((s) => s.state === 'active') ?? null;

    // Get closed sprints sorted by startDate descending (most recent first)
    const closed = allSprints
      .filter((s) => s.state === 'closed' && s.startDate)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));

    // Take top N closed sprints
    const pastSprints = closed.slice(0, sprintCount);

    // Combine: active + past, deduplicate (in case active is somehow in closed list)
    const ids: number[] = [];
    const seen = new Set<number>();

    if (active) {
      ids.push(active.id);
      seen.add(active.id);
    }

    for (const s of pastSprints) {
      if (!seen.has(s.id)) {
        ids.push(s.id);
        seen.add(s.id);
      }
    }

    return { activeSprint: active, computedSprintIds: ids, pastSprintCount: pastSprints.length };
  }, [allSprints, sprintCount]);

  // Report computed sprint IDs to parent whenever they change
  const prevIdsRef = useRef<string>('');
  useEffect(() => {
    const key = computedSprintIds.join(',');
    if (key !== prevIdsRef.current) {
      prevIdsRef.current = key;
      onComputedSprintIds(computedSprintIds);
    }
  }, [computedSprintIds, onComputedSprintIds]);

  const handleCountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 0 && val <= 20) {
      onSprintCountChange(val);
    }
  }, [onSprintCountChange]);

  const hasBoard = !!boardId;
  const hasData = computedSprintIds.length > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Step 1: Sprint Range */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <StepCircle step={1} done={hasData} />
          <Typography variant="subtitle2">Sprint Range</Typography>
          {isLoading && <CircularProgress size={16} />}
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
              label="Past Sprints"
              value={sprintCount}
              onChange={handleCountChange}
              inputProps={{ min: 0, max: 20 }}
              sx={{ width: 120 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {activeSprint
                ? `Current: ${activeSprint.name}`
                : 'No active sprint detected'}
              {pastSprintCount > 0 && ` + ${pastSprintCount} past sprint${pastSprintCount !== 1 ? 's' : ''}`}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Step 2: Filter Engineers (only visible when data loaded) */}
      {engineers.length > 0 && (
        <>
          <Divider />
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2">Filter Engineers</Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button
                  size="small"
                  variant="text"
                  onClick={onSelectAllEngineers}
                  sx={{ minWidth: 0, px: 1, fontSize: 11, textTransform: 'none' }}
                >
                  All
                </Button>
                <Button
                  size="small"
                  variant="text"
                  onClick={onDeselectAllEngineers}
                  sx={{ minWidth: 0, px: 1, fontSize: 11, textTransform: 'none' }}
                >
                  None
                </Button>
              </Box>
            </Box>

            <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
              {engineers.map((engineer, idx) => {
                const color = EPIC_COLORS[idx % EPIC_COLORS.length];
                const isHighlighted = highlightedEngineer === engineer;
                const isDimmed = highlightedEngineer !== null && !isHighlighted;
                return (
                  <Box
                    key={engineer}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      opacity: isDimmed ? 0.4 : 1,
                      transition: 'opacity 0.2s ease',
                    }}
                  >
                    <Checkbox
                      size="small"
                      checked={selectedEngineers.has(engineer)}
                      onChange={() => onEngineerToggle(engineer)}
                      sx={{ py: 0.25 }}
                    />
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        cursor: 'pointer',
                        flex: 1,
                        py: 0.25,
                        borderRadius: 0.5,
                        px: 0.5,
                        backgroundColor: isHighlighted ? 'action.selected' : 'transparent',
                        '&:hover': { backgroundColor: 'action.hover' },
                      }}
                      onClick={() => onEngineerHighlight(engineer)}
                    >
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: '2px',
                          backgroundColor: color,
                          flexShrink: 0,
                        }}
                      />
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: 13,
                          fontWeight: isHighlighted ? 'bold' : 'normal',
                          textDecoration: isHighlighted ? 'underline' : 'none',
                        }}
                      >
                        {engineer}
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
};

export default SprintCheckSidebarContent;
