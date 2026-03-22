'use client';

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Fab from '@mui/material/Fab';
import Tooltip from '@mui/material/Tooltip';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Header, Sidebar, MainContent } from '@/frontend/components';
import { TimeSpentSidebarContent } from '@/frontend/components/sidebar';
import { TimeSpentCharts } from '@/frontend/components/chart';
import { useAppState } from '@/frontend/hooks';
import { useTimeSpentData } from '@/frontend/hooks/useTimeSpentData';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { PiSprintAssignment } from '@/shared/types';

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

const serializePiSprints = (assignments: PiSprintAssignment[]): string =>
  assignments
    .filter((a) => a.sprintIds.length > 0)
    .map((a) => `${a.piLabel}:${a.sprintIds.join('.')}`)
    .join(',');

const TimeSpentContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ connected: false });

  const { projectKey, sidebarCollapsed, setSidebarCollapsed } = useAppState();

  const { data, isLoading, error, generate, clear } = useTimeSpentData();

  const [selectedInitiative, setSelectedInitiative] = useState<string | null>(null);
  const [selectedEpic, setSelectedEpic] = useState<string | null>(null);

  const boardParam = searchParams.get(QUERY_PARAM_KEYS.BOARD);
  const boardId = boardParam ? parseInt(boardParam, 10) || undefined : undefined;

  // PI labels use Time Spent's dedicated URL param
  const piLabelsParam = searchParams.get(QUERY_PARAM_KEYS.TS_PI_LABELS);
  const piLabels = useMemo(
    () => piLabelsParam?.split(',').filter(Boolean) ?? [],
    [piLabelsParam]
  );

  // ── PI sprint state — loaded from Jira, not URL ───────────────────

  const [piSprints, setPiSprints] = useState<PiSprintAssignment[]>([]);
  // undefined = not yet loaded, true = story exists in Jira, false = story doesn't exist
  const [piSprintsExistInJira, setPiSprintsExistInJira] = useState<Record<string, boolean | undefined>>({});
  const [isSavingPiSprints, setIsSavingPiSprints] = useState<Record<string, boolean>>({});

  const loadedPisRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!projectKey) {
      setPiSprints([]);
      setPiSprintsExistInJira({});
      loadedPisRef.current = new Set();
      return;
    }

    // Clean up state for PIs removed from the selection
    const removedPis = [...loadedPisRef.current]
      .filter((k) => k.startsWith(`${projectKey}:`))
      .map((k) => k.slice(projectKey.length + 1))
      .filter((pi) => !piLabels.includes(pi));

    if (removedPis.length > 0) {
      for (const pi of removedPis) loadedPisRef.current.delete(`${projectKey}:${pi}`);
      setPiSprints((prev) => prev.filter((a) => piLabels.includes(a.piLabel)));
      setPiSprintsExistInJira((prev) => {
        const next = { ...prev };
        for (const pi of removedPis) delete next[pi];
        return next;
      });
    }

    // Load only newly added PIs
    const newPis = piLabels.filter((pi) => !loadedPisRef.current.has(`${projectKey}:${pi}`));
    if (newPis.length === 0) return;

    let cancelled = false;

    Promise.all(
      newPis.map(async (pi) => {
        try {
          const params = new URLSearchParams({ projectKey, pi });
          const res = await fetch(`/api/capacity/pi-sprints?${params}`);
          const json = await res.json();
          if (json.data) {
            const ids = (json.data as string).split(',').map(Number).filter(Boolean);
            return { pi, sprintIds: ids, exists: true };
          }
        } catch { /* fall through */ }
        return { pi, sprintIds: [] as number[], exists: false };
      })
    ).then((results) => {
      if (cancelled) return;
      for (const r of results) loadedPisRef.current.add(`${projectKey}:${r.pi}`);

      setPiSprints((prev) => {
        const next = [...prev];
        for (const r of results) {
          if (r.sprintIds.length === 0) continue;
          const idx = next.findIndex((a) => a.piLabel === r.pi);
          if (idx >= 0) next[idx] = { piLabel: r.pi, sprintIds: r.sprintIds };
          else next.push({ piLabel: r.pi, sprintIds: r.sprintIds });
        }
        return next;
      });

      setPiSprintsExistInJira((prev) => {
        const next = { ...prev };
        for (const r of results) next[r.pi] = r.exists;
        return next;
      });
    });

    return () => { cancelled = true; };
  }, [projectKey, piLabels]);

  const handleSavePiSprints = useCallback(async (piLabel: string) => {
    if (!projectKey) return;
    setIsSavingPiSprints((prev) => ({ ...prev, [piLabel]: true }));
    try {
      const assignment = piSprints.find((a) => a.piLabel === piLabel);
      const sprintIds = assignment?.sprintIds ?? [];
      const res = await fetch('/api/capacity/pi-sprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey, pi: piLabel, sprintIds }),
      });
      if (res.ok) {
        setPiSprintsExistInJira((prev) => ({ ...prev, [piLabel]: true }));
      }
    } catch { /* ignore */ }
    finally {
      setIsSavingPiSprints((prev) => ({ ...prev, [piLabel]: false }));
    }
  }, [projectKey, piSprints]);

  const piSprintsKey = useMemo(() => serializePiSprints(piSprints), [piSprints]);

  const hasSprintsAssigned = piSprints.some((ps) => ps.sprintIds.length > 0);

  const handlePILabelsChange = useCallback((labels: string[]) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());

    if (labels.length > 0) {
      params.set(QUERY_PARAM_KEYS.TS_PI_LABELS, labels.join(','));
    } else {
      params.delete(QUERY_PARAM_KEYS.TS_PI_LABELS);
    }

    // Remove old URL-based piSprints if present (no longer used)
    params.delete(QUERY_PARAM_KEYS.TS_PI_SPRINTS);

    const newUrl = params.toString() ? `?${params.toString()}` : '/time-spent';
    router.push(newUrl, { scroll: false });
  }, [router]);

  const handlePiSprintsChange = useCallback((assignments: PiSprintAssignment[]) => {
    setPiSprints(assignments);
  }, []);

  const handleInitiativeSelect = useCallback((key: string) => {
    setSelectedInitiative((prev) => {
      const next = prev === key ? null : key;
      setSelectedEpic(null);
      return next;
    });
  }, []);

  const handleEpicSelect = useCallback((key: string) => {
    setSelectedEpic((prev) => (prev === key ? null : key));
  }, []);

  useEffect(() => {
    if (data) {
      setSelectedInitiative(null);
      setSelectedEpic(null);
    }
  }, [data]);

  const prevValuesRef = useRef<{
    projectKey: string | undefined;
    piSprintsKey: string;
    boardId: number | undefined;
  } | null>(null);

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

  // Auto-generate when inputs change
  useEffect(() => {
    if (!projectKey || !hasSprintsAssigned) {
      if (data && (!projectKey || !hasSprintsAssigned)) clear();
      return;
    }

    const currentValues = { projectKey, piSprintsKey, boardId };
    const prev = prevValuesRef.current;
    const hasChanged =
      !prev ||
      prev.projectKey !== currentValues.projectKey ||
      prev.piSprintsKey !== currentValues.piSprintsKey ||
      prev.boardId !== currentValues.boardId;

    if (hasChanged) {
      prevValuesRef.current = currentValues;
      setSelectedInitiative(null);
      setSelectedEpic(null);
      generate(projectKey, piSprints, boardId);
    }
  }, [projectKey, piSprints, piSprintsKey, boardId, hasSprintsAssigned, generate, clear, data]);

  const handleRefresh = useCallback(() => {
    if (!projectKey || !hasSprintsAssigned || isLoading) return;
    clear();
    generate(projectKey, piSprints, boardId);
  }, [projectKey, piSprints, boardId, hasSprintsAssigned, isLoading, clear, generate]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header connectionStatus={connectionStatus} />
      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed}>
          <TimeSpentSidebarContent
            projectKey={projectKey}
            piLabels={piLabels}
            boardId={boardId}
            piSprints={piSprints}
            isLoading={isLoading}
            piSprintsExistInJira={piSprintsExistInJira}
            onSavePiSprints={handleSavePiSprints}
            isSavingPiSprints={isSavingPiSprints}
            onPILabelsChange={handlePILabelsChange}
            onPiSprintsChange={handlePiSprintsChange}
          />
        </Sidebar>
        <MainContent>
          {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
          {data ? (
            <Box sx={{ overflow: 'auto', height: '100%', p: 1 }}>
              <TimeSpentCharts
                data={data}
                selectedInitiative={selectedInitiative}
                selectedEpic={selectedEpic}
                onInitiativeSelect={handleInitiativeSelect}
                onEpicSelect={handleEpicSelect}
              />
            </Box>
          ) : (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
              {isLoading ? (
                <>
                  <CircularProgress sx={{ mb: 2 }} />
                  <Typography variant="h6" gutterBottom>Loading Time Spent Data...</Typography>
                  <Typography variant="body2">
                    This may take a moment while fetching epic and story details
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6" gutterBottom>
                    {!projectKey
                      ? 'Select a Project'
                      : piLabels.length === 0
                        ? 'Select Planning Increments'
                        : !hasSprintsAssigned
                          ? 'Assign Sprints to PIs'
                          : 'Waiting for data...'}
                  </Typography>
                  <Typography variant="body2">
                    {!projectKey
                      ? 'Choose a JIRA project to analyze'
                      : piLabels.length === 0
                        ? 'Select one or more PIs in the sidebar'
                        : !hasSprintsAssigned
                          ? 'Associate sprints with each PI to see time spent data'
                          : 'Data will load automatically when sprints are assigned'}
                  </Typography>
                </>
              )}
            </Box>
          )}
        </MainContent>
      </Box>

      <Tooltip title="Refresh data from JIRA">
        <span>
          <Fab
            color="primary"
            aria-label="refresh"
            onClick={handleRefresh}
            disabled={isLoading || !projectKey || !hasSprintsAssigned}
            sx={{ position: 'fixed', bottom: 24, right: 24 }}
          >
            {isLoading ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
          </Fab>
        </span>
      </Tooltip>
    </Box>
  );
};

const TimeSpent = () => {
  return (
    <Suspense
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      }
    >
      <TimeSpentContent />
    </Suspense>
  );
};

export default TimeSpent;
