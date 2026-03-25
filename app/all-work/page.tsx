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
import { CapacityDemandSidebarContent } from '@/frontend/components/sidebar';
import { CapacityDemandChart, EpicStoriesGrid } from '@/frontend/components/chart';
import type { EpicSelection } from '@/frontend/components/chart';
import { useAppState, useEpicStoriesData } from '@/frontend/hooks';
import { useAllWorkData } from '@/frontend/hooks/useAllWorkData';
import type { SprintCapacityInfo } from '@/frontend/hooks/useCapacityDemandData';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { JiraSprint, PiSprintAssignment } from '@/shared/types';
import { deserializeCapacity, computeTotalCapacity } from '@/shared/lib/capacity';
import { serializePiSprints } from '@/shared/lib/piSprints';

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

const AllWorkContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ connected: false });

  const { projectKey, sidebarCollapsed, setSidebarCollapsed } = useAppState();

  const { data, isLoading, error, generate, clear } = useAllWorkData();

  const [epicSelection, setEpicSelection] = useState<EpicSelection | null>(null);

  const piLabelsParam = searchParams.get(QUERY_PARAM_KEYS.PI_LABELS);
  const piLabels = useMemo(
    () => piLabelsParam?.split(',').filter(Boolean) ?? [],
    [piLabelsParam]
  );

  const boardParam = searchParams.get(QUERY_PARAM_KEYS.BOARD);
  const boardId = boardParam ? parseInt(boardParam, 10) || undefined : undefined;

  // ── All sprints — loaded from Jira for capacity lookup ────────────

  const [allSprints, setAllSprints] = useState<JiraSprint[]>([]);

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

  // ── Per-sprint capacities from Jira ──────────────────────────────

  const [piCapacities, setPiCapacities] = useState<Record<string, SprintCapacityInfo[]>>({});

  // ── PI sprint state — loaded from Jira, not URL ───────────────────

  const [piSprints, setPiSprints] = useState<PiSprintAssignment[]>([]);

  const loadedPisRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!projectKey) {
      setPiSprints([]);
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
            return { pi, sprintIds: ids };
          }
        } catch { /* fall through */ }
        return { pi, sprintIds: [] as number[] };
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
    });

    return () => { cancelled = true; };
  }, [projectKey, piLabels]);

  const piSprintsKey = useMemo(() => serializePiSprints(piSprints), [piSprints]);

  // Load per-sprint Jira capacity whenever piSprints or allSprints change
  useEffect(() => {
    if (!projectKey || allSprints.length === 0) return;

    const sprintMap = new Map<number, JiraSprint>();
    for (const s of allSprints) sprintMap.set(s.id, s);

    const sprintRequests: { pi: string; sprintId: number; sprintName: string }[] = [];
    for (const assignment of piSprints) {
      for (const sprintId of assignment.sprintIds) {
        const sprint = sprintMap.get(sprintId);
        if (sprint) sprintRequests.push({ pi: assignment.piLabel, sprintId, sprintName: sprint.name });
      }
    }

    if (sprintRequests.length === 0) {
      const result: Record<string, SprintCapacityInfo[]> = {};
      for (const assignment of piSprints) {
        if (assignment.sprintIds.length > 0) {
          result[assignment.piLabel] = assignment.sprintIds.map((id) => ({
            sprintId: id,
            sprintName: sprintMap.get(id)?.name ?? `Sprint ${id}`,
            totalCapacity: null,
          }));
        }
      }
      setPiCapacities(result);
      return;
    }

    let cancelled = false;

    Promise.all(
      sprintRequests.map(async ({ pi, sprintId, sprintName }) => {
        try {
          const params = new URLSearchParams({ projectKey, sprintId: sprintId.toString(), sprintName });
          const res = await fetch(`/api/capacity/storage?${params}`);
          const json = await res.json();
          let totalCapacity: number | null = null;
          if (json.data) {
            const payload = deserializeCapacity(json.data);
            if (payload) totalCapacity = computeTotalCapacity(payload.rows, payload.supportPct);
          }
          return { pi, sprintId, sprintName, totalCapacity };
        } catch {
          return { pi, sprintId, sprintName, totalCapacity: null as number | null };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const result: Record<string, SprintCapacityInfo[]> = {};
      for (const r of results) {
        if (!result[r.pi]) result[r.pi] = [];
        result[r.pi].push({ sprintId: r.sprintId, sprintName: r.sprintName, totalCapacity: r.totalCapacity });
      }
      for (const assignment of piSprints) {
        if (result[assignment.piLabel]) {
          result[assignment.piLabel].sort((a, b) =>
            assignment.sprintIds.indexOf(a.sprintId) - assignment.sprintIds.indexOf(b.sprintId)
          );
        }
      }
      setPiCapacities(result);
    });

    return () => { cancelled = true; };
  }, [projectKey, piSprints, piSprintsKey, allSprints]);

  const hasSprintsAssigned = piSprints.some((ps) => ps.sprintIds.length > 0);

  const storiesSprintIds = useMemo(() => {
    if (!epicSelection) return undefined;
    if (epicSelection.source === 'bar' && epicSelection.piLabel) {
      const piAssignment = piSprints.find((ps) => ps.piLabel === epicSelection.piLabel);
      return piAssignment?.sprintIds;
    }
    return piSprints.flatMap((ps) => ps.sprintIds);
  }, [epicSelection, piSprints]);

  const storiesOptions = useMemo(
    () => ({ apiUrl: '/api/all-work/stories', projectKey }),
    [projectKey]
  );
  const { stories, epicStatus, isLoading: storiesLoading } = useEpicStoriesData(
    epicSelection?.epicKey ?? null,
    storiesSprintIds,
    storiesOptions
  );

  const handlePILabelsChange = useCallback((labels: string[]) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());

    if (labels.length > 0) {
      params.set(QUERY_PARAM_KEYS.PI_LABELS, labels.join(','));
    } else {
      params.delete(QUERY_PARAM_KEYS.PI_LABELS);
    }

    params.delete(QUERY_PARAM_KEYS.PI_SPRINTS);

    const newUrl = params.toString() ? `?${params.toString()}` : '/all-work';
    router.push(newUrl, { scroll: false });
  }, [router]);


  const prevValuesRef = useRef<{
    projectKey: string;
    piLabels: string;
    piSprintsKey: string;
    boardId: number | undefined;
  } | null>(null);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch('/api/auth/validate');
        const d = await response.json();
        setConnectionStatus({ connected: d.valid, email: d.email });
      } catch {
        setConnectionStatus({ connected: false });
      }
    };
    checkConnection();
  }, []);

  // Auto-generate when prerequisites are met (All Work requires sprints assigned)
  useEffect(() => {
    if (!projectKey || piLabels.length === 0 || !hasSprintsAssigned) {
      if (data && (!projectKey || piLabels.length === 0 || !hasSprintsAssigned)) clear();
      return;
    }

    const currentValues = { projectKey, piLabels: piLabels.join(','), piSprintsKey, boardId };
    const prev = prevValuesRef.current;
    const hasChanged =
      !prev ||
      prev.projectKey !== currentValues.projectKey ||
      prev.piLabels !== currentValues.piLabels ||
      prev.piSprintsKey !== currentValues.piSprintsKey ||
      prev.boardId !== currentValues.boardId;

    if (hasChanged) {
      prevValuesRef.current = currentValues;
      setEpicSelection(null);
      generate(projectKey, piLabels, piSprints, boardId);
    }
  }, [projectKey, piLabels, piSprints, piSprintsKey, boardId, generate, clear, data, hasSprintsAssigned]);

  const handleRefresh = useCallback(() => {
    if (!projectKey || piLabels.length === 0 || !hasSprintsAssigned || isLoading) return;
    clear();
    generate(projectKey, piLabels, piSprints, boardId);
  }, [projectKey, piLabels, piSprints, boardId, isLoading, clear, generate, hasSprintsAssigned]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header connectionStatus={connectionStatus} />
      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed}>
          <CapacityDemandSidebarContent
            projectKey={projectKey}
            piLabels={piLabels}
            isGenerating={isLoading}
            showCapacityControls={false}
            onPILabelsChange={handlePILabelsChange}
          />
        </Sidebar>
        <MainContent>
          {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
          {data ? (
            <Box sx={{ overflow: 'auto', height: '100%', p: 1 }}>
              <CapacityDemandChart
                data={data}
                piCapacities={piCapacities}
                selectedEpicKey={epicSelection?.epicKey ?? null}
                onEpicSelect={setEpicSelection}
              />
              <EpicStoriesGrid
                stories={stories}
                isLoading={storiesLoading}
                epicKey={epicSelection?.epicKey ?? null}
                epicStatus={epicStatus}
              />
            </Box>
          ) : (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
              {isLoading ? (
                <>
                  <CircularProgress sx={{ mb: 2 }} />
                  <Typography variant="h6" gutterBottom>Loading All Work Data...</Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6" gutterBottom>
                    {!projectKey
                      ? 'Select a Project'
                      : piLabels.length === 0
                        ? 'Select Planning Increments'
                        : 'Assign Sprints to PIs'}
                  </Typography>
                  <Typography variant="body2">
                    {!projectKey
                      ? 'Choose a JIRA project to analyze'
                      : piLabels.length === 0
                        ? 'Choose one or more PI labels'
                        : 'Associate sprints with each PI to view all work'}
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
            disabled={isLoading || !projectKey || piLabels.length === 0 || !hasSprintsAssigned}
            sx={{ position: 'fixed', bottom: 24, right: 24 }}
          >
            {isLoading ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
          </Fab>
        </span>
      </Tooltip>
    </Box>
  );
};

const AllWork = () => {
  return (
    <Suspense
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      }
    >
      <AllWorkContent />
    </Suspense>
  );
};

export default AllWork;
