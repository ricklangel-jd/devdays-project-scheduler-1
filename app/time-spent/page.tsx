'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
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

const TimeSpentContent = () => {
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
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useAppState();

  const { data, isLoading, error, generate, clear } = useTimeSpentData();

  // Selected initiative and epic for drill-down
  const [selectedInitiative, setSelectedInitiative] = useState<string | null>(null);
  const [selectedEpic, setSelectedEpic] = useState<string | null>(null);

  // Parse board ID from URL
  const boardParam = searchParams.get(QUERY_PARAM_KEYS.BOARD);
  const boardId = boardParam ? parseInt(boardParam, 10) || undefined : undefined;

  // Parse PI labels from URL (Time Spent has its own dedicated params)
  const piLabelsParam = searchParams.get(QUERY_PARAM_KEYS.TS_PI_LABELS);
  const piLabels = piLabelsParam ? piLabelsParam.split(',').filter(Boolean) : [];

  // Parse PI sprints from URL
  const piSprintsParam = searchParams.get(QUERY_PARAM_KEYS.TS_PI_SPRINTS);
  const piSprints = parsePiSprints(piSprintsParam);
  const piSprintsKey = piSprintsParam ?? '';

  // Has at least one sprint assigned
  const hasSprintsAssigned = piSprints.some((ps) => ps.sprintIds.length > 0);

  // URL update helper
  const updateUrl = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const newUrl = params.toString() ? `?${params.toString()}` : '/time-spent';
    router.push(newUrl, { scroll: false });
  }, [router]);

  // Handler: PI labels changed
  const handlePILabelsChange = useCallback((labels: string[]) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());

    if (labels.length > 0) {
      params.set(QUERY_PARAM_KEYS.TS_PI_LABELS, labels.join(','));
    } else {
      params.delete(QUERY_PARAM_KEYS.TS_PI_LABELS);
    }

    // Remove piSprints entries for PIs no longer selected
    const currentPiSprints = parsePiSprints(params.get(QUERY_PARAM_KEYS.TS_PI_SPRINTS));
    const filteredPiSprints = currentPiSprints.filter((ps) =>
      labels.includes(ps.piLabel)
    );
    if (filteredPiSprints.length > 0) {
      params.set(QUERY_PARAM_KEYS.TS_PI_SPRINTS, serializePiSprints(filteredPiSprints));
    } else {
      params.delete(QUERY_PARAM_KEYS.TS_PI_SPRINTS);
    }

    const newUrl = params.toString() ? `?${params.toString()}` : '/time-spent';
    router.push(newUrl, { scroll: false });
  }, [router]);

  // Handler: PI sprints changed
  const handlePiSprintsChange = useCallback((assignments: PiSprintAssignment[]) => {
    const serialized = serializePiSprints(assignments);
    updateUrl(QUERY_PARAM_KEYS.TS_PI_SPRINTS, serialized || null);
  }, [updateUrl]);

  // Handler: initiative selection (clear epic when initiative changes)
  const handleInitiativeSelect = useCallback((key: string) => {
    setSelectedInitiative((prev) => {
      const next = prev === key ? null : key;
      setSelectedEpic(null);
      return next;
    });
  }, []);

  // Handler: epic selection
  const handleEpicSelect = useCallback((key: string) => {
    setSelectedEpic((prev) => (prev === key ? null : key));
  }, []);

  // Clear selections when data refreshes
  useEffect(() => {
    if (data) {
      setSelectedInitiative(null);
      setSelectedEpic(null);
    }
  }, [data]);

  // Track previous values for change detection
  const prevValuesRef = useRef<{
    projectKey: string | undefined;
    piSprintsKey: string;
    boardId: number | undefined;
  } | null>(null);

  // Connection check
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
      if (data && (!projectKey || !hasSprintsAssigned)) {
        clear();
      }
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

  // Handle refresh
  const handleRefresh = useCallback(() => {
    if (!projectKey || !hasSprintsAssigned || isLoading) return;
    clear();
    generate(projectKey, piSprints, boardId);
  }, [projectKey, piSprints, boardId, hasSprintsAssigned, isLoading, clear, generate]);

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
          <TimeSpentSidebarContent
            projectKey={projectKey}
            piLabels={piLabels}
            boardId={boardId}
            piSprints={piSprints}
            isLoading={isLoading}
            onPILabelsChange={handlePILabelsChange}
            onPiSprintsChange={handlePiSprintsChange}
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
              <TimeSpentCharts
                data={data}
                selectedInitiative={selectedInitiative}
                selectedEpic={selectedEpic}
                onInitiativeSelect={handleInitiativeSelect}
                onEpicSelect={handleEpicSelect}
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
                    Loading Time Spent Data...
                  </Typography>
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

      {/* Refresh FAB */}
      <Tooltip title="Refresh data from JIRA">
        <span>
          <Fab
            color="primary"
            aria-label="refresh"
            onClick={handleRefresh}
            disabled={isLoading || !projectKey || !hasSprintsAssigned}
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
