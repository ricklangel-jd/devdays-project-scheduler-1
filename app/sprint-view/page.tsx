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
import { Header, Sidebar, MainContent, GanttChart, SlotTicketsDialog } from '@/frontend/components';
import { SprintViewSidebarContent } from '@/frontend/components/sidebar';
import { useAppState } from '@/frontend/hooks';
import { useSprintViewData } from '@/frontend/hooks/useSprintViewData';

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

const SprintViewContent = () => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
  });
  const [hasSprintOverlap, setHasSprintOverlap] = useState(false);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);

  const {
    sprintCapacities,
    sprintDateOverrides,
    autoAdjustStartDate,
    sidebarCollapsed,
    boardId,
    setSidebarCollapsed,
  } = useAppState();
  const { ganttData, isLoading, error, generate, clear, clearCache } = useSprintViewData();

  const handleSprintOverlapChange = useCallback((hasOverlap: boolean) => {
    setHasSprintOverlap(hasOverlap);
  }, []);

  // Track previous values to detect changes
  const prevValuesRef = useRef<{
    sprintCapacities: string;
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

  // Auto-generate when prerequisites are met and values change
  useEffect(() => {
    const canGenerate = sprintCapacities.length > 0 && !hasSprintOverlap;

    if (!canGenerate) {
      if (ganttData && (sprintCapacities.length === 0 || hasSprintOverlap)) {
        clear();
      }
      return;
    }

    const currentValues = {
      sprintCapacities: JSON.stringify(sprintCapacities),
      sprintDateOverrides: JSON.stringify(sprintDateOverrides),
      autoAdjustStartDate,
    };

    const prev = prevValuesRef.current;
    const hasChanged = !prev ||
      prev.sprintCapacities !== currentValues.sprintCapacities ||
      prev.sprintDateOverrides !== currentValues.sprintDateOverrides ||
      prev.autoAdjustStartDate !== currentValues.autoAdjustStartDate;

    if (hasChanged) {
      prevValuesRef.current = currentValues;
      generate(sprintCapacities, { sprintDateOverrides, autoAdjustStartDate, boardId });
    }
  }, [sprintCapacities, sprintDateOverrides, autoAdjustStartDate, hasSprintOverlap, boardId, generate, clear, ganttData]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    const canGenerate = sprintCapacities.length > 0 && !hasSprintOverlap;
    if (!canGenerate || isLoading) return;

    clearCache();
    generate(sprintCapacities, { sprintDateOverrides, autoAdjustStartDate, boardId });
  }, [sprintCapacities, hasSprintOverlap, isLoading, clearCache, generate, sprintDateOverrides, autoAdjustStartDate, boardId]);

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
          <SprintViewSidebarContent isGenerating={isLoading} onSprintOverlapChange={handleSprintOverlapChange} />
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
                    Select Sprints
                  </Typography>
                  <Typography variant="body2">
                    Choose the sprints to view tickets for
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
            disabled={isLoading || sprintCapacities.length === 0}
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
