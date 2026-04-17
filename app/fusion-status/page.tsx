'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Header,
  InitiativeControls,
  InitiativeChips,
  StatusPie,
  TeamStatusColumn,
  EpicList,
  StoriesGrid,
  rollupByStatus,
  rollupByTeamAndStatus,
  applyFilter,
} from '@/frontend/components';
import type { ChartFilter } from '@/frontend/components';
import { useFusionData } from '@/frontend/hooks';
import type { JiraInitiative } from '@/shared/types';

const jiraBaseUrl = process.env.NEXT_PUBLIC_JIRA_BASE_URL?.replace(/\/$/, '');

const readKeysFromUrl = (search: URLSearchParams): string[] => {
  const raw = search.get('initiatives') ?? '';
  return raw
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);
};

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

const FusionStatusContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
  });
  const [initiativeKeys, setInitiativeKeys] = useState<string[]>(() =>
    readKeysFromUrl(new URLSearchParams(searchParams.toString()))
  );
  const [filter, setFilter] = useState<ChartFilter | null>(null);
  const { data, isLoading, error, load, clear } = useFusionData();

  // Connection status (same pattern as app/page.tsx)
  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/auth/validate');
        const body = await response.json();
        setConnectionStatus({ connected: body.valid, email: body.email });
      } catch {
        setConnectionStatus({ connected: false });
      }
    })();
  }, []);

  // Keep URL param in sync with initiativeKeys. Read current search via
  // window.location to avoid re-running when `searchParams` identity changes
  // after our own router.replace().
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const current = params.get('initiatives') ?? '';
    const next = initiativeKeys.join(',');
    if (current === next) return;
    if (next.length === 0) params.delete('initiatives');
    else params.set('initiatives', next);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }, [initiativeKeys, router]);

  // Fetch whenever initiativeKeys changes
  useEffect(() => {
    if (initiativeKeys.length === 0) {
      clear();
      return;
    }
    load(initiativeKeys);
  }, [initiativeKeys, load, clear]);

  const addInitiative = useCallback((init: JiraInitiative) => {
    setInitiativeKeys(prev => (prev.includes(init.key) ? prev : [...prev, init.key]));
    setFilter(null);
  }, []);

  const bulkAddInitiatives = useCallback((inits: JiraInitiative[]) => {
    setInitiativeKeys(prev => {
      const seen = new Set(prev);
      const additions = inits.map(i => i.key).filter(k => !seen.has(k));
      return additions.length === 0 ? prev : [...prev, ...additions];
    });
    setFilter(null);
  }, []);

  const removeInitiative = useCallback((key: string) => {
    setInitiativeKeys(prev => prev.filter(k => k !== key));
    setFilter(null);
  }, []);

  const handlePieSelect = useCallback((status: string) => {
    setFilter(prev =>
      prev?.status === status && !prev.team ? null : { status }
    );
  }, []);

  const handleSegmentSelect = useCallback((team: string, status: string) => {
    setFilter(prev =>
      prev?.team === team && prev?.status === status ? null : { team, status }
    );
  }, []);

  const handleTeamSelect = useCallback((team: string) => {
    setFilter(prev =>
      prev?.team === team && !prev.status ? null : { team }
    );
  }, []);

  const displayedInitiatives = useMemo(() => {
    // Always include every entered key as a chip. If the server returned a
    // matching initiative, use its summary; if the key is unknown (or the
    // load hasn't resolved yet), fall back to a placeholder so the user can
    // still remove it.
    const byKey = new Map<string, JiraInitiative>();
    if (data) for (const init of data.initiatives) byKey.set(init.key, init);
    return initiativeKeys.map<JiraInitiative>(key => byKey.get(key) ?? {
      key,
      summary: data ? '(not found)' : '(loading…)',
      status: '',
      labels: [],
    });
  }, [data, initiativeKeys]);

  const pieData = useMemo(() => rollupByStatus(data?.epics), [data?.epics]);
  const barData = useMemo(() => rollupByTeamAndStatus(data?.epics), [data?.epics]);
  const filteredEpics = useMemo(() => applyFilter(data?.epics, filter), [data?.epics, filter]);
  const filteredStories = useMemo(
    () => filteredEpics.flatMap(e => e.stories),
    [filteredEpics]
  );

  const hasInitiatives = initiativeKeys.length > 0;
  const hasEpics = (data?.epics.length ?? 0) > 0;
  const chartsHidden = !hasEpics;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header connectionStatus={connectionStatus} />

      <Box sx={{ flex: 1, overflow: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* Controls */}
        <InitiativeControls
          existingKeys={initiativeKeys}
          onAdd={addInitiative}
          onBulkAdd={bulkAddInitiatives}
        />
        <InitiativeChips
          initiatives={displayedInitiatives}
          onRemove={removeInitiative}
        />

        {error && <Alert severity="error">{error}</Alert>}

        {!hasInitiatives ? (
          <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 8 }}>
            <Typography variant="h6" gutterBottom>
              No initiatives loaded
            </Typography>
            <Typography variant="body2">
              Add an initiative by key, or load a batch by label, to get started.
            </Typography>
          </Box>
        ) : (
          <>
            {/* Charts row */}
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {isLoading && !hasEpics ? (
                <>
                  <Skeleton variant="rectangular" width={280} height={280} />
                  <Skeleton variant="rectangular" width={380} height={280} />
                </>
              ) : chartsHidden ? (
                <Alert severity="info" sx={{ flex: 1 }}>
                  No non-canceled epics found for these initiatives.
                </Alert>
              ) : (
                <>
                  <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, minWidth: 260 }}>
                    <StatusPie
                      slices={pieData}
                      selectedStatus={filter?.team ? null : filter?.status ?? null}
                      onSelect={handlePieSelect}
                    />
                  </Box>
                  <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, flex: 1, minWidth: 380 }}>
                    <TeamStatusColumn
                      stacks={barData}
                      selected={filter}
                      onSelectSegment={handleSegmentSelect}
                      onSelectTeam={handleTeamSelect}
                    />
                  </Box>
                </>
              )}
            </Box>

            {/* Grids row */}
            {hasEpics && (
              <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 400 }}>
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Epics{filter ? ' (filtered)' : ''}
                  </Typography>
                  {filteredEpics.length === 0 ? (
                    <Alert severity="info">
                      No epics match this selection — click the selected chart element again to clear the filter.
                    </Alert>
                  ) : (
                    <EpicList epics={filteredEpics} jiraBaseUrl={jiraBaseUrl} />
                  )}
                </Box>
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Stories
                  </Typography>
                  <StoriesGrid stories={filteredStories} jiraBaseUrl={jiraBaseUrl} />
                </Box>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
};

const FusionStatus = () => (
  <Suspense
    fallback={
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    }
  >
    <FusionStatusContent />
  </Suspense>
);

export default FusionStatus;
