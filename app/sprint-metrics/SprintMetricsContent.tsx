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
import TableSortLabel from '@mui/material/TableSortLabel';
import Paper from '@mui/material/Paper';
import Link from '@mui/material/Link';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import AddIcon from '@mui/icons-material/Add';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Header } from '@/frontend/components';
import ProjectSearch from '@/frontend/components/sidebar/ProjectSearch';
import BoardSelector from '@/frontend/components/sidebar/BoardSelector';
import { useSprintMetricsData } from '@/frontend/hooks';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { JiraProject } from '@/shared/types';
import type { SprintMetricsData, SprintMetricsGrid, SprintMetricsIssue } from '@/frontend/hooks/useSprintMetricsData';
import VelocityTrendChart from './VelocityTrendChart';
import CarryoverTrendChart from './CarryoverTrendChart';
import SprintPointsByTeamChart from './SprintPointsByTeamChart';

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

// ── URL encode/decode helpers ─────────────────────────────────────────

interface Selection {
  projectKey: string;
  boardId: number;
  projectName: string;
  boardName: string;
}

/**
 * Encode selections to URL format using pipe separator for fields:
 * PROJ1|123|Project One|Board A,PROJ2|456|Other Project|Board B
 */
const encodeSelections = (selections: Selection[]): string =>
  selections.map((s) => `${s.projectKey}|${s.boardId}|${s.projectName}|${s.boardName}`).join(',');

/**
 * Decode selections from URL format
 */
