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
import { SprintCheckSidebarContent } from '@/frontend/components/sidebar';
import { SprintCheckLineChart, SprintCheckCurrentSprint, SupportTicketPanel } from '@/frontend/components/chart';
import { useAppState } from '@/frontend/hooks';
import { useSprintCheckData } from '@/frontend/hooks/useSprintCheckData';
import { QUERY_PARAM_KEYS } from '@/shared/types';

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

const DEFAULT_SPRINT_COUNT = 5;

const SprintCheckContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  useEffect(() => {
    document.title = 'Sprint Check';
  }, []);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
  });

  const {
    projectKey,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useAppState();

  const { data, isLoading, error, generate, clear } = useSprintCheckData();

  // Parse board ID from URL
  const boardParam = searchParams.get(QUERY_PARAM_KEYS.BOARD);
  const boardId = boardParam ? parseInt(boardParam, 10) || undefined : undefined;

  // Parse sprint count from URL (single number, default 5)
  const scSprintsParam = searchParams.get(QUERY_PARAM_KEYS.SC_SPRINTS);
  const sprintCount = scSprintsParam !== null ? (parseInt(scSprintsParam, 10) || DEFAULT_SPRINT_COUNT) : DEFAULT_SPRINT_COUNT;

  // Computed sprint IDs from sidebar (local state, not URL)
  const [computedSprintIds, setComputedSprintIds] = useState<number[]>([]);

  // Clear computed sprint IDs when board changes to prevent stale data
  useEffect(() => {
    setComputedSprintIds([]);
  }, [boardId]);

  // Stable key for change detection
  const sprintIdsKey = computedSprintIds.join(',');

  // Engineer filter state (local, not URL)
  const [selectedEngineers, setSelectedEngineers] = useState<Set<string>>(new Set());

  // Highlight state: which engineer (and optionally which sprint) is selected for detail view
  const [highlightedEngineer, setHighlightedEngineer] = useState<string | null>(null);
  const [highlightedSprintId, setHighlightedSprintId] = useState<number | null>(null);

  // Sync engineer selection when data loads; clear highlights
  useEffect(() => {
    if (data?.engineers) {
      setSelectedEngineers(new Set(data.engineers));
      setHighlightedEngineer(null);
      setHighlightedSprintId(null);
    }
  }, [data?.engineers]);

  // URL update helper
  const updateUrl = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const newUrl = params.toString() ? `?${params.toString()}` : '/sprint-check';
    router.push(newUrl, { scroll: false });
  }, [router]);

  // Handler: sprint count changed (from spinner)
  const handleSprintCountChange = useCallback((count: number) => {
    updateUrl(QUERY_PARAM_KEYS.SC_SPRINTS, count.toString());
  }, [updateUrl]);

  // Handler: sidebar reports computed sprint IDs
  const handleComputedSprintIds = useCallback((ids: number[]) => {
    setComputedSprintIds(ids);
  }, []);

  // Engineer filter handlers
  const handleEngineerToggle = useCallback((engineer: string) => {
    setSelectedEngineers((prev) => {
      const next = new Set(prev);
      if (next.has(engineer)) {
        next.delete(engineer);
      } else {
        next.add(engineer);
      }
      return next;
    });
  }, []);

  const handleSelectAllEngineers = useCallback(() => {
    if (data?.engineers) {
      setSelectedEngineers(new Set(data.engineers));
    }
  }, [data?.engineers]);

  const handleDeselectAllEngineers = useCallback(() => {
    setSelectedEngineers(new Set());
  }, []);

  // Highlight handlers: click engineer name → highlight their data
  const handleEngineerHighlight = useCallback((engineer: string) => {
    setHighlightedEngineer((prev) => (prev === engineer ? null : engineer));
    setHighlightedSprintId(null);
  }, []);

  // Click a data point → highlight engineer + sprint
  const handleDataPointClick = useCallback((engineer: string, sprintId: number) => {
    setHighlightedEngineer((prevEng) => {
      if (prevEng === engineer) {
        // Same engineer — toggle sprint
        setHighlightedSprintId((prevSprint) => (prevSprint === sprintId ? null : sprintId));
        return engineer;
      }
      // Different engineer — set both
      setHighlightedSprintId(sprintId);
      return engineer;
    });
  }, []);

  // Track previous values for change detection
  const prevValuesRef = useRef<{
    sprintIdsKey: string;
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

  // Auto-generate when computed sprint IDs change
  useEffect(() => {
    if (computedSprintIds.length === 0 || !boardId) {
      if (data && (computedSprintIds.length === 0 || !boardId)) {
        clear();
      }
      return;
    }

    const currentValues = { sprintIdsKey, boardId };

    const prev = prevValuesRef.current;
    const hasChanged =
      !prev ||
      prev.sprintIdsKey !== currentValues.sprintIdsKey ||
      prev.boardId !== currentValues.boardId;

    if (hasChanged) {
      prevValuesRef.current = currentValues;
      generate(computedSprintIds, boardId);
    }
  }, [computedSprintIds, sprintIdsKey, boardId, generate, clear, data]);

  // Handle refresh (force refetch)
  const handleRefresh = useCallback(() => {
    if (computedSprintIds.length === 0 || !boardId || isLoading) return;
    clear();
    generate(computedSprintIds, boardId);
  }, [computedSprintIds, boardId, isLoading, clear, generate]);

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
          <SprintCheckSidebarContent
            boardId={boardId}
            projectKey={projectKey}
            sprintCount={sprintCount}
            isLoading={isLoading}
            engineers={data?.engineers ?? []}
            selectedEngineers={selectedEngineers}
            highlightedEngineer={highlightedEngineer}
            onSprintCountChange={handleSprintCountChange}
            onComputedSprintIds={handleComputedSprintIds}
            onEngineerToggle={handleEngineerToggle}
            onSelectAllEngineers={handleSelectAllEngineers}
            onDeselectAllEngineers={handleDeselectAllEngineers}
            onEngineerHighlight={handleEngineerHighlight}
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
              <SprintCheckCurrentSprint
                currentSprint={data.currentSprint}
                tickets={data.tickets}
                highlightedEngineer={highlightedEngineer}
                onEngineerHighlight={handleEngineerHighlight}
              />
              <SprintCheckLineChart
                data={data}
                selectedEngineers={selectedEngineers}
                highlightedEngineer={highlightedEngineer}
                highlightedSprintId={highlightedSprintId}
                onEngineerHighlight={handleEngineerHighlight}
                onDataPointClick={handleDataPointClick}
              />
              <SupportTicketPanel tickets={data.supportTickets ?? []} />
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
                    Loading Sprint Check Data...
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6" gutterBottom>
                    {!projectKey
                      ? 'Select a Project'
                      : !boardId
                        ? 'Select a Board'
                        : 'Waiting for sprint data...'}
                  </Typography>
                  <Typography variant="body2">
                    {!projectKey
                      ? 'Choose a JIRA project to analyze'
                      : !boardId
                        ? 'Choose a board to load sprints'
                        : 'Sprint data will load automatically when a board is selected'}
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
            disabled={isLoading || computedSprintIds.length === 0 || !boardId}
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

const SprintCheck = () => {
  return (
    <Suspense
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      }
    >
      <SprintCheckContent />
    </Suspense>
  );
};

export default SprintCheck;
