'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import type { JiraSprint, PiSprintAssignment } from '@/shared/types';
import { savePiSprintMappings, loadPiSprintMappings, validateAssignments } from '@/frontend/lib/piSprintStorage';

const icon = <CheckBoxOutlineBlankIcon fontSize="small" />;
const checkedIcon = <CheckBoxIcon fontSize="small" />;

/** Format a date string for display (e.g., "Jan 28") */
const formatDateShort = (dateStr: string): string => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
};

interface PiSprintAssignerProps {
  piLabels: string[];
  boardId: number;
  projectKey?: string;
  piSprints: PiSprintAssignment[];
  onChange: (assignments: PiSprintAssignment[]) => void;
}

const PiSprintAssigner = ({
  piLabels,
  boardId,
  projectKey,
  piSprints,
  onChange,
}: PiSprintAssignerProps) => {
  const [allSprints, setAllSprints] = useState<JiraSprint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);

  // Refs to avoid dependency loops in the auto-fill effect
  const piSprintsRef = useRef(piSprints);
  piSprintsRef.current = piSprints;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // One-shot guard: only auto-fill once per board visit
  const hasAutoFilledRef = useRef<number | null>(null);

  // Fetch all sprints for the board when boardId changes
  useEffect(() => {
    if (!boardId) {
      setAllSprints([]);
      return;
    }

    let cancelled = false;

    const fetchSprints = async () => {
      setLoading(true);
      setError(null);

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
          setError(data.message || data.error);
          setAllSprints([]);
        } else {
          // Only include sprints that have both start and end dates
          const sprints = (data.sprints || []).filter(
            (s: JiraSprint) => s.startDate && s.endDate
          );
          setAllSprints(sprints);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load sprints');
          setAllSprints([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchSprints();
    return () => { cancelled = true; };
  }, [boardId, projectKey]);

  // Build a map for quick sprint lookup by ID
  const sprintMap = useMemo(() => {
    const map = new Map<number, JiraSprint>();
    for (const sprint of allSprints) {
      map.set(sprint.id, sprint);
    }
    return map;
  }, [allSprints]);

  // Auto-fill from localStorage when sprints load and PIs have no assignments
  useEffect(() => {
    if (!boardId || allSprints.length === 0 || piLabels.length === 0) return;
    if (hasAutoFilledRef.current === boardId) return;

    const currentPiSprints = piSprintsRef.current;
    const unassignedPIs = piLabels.filter(
      (pi) => !currentPiSprints.some((ps) => ps.piLabel === pi && ps.sprintIds.length > 0),
    );
    if (unassignedPIs.length === 0) {
      hasAutoFilledRef.current = boardId;
      return;
    }

    const stored = loadPiSprintMappings(boardId, unassignedPIs);
    if (!stored || stored.length === 0) {
      hasAutoFilledRef.current = boardId;
      return;
    }

    const validSprintIds = new Set(allSprints.map((s) => s.id));
    const validated = validateAssignments(stored, validSprintIds);
    if (validated.length === 0) {
      hasAutoFilledRef.current = boardId;
      return;
    }

    const merged = [
      ...currentPiSprints.filter((ps) => ps.sprintIds.length > 0),
      ...validated,
    ];

    hasAutoFilledRef.current = boardId;
    setRestoredFromStorage(true);
    savePiSprintMappings(boardId, merged);
    onChangeRef.current(merged);
  }, [allSprints, boardId, piLabels]);

  // Get the current sprint IDs for a specific PI label
  const getSprintIdsForPI = useCallback((piLabel: string): number[] => {
    const assignment = piSprints.find((ps) => ps.piLabel === piLabel);
    return assignment?.sprintIds ?? [];
  }, [piSprints]);

  // Get sprint objects for a specific PI's selected sprint IDs
  const getSelectedSprintsForPI = useCallback((piLabel: string): JiraSprint[] => {
    const ids = getSprintIdsForPI(piLabel);
    return ids
      .map((id) => sprintMap.get(id))
      .filter((s): s is JiraSprint => s !== undefined);
  }, [getSprintIdsForPI, sprintMap]);

  // Handle sprint selection change for a specific PI
  const handleSprintChangeForPI = useCallback((piLabel: string, selectedSprints: JiraSprint[]) => {
    const newSprintIds = selectedSprints.map((s) => s.id);

    // Update or create the assignment for this PI
    const existingIndex = piSprints.findIndex((ps) => ps.piLabel === piLabel);
    const updated = [...piSprints];

    if (existingIndex >= 0) {
      updated[existingIndex] = { piLabel, sprintIds: newSprintIds };
    } else {
      updated.push({ piLabel, sprintIds: newSprintIds });
    }

    // Remove entries with no sprints
    const finalAssignments = updated.filter((ps) => ps.sprintIds.length > 0);
    savePiSprintMappings(boardId, finalAssignments);
    setRestoredFromStorage(false);
    onChange(finalAssignments);
  }, [piSprints, onChange, boardId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">
          Loading sprints...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Typography variant="body2" color="error" sx={{ py: 1 }}>
        {error}
      </Typography>
    );
  }

  if (allSprints.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        No sprints found for this board
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {restoredFromStorage && (
        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          Sprint assignments restored from previous session
        </Typography>
      )}
      {piLabels.map((piLabel) => {
        const selectedSprints = getSelectedSprintsForPI(piLabel);
        const count = selectedSprints.length;

        return (
          <Box key={piLabel}>
            <Typography
              variant="caption"
              fontWeight="bold"
              sx={{ mb: 0.5, display: 'block' }}
            >
              {piLabel}
              {count > 0 && (
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 1 }}
                >
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
              onChange={(_event, newValue) => {
                handleSprintChangeForPI(piLabel, newValue);
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
                <TextField
                  {...params}
                  placeholder={count > 0 ? '' : 'Select sprints...'}
                />
              )}
            />
          </Box>
        );
      })}
    </Box>
  );
};

export default PiSprintAssigner;