const parseSelections = (encoded: string | null): Selection[] => {
  if (!encoded) return [];
  return encoded
    .split(',')
    .map((entry) => {
      // Support new format: key|boardId|projectName|boardName
      const parts = entry.split('|');
      if (parts.length >= 2) {
        const projectKey = parts[0];
        const boardId = parseInt(parts[1], 10);
        if (!projectKey || isNaN(boardId)) return null;
        const projectName = parts[2] || projectKey;
        const boardName = parts[3] || `Board ${boardId}`;
        return { projectKey, boardId, projectName, boardName };
      }
      // Legacy format: key:boardId
      const [projectKey, boardIdStr] = entry.split(':');
      const boardId = parseInt(boardIdStr, 10);
      if (!projectKey || isNaN(boardId)) return null;
      return { projectKey, boardId, projectName: projectKey, boardName: `Board ${boardId}` };
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
  bgcolor: 'grey.100',
};

// JIRA base URL for clickable ticket links
const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

// ── Drill-down types ──────────────────────────────────────────────────

interface SelectedCell {
  offset: number;
  projectKey: string;
  column: string;
}

// ── MetricsGrid sort types ────────────────────────────────────────────

type MetricsSortField = 'projectKey' | 'sprintName' | 'capacity' | 'day1Points' | 'resolvedPoints' | 'lastDayPoints' | 'scopeChangePoints' | 'carryoverPoints' | 'velocity' | 'velocitySwing' | 'engineerCount' | 'completedVsPlanned' | 'serviceDeskHours';
type SortDirection = 'asc' | 'desc';

// ── IssueDetailGrid sort types ────────────────────────────────────────

type IssueSortField = 'key' | 'summary' | 'sprintName' | 'points';

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
    return val !== null ? Math.max(3, Math.min(10, parseInt(val, 10) || 3)) : 3;
  });

  const [capacities, setCapacities] = useState<Map<string, number>>(() =>
    parseCapacities(searchParams.get(QUERY_PARAM_KEYS.SM_CAPACITIES))
  );

  const [engineerCounts, setEngineerCounts] = useState<Map<string, number>>(() =>
    parseCapacities(searchParams.get(QUERY_PARAM_KEYS.SM_ENGINEERS))
  );

  // Pending project/board for the "Add" flow
  const [pendingProjectKey, setPendingProjectKey] = useState<string | undefined>();
  const [pendingProjectName, setPendingProjectName] = useState<string | undefined>();
  const [pendingBoardId, setPendingBoardId] = useState<number | undefined>();

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
      newCapacities?: Map<string, number>,
      newEngineers?: Map<string, number>
    ) => {
      const params = new URLSearchParams(searchParamsRef.current.toString());

      const sel = newSelections ?? selections;
      const sb = newSprintsBack ?? sprintsBack;
      const cap = newCapacities ?? capacities;
      const eng = newEngineers ?? engineerCounts;

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

      const engEncoded = encodeCapacities(eng);
      if (engEncoded) {
        params.set(QUERY_PARAM_KEYS.SM_ENGINEERS, engEncoded);
      } else {
        params.delete(QUERY_PARAM_KEYS.SM_ENGINEERS);
      }

      const qs = params.toString();
      router.replace(qs ? `/sprint-metrics?${qs}` : '/sprint-metrics', { scroll: false });
    },
    [router, selections, sprintsBack, capacities, engineerCounts]
  );

  // ── Handlers ────────────────────────────────────────────────────────

  const handleProjectSelect = useCallback((project: JiraProject) => {
    setPendingProjectKey(project.key);
    setPendingProjectName(project.name);
    setPendingBoardId(undefined); // reset board when project changes
  }, []);

  const handleBoardSelect = useCallback((boardId: number) => {
    setPendingBoardId(boardId);
  }, []);

  const handleAdd = useCallback(() => {
    if (!pendingProjectKey || !pendingBoardId) return;

    // Don't add duplicates
    if (selections.some((s) => s.projectKey === pendingProjectKey)) return;

    const board = pendingBoards.find((b) => b.id === pendingBoardId);
    const boardName = board?.name ?? `Board ${pendingBoardId}`;
    const projectName = pendingProjectName ?? pendingProjectKey;

    const newSelections = [...selections, { projectKey: pendingProjectKey, boardId: pendingBoardId, projectName, boardName }];
    setSelections(newSelections);
    setPendingProjectKey(undefined);
    setPendingProjectName(undefined);
    setPendingBoardId(undefined);
    syncUrl(newSelections);
  }, [pendingProjectKey, pendingProjectName, pendingBoardId, pendingBoards, selections, syncUrl]);

  const handleRemoveSelection = useCallback(
    (projectKey: string) => {
      const newSelections = selections.filter((s) => s.projectKey !== projectKey);
      setSelections(newSelections);

      // Also remove capacity and engineer count for this project
      const newCapacities = new Map(capacities);
      newCapacities.delete(projectKey);
      setCapacities(newCapacities);

      const newEngineers = new Map(engineerCounts);
      newEngineers.delete(projectKey);
      setEngineerCounts(newEngineers);

      syncUrl(newSelections, undefined, newCapacities, newEngineers);
      clear();
    },
    [selections, capacities, engineerCounts, syncUrl, clear]
  );

  const handleSprintsBackChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Math.max(3, Math.min(10, parseInt(e.target.value, 10) || 3));
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

  const handleEngineerCountChange = useCallback(
    (projectKey: string, value: number) => {
      const newEngineers = new Map(engineerCounts);
      newEngineers.set(projectKey, value);
      setEngineerCounts(newEngineers);
      syncUrl(undefined, undefined, undefined, newEngineers);
    },
    [engineerCounts, syncUrl]
  );

  const handleLoadMetrics = useCallback(() => {
    if (selections.length === 0) return;
    generate(
      selections.map((s) => ({ projectKey: s.projectKey, boardId: s.boardId, projectName: s.projectName })),
      sprintsBack
    );
  }, [selections, sprintsBack, generate]);

  // Memoized capacity getter
  const getCapacity = useCallback(
    (projectKey: string): number => capacities.get(projectKey) ?? 30,
    [capacities]
  );

  const getEngineerCount = useCallback(
    (projectKey: string): number => engineerCounts.get(projectKey) ?? 5,
    [engineerCounts]
  );

  // Determine if Add button should be enabled
  const canAdd = Boolean(
    pendingProjectKey &&
    pendingBoardId &&
    !selections.some((s) => s.projectKey === pendingProjectKey)
  );

  const [activeTab, setActiveTab] = useState(0);

  // ── Drill-down state ─────────────────────────────────────────────────
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

  const handleCellClick = useCallback((offset: number, projectKey: string, column: string) => {
    setSelectedCell((prev) =>
      prev && prev.offset === offset && prev.projectKey === projectKey && prev.column === column
        ? null
        : { offset, projectKey, column }
    );
  }, []);

  const detailIssues = useMemo((): SprintMetricsIssue[] => {
    if (!selectedCell || !data) return [];
    const grid = data.grids.find((g) => g.offset === selectedCell.offset);
    const row = grid?.rows.find((r) => r.projectKey === selectedCell.projectKey);
    if (!row) return [];
    return row.issues.filter((i) => i.categories.includes(selectedCell.column));
  }, [selectedCell, data]);

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
        <Paper elevation={1} sx={{ p: 2 }}>
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

            {selections.length > 0 && <Divider orientation="vertical" flexItem />}

            {/* Selected project chips */}
            {selections.map((s) => (
              <Chip
                key={s.projectKey}
                label={`${s.projectName} — ${s.boardName}`}
                size="small"
                color="primary"
                variant="outlined"
                onDelete={() => handleRemoveSelection(s.projectKey)}
              />
            ))}

            <Divider orientation="vertical" flexItem />

            {/* Sprints back spinner */}
            <TextField
              label="Sprints Back"
              type="number"
              size="small"
              value={sprintsBack}
              onChange={handleSprintsBackChange}
              slotProps={{ htmlInput: { min: 3, max: 10 } }}
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

        {/* ── Tabs ─────────────────────────────────────────────────────── */}
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 36, py: 0.5, textTransform: 'none' } }}>
          <Tab label="Sprint Facts" />
          <Tab label="Trend Velocity" />
          <Tab label="Trend Carryover" />
          <Tab label="Sprint Points by Team" />
        </Tabs>

        {/* ── Sprint Facts tab ────────────────────────────────────────── */}
        {activeTab === 0 && (
          <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {data && data.grids.length > 0 && (
              <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {data.grids.map((grid) => {
                  // Compute 3 Sprint Velocity per project: avg of resolved from this sprint + 2 previous
                  const velocityMap = new Map<string, number>();
                  for (const row of grid.rows) {
                    let sum = 0;
                    let count = 0;
                    for (const off of [grid.offset, grid.offset - 1, grid.offset - 2]) {
                      const g = data.grids.find((gr) => gr.offset === off);
                      const r = g?.rows.find((rr) => rr.projectKey === row.projectKey);
                      if (r) {
                        sum += r.resolvedPoints;
                        count++;
                      }
                    }
                    velocityMap.set(row.projectKey, count > 0 ? Math.round((sum / 3) * 10) / 10 : 0);
                  }

                  return (
                    <MetricsGrid
                      key={grid.offset}
                      grid={grid}
                      getCapacity={getCapacity}
                      onCapacityChange={handleCapacityChange}
                      getEngineerCount={getEngineerCount}
                      onEngineerCountChange={handleEngineerCountChange}
                      velocityMap={velocityMap}
                      selectedCell={selectedCell}
                      onCellClick={handleCellClick}
                    />
                  );
                })}
              </Box>
            )}

            {data && data.grids.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                No sprint data found for the selected projects.
              </Typography>
            )}

            {/* ── Detail Grid + Legend ─────────────────────────────────── */}
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', mt: 'auto', pt: 1 }}>
              <IssueDetailGrid issues={detailIssues} selectedCell={selectedCell} data={data} />
              <Paper elevation={1} sx={{ px: 2, py: 1, maxWidth: 480, flexShrink: 0, bgcolor: 'grey.50' }}>
                <Typography variant="caption" fontWeight={700} sx={{ mb: 0.5, display: 'block' }}>
                  Calculated Columns
                </Typography>
                <Typography variant="caption" component="div" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                  <b>Day 1 Pts</b> = points committed at sprint start (excludes mid-sprint additions)<br />
                  <b>Resolved</b> = points in a done status (excludes canceled)<br />
                  <b>Last Day Pts</b> = total non-canceled points in the sprint<br />
                  <b>Scope Changes</b> = points added after sprint start<br />
                  <b>Carryover</b> = points carried from the previous sprint (excludes Blocked)<br />
                  <b>3 Sprint Velocity</b> = (this sprint Resolved + 2 previous sprints Resolved) / 3<br />
                  <b>Velocity Swing %</b> = (Resolved - 3 Sprint Velocity) / 3 Sprint Velocity<br />
                  <b>% Completed vs Planned</b> = Resolved / Day 1 Pts<br />
                  <b>SD/Splunk Hours Resolved</b> = hours logged on resolved [System] Incident, Problem, or Service request tickets
                </Typography>
              </Paper>
            </Box>
          </Box>
        )}

        {/* ── Trend Velocity tab ────────────────────────────────────── */}
        {activeTab === 1 && data && data.grids.length > 0 && (
          <VelocityTrendChart data={data} />
        )}

        {/* ── Trend Carryover tab ───────────────────────────────────── */}
        {activeTab === 2 && data && data.grids.length > 0 && (
          <CarryoverTrendChart data={data} />
        )}

        {/* ── Sprint Points by Team tab ──────────────────────────────── */}
        {activeTab === 3 && data && data.grids.length > 0 && (
          <SprintPointsByTeamChart data={data} />
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
  getEngineerCount: (projectKey: string) => number;
  onEngineerCountChange: (projectKey: string, value: number) => void;
  velocityMap: Map<string, number>;
  selectedCell: SelectedCell | null;
  onCellClick: (offset: number, projectKey: string, column: string) => void;
}

const MetricsGrid = ({ grid, getCapacity, onCapacityChange, getEngineerCount, onEngineerCountChange, velocityMap, selectedCell, onCellClick }: MetricsGridProps) => {
  const [sortField, setSortField] = useState<MetricsSortField>('projectKey');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: MetricsSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Helper to get computed values for sorting
  const getRowValue = useCallback((row: typeof grid.rows[0], field: MetricsSortField): number | string => {
    switch (field) {
      case 'projectKey': return row.projectName;
      case 'sprintName': return row.sprintName;
      case 'capacity': return getCapacity(row.projectKey);
      case 'day1Points': return row.day1Points;
      case 'resolvedPoints': return row.resolvedPoints;
      case 'lastDayPoints': return row.lastDayPoints;
      case 'scopeChangePoints': return row.scopeChangePoints;
      case 'carryoverPoints': return row.carryoverPoints;
      case 'velocity': return velocityMap.get(row.projectKey) ?? 0;
      case 'velocitySwing': {
        const vel = velocityMap.get(row.projectKey) ?? 0;
        return vel === 0 ? -Infinity : ((row.resolvedPoints - vel) / vel) * 100;
      }
      case 'engineerCount': return getEngineerCount(row.projectKey);
      case 'completedVsPlanned': return row.day1Points === 0 ? -Infinity : (row.resolvedPoints / row.day1Points) * 100;
      case 'serviceDeskHours': return row.serviceDeskHoursResolved;
      default: return 0;
    }
  }, [getCapacity, getEngineerCount, velocityMap]);

  const sortedRows = useMemo(() => {
    const rows = [...grid.rows];
    const mult = sortDirection === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const aVal = getRowValue(a, sortField);
      const bVal = getRowValue(b, sortField);
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return mult * aVal.localeCompare(bVal);
      }
      return mult * ((aVal as number) - (bVal as number));
    });
    return rows;
  }, [grid.rows, sortField, sortDirection, getRowValue]);

  // Compute totals
  const totals = useMemo(() => {
    let capacity = 0;
    let day1 = 0;
    let resolved = 0;
    let lastDay = 0;
    let scopeChange = 0;
    let carryover = 0;
    let velocitySum = 0;
    let engineers = 0;
    let serviceDeskHours = 0;

    for (const row of grid.rows) {
      capacity += getCapacity(row.projectKey);
      day1 += row.day1Points;
      resolved += row.resolvedPoints;
      lastDay += row.lastDayPoints;
      scopeChange += row.scopeChangePoints;
      carryover += row.carryoverPoints;
      velocitySum += velocityMap.get(row.projectKey) ?? 0;
      engineers += getEngineerCount(row.projectKey);
      serviceDeskHours += row.serviceDeskHoursResolved;
    }

    const velocity = Math.round(velocitySum * 10) / 10;
    const serviceDeskHoursTotal = Math.round(serviceDeskHours * 10) / 10;
    return { capacity, day1, resolved, lastDay, scopeChange, carryover, velocity, engineers, serviceDeskHoursTotal };
  }, [grid.rows, getCapacity, getEngineerCount, velocityMap]);

  // Helper for clickable cell styling
  const clickableCellSx = (projectKey: string, column: string) => ({
    ...compactCellSx,
    textAlign: 'right' as const,
    cursor: 'pointer',
    color: 'primary.main',
    '&:hover': { bgcolor: 'action.hover' },
    ...(selectedCell && selectedCell.offset === grid.offset && selectedCell.projectKey === projectKey && selectedCell.column === column
      ? { bgcolor: 'action.selected' }
      : {}),
  });

  const sortHeader = (field: MetricsSortField, label: string, align: 'left' | 'right' = 'right') => (
    <TableCell sx={{ ...compactHeaderSx, textAlign: align }}>
      <TableSortLabel
        active={sortField === field}
        direction={sortField === field ? sortDirection : 'asc'}
        onClick={() => handleSort(field)}
        sx={{ fontSize: 'inherit', '& .MuiTableSortLabel-icon': { fontSize: '0.875rem' } }}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <Paper elevation={1} sx={{ overflow: 'hidden', flexShrink: 0 }}>
      <Typography variant="subtitle2" sx={{ px: 1.5, pt: 1, pb: 0.5, fontWeight: 700, borderLeft: 3, borderColor: 'primary.main' }}>
        {grid.label}
      </Typography>
      <TableContainer>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {sortHeader('projectKey', 'Project', 'left')}
              {sortHeader('sprintName', 'Sprint', 'left')}
              {sortHeader('capacity', 'Capacity')}
              {sortHeader('day1Points', 'Day 1 Pts')}
              {sortHeader('resolvedPoints', 'Resolved')}
              {sortHeader('lastDayPoints', 'Last Day Pts')}
              {sortHeader('scopeChangePoints', 'Scope Changes')}
              {sortHeader('carryoverPoints', 'Carryover')}
              {sortHeader('velocity', '3 Sprint Velocity')}
              {sortHeader('velocitySwing', 'Velocity Swing %')}
              {sortHeader('engineerCount', 'Eng Count (excl TL)')}
              {sortHeader('completedVsPlanned', '% Completed vs Planned')}
              {sortHeader('serviceDeskHours', 'SD/Splunk Hours Resolved')}
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRows.map((row) => (
              <TableRow key={row.projectKey} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                <TableCell sx={compactCellSx}>{row.projectName}</TableCell>
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
                <TableCell
                  sx={clickableCellSx(row.projectKey, 'day1')}
                  onClick={() => onCellClick(grid.offset, row.projectKey, 'day1')}
                >
                  {row.day1Points}
                </TableCell>
                <TableCell
                  sx={clickableCellSx(row.projectKey, 'resolved')}
                  onClick={() => onCellClick(grid.offset, row.projectKey, 'resolved')}
                >
                  {row.resolvedPoints}
                </TableCell>
                <TableCell
                  sx={clickableCellSx(row.projectKey, 'lastDay')}
                  onClick={() => onCellClick(grid.offset, row.projectKey, 'lastDay')}
                >
                  {row.lastDayPoints}
                </TableCell>
                <TableCell
                  sx={clickableCellSx(row.projectKey, 'scopeChange')}
                  onClick={() => onCellClick(grid.offset, row.projectKey, 'scopeChange')}
                >
                  {row.scopeChangePoints}
                </TableCell>
                <TableCell
                  sx={clickableCellSx(row.projectKey, 'carryover')}
                  onClick={() => onCellClick(grid.offset, row.projectKey, 'carryover')}
                >
                  {row.carryoverPoints}
                </TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{velocityMap.get(row.projectKey) ?? 0}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>
                  {(() => {
                    const vel = velocityMap.get(row.projectKey) ?? 0;
                    if (vel === 0) return '—';
                    const swing = ((row.resolvedPoints - vel) / vel) * 100;
                    const rounded = Math.round(swing);
                    const color = rounded > 0 ? 'success.main' : rounded < 0 ? 'error.main' : undefined;
                    return <Box component="span" sx={color ? { color } : undefined}>{`${swing >= 0 ? '+' : ''}${rounded}%`}</Box>;
                  })()}
                </TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>
                  <TextField
                    type="number"
                    size="small"
                    value={getEngineerCount(row.projectKey)}
                    onChange={(e) =>
                      onEngineerCountChange(row.projectKey, parseInt(e.target.value, 10) || 0)
                    }
                    slotProps={{ htmlInput: { min: 0, style: { textAlign: 'right', fontSize: '0.75rem', padding: '2px 4px' } } }}
                    sx={{ width: 60 }}
                    variant="standard"
                  />
                </TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>
                  {(() => {
                    if (row.day1Points === 0) return '—';
                    const pct = Math.round((row.resolvedPoints / row.day1Points) * 100);
                    const color = pct >= 100 ? 'success.main' : pct >= 80 ? 'warning.main' : 'error.main';
                    return <Box component="span" sx={{ color }}>{`${pct}%`}</Box>;
                  })()}
                </TableCell>
                <TableCell
                  sx={clickableCellSx(row.projectKey, 'serviceDesk')}
                  onClick={() => onCellClick(grid.offset, row.projectKey, 'serviceDesk')}
                >
                  {row.serviceDeskHoursResolved}
                </TableCell>
              </TableRow>
            ))}

            {/* Totals row */}
            {grid.rows.length > 1 && (
              <TableRow sx={{ '& td': { fontWeight: 700 }, bgcolor: 'grey.100', borderTop: 2, borderColor: 'divider' }}>
                <TableCell sx={compactCellSx}>Total</TableCell>
                <TableCell sx={compactCellSx} />
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.capacity}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.day1}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.resolved}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.lastDay}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.scopeChange}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.carryover}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.velocity}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>
                  {(() => {
                    if (totals.velocity === 0) return '—';
                    const swing = Math.round((totals.resolved - totals.velocity) / totals.velocity * 100);
                    const color = swing > 0 ? 'success.main' : swing < 0 ? 'error.main' : undefined;
                    return <Box component="span" sx={color ? { color } : undefined}>{`${swing >= 0 ? '+' : ''}${swing}%`}</Box>;
                  })()}
                </TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.engineers}</TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>
                  {(() => {
                    if (totals.day1 === 0) return '—';
                    const pct = Math.round((totals.resolved / totals.day1) * 100);
                    const color = pct >= 100 ? 'success.main' : pct >= 80 ? 'warning.main' : 'error.main';
                    return <Box component="span" sx={{ color }}>{`${pct}%`}</Box>;
                  })()}
                </TableCell>
                <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{totals.serviceDeskHoursTotal}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

