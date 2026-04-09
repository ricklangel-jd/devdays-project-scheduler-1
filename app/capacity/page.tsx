'use client';

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Fab from '@mui/material/Fab';
import Tooltip from '@mui/material/Tooltip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Checkbox from '@mui/material/Checkbox';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Autocomplete from '@mui/material/Autocomplete';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import { Header, MainContent } from '@/frontend/components';
import { useAppState } from '@/frontend/hooks';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { JiraSprint } from '@/shared/types';
import {
  serializeCapacity,
  deserializeCapacity,
  computeEngineerCapacity,
  computeTotalCapacity,
  DEFAULT_CAPACITY_PCT,
  type EngineerRow,
} from '@/shared/lib/capacity';

const DEFAULT_SUPPORT_PCT = 10;

// PI options: PI1_YYYY through PI4_YYYY for 2025–2027
const PI_OPTIONS = (() => {
  const options: string[] = [];
  for (let year = 2025; year <= 2027; year++) {
    for (let q = 1; q <= 4; q++) {
      options.push(`PI${q}_${year}`);
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

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

// ── Engineer grid ─────────────────────────────────────────────────────

interface EngineerGridProps {
  sprintName: string;
  rows: EngineerRow[];
  supportPct: number;
  onToggleTechLead: (name: string) => void;
  onToggleIgnore: (name: string) => void;
  onDaysOutChange: (name: string, value: number) => void;
  onCapacityPctChange: (name: string, value: number) => void;
  onNotesChange: (name: string, value: string) => void;
  onSupportPctChange: (value: number) => void;
}

const EngineerGrid = ({ sprintName, rows, supportPct, onToggleTechLead, onToggleIgnore, onDaysOutChange, onCapacityPctChange, onNotesChange, onSupportPctChange }: EngineerGridProps) => {
  const totalCapacity = useMemo(
    () => computeTotalCapacity(rows, supportPct),
    [rows, supportPct]
  );

  const colSx = { fontSize: '0.82rem', py: 0.75, px: 1.5 };
  const headerSx = { ...colSx, fontWeight: 700, bgcolor: 'grey.100', whiteSpace: 'nowrap' as const };

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1.5, fontWeight: 600 }}>
        Engineer Capacity
        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          {sprintName}
        </Typography>
      </Typography>

      <TableContainer component={Paper} elevation={1} sx={{ width: '100%' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={headerSx}>Engineer</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'center' }}>Tech Lead</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'center' }}>Ignore</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Days Out</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>% Capacity</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Capacity</TableCell>
              <TableCell sx={{ ...headerSx, width: '100%' }}>Notes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const capacity = computeEngineerCapacity(row);
              return (
                <TableRow key={row.name} sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' }, opacity: row.ignore ? 0.5 : 1 }}>
                  <TableCell sx={colSx}>{row.name}</TableCell>

                  <TableCell sx={{ ...colSx, textAlign: 'center', py: 0 }}>
                    <Checkbox
                      size="small"
                      checked={row.isTechLead}
                      onChange={() => onToggleTechLead(row.name)}
                    />
                  </TableCell>

                  <TableCell sx={{ ...colSx, textAlign: 'center', py: 0 }}>
                    <Checkbox
                      size="small"
                      checked={row.ignore ?? false}
                      onChange={() => onToggleIgnore(row.name)}
                    />
                  </TableCell>

                  <TableCell sx={{ ...colSx, textAlign: 'right', py: 0.25 }}>
                    <TextField
                      type="number"
                      size="small"
                      value={row.daysOut}
                      disabled={row.isTechLead || row.ignore}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val >= 0) {
                          onDaysOutChange(row.name, val);
                        }
                      }}
                      inputProps={{ min: 0, step: 0.5, style: { textAlign: 'right', width: 60 } }}
                      sx={{ width: 80 }}
                    />
                  </TableCell>

                  <TableCell sx={{ ...colSx, textAlign: 'right', py: 0.25 }}>
                    <TextField
                      type="number"
                      size="small"
                      value={row.capacityPct}
                      disabled={row.isTechLead || row.ignore}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val >= 0 && val <= 100) {
                          onCapacityPctChange(row.name, val);
                        }
                      }}
                      InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                      inputProps={{ min: 0, max: 100, step: 5, style: { textAlign: 'right', width: 52 } }}
                      sx={{ width: 100 }}
                    />
                  </TableCell>

                  <TableCell
                    sx={{
                      ...colSx,
                      textAlign: 'right',
                      fontWeight: 600,
                      color: capacity === 0 ? 'text.disabled' : 'text.primary',
                    }}
                  >
                    {capacity}
                  </TableCell>

                  <TableCell sx={{ ...colSx, py: 0.25, width: '100%' }}>
                    <TextField
                      size="small"
                      value={row.notes ?? ''}
                      onChange={(e) => onNotesChange(row.name, e.target.value)}
                      inputProps={{ style: { fontSize: '0.82rem' } }}
                      sx={{ width: '100%' }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}

            <TableRow sx={{ borderTop: 2, borderColor: 'grey.300' }}>
              <TableCell sx={{ ...colSx, fontWeight: 700 }} colSpan={4}>Total</TableCell>
              <TableCell sx={{ ...colSx, textAlign: 'right', fontWeight: 700 }}>{totalCapacity}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1.5 }}>
        <TextField
          label="Percent Support Time"
          type="number"
          size="small"
          value={supportPct}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 0 && val <= 15) onSupportPctChange(val);
          }}
          inputProps={{ min: 0, max: 15, step: 1, style: { width: 48, textAlign: 'right' } }}
          InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
          sx={{ width: 180 }}
        />
        <Typography variant="body2" color="primary.main">
          {totalCapacity} total pts capacity{supportPct > 0 ? ` (after ${supportPct}% support)` : ''}
        </Typography>
      </Box>
    </Box>
  );
};

