'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Header } from '@/frontend/components';
import ProjectSearch from '@/frontend/components/sidebar/ProjectSearch';
import BoardSelector from '@/frontend/components/sidebar/BoardSelector';
import { useSprintMetricsData } from '@/frontend/hooks';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { JiraProject } from '@/shared/types';
import type { SprintMetricsGrid } from '@/frontend/hooks/useSprintMetricsData';

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

// ── URL encode/decode helpers ─────────────────────────────────────────

interface Selection {
  projectKey: string;
  boardId: number;
}

/**
 * Encode selections to URL format: PROJ1:123,PROJ2:456
 */
const encodeSelections = (selections: Selection[]): string =>
  selections.map((s) => `${s.projectKey}:${s.boardId}`).join(',');

/**
 * Decode selections from URL format
 */
const parseSelections = (encoded: string | null): Selection[] => {
  if (!encoded) return [];
  return encoded
    .split(',')
    .map((entry) => {
      const [projectKey, boardIdStr] = entry.split(':');
      const boardId = parseInt(boardIdStr, 10);
      if (!projectKey || isNaN(boardId)) return null;
      return { projectKey, boardId };
    })
    .filter((s): s is Selection => s !== null);
};

/**
 * Encode capacities to URL format: PROJ1:30,PROJ2:45
 */
const encodeCapacities = (capacities: Map<string, number>): string =>
  Array.from(capacities.entries())
    .map(([key, val]) => `${key}:${val}`)
    .join(',');

/**
 * Decode capacities from URL format
 */
const parseCapacities = (encoded: string | null): Map<string, number> => {
  const map = new Map<string, number>();
  if (!encoded) return map;
  for (const entry of encoded.split(',')) {
    const [key, valStr] = entry.split(':');
    const val = parseInt(valStr, 10);
    if (key && !isNaN(val)) map.set(key, val);
  }
  return map;
};

// ── Compact cell styling ──────────────────────────────────────────────

const compactCellSx = {
  fontSize: '0.75rem',
  py: 0.25,
  px: 1,
  lineHeight: 1.3,
};

const compactHeaderSx = {
  ...compactCellSx,
  fontWeight: 700,
  whiteSpace: 'nowrap' as const,
};

// ── Component ─────────────────────────────────────────────────────────