// ── IssueDetailGrid sub-component ──────────────────────────────────────

interface IssueDetailGridProps {
  issues: SprintMetricsIssue[];
  selectedCell: SelectedCell | null;
  data: SprintMetricsData | null;
}

const COLUMN_LABELS: Record<string, string> = {
  day1: 'Day 1 Pts',
  resolved: 'Resolved',
  lastDay: 'Last Day Pts',
  scopeChange: 'Scope Changes',
  carryover: 'Carryover',
  serviceDesk: 'SD/Splunk Hours',
};

const IssueDetailGrid = ({ issues, selectedCell, data }: IssueDetailGridProps) => {
  const [sortField, setSortField] = useState<IssueSortField>('summary');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: IssueSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedIssues = useMemo(() => {
    const sorted = [...issues];
    const mult = sortDirection === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sortField) {
        case 'key': return mult * a.key.localeCompare(b.key);
        case 'summary': return mult * a.summary.localeCompare(b.summary);
        case 'sprintName': return mult * a.sprintName.localeCompare(b.sprintName);
        case 'points': return mult * (a.points - b.points);
        default: return 0;
      }
    });
    return sorted;
  }, [issues, sortField, sortDirection]);

  const columnLabel = selectedCell ? (COLUMN_LABELS[selectedCell.column] ?? selectedCell.column) : '';

  // Look up project name from data
  const projectDisplayName = useMemo(() => {
    if (!selectedCell || !data) return '';
    const grid = data.grids.find((g) => g.offset === selectedCell.offset);
    const row = grid?.rows.find((r) => r.projectKey === selectedCell.projectKey);
    return row?.projectName ?? selectedCell.projectKey;
  }, [selectedCell, data]);

  const sortHeader = (field: IssueSortField, label: string, align: 'left' | 'right' = 'left') => (
    <TableCell sx={{ ...compactHeaderSx, textAlign: align }}>
      <TableSortLabel
        active={sortField === field}
        direction={sortField === field ? sortDirection : 'asc'}
        onClick={() => handleSort(field)}
        sx={{ fontSize: 'inherit', '& .MuiTableSortLabel-icon': { fontSize: '0.875rem' } }}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <Paper elevation={1} sx={{ flex: 1, maxWidth: 600, maxHeight: 300, overflow: 'auto' }}>
      <Typography variant="caption" fontWeight={700} sx={{ px: 1.5, pt: 1, pb: 0.5, display: 'block', bgcolor: 'grey.50', position: 'sticky', top: 0, zIndex: 1 }}>
        {selectedCell ? `${projectDisplayName} — ${columnLabel} (${issues.length} issues)` : 'Issue Details'}
      </Typography>
      {!selectedCell ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 2, textAlign: 'center' }}>
          Click a cell in the grid above to view its issues.
        </Typography>
      ) : issues.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 2, textAlign: 'center' }}>
          No issues for this cell.
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {sortHeader('key', 'Key')}
                {sortHeader('summary', 'Summary')}
                {sortHeader('sprintName', 'Sprint')}
                {sortHeader('points', 'Story Points', 'right')}
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedIssues.map((issue) => (
                <TableRow key={issue.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                  <TableCell sx={compactCellSx}>
                    <Link
                      href={`${JIRA_BASE_URL}/browse/${issue.key}`}
                      target="_blank"
                      rel="noopener"
                      underline="hover"
                      sx={{ fontSize: 'inherit' }}
                    >
                      {issue.key}
                    </Link>
                  </TableCell>
                  <TableCell sx={{ ...compactCellSx, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {issue.summary}
                  </TableCell>
                  <TableCell sx={compactCellSx}>{issue.sprintName}</TableCell>
                  <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{issue.points}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
};

export default SprintMetricsContent;