// ── Page ──────────────────────────────────────────────────────────────

const CapacityContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ connected: false });
  const { projectKey } = useAppState();

  // Loading state for the engineer capacity section
  const [isSprintLoading, setIsSprintLoading] = useState(false);
  const [sprintLoadError, setSprintLoadError] = useState<string | null>(null);

  const boardParam = searchParams.get(QUERY_PARAM_KEYS.BOARD);
  const boardId = boardParam ? parseInt(boardParam, 10) || undefined : undefined;

  const sprintParam = searchParams.get(QUERY_PARAM_KEYS.CAP_SPRINT);
  const selectedSprintId = sprintParam ? parseInt(sprintParam, 10) || null : null;

  const piParam = searchParams.get(QUERY_PARAM_KEYS.CAP_PI);
  const selectedPi = piParam || null;

  const [engineerRows, setEngineerRows] = useState<EngineerRow[]>([]);
  const [supportPct, setSupportPct] = useState(DEFAULT_SUPPORT_PCT);

  // Engineer capacity save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Reload state
  const [isReloading, setIsReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloadInfo, setReloadInfo] = useState<string | null>(null);

  // Guard against re-initializing for same board+sprint
  const initKeyRef = useRef<string>('');

  // ── PI sprint selection state ─────────────────────────────────────

  const [allSprints, setAllSprints] = useState<JiraSprint[]>([]);

  // Derive sprint name directly — no separate state means no async sync issues
  const selectedSprintName = useMemo(
    () => allSprints.find((s) => s.id === selectedSprintId)?.name ?? '',
    [allSprints, selectedSprintId]
  );

  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [selectedSprintIds, setSelectedSprintIds] = useState<number[]>([]);
  const [isPiSaving, setIsPiSaving] = useState(false);
  const [piSaveError, setPiSaveError] = useState<string | null>(null);
  const [piSaveSuccess, setPiSaveSuccess] = useState(false);
  const piInitKeyRef = useRef<string>('');

  // Load sprints for board/project when they change
  useEffect(() => {
    if (!boardId) { setAllSprints([]); return; }
    let cancelled = false;
    const fetchSprints = async () => {
      setSprintsLoading(true);
      try {
        const params = new URLSearchParams({ boardId: boardId.toString() });
        if (projectKey) params.set('projectKey', projectKey);
        const res = await fetch(`/api/sprints?${params}`);
        const json = await res.json();
        if (!cancelled) {
          setAllSprints((json.sprints ?? []).filter((s: JiraSprint) => s.startDate && s.endDate));
        }
      } catch {
        if (!cancelled) setAllSprints([]);
      } finally {
        if (!cancelled) setSprintsLoading(false);
      }
    };
    fetchSprints();
    return () => { cancelled = true; };
  }, [boardId, projectKey]);

  // Load saved PI sprints from Jira when projectKey or selectedPi changes
  useEffect(() => {
    if (!projectKey || !selectedPi) { setSelectedSprintIds([]); return; }
    const key = `${projectKey}:${selectedPi}`;
    if (key === piInitKeyRef.current) return;
    piInitKeyRef.current = key;

    const load = async () => {
      try {
        const params = new URLSearchParams({ projectKey, pi: selectedPi });
        const res = await fetch(`/api/capacity/pi-sprints?${params}`);
        const json = await res.json();
        if (json.data) {
          const ids = (json.data as string).split(',').map(Number).filter(Boolean);
          setSelectedSprintIds(ids);
        } else {
          setSelectedSprintIds([]);
        }
      } catch {
        setSelectedSprintIds([]);
      }
    };
    load();
  }, [projectKey, selectedPi]);

  // Load the capacity for the selected sprint.
  // If saved data exists → use it exactly.
  // If not → fetch that sprint's assignees from Jira and show them with defaults.
  const loadSprintCapacity = useCallback(async (sprintId: number, sprintName: string, force = false) => {
    if (!boardId || !sprintId || !projectKey || !sprintName) {
      setEngineerRows([]);
      return;
    }

    // Dedup guard lives INSIDE the function so it cannot be bypassed by
    // external initKeyRef resets.  Set synchronously before the first
    // await to prevent any concurrent call from slipping through.
    const loadKey = `${boardId}:${sprintId}`;
    if (!force && loadKey === initKeyRef.current) return;
    initKeyRef.current = loadKey;

    setIsSprintLoading(true);
    setSprintLoadError(null);
    try {
      // 1. Try the saved capacity story for this sprint
      const storageParams = new URLSearchParams({
        projectKey,
        sprintId: sprintId.toString(),
        sprintName,
      });
      const storageRes = await fetch(`/api/capacity/storage?${storageParams}`);
      const storageJson = await storageRes.json();
      if (storageJson.data) {
        const payload = deserializeCapacity(storageJson.data as string);
        if (payload) {
          setEngineerRows(payload.rows);
          setSupportPct(payload.supportPct);
          return;
        }
      }

      // 2. No saved data — fetch assignees from both the selected sprint and the
      //    current active sprint, then merge into a distinct sorted list.
      const [selectedSprintRes, activeSprintRes] = await Promise.all([
        fetch('/api/capacity/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boardId, sprintId }),
        }),
        fetch('/api/capacity/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boardId }), // no sprintId → active sprint
        }),
      ]);

      const nameSet = new Set<string>();
      const extractNames = (json: { engineers?: { name: string }[] }) => {
        for (const { name } of json.engineers ?? []) nameSet.add(name);
      };
      if (selectedSprintRes.ok) extractNames(await selectedSprintRes.json());
      if (activeSprintRes.ok) extractNames(await activeSprintRes.json());

      const rows: EngineerRow[] = [...nameSet]
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
        .map((name) => ({ name, isTechLead: false, daysOut: 0, capacityPct: DEFAULT_CAPACITY_PCT }));
      setEngineerRows(rows);
      setSupportPct(DEFAULT_SUPPORT_PCT);
    } catch (err) {
      setSprintLoadError(err instanceof Error ? err.message : 'Failed to load capacity data');
      setEngineerRows([]);
    } finally {
      setIsSprintLoading(false);
    }
  }, [boardId, projectKey]);

  // Save engineer capacity to Jira
  const handleSave = useCallback(async () => {
    if (!projectKey || !selectedSprintId || engineerRows.length === 0) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/capacity/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey,
          sprintId: selectedSprintId,
          sprintName: selectedSprintName,
          data: serializeCapacity(engineerRows, supportPct),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [projectKey, selectedSprintId, selectedSprintName, engineerRows, supportPct]);

  // Reload: re-fetch from Jira for the selected sprint, same logic as initial load.
  // Uses force=true to bypass the dedup guard so the user can always refresh.
  const handleReload = useCallback(async () => {
    if (isReloading || isSprintLoading) return;
    if (!selectedSprintId || !selectedSprintName) return;
    setIsReloading(true);
    setReloadError(null);
    setReloadInfo(null);
    try {
      initKeyRef.current = '';
      await loadSprintCapacity(selectedSprintId, selectedSprintName, true);
      setReloadInfo('Reloaded from Jira');
      setTimeout(() => setReloadInfo(null), 3000);
    } catch (err) {
      setReloadError(err instanceof Error ? err.message : 'Reload failed');
    } finally {
      setIsReloading(false);
    }
  }, [isReloading, isSprintLoading, loadSprintCapacity, selectedSprintId, selectedSprintName]);

  // Save PI sprint selections to Jira
  const handleSavePiSprints = useCallback(async () => {
    if (!projectKey || !selectedPi) return;
    setIsPiSaving(true);
    setPiSaveError(null);
    setPiSaveSuccess(false);
    try {
      const res = await fetch('/api/capacity/pi-sprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey, pi: selectedPi, sprintIds: selectedSprintIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setPiSaveSuccess(true);
      setTimeout(() => setPiSaveSuccess(false), 3000);
    } catch (err) {
      setPiSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsPiSaving(false);
    }
  }, [projectKey, selectedPi, selectedSprintIds]);

  const handleSprintChange = useCallback((sprintId: number, sprintName: string) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    params.set(QUERY_PARAM_KEYS.CAP_SPRINT, sprintId.toString());
    initKeyRef.current = '';
    router.push(`?${params.toString()}`, { scroll: false });
    loadSprintCapacity(sprintId, sprintName);
  }, [router, loadSprintCapacity]);

  // Narrow full sprint list to active sprint ±10
  const visibleSprints = useMemo(() => {
    if (allSprints.length === 0) return [];
    const sorted = [...allSprints]
      .filter((s) => s.startDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const activeIdx = sorted.findIndex((s) => s.state === 'active');
    if (activeIdx < 0) return sorted.slice(Math.max(0, sorted.length - 20));
    const start = Math.max(0, activeIdx - 10);
    const end = Math.min(sorted.length, activeIdx + 11);
    return sorted.slice(start, end);
  }, [allSprints]);

  // Auto-select the active sprint when sprints first load (previously done by the sidebar)
  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    if (visibleSprints.length === 0) { hasAutoSelectedRef.current = false; return; }
    if (hasAutoSelectedRef.current) return;
    hasAutoSelectedRef.current = true;
    if (selectedSprintId !== null) {
      // Page loaded with sprint already in URL (e.g. browser refresh) — trigger load directly
      const sprint = allSprints.find((s) => s.id === selectedSprintId);
      if (sprint) loadSprintCapacity(sprint.id, sprint.name);
      return;
    }
    // No sprint selected yet — auto-select the active sprint
    const target = visibleSprints.find((s) => s.state === 'active') ?? visibleSprints[0];
    if (target) handleSprintChange(target.id, target.name);
  }, [visibleSprints, selectedSprintId, allSprints, loadSprintCapacity, handleSprintChange]);

  const handlePiChange = useCallback((_: unknown, value: string | null) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (value) params.set(QUERY_PARAM_KEYS.CAP_PI, value);
    else params.delete(QUERY_PARAM_KEYS.CAP_PI);
    piInitKeyRef.current = '';
    setSelectedSprintIds([]);
    router.push(`?${params.toString()}`, { scroll: false });
  }, [router]);

  const handleRefresh = useCallback(() => {
    if (isSprintLoading || !selectedSprintId || !selectedSprintName) return;
    initKeyRef.current = '';
    loadSprintCapacity(selectedSprintId, selectedSprintName, true);
  }, [isSprintLoading, loadSprintCapacity, selectedSprintId, selectedSprintName]);

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

  const handleToggleTechLead = useCallback((name: string) => {
    setEngineerRows((prev) =>
      prev.map((r) => r.name === name ? { ...r, isTechLead: !r.isTechLead, daysOut: 0 } : r)
    );
  }, []);

  const handleToggleIgnore = useCallback((name: string) => {
    setEngineerRows((prev) =>
      prev.map((r) => r.name === name ? { ...r, ignore: !r.ignore } : r)
    );
  }, []);

  const handleDaysOutChange = useCallback((name: string, value: number) => {
    setEngineerRows((prev) => prev.map((r) => r.name === name ? { ...r, daysOut: value } : r));
  }, []);

  const handleCapacityPctChange = useCallback((name: string, value: number) => {
    setEngineerRows((prev) => prev.map((r) => r.name === name ? { ...r, capacityPct: value } : r));
  }, []);

  const handleNotesChange = useCallback((name: string, value: string) => {
    setEngineerRows((prev) => prev.map((r) => r.name === name ? { ...r, notes: value } : r));
  }, []);

  const [activeTab, setActiveTab] = useState(0);

  const selectedSprintsForPi = useMemo(
    () => allSprints.filter((s) => selectedSprintIds.includes(s.id)),
    [allSprints, selectedSprintIds]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header connectionStatus={connectionStatus} />
      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <MainContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

            {/* ── Tab bar ── */}
            <Tabs
              value={activeTab}
              onChange={(_, v) => setActiveTab(v)}
              sx={{ borderBottom: 1, borderColor: 'divider', px: 2, flexShrink: 0 }}
            >
              <Tab label="Engineer Capacity" />
              <Tab label="PI Sprint Selection" />
            </Tabs>

            {/* ── Tab 0: Engineer Capacity ── */}
            {activeTab === 0 && (
              <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2 }}>

                {/* Sprint selector */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <TextField
                    select
                    size="small"
                    label="Sprint"
                    value={selectedSprintId ?? ''}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const sprint = visibleSprints.find((s) => s.id === id);
                      if (sprint) handleSprintChange(id, sprint.name);
                    }}
                    sx={{ minWidth: 300 }}
                    disabled={!boardId || sprintsLoading}
                  >
                    {visibleSprints.length === 0 ? (
                      <MenuItem value="" disabled>
                        {!boardId ? 'Select a board first' : sprintsLoading ? 'Loading sprints…' : 'No sprints found'}
                      </MenuItem>
                    ) : (
                      visibleSprints.map((s) => (
                        <MenuItem key={s.id} value={s.id}>
                          {s.name}{s.state === 'active' ? ' (current)' : ''}
                        </MenuItem>
                      ))
                    )}
                  </TextField>
                  {sprintsLoading && <CircularProgress size={18} />}
                </Box>

                {sprintLoadError && (
                  <Alert severity="error" sx={{ mb: 2 }}>{sprintLoadError}</Alert>
                )}

                {engineerRows.length > 0 ? (
                  <Box>
                    <EngineerGrid
                      sprintName={selectedSprintName}
                      rows={engineerRows}
                      supportPct={supportPct}
                      onToggleTechLead={handleToggleTechLead}
                      onToggleIgnore={handleToggleIgnore}
                      onDaysOutChange={handleDaysOutChange}
                      onCapacityPctChange={handleCapacityPctChange}
                      onNotesChange={handleNotesChange}
                      onSupportPctChange={setSupportPct}
                    />
                    <Box sx={{ mt: 2, display: 'flex', gap: 1.5, alignItems: 'center' }}>
                      <Button
                        variant="contained"
                        color="secondary"
                        startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                        onClick={handleSave}
                        disabled={isSaving || engineerRows.length === 0 || !projectKey || !selectedSprintId}
                      >
                        Save
                      </Button>
                      <Button
                        variant="outlined"
                        startIcon={isReloading ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                        onClick={handleReload}
                        disabled={isReloading || !boardId}
                      >
                        Reload from Jira
                      </Button>
                    </Box>
                    {saveError && (
                      <Alert severity="error" onClose={() => setSaveError(null)} sx={{ mt: 1, maxWidth: 680 }}>
                        {saveError}
                      </Alert>
                    )}
                    {saveSuccess && (
                      <Alert severity="success" sx={{ mt: 1, maxWidth: 680 }}>Saved to JIRA</Alert>
                    )}
                    {reloadError && (
                      <Alert severity="error" onClose={() => setReloadError(null)} sx={{ mt: 1, maxWidth: 680 }}>
                        {reloadError}
                      </Alert>
                    )}
                    {reloadInfo && (
                      <Alert severity="info" sx={{ mt: 1, maxWidth: 680 }}>{reloadInfo}</Alert>
                    )}
                  </Box>
                ) : (
                  <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
                    {isSprintLoading ? (
                      <>
                        <CircularProgress sx={{ mb: 2 }} />
                        <Typography variant="h6" gutterBottom>Loading Engineer Data...</Typography>
                      </>
                    ) : (
                      <>
                        <Typography variant="h6" gutterBottom>
                          {!projectKey ? 'Select a Project' : !boardId ? 'Select a Board' : !selectedSprintId ? 'Select a Sprint above' : 'No engineers found for this sprint'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {!projectKey ? 'Choose a JIRA project to get started' : !boardId ? 'Choose a board to continue' : ''}
                        </Typography>
                      </>
                    )}
                  </Box>
                )}
              </Box>
            )}

            {/* ── Tab 1: PI Sprint Selection ── */}
            {activeTab === 1 && (
              <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2 }}>
                <Typography variant="h6" sx={{ mb: 1.5, fontWeight: 600 }}>
                  PI Sprint Selection
                </Typography>

                <Autocomplete
                  options={PI_OPTIONS}
                  value={selectedPi}
                  onChange={handlePiChange}
                  renderInput={(params) => (
                    <TextField {...params} size="small" label="PI" placeholder="Select PI..." />
                  )}
                  sx={{ mb: 2, maxWidth: 340 }}
                  size="small"
                  disabled={!projectKey}
                />

                {!projectKey && (
                  <Typography variant="body2" color="text.secondary">
                    Select a project to get started.
                  </Typography>
                )}

                {selectedPi && (
                  <Box sx={{ maxWidth: 560 }}>
                    {sprintsLoading ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                        <CircularProgress size={18} />
                        <Typography variant="body2" color="text.secondary">Loading sprints...</Typography>
                      </Box>
                    ) : (
                      <Autocomplete
                        multiple
                        disableCloseOnSelect
                        size="small"
                        options={allSprints}
                        value={selectedSprintsForPi}
                        getOptionLabel={(option) => option.name}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        onChange={(_e, newValue) => setSelectedSprintIds(newValue.map((s) => s.id))}
                        slotProps={{ chip: { size: 'small' } }}
                        renderOption={(props, option, { selected }) => {
                          const { key, ...rest } = props;
                          return (
                            <li key={key} {...rest}>
                              <Checkbox
                                icon={<CheckBoxOutlineBlankIcon fontSize="small" />}
                                checkedIcon={<CheckBoxIcon fontSize="small" />}
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
                            placeholder={selectedSprintIds.length > 0 ? '' : 'Select sprints...'}
                          />
                        )}
                        sx={{ mb: 2, '& .MuiAutocomplete-inputRoot': { flexWrap: 'wrap' } }}
                      />
                    )}

                    <Button
                      variant="contained"
                      startIcon={isPiSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                      onClick={handleSavePiSprints}
                      disabled={isPiSaving || !projectKey || !selectedPi}
                    >
                      Save
                    </Button>
                    {piSaveError && (
                      <Alert severity="error" onClose={() => setPiSaveError(null)} sx={{ mt: 1 }}>
                        {piSaveError}
                      </Alert>
                    )}
                    {piSaveSuccess && (
                      <Alert severity="success" sx={{ mt: 1 }}>Saved to JIRA</Alert>
                    )}
                  </Box>
                )}
              </Box>
            )}

          </Box>
        </MainContent>
      </Box>

      {/* FAB only relevant on the Engineer Capacity tab */}
      {activeTab === 0 && (
        <Tooltip title="Refresh engineers from JIRA">
          <span>
            <Fab
              color="primary"
              aria-label="refresh"
              onClick={handleRefresh}
              disabled={isSprintLoading || !boardId || !selectedSprintId}
              sx={{ position: 'fixed', bottom: 24, right: 24 }}
            >
              {isSprintLoading ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
            </Fab>
          </span>
        </Tooltip>
      )}
    </Box>
  );
};

const Capacity = () => {
  return (
    <Suspense
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      }
    >
      <CapacityContent />
    </Suspense>
  );
};

export default Capacity;
