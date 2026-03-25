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
import RefreshIcon from '@mui/icons-material/Refresh';
import { Header, Sidebar, MainContent } from '@/frontend/components';
import { PiPlanningSidebarContent } from '@/frontend/components/sidebar';
import { PiPlanningChart } from '@/frontend/components/chart';
import type { PiPlanningEpicBar } from '@/frontend/components/chart';
import { useAppState, usePiPlanningData } from '@/frontend/hooks';
import type { SprintCapacityInfo } from '@/frontend/hooks/useCapacityDemandData';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { JiraSprint } from '@/shared/types';
import type { PiPlanningEpic } from '@/frontend/hooks/usePiPlanningData';
import { deserializeCapacity, computeTotalCapacity, computeEngineerCapacity } from '@/shared/lib/capacity';
import type { CapacityPayload } from '@/shared/lib/capacity';

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

// Sortable columns
type SortColumn = 'checked' | 'key' | 'summary' | 'status' | 'childPoints' | 'piPoints' | 'plannedStretch' | 'stretch';
type SortDirection = 'asc' | 'desc';

interface SprintCapacityDetail {
  sprintId: number;
  sprintName: string;
  startDate: string;
  totalCapacity: number | null;
  payload: CapacityPayload | null;
}

const PiPlanningContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ connected: false });

  const { projectKey, boardId, sidebarCollapsed, setSidebarCollapsed } = useAppState();

  const { epics, isLoading, isSaving, error, saveResult, fetchEpics, saveChanges, clearSaveResult } = usePiPlanningData();

  // Parse selected PI from URL
  const selectedPi = searchParams.get(QUERY_PARAM_KEYS.PP_PI);

  // Local editing state
  const [checkedEpics, setCheckedEpics] = useState<Map<string, boolean>>(new Map());
  const [stretchFlags, setStretchFlags] = useState<Map<string, boolean>>(new Map());
  const [plannedStretchFlags, setPlannedStretchFlags] = useState<Map<string, boolean>>(new Map());
  const [pointsEntries, setPointsEntries] = useState<Map<string, number | null>>(new Map());
  const [originalChecked, setOriginalChecked] = useState<Set<string>>(new Set());
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error'>('success');

  // Sorting state
  const [sortColumn, setSortColumn] = useState<SortColumn>('checked');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Engineer grid column widths (for resizable columns)
  const [gridColWidths, setGridColWidths] = useState<Record<string, number>>({});
  const colResizeRef = useRef<{ colKey: string; startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback((colKey: string, currentWidth: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    colResizeRef.current = { colKey, startX: e.clientX, startWidth: currentWidth };
    const onMouseMove = (me: MouseEvent) => {
      const r = colResizeRef.current;
      if (!r) return;
      const newWidth = Math.max(50, r.startWidth + (me.clientX - r.startX));
      setGridColWidths((prev) => ({ ...prev, [r.colKey]: newWidth }));
    };
    const onMouseUp = () => {
      colResizeRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  // ── Sprint capacity state ──────────────────────────────────────────

  const [piSprintIds, setPiSprintIds] = useState<number[]>([]);
  const [allSprints, setAllSprints] = useState<JiraSprint[]>([]);
  const [sprintCapacityDetails, setSprintCapacityDetails] = useState<SprintCapacityDetail[]>([]);

  // Load sprints for board/project
  useEffect(() => {
    if (!boardId) { setAllSprints([]); return; }
    let cancelled = false;
    const fetchSprints = async () => {
      try {
        const params = new URLSearchParams({ boardId: boardId.toString() });
        if (projectKey) params.set('projectKey', projectKey);
        const res = await fetch(`/api/sprints?${params}`);
        const json = await res.json();
        if (!cancelled && !json.error) {
          setAllSprints((json.sprints ?? []).filter((s: JiraSprint) => s.startDate && s.endDate));
        }
      } catch { /* ignore */ }
    };
    fetchSprints();
    return () => { cancelled = true; };
  }, [boardId, projectKey]);

  // Load PI sprint assignments from Jira when project/PI changes
  useEffect(() => {
    if (!projectKey || !selectedPi) { setPiSprintIds([]); return; }
    let cancelled = false;
    const fetchPiSprints = async () => {
      try {
        const params = new URLSearchParams({ projectKey, pi: selectedPi });
        const res = await fetch(`/api/capacity/pi-sprints?${params}`);
        const json = await res.json();
        if (!cancelled && json.data) {
          const ids = (json.data as string).split(',').map(Number).filter(Boolean);
          setPiSprintIds(ids);
        } else if (!cancelled) {
          setPiSprintIds([]);
        }
      } catch { if (!cancelled) setPiSprintIds([]); }
    };
    fetchPiSprints();
    return () => { cancelled = true; };
  }, [projectKey, selectedPi]);

  // Load per-sprint capacity from Jira
  useEffect(() => {
    if (!projectKey || piSprintIds.length === 0 || allSprints.length === 0) {
      setSprintCapacityDetails([]);
      return;
    }

    const sprintMap = new Map<number, JiraSprint>();
    for (const s of allSprints) sprintMap.set(s.id, s);

    const requests = piSprintIds
      .map((id) => sprintMap.get(id))
      .filter((s): s is JiraSprint => s !== undefined);

    if (requests.length === 0) { setSprintCapacityDetails([]); return; }

    let cancelled = false;

    Promise.all(
      requests.map(async (sprint) => {
        try {
          const params = new URLSearchParams({ projectKey, sprintId: sprint.id.toString(), sprintName: sprint.name });
          const res = await fetch(`/api/capacity/storage?${params}`);
          const json = await res.json();
          let payload: CapacityPayload | null = null;
          let totalCapacity: number | null = null;
          if (json.data) {
            payload = deserializeCapacity(json.data);
            if (payload) totalCapacity = computeTotalCapacity(payload.rows, payload.supportPct);
          }
          return { sprintId: sprint.id, sprintName: sprint.name, startDate: sprint.startDate, totalCapacity, payload };
        } catch {
          return { sprintId: sprint.id, sprintName: sprint.name, startDate: sprint.startDate, totalCapacity: null, payload: null };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      // Sort by start date (calendar order)
      results.sort((a, b) => a.startDate.localeCompare(b.startDate));
      setSprintCapacityDetails(results);
    });

    return () => { cancelled = true; };
  }, [projectKey, piSprintIds, allSprints]);

  // Derive SprintCapacityInfo[] for the chart (already sorted by start date)
  const capacitySegments: SprintCapacityInfo[] = useMemo(
    () => sprintCapacityDetails.map((d) => ({
      sprintId: d.sprintId,
      sprintName: d.sprintName,
      totalCapacity: d.totalCapacity,
    })),
    [sprintCapacityDetails]
  );

  // Total capacity for the table total row comparison
  const totalCapacity = useMemo(() => {
    if (capacitySegments.length === 0) return 400;
    return Math.round(capacitySegments.reduce((sum, s) => sum + (s.totalCapacity ?? 50), 0) * 10) / 10;
  }, [capacitySegments]);

  // ── Track previous project ─────────────────────────────────────────

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

  // Auto-fetch epics when project changes
  useEffect(() => {
    if (projectKey && projectKey !== prevProjectRef.current) {
      prevProjectRef.current = projectKey;
      fetchEpics(projectKey);
    }
    if (!projectKey) prevProjectRef.current = undefined;
  }, [projectKey, fetchEpics]);

  // Pre-populate editing state when PI selection or epics change
  useEffect(() => {
    if (!selectedPi || epics.length === 0) {
      setCheckedEpics(new Map());
      setStretchFlags(new Map());
      setPlannedStretchFlags(new Map());
      setPointsEntries(new Map());
      setOriginalChecked(new Set());
      return;
    }

    const newChecked = new Map<string, boolean>();
    const newStretch = new Map<string, boolean>();
    const newPlannedStretch = new Map<string, boolean>();
    const newPoints = new Map<string, number | null>();
    const newOriginalChecked = new Set<string>();

    for (const epic of epics) {
      const hasPiLabel = epic.labels.some((l) => l.toLowerCase() === selectedPi.toLowerCase());
      newChecked.set(epic.key, hasPiLabel);
      newStretch.set(epic.key, epic.labels.some((l) => l.toLowerCase() === 'stretch'));
      newPlannedStretch.set(epic.key, epic.labels.some((l) => l.toLowerCase() === 'stretchplan'));
      newPoints.set(epic.key, epic.storyPointEstimate);
      if (hasPiLabel) newOriginalChecked.add(epic.key);
    }

    setCheckedEpics(newChecked);
    setStretchFlags(newStretch);
    setPlannedStretchFlags(newPlannedStretch);
    setPointsEntries(newPoints);
    setOriginalChecked(newOriginalChecked);
  }, [selectedPi, epics]);

  // URL update helper for PI
  const handlePiChange = useCallback((pi: string | null) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (pi) params.set(QUERY_PARAM_KEYS.PP_PI, pi);
    else params.delete(QUERY_PARAM_KEYS.PP_PI);
    const newUrl = params.toString() ? `/pi-planning?${params.toString()}` : '/pi-planning';
    router.push(newUrl, { scroll: false });
  }, [router]);

  // Table interaction handlers
  const handleCheckChange = useCallback((epicKey: string, checked: boolean) => {
    setCheckedEpics((prev) => { const next = new Map(prev); next.set(epicKey, checked); return next; });
  }, []);

  const handleStretchChange = useCallback((epicKey: string, isStretch: boolean) => {
    setStretchFlags((prev) => { const next = new Map(prev); next.set(epicKey, isStretch); return next; });
  }, []);

  const handlePlannedStretchChange = useCallback((epicKey: string, isPlannedStretch: boolean) => {
    setPlannedStretchFlags((prev) => { const next = new Map(prev); next.set(epicKey, isPlannedStretch); return next; });
  }, []);

  const handlePointsChange = useCallback((epicKey: string, value: string) => {
    const numValue = value === '' ? null : parseFloat(value);
    setPointsEntries((prev) => { const next = new Map(prev); next.set(epicKey, numValue !== null && isNaN(numValue) ? null : numValue); return next; });
  }, []);

  // Sort handler
  const handleSort = useCallback((column: SortColumn) => {
    if (column === sortColumn) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortColumn(column); setSortDirection('asc'); }
  }, [sortColumn]);

  // Sorted epics
  const sortedEpics = useMemo(() => {
    const sorted = [...epics];
    const dir = sortDirection === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sortColumn) {
        case 'checked': return ((checkedEpics.get(a.key) ? 1 : 0) - (checkedEpics.get(b.key) ? 1 : 0)) * dir;
        case 'key': return a.key.localeCompare(b.key) * dir;
        case 'summary': return a.summary.localeCompare(b.summary) * dir;
        case 'status': return a.status.localeCompare(b.status) * dir;
        case 'childPoints': return (a.childStoryPoints - b.childStoryPoints) * dir;
        case 'piPoints': return ((pointsEntries.get(a.key) ?? 0) - (pointsEntries.get(b.key) ?? 0)) * dir;
        case 'plannedStretch': return ((plannedStretchFlags.get(a.key) ? 1 : 0) - (plannedStretchFlags.get(b.key) ? 1 : 0)) * dir;
        case 'stretch': return ((stretchFlags.get(a.key) ? 1 : 0) - (stretchFlags.get(b.key) ? 1 : 0)) * dir;
        default: return 0;
      }
    });
    return sorted;
  }, [epics, sortColumn, sortDirection, checkedEpics, pointsEntries, stretchFlags, plannedStretchFlags]);

  // Running totals
  const { checkedCount, totalPoints } = useMemo(() => {
    let count = 0;
    let points = 0;
    for (const [key, checked] of checkedEpics) {
      if (checked) {
        count++;
        const pts = pointsEntries.get(key);
        if (pts !== null && pts !== undefined && !isNaN(pts)) points += pts;
      }
    }
    return { checkedCount: count, totalPoints: points };
  }, [checkedEpics, pointsEntries]);

  // Chart data — only checked epics
  const chartEpics: PiPlanningEpicBar[] = useMemo(() => {
    const result: PiPlanningEpicBar[] = [];
    for (const epic of epics) {
      if (!(checkedEpics.get(epic.key) ?? false)) continue;
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

  // Has unsaved changes
  const hasChanges = useMemo(() => {
    if (!selectedPi) return false;
    for (const epic of epics) {
      const isChecked = checkedEpics.get(epic.key) ?? false;
      const wasChecked = originalChecked.has(epic.key);
      if (isChecked !== wasChecked) return true;
      if (isChecked) {
        if ((pointsEntries.get(epic.key) ?? null) !== epic.storyPointEstimate) return true;
        if ((stretchFlags.get(epic.key) ?? false) !== epic.labels.some((l) => l.toLowerCase() === 'stretch')) return true;
        if ((plannedStretchFlags.get(epic.key) ?? false) !== epic.labels.some((l) => l.toLowerCase() === 'stretchplan')) return true;
      }
    }
    return false;
  }, [selectedPi, epics, checkedEpics, originalChecked, pointsEntries, stretchFlags, plannedStretchFlags]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!selectedPi) return;
    const updates: { key: string; storyPointEstimate: number | null; isStretch: boolean; isPlannedStretch: boolean }[] = [];
    const removals: string[] = [];
    for (const epic of epics) {
      const isChecked = checkedEpics.get(epic.key) ?? false;
      const wasChecked = originalChecked.has(epic.key);
      if (isChecked) {
        updates.push({
          key: epic.key,
          storyPointEstimate: pointsEntries.get(epic.key) ?? null,
          isStretch: stretchFlags.get(epic.key) ?? false,
          isPlannedStretch: plannedStretchFlags.get(epic.key) ?? false,
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
  }, [selectedPi, epics, checkedEpics, originalChecked, pointsEntries, stretchFlags, plannedStretchFlags, saveChanges]);

  const handleRefresh = useCallback(() => {
    if (!projectKey || isLoading) return;
    fetchEpics(projectKey);
  }, [projectKey, isLoading, fetchEpics]);

  const handleSnackbarClose = useCallback(() => {
    setSnackbarOpen(false);
    clearSaveResult();
  }, [clearSaveResult]);

  const getStatusColor = (status: string): 'default' | 'primary' | 'success' | 'warning' | 'info' => {
    const lower = status.toLowerCase();
    if (lower === 'done' || lower === 'closed') return 'success';
    if (lower === 'in progress' || lower === 'in development') return 'primary';
    if (lower === 'to do' || lower === 'open' || lower === 'backlog') return 'default';
    return 'info';
  };

  // ── Engineer capacity grid data ────────────────────────────────────

  const engineerGridData = useMemo(() => {
    const sortedSprints = sprintCapacityDetails; // already sorted by start date
    if (sortedSprints.length === 0) return null;

    // Collect all unique engineer names (preserve order: first appearance)
    const engineerSet = new Set<string>();
    for (const detail of sortedSprints) {
      if (detail.payload) {
        for (const row of detail.payload.rows) {
          engineerSet.add(row.name);
        }
      }
    }
    if (engineerSet.size === 0) return null;

    const engineers = Array.from(engineerSet).sort();

    // Build payload map for quick lookup
    const payloadMap = new Map<number, CapacityPayload | null>();
    for (const d of sortedSprints) payloadMap.set(d.sprintId, d.payload);

    return { sortedSprints, engineers, payloadMap };
  }, [sprintCapacityDetails]);

  const compactCell = { fontSize: '0.75rem', py: 0.25, px: 0.5 } as const;
  const compactHeaderCell = { ...compactCell, fontWeight: 700, whiteSpace: 'nowrap' as const, bgcolor: 'grey.100' };

  const gridHeaderCellSx = (colKey: string, defaultWidth: number, align: 'left' | 'right' = 'left') => ({
    fontSize: '0.75rem',
    py: 0.25,
    px: 0.5,
    fontWeight: 700,
    bgcolor: 'grey.100',
    position: 'relative' as const,
    whiteSpace: 'normal' as const,
    wordBreak: 'break-word' as const,
    width: gridColWidths[colKey] ?? defaultWidth,
    minWidth: gridColWidths[colKey] ?? defaultWidth,
    maxWidth: gridColWidths[colKey] ?? defaultWidth,
    verticalAlign: 'bottom',
    lineHeight: 1.2,
    textAlign: align,
  });

  const SortHeader = ({ column, label, align }: { column: SortColumn; label: string; align?: 'left' | 'right' | 'center' }) => (
    <TableCell sx={compactHeaderCell} align={align} sortDirection={sortColumn === column ? sortDirection : false}>
      <TableSortLabel
        active={sortColumn === column}
        direction={sortColumn === column ? sortDirection : 'asc'}
        onClick={() => handleSort(column)}
        sx={{ fontSize: 'inherit', '& .MuiTableSortLabel-icon': { fontSize: '0.875rem' } }}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header connectionStatus={connectionStatus} />
      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed}>
          <PiPlanningSidebarContent
            projectKey={projectKey}
            selectedPi={selectedPi}
            onPiChange={handlePiChange}
            checkedCount={checkedCount}
            totalPoints={totalPoints}
            isSaving={isSaving}
            hasChanges={hasChanges}
            onSave={handleSave}
          />
        </Sidebar>
        <MainContent>
          {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
          {saveResult && !saveResult.success && saveResult.errors && (
            <Alert severity="warning" sx={{ m: 2 }}>
              Some updates failed: {saveResult.errors.map((e) => `${e.key}: ${e.error}`).join('; ')}
            </Alert>
          )}
          {epics.length > 0 && selectedPi ? (
            <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden', gap: 1.5, p: 1.5 }}>
              {/* Left side — epics table */}
              <Box sx={{ flex: '1 1 60%', minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Paper elevation={1} sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <Typography variant="subtitle2" sx={{ px: 1.5, pt: 1, pb: 0.5, fontWeight: 700, borderLeft: 3, borderColor: 'primary.main', flexShrink: 0 }}>
                    Epics ({epics.length})
                  </Typography>
                  <TableContainer sx={{ flex: 1, minHeight: 0 }}>
                    <Table stickyHeader size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell padding="checkbox" sortDirection={sortColumn === 'checked' ? sortDirection : false} sx={compactHeaderCell}>
                            <TableSortLabel
                              active={sortColumn === 'checked'}
                              direction={sortColumn === 'checked' ? sortDirection : 'asc'}
                              onClick={() => handleSort('checked')}
                              sx={{ '& .MuiTableSortLabel-icon': { fontSize: '0.875rem' } }}
                            />
                          </TableCell>
                          <SortHeader column="key" label="Key" />
                          <SortHeader column="summary" label="Summary" />
                          <SortHeader column="status" label="Status" />
                          <SortHeader column="childPoints" label="Child Points" align="right" />
                          <SortHeader column="piPoints" label="PI Points" align="right" />
                          <SortHeader column="plannedStretch" label="Planned Stretch" align="center" />
                          <SortHeader column="stretch" label="Stretch" align="center" />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {sortedEpics.map((epic, idx) => {
                          const isChecked = checkedEpics.get(epic.key) ?? false;
                          const isStretch = stretchFlags.get(epic.key) ?? false;
                          const isPlannedStretch = plannedStretchFlags.get(epic.key) ?? false;
                          const points = pointsEntries.get(epic.key);
                          return (
                            <EpicRow
                              key={epic.key}
                              epic={epic}
                              isChecked={isChecked}
                              isStretch={isStretch}
                              isPlannedStretch={isPlannedStretch}
                              points={points ?? null}
                              even={idx % 2 === 1}
                              getStatusColor={getStatusColor}
                              onCheckChange={handleCheckChange}
                              onStretchChange={handleStretchChange}
                              onPlannedStretchChange={handlePlannedStretchChange}
                              onPointsChange={handlePointsChange}
                            />
                          );
                        })}
                        {/* Running total row */}
                        <TableRow sx={{ '& td': { fontWeight: 700 }, bgcolor: 'grey.100', borderTop: 2, borderColor: 'divider' }}>
                          <TableCell sx={compactCell} />
                          <TableCell colSpan={3} sx={compactCell}>Total ({checkedCount} epics)</TableCell>
                          <TableCell align="right" sx={compactCell}>
                            {epics.reduce((sum, e) => (checkedEpics.get(e.key) ?? false) ? sum + e.childStoryPoints : sum, 0)}
                          </TableCell>
                          <TableCell align="right" sx={compactCell}>
                            <Box component="span" sx={{ color: totalPoints > totalCapacity ? 'error.main' : 'success.main' }}>
                              {totalPoints}
                            </Box>
                          </TableCell>
                          <TableCell sx={compactCell} />
                          <TableCell sx={compactCell} />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </Box>

              {/* Right side — chart + engineer grid */}
              <Box sx={{ flex: '0 0 40%', minWidth: 350, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ flexShrink: 0 }}>
                  <PiPlanningChart
                    epics={chartEpics}
                    piLabel={selectedPi}
                    capacitySegments={capacitySegments}
                  />
                </Box>

                {/* Engineer capacity grid */}
                {engineerGridData && (
                  <Paper elevation={1} sx={{ flexShrink: 0, overflow: 'hidden' }}>
                    <Typography variant="subtitle2" sx={{ px: 1.5, pt: 1, pb: 0.5, fontWeight: 700, borderLeft: 3, borderColor: 'secondary.main' }}>
                      Engineer Capacity by Sprint
                    </Typography>
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={gridHeaderCellSx('engineer', 120)}>
                              Engineer
                              <Box onMouseDown={handleResizeStart('engineer', gridColWidths['engineer'] ?? 120)} sx={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize', '&:hover': { bgcolor: 'primary.light', opacity: 0.6 } }} />
                            </TableCell>
                            {engineerGridData.sortedSprints.map((d) => {
                              const colKey = `sprint-${d.sprintId}`;
                              return (
                                <TableCell key={d.sprintId} align="right" sx={gridHeaderCellSx(colKey, 90, 'right')}>
                                  {d.sprintName}
                                  <Box onMouseDown={handleResizeStart(colKey, gridColWidths[colKey] ?? 90)} sx={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize', '&:hover': { bgcolor: 'primary.light', opacity: 0.6 } }} />
                                </TableCell>
                              );
                            })}
                            <TableCell align="right" sx={gridHeaderCellSx('total', 60, 'right')}>
                              Total
                              <Box onMouseDown={handleResizeStart('total', gridColWidths['total'] ?? 60)} sx={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize', '&:hover': { bgcolor: 'primary.light', opacity: 0.6 } }} />
                            </TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {engineerGridData.engineers.map((name, idx) => {
                            const rowTotal = engineerGridData.sortedSprints.reduce((sum, d) => {
                              const payload = engineerGridData.payloadMap.get(d.sprintId);
                              const row = payload?.rows.find((r) => r.name === name);
                              return row ? sum + computeEngineerCapacity(row) : sum;
                            }, 0);
                            return (
                              <TableRow key={name} sx={{ bgcolor: idx % 2 === 1 ? 'grey.50' : undefined }}>
                                <TableCell sx={compactCell}>{name}</TableCell>
                                {engineerGridData.sortedSprints.map((d) => {
                                  const payload = engineerGridData.payloadMap.get(d.sprintId);
                                  const row = payload?.rows.find((r) => r.name === name);
                                  const cap = row ? computeEngineerCapacity(row) : null;
                                  return (
                                    <TableCell key={d.sprintId} align="right" sx={{ ...compactCell, color: cap === null ? 'text.disabled' : undefined }}>
                                      {cap !== null ? cap : '—'}
                                    </TableCell>
                                  );
                                })}
                                <TableCell align="right" sx={{ ...compactCell, fontWeight: 700 }}>
                                  {Math.round(rowTotal * 10) / 10}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {/* Sprint totals row */}
                          <TableRow sx={{ bgcolor: 'grey.100', '& td': { fontWeight: 700 }, borderTop: 2, borderColor: 'divider' }}>
                            <TableCell sx={compactCell}>Sprint Total</TableCell>
                            {engineerGridData.sortedSprints.map((d) => (
                              <TableCell key={d.sprintId} align="right" sx={compactCell}>
                                {d.totalCapacity !== null ? d.totalCapacity : '—'}
                              </TableCell>
                            ))}
                            <TableCell align="right" sx={compactCell}>
                              {Math.round(engineerGridData.sortedSprints.reduce((sum, d) => sum + (d.totalCapacity ?? 0), 0) * 10) / 10}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Paper>
                )}
              </Box>
            </Box>
          ) : (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
              {isLoading ? (
                <>
                  <CircularProgress sx={{ mb: 2 }} />
                  <Typography variant="h6" gutterBottom>Loading Epics...</Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6" gutterBottom>
                    {!projectKey ? 'Select a Project' : !selectedPi ? 'Select a Planning Increment' : 'No Epics Found'}
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

      <Tooltip title="Refresh epics from JIRA">
        <span>
          <Fab
            color="primary"
            aria-label="refresh"
            onClick={handleRefresh}
            disabled={isLoading || !projectKey}
            sx={{ position: 'fixed', bottom: 24, right: 24 }}
          >
            {isLoading ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
          </Fab>
        </span>
      </Tooltip>

      <Snackbar open={snackbarOpen} autoHideDuration={4000} onClose={handleSnackbarClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
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
  isPlannedStretch: boolean;
  points: number | null;
  even: boolean;
  getStatusColor: (status: string) => 'default' | 'primary' | 'success' | 'warning' | 'info';
  onCheckChange: (key: string, checked: boolean) => void;
  onStretchChange: (key: string, isStretch: boolean) => void;
  onPlannedStretchChange: (key: string, isPlannedStretch: boolean) => void;
  onPointsChange: (key: string, value: string) => void;
}

const compactCellSx = { fontSize: '0.75rem', py: 0.25, px: 0.5 } as const;

const EpicRow = ({ epic, isChecked, isStretch, isPlannedStretch, points, even, getStatusColor, onCheckChange, onStretchChange, onPlannedStretchChange, onPointsChange }: EpicRowProps) => (
  <TableRow
    hover
    sx={{
      opacity: isChecked ? 1 : 0.5,
      ...(isChecked ? { bgcolor: 'action.selected' } : even ? { bgcolor: 'grey.50' } : {}),
    }}
  >
    <TableCell padding="checkbox" sx={compactCellSx}>
      <Checkbox checked={isChecked} onChange={(e) => onCheckChange(epic.key, e.target.checked)} size="small" sx={{ p: 0.25 }} />
    </TableCell>
    <TableCell sx={compactCellSx}>
      {JIRA_BASE_URL ? (
        <Link href={`${JIRA_BASE_URL}/browse/${epic.key}`} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ fontSize: '0.75rem', fontWeight: 500, fontFamily: 'monospace', color: 'primary.main' }}>
          {epic.key}
        </Link>
      ) : (
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, fontFamily: 'monospace' }}>{epic.key}</Typography>
      )}
    </TableCell>
    <TableCell sx={compactCellSx}>
      <Typography sx={{ fontSize: '0.75rem' }} noWrap>{epic.summary}</Typography>
    </TableCell>
    <TableCell sx={compactCellSx}>
      <Chip label={epic.status} size="small" color={getStatusColor(epic.status)} variant="outlined" sx={{ fontSize: '0.7rem', height: 20 }} />
    </TableCell>
    <TableCell align="right" sx={compactCellSx}>
      <Typography sx={{ fontSize: '0.75rem' }}>{epic.childStoryPoints}</Typography>
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
      <Checkbox checked={isPlannedStretch} onChange={(e) => onPlannedStretchChange(epic.key, e.target.checked)} disabled={!isChecked} size="small" sx={{ p: 0.25 }} />
    </TableCell>
    <TableCell align="center" sx={compactCellSx}>
      <Checkbox checked={isStretch} onChange={(e) => onStretchChange(epic.key, e.target.checked)} disabled={!isChecked} size="small" sx={{ p: 0.25 }} />
    </TableCell>
  </TableRow>
);

const PiPlanning = () => (
  <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><CircularProgress /></Box>}>
    <PiPlanningContent />
  </Suspense>
);

export default PiPlanning;