const SprintMetricsContent = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
  });

  // Check JIRA connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch('/api/auth/validate');
        const authData = await response.json();
        setConnectionStatus({ connected: authData.valid, email: authData.email });
      } catch {
        setConnectionStatus({ connected: false });
      }
    };
    checkConnection();
  }, []);

  const { data, isLoading, error, generate, clear } = useSprintMetricsData();

  // ── State from URL ──────────────────────────────────────────────────

  const [selections, setSelections] = useState<Selection[]>(() =>
    parseSelections(searchParams.get(QUERY_PARAM_KEYS.SM_SELECTIONS))
  );

  const [sprintsBack, setSprintsBack] = useState<number>(() => {
    const val = searchParams.get(QUERY_PARAM_KEYS.SM_SPRINTS_BACK);
    return val !== null ? Math.max(0, Math.min(10, parseInt(val, 10) || 3)) : 3;
  });

  const [capacities, setCapacities] = useState<Map<string, number>>(() =>
    parseCapacities(searchParams.get(QUERY_PARAM_KEYS.SM_CAPACITIES))
  );

  // Pending project/board for the "Add" flow
  const [pendingProjectKey, setPendingProjectKey] = useState<string | undefined>();
  const [pendingBoardId, setPendingBoardId] = useState<number | undefined>();

  // Display-only map: projectKey → board name (not persisted in URL)
  const [boardNames, setBoardNames] = useState<Map<string, string>>(new Map());

  // Boards loaded for the pending project (used to look up board name)
  const [pendingBoards, setPendingBoards] = useState<{ id: number; name: string }[]>([]);

  // Fetch boards when pending project changes
  useEffect(() => {
    if (!pendingProjectKey) {
      setPendingBoards([]);
      return;
    }
    const fetchBoards = async () => {
      try {
        const response = await fetch(`/api/boards?projectKey=${encodeURIComponent(pendingProjectKey)}`);
        const data = await response.json();
        setPendingBoards(data.boards ?? []);
      } catch {
        setPendingBoards([]);
      }
    };
    fetchBoards();
  }, [pendingProjectKey]);

  // ── URL sync helper ─────────────────────────────────────────────────

  const syncUrl = useCallback(
    (
      newSelections?: Selection[],
      newSprintsBack?: number,
      newCapacities?: Map<string, number>
    ) => {
      const params = new URLSearchParams(searchParamsRef.current.toString());

      const sel = newSelections ?? selections;
      const sb = newSprintsBack ?? sprintsBack;
      const cap = newCapacities ?? capacities;

      if (sel.length > 0) {
        params.set(QUERY_PARAM_KEYS.SM_SELECTIONS, encodeSelections(sel));
      } else {
        params.delete(QUERY_PARAM_KEYS.SM_SELECTIONS);
      }

      if (sb !== 3) {
        params.set(QUERY_PARAM_KEYS.SM_SPRINTS_BACK, sb.toString());
      } else {
        params.delete(QUERY_PARAM_KEYS.SM_SPRINTS_BACK);
      }

      const capEncoded = encodeCapacities(cap);
      if (capEncoded) {
        params.set(QUERY_PARAM_KEYS.SM_CAPACITIES, capEncoded);
      } else {
        params.delete(QUERY_PARAM_KEYS.SM_CAPACITIES);
      }

      const qs = params.toString();
      router.replace(qs ? `/sprint-metrics?${qs}` : '/sprint-metrics', { scroll: false });
    },
    [router, selections, sprintsBack, capacities]
  );

  // ── Handlers ────────────────────────────────────────────────────────

  const handleProjectSelect = useCallback((project: JiraProject) => {
    setPendingProjectKey(project.key);
    setPendingBoardId(undefined); // reset board when project changes
  }, []);

  const handleBoardSelect = useCallback((boardId: number) => {
    setPendingBoardId(boardId);
  }, []);

  const handleAdd = useCallback(() => {
    if (!pendingProjectKey || !pendingBoardId) return;

    // Don't add duplicates
    if (selections.some((s) => s.projectKey === pendingProjectKey)) return;

    // Store board name for display
    const board = pendingBoards.find((b) => b.id === pendingBoardId);
    if (board) {
      setBoardNames((prev) => new Map(prev).set(pendingProjectKey, board.name));
    }

    const newSelections = [...selections, { projectKey: pendingProjectKey, boardId: pendingBoardId }];
    setSelections(newSelections);
    setPendingProjectKey(undefined);
    setPendingBoardId(undefined);
    syncUrl(newSelections);
  }, [pendingProjectKey, pendingBoardId, pendingBoards, selections, syncUrl]);

  const handleRemoveSelection = useCallback(
    (projectKey: string) => {
      const newSelections = selections.filter((s) => s.projectKey !== projectKey);
      setSelections(newSelections);

      // Also remove capacity and board name for this project
      const newCapacities = new Map(capacities);
      newCapacities.delete(projectKey);
      setCapacities(newCapacities);

      setBoardNames((prev) => {
        const next = new Map(prev);
        next.delete(projectKey);
        return next;
      });

      syncUrl(newSelections, undefined, newCapacities);
      clear();
    },
    [selections, capacities, syncUrl, clear]
  );

  const handleSprintsBackChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Math.max(0, Math.min(10, parseInt(e.target.value, 10) || 0));
      setSprintsBack(val);
      syncUrl(undefined, val);
    },
    [syncUrl]
  );

  const handleCapacityChange = useCallback(
    (projectKey: string, value: number) => {
      const newCapacities = new Map(capacities);
      newCapacities.set(projectKey, value);
      setCapacities(newCapacities);
      syncUrl(undefined, undefined, newCapacities);
    },
    [capacities, syncUrl]
  );

  const handleLoadMetrics = useCallback(() => {
    if (selections.length === 0) return;
    generate(selections, sprintsBack);
  }, [selections, sprintsBack, generate]);

  // Memoized capacity getter
  const getCapacity = useCallback(
    (projectKey: string): number => capacities.get(projectKey) ?? 30,
    [capacities]
  );

  // Determine if Add button should be enabled
  const canAdd = Boolean(
    pendingProjectKey &&
    pendingBoardId &&
    !selections.some((s) => s.projectKey === pendingProjectKey)
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <Header connectionStatus={connectionStatus} />
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflow: 'hidden' }}>
        {/* ── Controls Bar ─────────────────────────────────────────────── */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            {/* Project + Board selection */}
            <Box sx={{ width: 250 }}>
              <ProjectSearch
                onProjectSelect={handleProjectSelect}
                selectedProjectKey={pendingProjectKey}
              />
            </Box>
            <Box sx={{ width: 200 }}>
              <BoardSelector
                projectKey={pendingProjectKey}
                selectedBoardId={pendingBoardId}
                onBoardSelect={handleBoardSelect}
                disabled={!pendingProjectKey}
              />
            </Box>
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              onClick={handleAdd}
              disabled={!canAdd}
            >
              Add
            </Button>

            {/* Selected project chips */}
            {selections.map((s) => (
              <Chip
                key={s.projectKey}
                label={`${s.projectKey} — ${boardNames.get(s.projectKey) ?? `Board ${s.boardId}`}`}
                size="small"
                color="primary"
                variant="outlined"
                onDelete={() => handleRemoveSelection(s.projectKey)}
              />
            ))}

            {/* Sprints back spinner */}
            <TextField
              label="Sprints Back"
              type="number"
              size="small"
              value={sprintsBack}
              onChange={handleSprintsBackChange}
              slotProps={{ htmlInput: { min: 0, max: 10 } }}
              sx={{ width: 120 }}
            />

            {/* Load button */}
            <Button
              variant="contained"
              size="small"
              startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
              onClick={handleLoadMetrics}
              disabled={selections.length === 0 || isLoading}
            >
              {isLoading ? 'Loading…' : 'Load Metrics'}
            </Button>
          </Box>
        </Paper>

        {/* ── Error ────────────────────────────────────────────────────── */}
        {error && (
          <Alert severity="error" onClose={() => clear()}>
            {error}
          </Alert>
        )}

        {/* ── Grids ────────────────────────────────────────────────────── */}
        {data && data.grids.length > 0 && (
          <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {data.grids.map((grid) => (
              <MetricsGrid
                key={grid.offset}
                grid={grid}
                getCapacity={getCapacity}
                onCapacityChange={handleCapacityChange}
              />
            ))}
          </Box>
        )}

        {data && data.grids.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No sprint data found for the selected projects.
          </Typography>
        )}
      </Box>
    </Box>
  );
};

