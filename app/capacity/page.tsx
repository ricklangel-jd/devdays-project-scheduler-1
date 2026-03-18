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
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Header, Sidebar, MainContent } from '@/frontend/components';
import SprintPlanningSidebarContent from '@/frontend/components/sidebar/SprintPlanningSidebarContent';
import { useAppState } from '@/frontend/hooks';
import { useCapacityData } from '@/frontend/hooks/useCapacityData';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import {
  serializeCapacity,
  deserializeCapacity,
  computeEngineerCapacity,
  computeTotalCapacity,
  DEFAULT_CAPACITY_PCT,
  type EngineerRow,
} from '@/shared/lib/capacity';

const DEFAULT_SUPPORT_PCT = 10;

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
  onDaysOutChange: (name: string, value: number) => void;
  onCapacityPctChange: (name: string, value: number) => void;
  onSupportPctChange: (value: number) => void;
}

const EngineerGrid = ({ sprintName, rows, supportPct, onToggleTechLead, onDaysOutChange, onCapacityPctChange, onSupportPctChange }: EngineerGridProps) => {
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

      <TableContainer component={Paper} elevation={1} sx={{ maxWidth: 680 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={headerSx}>Engineer</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'center' }}>Tech Lead</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Days Out</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>% Capacity</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Capacity</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const capacity = computeEngineerCapacity(row);
              return (
                <TableRow key={row.name} sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                  <TableCell sx={colSx}>{row.name}</TableCell>

                  <TableCell sx={{ ...colSx, textAlign: 'center', py: 0 }}>
                    <Checkbox
                      size="small"
                      checked={row.isTechLead}
                      onChange={() => onToggleTechLead(row.name)}
                    />
                  </TableCell>

                  <TableCell sx={{ ...colSx, textAlign: 'right', py: 0.25 }}>
                    <TextField
                      type="number"
                      size="small"
                      value={row.daysOut}
                      disabled={row.isTechLead}
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
                      disabled={row.isTechLead}
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
                </TableRow>
              );
            })}

            <TableRow sx={{ borderTop: 2, borderColor: 'grey.300' }}>
              <TableCell sx={{ ...colSx, fontWeight: 700 }} colSpan={4}>Total</TableCell>
              <TableCell sx={{ ...colSx, textAlign: 'right', fontWeight: 700 }}>{totalCapacity}</TableCell>
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
  const { projectKey, sidebarCollapsed, setSidebarCollapsed } = useAppState();
  const { data, isLoading, error, generate, clear } = useCapacityData();

  const boardParam = searchParams.get(QUERY_PARAM_KEYS.BOARD);
  const boardId = boardParam ? parseInt(boardParam, 10) || undefined : undefined;

  const sprintParam = searchParams.get(QUERY_PARAM_KEYS.CAP_SPRINT);
  const selectedSprintId = sprintParam ? parseInt(sprintParam, 10) || null : null;

  const [engineerRows, setEngineerRows] = useState<EngineerRow[]>([]);
  const [supportPct, setSupportPct] = useState(DEFAULT_SUPPORT_PCT);

  // JIRA save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Track sprint name for display and JIRA story title
  const [selectedSprintName, setSelectedSprintName] = useState<string>('');

  // Guard against re-initializing for same board+sprint
  const initKeyRef = useRef<string>('');

  // Load saved data from JIRA when engineers + sprint are known
  useEffect(() => {
    if (!data || !boardId || !selectedSprintId || !projectKey || !selectedSprintName) {
      setEngineerRows([]);
      return;
    }

    const initKey = `${boardId}:${selectedSprintId}`;
    if (initKey === initKeyRef.current) return;
    initKeyRef.current = initKey;

    const freshRows: EngineerRow[] = data.engineers.map(({ name }) => ({
      name,
      isTechLead: false,
      daysOut: 0,
      capacityPct: DEFAULT_CAPACITY_PCT,
    }));

    // Load from JIRA storage
    const loadFromJira = async () => {
      try {
        const params = new URLSearchParams({
          projectKey,
          sprintId: selectedSprintId.toString(),
          sprintName: selectedSprintName,
        });
        const res = await fetch(`/api/capacity/storage?${params}`);
        const json = await res.json();
        if (json.data) {
          const payload = deserializeCapacity(json.data);
          if (payload) {
            const savedMap = new Map(payload.rows.map((r) => [r.name, r]));
            const merged = freshRows.map((r) => savedMap.get(r.name) ?? r);
            setEngineerRows(merged);
            setSupportPct(payload.supportPct);
            return;
          }
        }
      } catch {
        // Fall through to defaults on error
      }
      setEngineerRows(freshRows);
      setSupportPct(DEFAULT_SUPPORT_PCT);
    };

    loadFromJira();
  }, [data, boardId, selectedSprintId, projectKey, selectedSprintName]);

  // Save to JIRA
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

  // Clear + reload when board changes
  const prevBoardRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (boardId === prevBoardRef.current) return;
    prevBoardRef.current = boardId;
    initKeyRef.current = '';
    clear();
    if (boardId) generate(boardId);
  }, [boardId, generate, clear]);

  const handleSprintChange = useCallback((sprintId: number, sprintName: string) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    params.set(QUERY_PARAM_KEYS.CAP_SPRINT, sprintId.toString());
    initKeyRef.current = '';
    setSelectedSprintName(sprintName);
    router.push(`?${params.toString()}`, { scroll: false });
  }, [router]);

  const handleRefresh = useCallback(() => {
    if (!boardId || isLoading) return;
    initKeyRef.current = '';
    clear();
    generate(boardId);
  }, [boardId, isLoading, clear, generate]);

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

  const handleDaysOutChange = useCallback((name: string, value: number) => {
    setEngineerRows((prev) => prev.map((r) => r.name === name ? { ...r, daysOut: value } : r));
  }, []);

  const handleCapacityPctChange = useCallback((name: string, value: number) => {
    setEngineerRows((prev) => prev.map((r) => r.name === name ? { ...r, capacityPct: value } : r));
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header connectionStatus={connectionStatus} />
      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed}>
          <SprintPlanningSidebarContent
            boardId={boardId}
            projectKey={projectKey}
            selectedSprintId={selectedSprintId}
            isLoading={isLoading}
            onSprintChange={handleSprintChange}
          />
        </Sidebar>

        <MainContent>
          {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
          {saveError && <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={() => setSaveError(null)}>{saveError}</Alert>}
          {saveSuccess && <Alert severity="success" sx={{ mx: 2, mt: 1 }}>Saved to JIRA</Alert>}

          {data && engineerRows.length > 0 ? (
            <Box sx={{ overflow: 'auto', height: '100%', p: 2 }}>
              <EngineerGrid
                sprintName={selectedSprintName}
                rows={engineerRows}
                supportPct={supportPct}
                onToggleTechLead={handleToggleTechLead}
                onDaysOutChange={handleDaysOutChange}
                onCapacityPctChange={handleCapacityPctChange}
                onSupportPctChange={setSupportPct}
              />
            </Box>
          ) : (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
              {isLoading ? (
                <>
                  <CircularProgress sx={{ mb: 2 }} />
                  <Typography variant="h6" gutterBottom>Loading Engineer Data...</Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6" gutterBottom>
                    {!projectKey ? 'Select a Project' : !boardId ? 'Select a Board' : data && engineerRows.length === 0 ? 'No engineers found in active sprint' : 'Waiting for board selection...'}
                  </Typography>
                  <Typography variant="body2">
                    {!projectKey ? 'Choose a JIRA project to get started' : !boardId ? 'Choose a board to load engineers' : ''}
                  </Typography>
                </>
              )}
            </Box>
          )}
        </MainContent>
      </Box>

      {/* Save to JIRA FAB */}
      <Tooltip title="Save to JIRA">
        <span>
          <Fab
            color="secondary"
            aria-label="save"
            onClick={handleSave}
            disabled={isSaving || engineerRows.length === 0 || !projectKey || !selectedSprintId}
            sx={{ position: 'fixed', bottom: 24, right: 88 }}
          >
            {isSaving ? <CircularProgress size={24} color="inherit" /> : <SaveIcon />}
          </Fab>
        </span>
      </Tooltip>

      <Tooltip title="Refresh engineers from JIRA">
        <span>
          <Fab
            color="primary"
            aria-label="refresh"
            onClick={handleRefresh}
            disabled={isLoading || !boardId}
            sx={{ position: 'fixed', bottom: 24, right: 24 }}
          >
            {isLoading ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
          </Fab>
        </span>
      </Tooltip>
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
