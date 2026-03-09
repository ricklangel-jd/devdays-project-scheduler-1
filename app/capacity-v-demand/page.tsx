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
import { CapacityDemandChart } from '@/frontend/components/chart';
import { useAppState } from '@/frontend/hooks';
import { useCapacityDemandData } from '@/frontend/hooks/useCapacityDemandData';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { JiraProject, PiSprintAssignment } from '@/shared/types';

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

const CapacityDemandContent = () => {
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

  const { data, isLoading, error, generate, clear } = useCapacityDemandData();

  // Parse PI labels from URL
  const piLabelsParam = searchParams.get(QUERY_PARAM_KEYS.PI_LABELS);
  const piLabels = useMemo(
    () => piLabelsParam?.split(',').filter(Boolean) ?? [],
    [piLabelsParam]
  );

  // Parse developer count from URL
  const devsParam = searchParams.get(QUERY_PARAM_KEYS.DEVS);
  const developerCount = devsParam ? parseInt(devsParam, 10) || 5 : 5;

  // Parse board ID from URL
  const boardCdParam = searchParams.get(QUERY_PARAM_KEYS.BOARD_CD);
  const boardId = boardCdParam ? parseInt(boardCdParam, 10) || undefined : undefined;

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

  // URL update helper
  const updateUrl = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const newUrl = params.toString() ? `?${params.toString()}` : '/capacity-v-demand';
    router.push(newUrl, { scroll: false });
  }, [router]);

  // Multi-param URL update helper (for clearing cascade)
  const updateUrlMulti = useCallback((updates: { key: string; value: string | null }[]) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    for (const { key, value } of updates) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    const newUrl = params.toString() ? `?${params.toString()}` : '/capacity-v-demand';
    router.push(newUrl, { scroll: false });
  }, [router]);

  // Handler: project selected → clear PI labels, board, piSprints, piDaysOff
  const handleProjectSelect = useCallback((project: JiraProject) => {
    updateUrlMulti([
      { key: QUERY_PARAM_KEYS.PROJECT, value: project.key },
      { key: QUERY_PARAM_KEYS.PI_LABELS, value: null },
      { key: QUERY_PARAM_KEYS.BOARD_CD, value: null },
      { key: QUERY_PARAM_KEYS.PI_SPRINTS, value: null },
      { key: QUERY_PARAM_KEYS.PI_DAYS_OFF, value: null },
    ]);
    clear();
  }, [updateUrlMulti, clear]);

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

    const newUrl = params.toString() ? `?${params.toString()}` : '/capacity-v-demand';
    router.push(newUrl, { scroll: false });
  }, [router]);

  // Handler: board selected → clear piSprints
  const handleBoardSelect = useCallback((selectedBoardId: number) => {
    updateUrlMulti([
      { key: QUERY_PARAM_KEYS.BOARD_CD, value: selectedBoardId.toString() },
      { key: QUERY_PARAM_KEYS.PI_SPRINTS, value: null },
    ]);
  }, [updateUrlMulti]);

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

  // Handler: piDaysOff changed
  const handlePiDaysOffChange = useCallback((daysOff: Record<string, number>) => {
    updateUrl(QUERY_PARAM_KEYS.PI_DAYS_OFF, serializePiDaysOff(daysOff));
  }, [updateUrl]);

  // Track previous values to detect changes
  const prevValuesRef = useRef<{
    projectKey: string;
    piLabels: string;
    piSprintsKey: string;
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
  useEffect(() => {
    if (!projectKey || piLabels.length === 0) {
      if (data && (!projectKey || piLabels.length === 0)) {
        clear();
      }
      return;
    }

    const currentValues = {
      projectKey,
      piLabels: piLabels.join(','),
      piSprintsKey,
    };

    const prev = prevValuesRef.current;
    const hasChanged =
      !prev ||
      prev.projectKey !== currentValues.projectKey ||
      prev.piLabels !== currentValues.piLabels ||
      prev.piSprintsKey !== currentValues.piSprintsKey;

    if (hasChanged) {
      prevValuesRef.current = currentValues;
      generate(projectKey, piLabels, piSprints);
    }
  }, [projectKey, piLabels, piSprints, piSprintsKey, generate, clear, data]);

  // Handle refresh (force refetch)
  const handleRefresh = useCallback(() => {
    if (!projectKey || piLabels.length === 0 || isLoading) return;
    clear();
    generate(projectKey, piLabels, piSprints);
  }, [projectKey, piLabels, piSprints, isLoading, clear, generate]);

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
            piDaysOff={piDaysOff}
            isGenerating={isLoading}
            onProjectSelect={handleProjectSelect}
            onPILabelsChange={handlePILabelsChange}
            onBoardSelect={handleBoardSelect}
            onPiSprintsChange={handlePiSprintsChange}
            onDeveloperCountChange={handleDeveloperCountChange}
            onPiDaysOffChange={handlePiDaysOffChange}
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
                piDaysOff={piDaysOff}
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
                    Loading PI Data...
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6" gutterBottom>
                    {!projectKey
                      ? 'Select a Project'
                      : 'Select Planning Increments'}
                  </Typography>
                  <Typography variant="body2">
                    {!projectKey
                      ? 'Choose a JIRA project to analyze'
                      : 'Choose one or more PI labels to view capacity vs demand'}
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
            disabled={isLoading || !projectKey || piLabels.length === 0}
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

const CapacityVDemand = () => {
  return (
    <Suspense
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      }
    >
      <CapacityDemandContent />
    </Suspense>
  );
};

export default CapacityVDemand;
