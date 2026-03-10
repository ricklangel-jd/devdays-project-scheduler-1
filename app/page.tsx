'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Fab from '@mui/material/Fab';
import Tooltip from '@mui/material/Tooltip';
import RefreshIcon from '@mui/icons-material/Refresh';
import AssignmentIcon from '@mui/icons-material/Assignment';
import { Header, Sidebar, MainContent, SidebarContent, GanttChart, SlotTicketsDialog } from '@/frontend/components';
import { useAppState, useGanttData } from '@/frontend/hooks';
import type { DailyCapacity } from '@/shared/types';

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

const HomeContent = () => {
  useEffect(() => {
    document.title = 'DevDays GaNTT Chart';
  }, []);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
  });
  const [hasSprintOverlap, setHasSprintOverlap] = useState(false);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);

  const {
    projectKey,
    epicKeys,
    epics,
    sprintCapacities,
    maxDevelopers,
    dailyCapacityOverrides,
    sprintDateOverrides,
    autoAdjustStartDate,
    sidebarCollapsed,
    boardId,
    setDailyCapacityOverride,
    setSidebarCollapsed,
  } = useAppState();
  const { ganttData, isLoading, error, generate, clear, clearCache } = useGanttData();

  const handleSprintOverlapChange = useCallback((hasOverlap: boolean) => {
    setHasSprintOverlap(hasOverlap);
  }, []);

  // Track previous values to detect changes
  const prevValuesRef = useRef<{
    epicKeys: string;
    sprintCapacities: string;
    maxDevelopers: number;
    dailyCapacityOverrides: string;
    sprintDateOverrides: string;
    autoAdjustStartDate: boolean;
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

  // Build sprint capacities with daily overrides
  const buildCapacitiesWithOverrides = useCallback(() => {
    return sprintCapacities.map((sc) => {
      const dailyOverrides: DailyCapacity[] = dailyCapacityOverrides
        .filter((override) => override.sprintId === sc.sprintId)
        .map((override) => ({ date: override.date, capacity: override.capacity }));

      return {
        ...sc,
        dailyCapacities: dailyOverrides.length > 0 ? dailyOverrides : sc.dailyCapacities,
      };
    });
  }, [sprintCapacities, dailyCapacityOverrides]);

  // Auto-generate when prerequisites are met and values change
  useEffect(() => {
    // Check prerequisites - don't generate if there's sprint overlap
    const canGenerate = epicKeys.length > 0 && sprintCapacities.length > 0 && maxDevelopers > 0 && !hasSprintOverlap;

    if (!canGenerate) {
      // Clear gantt data if prerequisites are no longer met or there's overlap
      if (ganttData && (epicKeys.length === 0 || sprintCapacities.length === 0 || hasSprintOverlap)) {
        clear();
      }
      return;
    }

    // Create current value signatures
    const currentValues = {
      epicKeys: epicKeys.join(','),
      sprintCapacities: JSON.stringify(sprintCapacities),
      maxDevelopers,
      dailyCapacityOverrides: JSON.stringify(dailyCapacityOverrides),
      sprintDateOverrides: JSON.stringify(sprintDateOverrides),
      autoAdjustStartDate,
    };

    // Check if values have changed
    const prev = prevValuesRef.current;
    const hasChanged = !prev ||
      prev.epicKeys !== currentValues.epicKeys ||
      prev.sprintCapacities !== currentValues.sprintCapacities ||
      prev.maxDevelopers !== currentValues.maxDevelopers ||
      prev.dailyCapacityOverrides !== currentValues.dailyCapacityOverrides ||
      prev.sprintDateOverrides !== currentValues.sprintDateOverrides ||
      prev.autoAdjustStartDate !== currentValues.autoAdjustStartDate;

    if (hasChanged) {
      prevValuesRef.current = currentValues;
      const capacitiesWithOverrides = buildCapacitiesWithOverrides();
      generate(epicKeys, capacitiesWithOverrides, maxDevelopers, { sprintDateOverrides, autoAdjustStartDate, boardId });
    }
  }, [epicKeys, sprintCapacities, maxDevelopers, dailyCapacityOverrides, sprintDateOverrides, autoAdjustStartDate, hasSprintOverlap, boardId, buildCapacitiesWithOverrides, generate, clear, ganttData]);

  // Handle daily capacity changes from the gantt chart
  const handleDailyCapacityChange = useCallback((dayIndex: number, date: string, capacity: number) => {
    if (!ganttData) return;

    // Find which sprint this day belongs to
    const dayInfo = ganttData.dailyCapacities[dayIndex];
    if (!dayInfo) return;

    // Store the override in URL state (will trigger auto-regeneration)
    setDailyCapacityOverride(date, dayInfo.sprintId, capacity);
  }, [ganttData, setDailyCapacityOverride]);

  // Handle refresh - clears cache and regenerates with fresh data from JIRA
  const handleRefresh = useCallback(() => {
    const canGenerate = epicKeys.length > 0 && sprintCapacities.length > 0 && maxDevelopers > 0 && !hasSprintOverlap;
    if (!canGenerate || isLoading) return;

    clearCache();
    const capacitiesWithOverrides = buildCapacitiesWithOverrides();
    generate(epicKeys, capacitiesWithOverrides, maxDevelopers, { sprintDateOverrides, autoAdjustStartDate, boardId });
  }, [epicKeys, sprintCapacities, maxDevelopers, hasSprintOverlap, isLoading, clearCache, buildCapacitiesWithOverrides, generate, sprintDateOverrides, autoAdjustStartDate, boardId]);

  // Determine what message to show when no chart
  const getEmptyStateMessage = () => {
    if (sprintCapacities.length === 0) {
      return {
        title: 'Step 1: Select Sprints',
        subtitle: 'Choose the sprints to include in the schedule',
      };
    }
    if (maxDevelopers <= 0) {
      return {
        title: 'Step 2: Set Points Per Day',
        subtitle: 'Configure how many story points can be completed per day',
      };
    }
    if (epics.length === 0) {
      return {
        title: 'Step 3: Select Epics',
        subtitle: 'Add epics to generate the GANTT chart',
      };
    }
    return {
      title: 'Generating...',
      subtitle: 'Please wait while the schedule is calculated',
    };
  };

  const emptyState = getEmptyStateMessage();

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
          <SidebarContent isGenerating={isLoading} onSprintOverlapChange={handleSprintOverlapChange} />
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
              maxDevelopers={maxDevelopers}
              onDailyCapacityChange={handleDailyCapacityChange}
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
                    Generating Schedule...
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6" gutterBottom>
                    {emptyState.title}
                  </Typography>
                  <Typography variant="body2">
                    {emptyState.subtitle}
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
            disabled={isLoading || epicKeys.length === 0 || sprintCapacities.length === 0}
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

const Home = () => {
  return (
    <Suspense
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      }
    >
      <HomeContent />
    </Suspense>
  );
};

export default Home;
