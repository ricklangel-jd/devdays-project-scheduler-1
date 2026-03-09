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
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { PiSprintAssignment } from '@/shared/types';

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

/**
 * Parse piSprints URL param: "PI1_2025:101.102.103,PI2_2025:104.105.106"
 */
const parsePiSprints = (value: string | null): PiSprintAssignment[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => {
      const colonIdx = entry.indexOf(':');
      if (colonIdx < 0) return { piLabel: entry, sprintIds: [] };
      const piLabel = entry.slice(0, colonIdx);
      const ids = entry
        .slice(colonIdx + 1)
        .split('.')
        .map(Number)
        .filter((n) => !isNaN(n));
      return { piLabel, sprintIds: ids };
    })
    .filter((a) => a.piLabel && a.sprintIds.length > 0);
};

/**
 * Serialize piSprints to URL param format
 */
const serializePiSprints = (assignments: PiSprintAssignment[]): string =>
  assignments
    .filter((a) => a.sprintIds.length > 0)
    .map((a) => `${a.piLabel}:${a.sprintIds.join('.')}`)
    .join(',');

/**
 * Parse piDaysOff URL param: "PI1_2025:5,PI2_2025:10"
 */
const parsePiDaysOff = (value: string | null): Record<string, number> => {
  if (!value) return {};
  const result: Record<string, number> = {};
  for (const entry of value.split(',')) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx < 0) continue;
    const piLabel = entry.slice(0, colonIdx);
    const days = parseInt(entry.slice(colonIdx + 1), 10);
    if (piLabel && !isNaN(days) && days > 0) {
      result[piLabel] = days;
    }
  }
  return result;
};

/**
 * Serialize piDaysOff to URL param format
 */
const serializePiDaysOff = (daysOff: Record<string, number>): string | null => {
  const entries = Object.entries(daysOff).filter(([, days]) => days > 0);
  if (entries.length === 0) return null;
  return entries.map(([piLabel, days]) => `${piLabel}:${days}`).join(',');
};

const AllWorkContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  useEffect(() => {
    document.title = 'All Work';
  }, []);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
  });

  const {
    projectKey,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useAppState();

  const { data, isLoading, error, generate, clear } = useAllWorkData();

  // Epic selection state (lifted from chart for stories grid)
  const [epicSelection, setEpicSelection] = useState<EpicSelection | null>(null);

  // Parse PI labels from URL
  const piLabelsParam = searchParams.get(QUERY_PARAM_KEYS.PI_LABELS);
  const piLabels = useMemo(
    () => piLabelsParam?.split(',').filter(Boolean) ?? [],
    [piLabelsParam]
  );

  // Parse developer count from URL
  const devsParam = searchParams.get(QUERY_PARAM_KEYS.DEVS);
  const developerCount = devsParam ? parseInt(devsParam, 10) || 5 : 5;

  // Parse support percent from URL (default 10)
  const supportPctParam = searchParams.get(QUERY_PARAM_KEYS.SUPPORT_PCT);
  const supportPercent = supportPctParam ? parseInt(supportPctParam, 10) || 10 : 10;

  // Parse board ID from URL
  const boardParam = searchParams.get(QUERY_PARAM_KEYS.BOARD);
  const boardId = boardParam ? parseInt(boardParam, 10) || undefined : undefined;

  // Parse piSprints from URL
  const piSprintsParam = searchParams.get(QUERY_PARAM_KEYS.PI_SPRINTS);
  const piSprints = useMemo(
    () => parsePiSprints(piSprintsParam),
    [piSprintsParam]
  );

  // Serialized piSprints key for change detection
  const piSprintsKey = useMemo(
    () => serializePiSprints(piSprints),
    [piSprints]
  );

  // Parse piDaysOff from URL
  const piDaysOffParam = searchParams.get(QUERY_PARAM_KEYS.PI_DAYS_OFF);
  const piDaysOff = useMemo(
    () => parsePiDaysOff(piDaysOffParam),
    [piDaysOffParam]
  );

  // Check if sprints are assigned (required for All Work)
  const hasSprintsAssigned = piSprints.some((ps) => ps.sprintIds.length > 0);

  // Derive sprint IDs for stories grid filtering
  // Bar clicks filter by the PI's sprints; legend clicks show all stories
  const storiesSprintIds = useMemo(() => {
    if (!epicSelection) return undefined;
    if (epicSelection.source === 'bar' && epicSelection.piLabel) {
      const piAssignment = piSprints.find((ps) => ps.piLabel === epicSelection.piLabel);
      return piAssignment?.sprintIds;
    }
    // For legend clicks, return all sprint IDs across all PIs
    return piSprints.flatMap((ps) => ps.sprintIds);
  }, [epicSelection, piSprints]);

  // Fetch stories for selected epic
  // Use All Work stories API, pass projectKey for __NO_EPIC__ queries
  const storiesOptions = useMemo(
    () => ({ apiUrl: '/api/all-work/stories', projectKey }),
    [projectKey]
  );
  const { stories, epicStatus, isLoading: storiesLoading } = useEpicStoriesData(
    epicSelection?.epicKey ?? null,
    storiesSprintIds,
    storiesOptions
  );

  // URL update helper
  const updateUrl = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const newUrl = params.toString() ? `?${params.toString()}` : '/all-work';
    router.push(newUrl, { scroll: false });
  }, [router]);

  // Handler: PI labels changed → remove piSprints/piDaysOff entries for removed PIs
  const handlePILabelsChange = useCallback((labels: string[]) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());

    if (labels.length > 0) {
      params.set(QUERY_PARAM_KEYS.PI_LABELS, labels.join(','));
    } else {
      params.delete(QUERY_PARAM_KEYS.PI_LABELS);
    }

    // Clean up piSprints: remove entries for PIs that are no longer selected
    const currentPiSprints = parsePiSprints(params.get(QUERY_PARAM_KEYS.PI_SPRINTS));
    const filteredPiSprints = currentPiSprints.filter((ps) =>
      labels.includes(ps.piLabel)
    );
    if (filteredPiSprints.length > 0) {
      params.set(QUERY_PARAM_KEYS.PI_SPRINTS, serializePiSprints(filteredPiSprints));
    } else {
      params.delete(QUERY_PARAM_KEYS.PI_SPRINTS);
    }

    // Clean up piDaysOff: remove entries for PIs that are no longer selected
    const currentDaysOff = parsePiDaysOff(params.get(QUERY_PARAM_KEYS.PI_DAYS_OFF));
    const filteredDaysOff: Record<string, number> = {};
    for (const [piLabel, days] of Object.entries(currentDaysOff)) {
      if (labels.includes(piLabel)) {
        filteredDaysOff[piLabel] = days;
      }
    }
    const serializedDaysOff = serializePiDaysOff(filteredDaysOff);
    if (serializedDaysOff) {
      params.set(QUERY_PARAM_KEYS.PI_DAYS_OFF, serializedDaysOff);
    } else {
      params.delete(QUERY_PARAM_KEYS.PI_DAYS_OFF);
    }

    const newUrl = params.toString() ? `?${params.toString()}` : '/all-work';
    router.push(newUrl, { scroll: false });
  }, [router]);

  // Handler: piSprints changed
  const handlePiSprintsChange = useCallback((assignments: PiSprintAssignment[]) => {
    const value = assignments.some((a) => a.sprintIds.length > 0)
      ? serializePiSprints(assignments)
      : null;
    updateUrl(QUERY_PARAM_KEYS.PI_SPRINTS, value);
  }, [updateUrl]);

  const handleDeveloperCountChange = useCallback((count: number) => {
    updateUrl(QUERY_PARAM_KEYS.DEVS, count.toString());
  }, [updateUrl]);

  const handleSupportPercentChange = useCallback((pct: number) => {
    updateUrl(QUERY_PARAM_KEYS.SUPPORT_PCT, pct.toString());
  }, [updateUrl]);

  // Handler: piDaysOff changed
  const handlePiDaysOffChange = useCallback((daysOff: Record<string, number>) => {
    updateUrl(QUERY_PARAM_KEYS.PI_DAYS_OFF, serializePiDaysOff(daysOff));
  }, [updateUrl]);

  // Track previous values to detect changes
  const prevValuesRef = useRef<{
    projectKey: string;
    piLabels: string;
    piSprintsKey: string;
    boardId: number | undefined;
  } | null>(null);

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

  // Auto-generate when prerequisites are met
  // All Work requires: projectKey, piLabels, AND piSprints with at least one assignment
  useEffect(() => {
    if (!projectKey || piLabels.length === 0 || !hasSprintsAssigned) {
      if (data && (!projectKey || piLabels.length === 0 || !hasSprintsAssigned)) {
        clear();
      }
      return;
    }

    const currentValues = {
      projectKey,
      piLabels: piLabels.join(','),
      piSprintsKey,
      boardId,
    };

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

  // Handle refresh (force refetch)
  const handleRefresh = useCallback(() => {
    if (!projectKey || piLabels.length === 0 || !hasSprintsAssigned || isLoading) return;
    clear();
    generate(projectKey, piLabels, piSprints, boardId);
  }, [projectKey, piLabels, piSprints, boardId, isLoading, clear, generate, hasSprintsAssigned]);

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
          <CapacityDemandSidebarContent
            projectKey={projectKey}
            piLabels={piLabels}
            boardId={boardId}
            piSprints={piSprints}
            developerCount={developerCount}
            supportPercent={supportPercent}
            piDaysOff={piDaysOff}
            isGenerating={isLoading}
            onPILabelsChange={handlePILabelsChange}
            onPiSprintsChange={handlePiSprintsChange}
            onDeveloperCountChange={handleDeveloperCountChange}
            onSupportPercentChange={handleSupportPercentChange}
            onPiDaysOffChange={handlePiDaysOffChange}
            sprintsRequired
          />
        </Sidebar>
        <MainContent>
          {error && (
            <Alert severity="error" sx={{ m: 2 }}>
              {error}
            </Alert>
          )}
          {data ? (
            <Box sx={{ overflow: 'auto', height: '100%', p: 1 }}>
              <CapacityDemandChart
                data={data}
                developerCount={developerCount}
                supportPercent={supportPercent}
                piDaysOff={piDaysOff}
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
                    Loading All Work Data...
                  </Typography>
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

      {/* Refresh FAB */}
      <Tooltip title="Refresh data from JIRA">
        <span>
          <Fab
            color="primary"
            aria-label="refresh"
            onClick={handleRefresh}
            disabled={isLoading || !projectKey || piLabels.length === 0 || !hasSprintsAssigned}
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
