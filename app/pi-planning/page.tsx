'use client';

import { Suspense, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Paper from '@mui/material/Paper';
import Checkbox from '@mui/material/Checkbox';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Fab from '@mui/material/Fab';
import Tooltip from '@mui/material/Tooltip';
import Link from '@mui/material/Link';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import { Header, Sidebar, MainContent } from '@/frontend/components';
import { PiPlanningSidebarContent } from '@/frontend/components/sidebar';
import { PiPlanningChart } from '@/frontend/components/chart';
import type { PiPlanningEpicBar } from '@/frontend/components/chart';
import { useAppState, usePiPlanningData } from '@/frontend/hooks';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { PiPlanningEpic } from '@/frontend/hooks/usePiPlanningData';

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

const SPRINT_COUNT = 7;
const DAYS_PER_SPRINT = 10;

/**
 * Encode engineers + daysOut map to URL-safe string.
 * Format: "Name:0,0,2,0,0,0,0|Name2:1,0,0,0,0,0,0"
 */
const encodeDaysOffForUrl = (engineers: string[], daysOut: Map<string, number[]>): string => {
  return engineers
    .map((name) => {
      const days = daysOut.get(name) ?? new Array(SPRINT_COUNT).fill(0);
      return `${encodeURIComponent(name)}:${days.join(',')}`;
    })
    .join('|');
};

/**
 * Decode URL string back to engineers list + daysOut map.
 */
const parseDaysOffFromUrl = (
  encoded: string | null
): { engineers: string[]; daysOut: Map<string, number[]> } | null => {
  if (!encoded) return null;
  const engineers: string[] = [];
  const daysOut = new Map<string, number[]>();

  const entries = encoded.split('|');
  for (const entry of entries) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx === -1) continue;
    const name = decodeURIComponent(entry.substring(0, colonIdx));
    const days = entry
      .substring(colonIdx + 1)
      .split(',')
      .map((d) => parseInt(d, 10) || 0);
    // Pad to SPRINT_COUNT
    while (days.length < SPRINT_COUNT) days.push(0);
    engineers.push(name);
    daysOut.set(name, days.slice(0, SPRINT_COUNT));
  }

  return engineers.length > 0 ? { engineers, daysOut } : null;
};

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

// Sortable columns
type SortColumn = 'checked' | 'key' | 'summary' | 'status' | 'childPoints' | 'piPoints' | 'stretch';
type SortDirection = 'asc' | 'desc';

const PiPlanningContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
  });

  const {
    projectKey,
    boardId,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useAppState();

  const {
    epics,
    isLoading,
    isSaving,
    error,
    saveResult,
    fetchEpics,
    saveChanges,
    clearSaveResult,
  } = usePiPlanningData();

  // Parse selected PI from URL
  const selectedPi = searchParams.get(QUERY_PARAM_KEYS.PP_PI);

  // Local editing state
  const [checkedEpics, setCheckedEpics] = useState<Map<string, boolean>>(new Map());
  const [stretchFlags, setStretchFlags] = useState<Map<string, boolean>>(new Map());
  const [pointsEntries, setPointsEntries] = useState<Map<string, number | null>>(new Map());
  const [originalChecked, setOriginalChecked] = useState<Set<string>>(new Set());
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error'>('success');

  // Sorting state
  const [sortColumn, setSortColumn] = useState<SortColumn>('key');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Engineer capacity state — initialized from URL params when available
  const [engineers, setEngineers] = useState<string[]>(() => {
    const parsed = parseDaysOffFromUrl(searchParams.get(QUERY_PARAM_KEYS.PP_DAYS_OFF));
    return parsed?.engineers ?? [];
  });
  const [daysOut, setDaysOut] = useState<Map<string, number[]>>(() => {
    const parsed = parseDaysOffFromUrl(searchParams.get(QUERY_PARAM_KEYS.PP_DAYS_OFF));
    return parsed?.daysOut ?? new Map();
  });
  const [newEngineerName, setNewEngineerName] = useState('');
  const [supportPercent, setSupportPercentState] = useState(() => {
    const val = searchParams.get(QUERY_PARAM_KEYS.PP_SUPPORT_PCT);
    return val !== null ? (parseInt(val, 10) || 10) : 10;
  });
  const [excludeSprint7, setExcludeSprint7State] = useState(() => {
    return searchParams.get(QUERY_PARAM_KEYS.PP_EXCLUDE_S7) === '1';
  });

  // Track previous project to detect changes
  const prevProjectRef = useRef<string | undefined>(undefined);

  // Connection check
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch('/api/auth/validate');
        const data = await response.json();
        setConnectionStatus({ connected: data.valid, email: data.email });
      } catch {
        setConnectionStatus({ connected: false });
      }
    };
    checkConnection();
  }, []);

  // Auto-fetch epics and engineers when project changes
  useEffect(() => {
    if (projectKey && projectKey !== prevProjectRef.current) {
      prevProjectRef.current = projectKey;
      fetchEpics(projectKey);

      // Check if URL already has days-off data (from a shared URL)
      const urlDaysOff = searchParamsRef.current.get(QUERY_PARAM_KEYS.PP_DAYS_OFF);
      const parsedDaysOff = parseDaysOffFromUrl(urlDaysOff);

      if (parsedDaysOff) {
        // Restore engineers + days-off from URL
        setEngineers(parsedDaysOff.engineers);
        setDaysOut(parsedDaysOff.daysOut);
      } else {
        // Fetch engineers from current sprint
        const fetchEngineers = async () => {
          try {
            const params = new URLSearchParams({ project: projectKey });
            if (boardId) params.set('boardId', boardId.toString());
            const response = await fetch(`/api/pi-planning/engineers?${params.toString()}`);
            const data = await response.json();
            if (response.ok && data.engineers) {
              const names: string[] = data.engineers;
              setEngineers(names);
              // Initialize daysOut with zeros for each engineer
              const newDaysOut = new Map<string, number[]>();
              for (const name of names) {
                newDaysOut.set(name, new Array(SPRINT_COUNT).fill(0));
              }
              setDaysOut(newDaysOut);
            }
          } catch (err) {
            console.error('Failed to fetch engineers:', err);
          }
        };
        fetchEngineers();
      }
    }
    if (!projectKey) {
      prevProjectRef.current = undefined;
    }
  }, [projectKey, boardId, fetchEpics]);

  // Pre-populate editing state when PI selection or epics change
  useEffect(() => {
    if (!selectedPi || epics.length === 0) {
      setCheckedEpics(new Map());
      setStretchFlags(new Map());
      setPointsEntries(new Map());
      setOriginalChecked(new Set());
      return;
    }

    const newChecked = new Map<string, boolean>();
    const newStretch = new Map<string, boolean>();
    const newPoints = new Map<string, number | null>();
    const newOriginalChecked = new Set<string>();

    for (const epic of epics) {
      const hasPiLabel = epic.labels.some(
        (l) => l.toLowerCase() === selectedPi.toLowerCase()
      );
      const hasStretch = epic.labels.some(
        (l) => l.toLowerCase() === 'stretch'
      );

      newChecked.set(epic.key, hasPiLabel);
      newStretch.set(epic.key, hasStretch);
      newPoints.set(epic.key, epic.storyPointEstimate);

      if (hasPiLabel) {
        newOriginalChecked.add(epic.key);
      }
    }

    setCheckedEpics(newChecked);
    setStretchFlags(newStretch);
    setPointsEntries(newPoints);
    setOriginalChecked(newOriginalChecked);
  }, [selectedPi, epics]);

  // URL update helper for PI
  const handlePiChange = useCallback((pi: string | null) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (pi) {
      params.set(QUERY_PARAM_KEYS.PP_PI, pi);
    } else {
      params.delete(QUERY_PARAM_KEYS.PP_PI);
    }
    const newUrl = params.toString() ? `/pi-planning?${params.toString()}` : '/pi-planning';
    router.push(newUrl, { scroll: false });
  }, [router]);

  // URL-synced support percent handler
  const handleSupportPercentChange = useCallback((pct: number) => {
    setSupportPercentState(pct);
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (pct !== 10) {
      params.set(QUERY_PARAM_KEYS.PP_SUPPORT_PCT, pct.toString());
    } else {
      params.delete(QUERY_PARAM_KEYS.PP_SUPPORT_PCT);
    }
    const qs = params.toString();
    router.replace(qs ? `/pi-planning?${qs}` : '/pi-planning', { scroll: false });
  }, [router]);

  // URL-synced exclude sprint 7 handler
  const handleExcludeSprint7Change = useCallback((exclude: boolean) => {
    setExcludeSprint7State(exclude);
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (exclude) {
      params.set(QUERY_PARAM_KEYS.PP_EXCLUDE_S7, '1');
    } else {
      params.delete(QUERY_PARAM_KEYS.PP_EXCLUDE_S7);
    }
    const qs = params.toString();
    router.replace(qs ? `/pi-planning?${qs}` : '/pi-planning', { scroll: false });
  }, [router]);

  // Sync engineers + daysOut to URL whenever they change
  const isInitialDaysOutSync = useRef(true);
  useEffect(() => {
    // Skip the very first sync to avoid overwriting URL data we just parsed
    if (isInitialDaysOutSync.current) {
      isInitialDaysOutSync.current = false;
      return;
    }
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (engineers.length > 0) {
      params.set(QUERY_PARAM_KEYS.PP_DAYS_OFF, encodeDaysOffForUrl(engineers, daysOut));
    } else {
      params.delete(QUERY_PARAM_KEYS.PP_DAYS_OFF);
    }
    const qs = params.toString();
    router.replace(qs ? `/pi-planning?${qs}` : '/pi-planning', { scroll: false });
  }, [engineers, daysOut, router]);

  // Handlers for table interactions
  const handleCheckChange = useCallback((epicKey: string, checked: boolean) => {
    setCheckedEpics((prev) => {
      const next = new Map(prev);
      next.set(epicKey, checked);
      return next;
    });
  }, []);

  const handleStretchChange = useCallback((epicKey: string, isStretch: boolean) => {
    setStretchFlags((prev) => {
      const next = new Map(prev);
      next.set(epicKey, isStretch);
      return next;
    });
  }, []);

  const handlePointsChange = useCallback((epicKey: string, value: string) => {
    const numValue = value === '' ? null : parseFloat(value);
    setPointsEntries((prev) => {
      const next = new Map(prev);
      next.set(epicKey, numValue !== null && isNaN(numValue) ? null : numValue);
      return next;
    });
  }, []);

  // Engineer capacity handlers
  const handleDaysOutChange = useCallback((engineer: string, sprintIdx: number, value: string) => {
    const num = value === '' ? 0 : Math.max(0, Math.min(DAYS_PER_SPRINT, parseInt(value, 10) || 0));
    setDaysOut((prev) => {
      const next = new Map(prev);
      const sprints = [...(next.get(engineer) ?? new Array(SPRINT_COUNT).fill(0))];
      sprints[sprintIdx] = num;
      next.set(engineer, sprints);
      return next;
    });
  }, []);

  const handleAddEngineer = useCallback(() => {
    const name = newEngineerName.trim();
    if (!name || engineers.includes(name)) return;
    setEngineers((prev) => [...prev, name]);
    setDaysOut((prev) => {
      const next = new Map(prev);
      next.set(name, new Array(SPRINT_COUNT).fill(0));
      return next;
    });
    setNewEngineerName('');
  }, [newEngineerName, engineers]);

  const handleRemoveEngineer = useCallback((name: string) => {
    setEngineers((prev) => prev.filter((n) => n !== name));
    setDaysOut((prev) => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  }, []);

  // Sort handler
  const handleSort = useCallback((column: SortColumn) => {
    if (column === sortColumn) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn]);

  // Sorted epics
  const sortedEpics = useMemo(() => {
    const sorted = [...epics];
    const dir = sortDirection === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      switch (sortColumn) {
        case 'checked': {
          const aChecked = checkedEpics.get(a.key) ? 1 : 0;
          const bChecked = checkedEpics.get(b.key) ? 1 : 0;
          return (aChecked - bChecked) * dir;
        }
        case 'key':
          return a.key.localeCompare(b.key) * dir;
        case 'summary':
          return a.summary.localeCompare(b.summary) * dir;
        case 'status':
          return a.status.localeCompare(b.status) * dir;
        case 'childPoints':
          return (a.childStoryPoints - b.childStoryPoints) * dir;
        case 'piPoints': {
          const aPts = pointsEntries.get(a.key) ?? 0;
          const bPts = pointsEntries.get(b.key) ?? 0;
          return (aPts - bPts) * dir;
        }
        case 'stretch': {
          const aStretch = stretchFlags.get(a.key) ? 1 : 0;
          const bStretch = stretchFlags.get(b.key) ? 1 : 0;
          return (aStretch - bStretch) * dir;
        }
        default:
          return 0;
      }
    });

    return sorted;
  }, [epics, sortColumn, sortDirection, checkedEpics, pointsEntries, stretchFlags]);

  // Compute running totals
  const { checkedCount, totalPoints } = useMemo(() => {
    let count = 0;
    let points = 0;
    for (const [key, checked] of checkedEpics) {
      if (checked) {
        count++;
        const pts = pointsEntries.get(key);
        if (pts !== null && pts !== undefined && !isNaN(pts)) {
          points += pts;
        }
      }
    }
    return { checkedCount: count, totalPoints: points };
  }, [checkedEpics, pointsEntries]);

  // Compute total capacity from engineer grid, reduced by support percent
  const supportMultiplier = 1 - supportPercent / 100;
  const activeSprints = excludeSprint7 ? SPRINT_COUNT - 1 : SPRINT_COUNT;

  const totalCapacity = useMemo(() => {
    let total = 0;
    for (const sprints of daysOut.values()) {
      for (let i = 0; i < activeSprints; i++) {
        total += DAYS_PER_SPRINT - (sprints[i] ?? 0);
      }
    }
    return Math.round(total * supportMultiplier);
  }, [daysOut, supportMultiplier, activeSprints]);

  // Build chart data — only checked epics
  const chartEpics: PiPlanningEpicBar[] = useMemo(() => {
    const result: PiPlanningEpicBar[] = [];
    for (const epic of epics) {
      const isChecked = checkedEpics.get(epic.key) ?? false;
      if (!isChecked) continue;

      const pts = pointsEntries.get(epic.key);
      result.push({
        key: epic.key,
        summary: epic.summary,
        piPoints: pts !== null && pts !== undefined && !isNaN(pts) ? pts : 0,
        isStretch: stretchFlags.get(epic.key) ?? false,
      });
    }
    return result;
  }, [epics, checkedEpics, pointsEntries, stretchFlags]);

  // Determine if there are unsaved changes
  const hasChanges = useMemo(() => {
    if (!selectedPi) return false;

    for (const epic of epics) {
      const isChecked = checkedEpics.get(epic.key) ?? false;
      const wasChecked = originalChecked.has(epic.key);
      if (isChecked !== wasChecked) return true;

      if (isChecked) {
        const currentPoints = pointsEntries.get(epic.key) ?? null;
        if (currentPoints !== epic.storyPointEstimate) return true;

        const currentStretch = stretchFlags.get(epic.key) ?? false;
        const wasStretch = epic.labels.some((l) => l.toLowerCase() === 'stretch');
        if (currentStretch !== wasStretch) return true;
      }
    }
    return false;
  }, [selectedPi, epics, checkedEpics, originalChecked, pointsEntries, stretchFlags]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!selectedPi) return;

    const updates: { key: string; storyPointEstimate: number | null; isStretch: boolean }[] = [];
    const removals: string[] = [];

    for (const epic of epics) {
      const isChecked = checkedEpics.get(epic.key) ?? false;
      const wasChecked = originalChecked.has(epic.key);

      if (isChecked) {
        updates.push({
          key: epic.key,
          storyPointEstimate: pointsEntries.get(epic.key) ?? null,
          isStretch: stretchFlags.get(epic.key) ?? false,
        });
      } else if (wasChecked) {
        removals.push(epic.key);
      }
    }

    const success = await saveChanges(selectedPi, updates, removals);

    if (success) {
      setSnackbarSeverity('success');
      setSnackbarMessage(`Saved: ${updates.length} updated, ${removals.length} removed`);
    } else {
      setSnackbarSeverity('error');
      setSnackbarMessage('Some updates failed. Check the console for details.');
    }
    setSnackbarOpen(true);
  }, [selectedPi, epics, checkedEpics, originalChecked, pointsEntries, stretchFlags, saveChanges]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    if (!projectKey || isLoading) return;
    fetchEpics(projectKey);
  }, [projectKey, isLoading, fetchEpics]);

  // Close snackbar
  const handleSnackbarClose = useCallback(() => {
    setSnackbarOpen(false);
    clearSaveResult();
  }, [clearSaveResult]);

  // Status chip color
  const getStatusColor = (status: string): 'default' | 'primary' | 'success' | 'warning' | 'info' => {
    const lower = status.toLowerCase();
    if (lower === 'done' || lower === 'closed') return 'success';
    if (lower === 'in progress' || lower === 'in development') return 'primary';
    if (lower === 'to do' || lower === 'open' || lower === 'backlog') return 'default';
    return 'info';
  };

  // Compact cell style shared across both tables
  const compactCell = { fontSize: '0.75rem', py: 0.25, px: 0.5 } as const;

  // Sortable column header helper
  const SortHeader = ({ column, label, align }: { column: SortColumn; label: string; align?: 'left' | 'right' | 'center' }) => (
    <TableCell
      sx={{ fontWeight: 'bold', ...compactCell }}
      align={align}
      sortDirection={sortColumn === column ? sortDirection : false}
    >
      <TableSortLabel
        active={sortColumn === column}
        direction={sortColumn === column ? sortDirection : 'asc'}
        onClick={() => handleSort(column)}
        sx={{ fontSize: '0.75rem' }}
      >
        {label}
      </TableSortLabel>
    </TableCell>
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
      <Box
        sx={{
          display: 'flex',
          flexGrow: 1,
          overflow: 'hidden',
        }}
      >
        <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed}>
          <PiPlanningSidebarContent
            projectKey={projectKey}
            selectedPi={selectedPi}
            onPiChange={handlePiChange}
            checkedCount={checkedCount}
            totalPoints={totalPoints}
            supportPercent={supportPercent}
            onSupportPercentChange={handleSupportPercentChange}
            excludeSprint7={excludeSprint7}
            onExcludeSprint7Change={handleExcludeSprint7Change}
            isSaving={isSaving}
            hasChanges={hasChanges}
            onSave={handleSave}
          />
        </Sidebar>
        <MainContent>
          {error && (
            <Alert severity="error" sx={{ m: 2 }}>
              {error}
            </Alert>
          )}
          {saveResult && !saveResult.success && saveResult.errors && (
            <Alert severity="warning" sx={{ m: 2 }}>
              Some updates failed: {saveResult.errors.map((e) => `${e.key}: ${e.error}`).join('; ')}
            </Alert>
          )}
          {epics.length > 0 && selectedPi ? (
            <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden', gap: 1, p: 1 }}>
              {/* Left side — tables stacked vertically */}
              <Box sx={{ flex: '1 1 60%', minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>

                {/* Engineer Capacity Grid */}
                <TableContainer component={Paper} sx={{ flexShrink: 0 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold', ...compactCell, minWidth: 120 }}>Engineer</TableCell>
                        {Array.from({ length: SPRINT_COUNT }, (_, i) => (
                          <TableCell
                            key={i}
                            align="center"
                            sx={{
                              fontWeight: 'bold',
                              ...compactCell,
                              minWidth: 50,
                              ...(excludeSprint7 && i === SPRINT_COUNT - 1 ? { opacity: 0.3 } : {}),
                            }}
                          >
                            S{i + 1}
                          </TableCell>
                        ))}
                        <TableCell align="right" sx={{ fontWeight: 'bold', ...compactCell, minWidth: 70 }}>
                          Capacity
                        </TableCell>
                        <TableCell sx={{ width: 32, ...compactCell }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {engineers.map((name) => {
                        const sprints = daysOut.get(name) ?? new Array(SPRINT_COUNT).fill(0);
                        const engineerCapacity = sprints.reduce(
                          (sum, out, idx) => idx < activeSprints ? sum + (DAYS_PER_SPRINT - out) : sum,
                          0
                        );

                        return (
                          <TableRow key={name} hover>
                            <TableCell sx={compactCell}>
                              <Typography sx={{ fontSize: '0.75rem', fontWeight: 500 }} noWrap>
                                {name}
                              </Typography>
                            </TableCell>
                            {sprints.map((val, sprintIdx) => {
                              const isExcluded = excludeSprint7 && sprintIdx === SPRINT_COUNT - 1;
                              return (
                                <TableCell key={sprintIdx} align="center" sx={{ ...compactCell, p: 0.25, ...(isExcluded ? { opacity: 0.3 } : {}) }}>
                                  <TextField
                                    type="number"
                                    size="small"
                                    value={val || ''}
                                    onChange={(e) => handleDaysOutChange(name, sprintIdx, e.target.value)}
                                    disabled={isExcluded}
                                    inputProps={{ min: 0, max: DAYS_PER_SPRINT, style: { textAlign: 'center', fontSize: '0.75rem', padding: '2px 4px' } }}
                                    sx={{ width: 44 }}
                                    placeholder="0"
                                  />
                                </TableCell>
                              );
                            })}
                            <TableCell align="right" sx={compactCell}>
                              <Typography sx={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
                                {engineerCapacity}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ p: 0 }}>
                              <IconButton
                                size="small"
                                onClick={() => handleRemoveEngineer(name)}
                                color="error"
                                sx={{ p: 0.25 }}
                              >
                                <RemoveCircleOutlineIcon sx={{ fontSize: '1rem' }} />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        );
                      })}

                      {/* Add engineer row */}
                      <TableRow>
                        <TableCell colSpan={SPRINT_COUNT + 1} sx={{ ...compactCell, p: 0.25 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <TextField
                              size="small"
                              value={newEngineerName}
                              onChange={(e) => setNewEngineerName(e.target.value)}
                              placeholder="Add engineer..."
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddEngineer();
                              }}
                              inputProps={{ style: { fontSize: '0.75rem', padding: '2px 6px' } }}
                              sx={{ width: 160 }}
                            />
                            <IconButton
                              size="small"
                              onClick={handleAddEngineer}
                              disabled={!newEngineerName.trim()}
                              color="primary"
                              sx={{ p: 0.25 }}
                            >
                              <AddIcon sx={{ fontSize: '1rem' }} />
                            </IconButton>
                          </Box>
                        </TableCell>
                        <TableCell align="right" sx={compactCell}>
                          <Typography sx={{ fontSize: '0.75rem', fontWeight: 'bold' }} color="primary">
                            {totalCapacity}
                          </Typography>
                        </TableCell>
                        <TableCell sx={compactCell} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>

                {/* Epics Table */}
                <TableContainer component={Paper} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell
                          padding="checkbox"
                          sortDirection={sortColumn === 'checked' ? sortDirection : false}
                          sx={compactCell}
                        >
                          <TableSortLabel
                            active={sortColumn === 'checked'}
                            direction={sortColumn === 'checked' ? sortDirection : 'asc'}
                            onClick={() => handleSort('checked')}
                          />
                        </TableCell>
                        <SortHeader column="key" label="Key" />
                        <SortHeader column="summary" label="Summary" />
                        <SortHeader column="status" label="Status" />
                        <SortHeader column="childPoints" label="Child Points" align="right" />
                        <SortHeader column="piPoints" label="PI Points" align="right" />
                        <SortHeader column="stretch" label="Stretch" align="center" />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedEpics.map((epic) => {
                        const isChecked = checkedEpics.get(epic.key) ?? false;
                        const isStretch = stretchFlags.get(epic.key) ?? false;
                        const points = pointsEntries.get(epic.key);

                        return (
                          <EpicRow
                            key={epic.key}
                            epic={epic}
                            isChecked={isChecked}
                            isStretch={isStretch}
                            points={points ?? null}
                            getStatusColor={getStatusColor}
                            onCheckChange={handleCheckChange}
                            onStretchChange={handleStretchChange}
                            onPointsChange={handlePointsChange}
                          />
                        );
                      })}
                      {/* Running total row */}
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell sx={compactCell} />
                        <TableCell colSpan={3} sx={compactCell}>
                          <Typography sx={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
                            Total ({checkedCount} epics)
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={compactCell}>
                          <Typography sx={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
                            {epics.reduce((sum, e) => {
                              const isChecked = checkedEpics.get(e.key) ?? false;
                              return isChecked ? sum + e.childStoryPoints : sum;
                            }, 0)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={compactCell}>
                          <Typography sx={{ fontSize: '0.75rem', fontWeight: 'bold' }} color="primary">
                            {totalPoints}
                          </Typography>
                        </TableCell>
                        <TableCell sx={compactCell} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>

              {/* Chart — right side */}
              <Box sx={{ flex: '0 0 40%', minWidth: 350, overflow: 'auto' }}>
                <PiPlanningChart
                  epics={chartEpics}
                  piLabel={selectedPi}
                  capacity={totalCapacity}
                />
              </Box>
            </Box>
          ) : (
            <Box
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'text.secondary',
              }}
            >
              {isLoading ? (
                <>
                  <CircularProgress sx={{ mb: 2 }} />
                  <Typography variant="h6" gutterBottom>
                    Loading Epics...
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6" gutterBottom>
                    {!projectKey
                      ? 'Select a Project'
                      : !selectedPi
                        ? 'Select a Planning Increment'
                        : 'No Epics Found'}
                  </Typography>
                  <Typography variant="body2">
                    {!projectKey
                      ? 'Choose a JIRA project to manage PI assignments'
                      : !selectedPi
                        ? 'Choose a PI to assign epics to'
                        : 'No open epics found for this project'}
                  </Typography>
                </>
              )}
            </Box>
          )}
        </MainContent>
      </Box>

      {/* Refresh FAB */}
      <Tooltip title="Refresh epics from JIRA">
        <span>
          <Fab
            color="primary"
            aria-label="refresh"
            onClick={handleRefresh}
            disabled={isLoading || !projectKey}
            sx={{
              position: 'fixed',
              bottom: 24,
              right: 24,
            }}
          >
            {isLoading ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
          </Fab>
        </span>
      </Tooltip>

      {/* Save feedback */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbarSeverity} variant="filled">
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

/**
 * Epic table row — extracted to avoid re-rendering the whole table on each keystroke.
 */
interface EpicRowProps {
  epic: PiPlanningEpic;
  isChecked: boolean;
  isStretch: boolean;
  points: number | null;
  getStatusColor: (status: string) => 'default' | 'primary' | 'success' | 'warning' | 'info';
  onCheckChange: (key: string, checked: boolean) => void;
  onStretchChange: (key: string, isStretch: boolean) => void;
  onPointsChange: (key: string, value: string) => void;
}

const compactCellSx = { fontSize: '0.75rem', py: 0.25, px: 0.5 } as const;

const EpicRow = ({
  epic,
  isChecked,
  isStretch,
  points,
  getStatusColor,
  onCheckChange,
  onStretchChange,
  onPointsChange,
}: EpicRowProps) => (
  <TableRow
    hover
    sx={{
      opacity: isChecked ? 1 : 0.6,
      bgcolor: isChecked ? 'action.selected' : undefined,
    }}
  >
    <TableCell padding="checkbox" sx={compactCellSx}>
      <Checkbox
        checked={isChecked}
        onChange={(e) => onCheckChange(epic.key, e.target.checked)}
        size="small"
        sx={{ p: 0.25 }}
      />
    </TableCell>
    <TableCell sx={compactCellSx}>
      {JIRA_BASE_URL ? (
        <Link
          href={`${JIRA_BASE_URL}/browse/${epic.key}`}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ fontSize: '0.75rem', fontWeight: 500, fontFamily: 'monospace' }}
        >
          {epic.key}
        </Link>
      ) : (
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, fontFamily: 'monospace' }}>
          {epic.key}
        </Typography>
      )}
    </TableCell>
    <TableCell sx={compactCellSx}>
      <Typography sx={{ fontSize: '0.75rem' }} noWrap>
        {epic.summary}
      </Typography>
    </TableCell>
    <TableCell sx={compactCellSx}>
      <Chip
        label={epic.status}
        size="small"
        color={getStatusColor(epic.status)}
        variant="outlined"
        sx={{ fontSize: '0.7rem', height: 20 }}
      />
    </TableCell>
    <TableCell align="right" sx={compactCellSx}>
      <Typography sx={{ fontSize: '0.75rem' }}>
        {epic.childStoryPoints}
      </Typography>
    </TableCell>
    <TableCell align="right" sx={{ ...compactCellSx, p: 0.25 }}>
      <TextField
        type="number"
        size="small"
        value={points ?? ''}
        onChange={(e) => onPointsChange(epic.key, e.target.value)}
        disabled={!isChecked}
        inputProps={{ min: 0, step: 0.5, style: { fontSize: '0.75rem', padding: '2px 4px' } }}
        sx={{ width: 70 }}
      />
    </TableCell>
    <TableCell align="center" sx={compactCellSx}>
      <Checkbox
        checked={isStretch}
        onChange={(e) => onStretchChange(epic.key, e.target.checked)}
        disabled={!isChecked}
        size="small"
        sx={{ p: 0.25 }}
      />
    </TableCell>
  </TableRow>
);

const PiPlanning = () => {
  return (
    <Suspense
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      }
    >
      <PiPlanningContent />
    </Suspense>
  );
};

export default PiPlanning;