// ── MetricsGrid sub-component ─────────────────────────────────────────

interface MetricsGridProps {
  grid: SprintMetricsGrid;
  getCapacity: (projectKey: string) => number;
  onCapacityChange: (projectKey: string, value: number) => void;
}

const MetricsGrid = ({ grid, getCapacity, onCapacityChange }: MetricsGridProps) => {
  // Compute totals
  const totals = useMemo(() => {
    let capacity = 0;
    let day1 = 0;
    let resolved = 0;
    let lastDay = 0;

    for (const row of grid.rows) {
      capacity += getCapacity(row.projectKey);
      day1 += row.day1Points;
      resolved += row.resolvedPoints;
      lastDay += row.lastDayPoints;
    }

    return { capacity, day1, resolved, lastDay };
  }, [grid.rows, getCapacity]);

  return (
    <Paper variant="outlined">
      <Typography variant="subtitle2" sx={{ px: 1.5, pt: 1, pb: 0.5, fontWeight: 700 }}>
        {grid.label}
      </Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={compactHeaderSx}>Project</TableCell>
              <TableCell sx={compactHeaderSx}>Sprint</TableCell>
              <TableCell sx={{ ...compactHeaderSx, textAlign: 'right' }}>Capacity</TableCell>
              <TableCell sx={{ ...compactHeaderSx, textAlign: 'right' }}>Day 1 Pts</TableCell>
              <TableCell sx={{ ...compactHeaderSx, textAlign: 'right' }}>Resolved</TableCell>
              <TableCell sx={{ ...compactHeaderSx, textAlign: 'right' }}>Last Day Pts</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {grid.rows.map((row) => (
              <TableRow key={row.projectKey} hover>
                <TableCell sx={compactCellSx}>{row.projectKey}</TableCell>
                <TableCell sx={compactCellSx}>{row.sprintName}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>
                  <TextField
                    type="number"
                    size="small"
                    value={getCapacity(row.projectKey)}
                    onChange={(e) =>
                      onCapacityChange(row.projectKey, parseInt(e.target.value, 10) || 0)
                    }
                    slotProps={{ htmlInput: { min: 0, style: { textAlign: 'right', fontSize: '0.75rem', padding: '2px 4px' } } }}
                    sx={{ width: 60 }}
                    variant="standard"
                  />
                </TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{row.day1Points}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{row.resolvedPoints}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{row.lastDayPoints}</TableCell>
              </TableRow>
            ))}

            {/* Totals row */}
            {grid.rows.length > 1 && (
              <TableRow sx={{ '& td': { fontWeight: 700 } }}>
                <TableCell sx={compactCellSx}>Total</TableCell>
                <TableCell sx={compactCellSx} />
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.capacity}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.day1}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.resolved}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.lastDay}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default SprintMetricsContent;
