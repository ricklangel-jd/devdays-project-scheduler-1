'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
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

interface SprintPlanningSidebarContentProps {
  boardId?: number;
  projectKey?: string;
  selectedSprintId: number | null;
  isLoading: boolean;
  onSprintChange: (sprintId: number, sprintName: string) => void;
}

const SprintPlanningSidebarContent = ({
  boardId,
  projectKey,
  selectedSprintId,
  isLoading,
  onSprintChange,
}: SprintPlanningSidebarContentProps) => {
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

  // Compute which sprints to show: active sprint ± 5 sprints by start date
  const visibleSprints = useMemo(() => {
    if (allSprints.length === 0) return [];

    const sorted = [...allSprints]
      .filter((s) => s.startDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    const activeIdx = sorted.findIndex((s) => s.state === 'active');

    if (activeIdx < 0) {
      // No active sprint — show last 5 + first 5 future, or all if fewer
      return sorted.slice(Math.max(0, sorted.length - 10));
    }

    const start = Math.max(0, activeIdx - 5);
    const end = Math.min(sorted.length, activeIdx + 6); // +6 because slice is exclusive
    return sorted.slice(start, end);
  }, [allSprints]);

  // Default to active sprint when sprints load
  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    if (visibleSprints.length === 0) {
      hasAutoSelectedRef.current = false;
      return;
    }
    if (hasAutoSelectedRef.current) return;

    // Only auto-select if no sprint is currently selected
    if (selectedSprintId !== null) {
      hasAutoSelectedRef.current = true;
      return;
    }

    const active = visibleSprints.find((s) => s.state === 'active');
    const target = active ?? visibleSprints[0];
    if (target) {
      hasAutoSelectedRef.current = true;
      onSprintChange(target.id, target.name);
    }
  }, [visibleSprints, selectedSprintId, onSprintChange]);

  const handleSprintChange = useCallback(
    (e: React.ChangeEvent<{ value: unknown }>) => {
      const id = Number(e.target.value);
      const sprint = visibleSprints.find((s) => s.id === id);
      if (!isNaN(id) && sprint) onSprintChange(id, sprint.name);
    },
    [onSprintChange, visibleSprints]
  );

  const hasBoard = !!boardId;
  const hasSprint = selectedSprintId !== null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <StepCircle step={1} done={hasSprint} />
          <Typography variant="subtitle2">Select Sprint</Typography>
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
        ) : visibleSprints.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ pl: 3.5 }}>
            No sprints found
          </Typography>
        ) : (
          <Box sx={{ pl: 3.5 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Sprint</InputLabel>
              <Select
                value={selectedSprintId ?? ''}
                label="Sprint"
                onChange={handleSprintChange as never}
              >
                {visibleSprints.map((sprint) => (
                  <MenuItem key={sprint.id} value={sprint.id}>
                    {sprint.name}
                    {sprint.state === 'active' && ' (current)'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default SprintPlanningSidebarContent;
