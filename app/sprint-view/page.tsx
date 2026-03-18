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
import AssignmentIcon from '@mui/icons-material/Assignment';
import { Header, Sidebar, MainContent, GanttChart, SlotTicketsDialog } from '@/frontend/components';
import { SprintViewSidebarContent } from '@/frontend/components/sidebar';
import { useAppState } from '@/frontend/hooks';
import { useSprintViewData } from '@/frontend/hooks/useSprintViewData';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { SprintCapacity } from '@/shared/types';

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

const DEFAULT_FUTURE_SPRINT_COUNT = 0;
const DEFAULT_CAPACITY = 20;

const SprintViewContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });


  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
  });
  const [hasSprintOverlap, setHasSprintOverlap] = useState(false);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);

  const {
    projectKey,
    sprintDateOverrides,
    autoAdjustStartDate,
    sidebarCollapsed,
    boardId,
    setSidebarCollapsed,
    setSprintDateOverride,
    clearSprintDateOverride,
    setAutoAdjustStartDate,
  } = useAppState();

  const { ganttData, isLoading, error, generate, clear, clearCache } = useSprintViewData();

  // Parse future sprint count from URL
  const svFutureParam = searchParams.get(QUERY_PARAM_KEYS.SV_FUTURE_SPRINTS);
  const futureSprintCount = svFutureParam !== null
    ? (parseInt(svFutureParam, 10) || DEFAULT_FUTURE_SPRINT_COUNT)
    : DEFAULT_FUTURE_SPRINT_COUNT;

  // Computed sprint IDs from sidebar (local state, not URL)
  const [computedSprintIds, setComputedSprintIds] = useState<number[]>([]);

  // Clear computed sprint IDs when board changes to prevent stale data
  useEffect(() => {
    setComputedSprintIds([]);
  }, [boardId]);

  // Build SprintCapacity[] from computed sprint IDs with default capacity
  const sprintCapacities = useMemo((): SprintCapacity[] =>
    computedSprintIds.map((id) => ({
      sprintId: id,
      devDaysCapacity: DEFAULT_CAPACITY,
    })),
    [computedSprintIds],
  );

  // Stable key for change detection
  const sprintIdsKey = computedSprintIds.join(',');

  // URL update helper
  const updateUrl = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const newUrl = params.toString() ? `?${params.toString()}` : '/sprint-view';
    router.push(newUrl, { scroll: false });
  }, [router]);

  // Handler: future sprint count changed (from spinner)
  const handleFutureSprintCountChange = useCallback((count: number) => {
    updateUrl(QUERY_PARAM_KEYS.SV_FUTURE_SPRINTS, count.toString());
  }, [updateUrl]);

  // Handler: sidebar reports computed sprint IDs
  const handleComputedSprintIds = useCallback((ids: number[]) => {
    setComputedSprintIds(ids);
  }, []);

  const handleSprintOverlapChange = useCallback((hasOverlap: boolean) => {
    setHasSprintOverlap(hasOverlap);
  }, []);

  // Handler: sprint date override from sidebar
  const handleSprintDateOverride = useCallback((sprintId: number, startDate: string, endDate: string) => {
    setSprintDateOverride(sprintId, startDate, endDate);
  }, [setSprintDateOverride]);

  // Handler: clear sprint date override from sidebar
  const handleClearSprintDateOverride = useCallback((sprintId: number) => {
    clearSprintDateOverride(sprintId);
  }, [clearSprintDateOverride]);

  // Handler: auto-adjust dates toggle from sidebar
  const handleAutoAdjustDatesChange = useCallback((enabled: boolean) => {
    setAutoAdjustStartDate(enabled);
  }, [setAutoAdjustStartDate]);

  // Track previous values to detect changes
  const prevValuesRef = useRef<{
    sprintIdsKey: string;
    sprintDateOverrides: string;
    autoAdjustStartDate: boolean;
    boardId: number | undefined;
  } | null>(null);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch('/api/auth/validate');
        const data = await response.json();
        setConnectionStatus({
          connected: data.valid,
          email: data.email,
        });
      } catch {
        setConnectionStatus({ connected: false });
      }
    };

    checkConnection();
  }, []);

  // Auto-generate when prerequisites are met and values change
  useEffect(() => {
    const canGenerate = computedSprintIds.length > 0 && !hasSprintOverlap;

    if (!canGenerate) {
      if (ganttData && (computedSprintIds.length === 0 || hasSprintOverlap)) {
        clear();
      }
      return;
    }

    const currentValues = {
      sprintIdsKey,
      sprintDateOverrides: JSON.stringify(sprintDateOverrides),
      autoAdjustStartDate,
      boardId,
    };

    const prev = prevValuesRef.current;
    const hasChanged = !prev ||
      prev.sprintIdsKey !== currentValues.sprintIdsKey ||
      prev.sprintDateOverrides !== currentValues.sprintDateOverrides ||
      prev.autoAdjustStartDate !== currentValues.autoAdjustStartDate ||
      prev.boardId !== currentValues.boardId;

    if (hasChanged) {
      prevValuesRef.current = currentValues;
      generate(sprintCapacities, { sprintDateOverrides, autoAdjustStartDate, boardId });
    }
  }, [computedSprintIds, sprintIdsKey, sprintCapacities, sprintDateOverrides, autoAdjustStartDate, hasSprintOverlap, boardId, generate, clear, ganttData]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    const canGenerate = computedSprintIds.length > 0 && !hasSprintOverlap;
    if (!canGenerate || isLoading) return;

    clearCache();
    generate(sprintCapacities, { sprintDateOverrides, autoAdjustStartDate, boardId });
  }, [computedSprintIds, sprintCapacities, hasSprintOverlap, isLoading, clearCache, generate, sprintDateOverrides, autoAdjustStartDate, boardId]);

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
          <SprintViewSidebarContent
            boardId={boardId}
            projectKey={projectKey}
            futureSprintCount={futureSprintCount}
            isGenerating={isLoading}
            sprintDateOverrides={sprintDateOverrides}
            autoAdjustDates={autoAdjustStartDate}
            onFutureSprintCountChange={handleFutureSprintCountChange}
            onComputedSprintIds={handleComputedSprintIds}
            onSprintOverlapChange={handleSprintOverlapChange}
            onSprintDateOverride={handleSprintDateOverride}
            onClearSprintDateOverride={handleClearSprintDateOverride}
            onAutoAdjustDatesChange={handleAutoAdjustDatesChange}
          />
        </Sidebar>
        <MainContent>
          {error && (
            <Alert severity="error" sx={{ m: 2 }}>
              {error}
            </Alert>
          )}
          {ganttData ? (
            <GanttChart
              data={ganttData}
              maxDevelopers={9999}
              sprintDateOverrides={sprintDateOverrides}
            />
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
                    Loading Sprint Tickets...
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6" gutterBottom>
                    {!boardId
                      ? 'Select a Board'
                      : 'Waiting for sprint data...'}
                  </Typography>
                  <Typography variant="body2">
                    {!boardId
                      ? 'Choose a board to load sprints'
                      : 'Sprint data will load automatically when the active sprint is found'}
                  </Typography>
                </>
              )}
            </Box>
          )}
        </MainContent>
      </Box>

      {/* Slot Tickets FAB */}
      <Tooltip title="Slot tickets to sprints">
        <span>
          <Fab
            color="secondary"
            aria-label="slot tickets"
            onClick={() => setSlotDialogOpen(true)}
            disabled={!ganttData}
            sx={{
              position: 'fixed',
              bottom: 24,
              right: 88,
            }}
          >
            <AssignmentIcon />
          </Fab>
        </span>
      </Tooltip>

      {/* Refresh FAB */}
      <Tooltip title="Refresh all data from JIRA">
        <span>
          <Fab
            color="primary"
            aria-label="refresh"
            onClick={handleRefresh}
            disabled={isLoading || computedSprintIds.length === 0}
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

      {/* Slot Tickets Dialog */}
      <SlotTicketsDialog
        open={slotDialogOpen}
        onClose={() => setSlotDialogOpen(false)}
        ganttData={ganttData}
      />
    </Box>
  );
};

const SprintView = () => {
  return (
    <Suspense
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      }
    >
      <SprintViewContent />
    </Suspense>
  );
};

export default SprintView;
