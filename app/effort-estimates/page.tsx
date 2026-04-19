'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Fab from '@mui/material/Fab';
import Tooltip from '@mui/material/Tooltip';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Chip from '@mui/material/Chip';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Header,
  InitiativeControls,
  InitiativeChips,
  SizePie,
  TeamSizeColumn,
  InitiativeSizeColumn,
  EffortEpicList,
  EffortStoriesGrid,
  NoStoriesPie,
  NoStoriesEpicList,
  SprintsNeededTab,
  rollupBySize,
  rollupByTeamAndSize,
  rollupByInitiativeAndSize,
  applyEffortFilter,
} from '@/frontend/components';
import type { EffortFilter } from '@/frontend/components';
import { useEffortData } from '@/frontend/hooks';
import type { JiraInitiative, TshirtSize } from '@/shared/types';

const jiraBaseUrl = process.env.NEXT_PUBLIC_JIRA_BASE_URL?.replace(/\/$/, '');

const readKeysFromUrl = (search: URLSearchParams): string[] => {
  const raw = search.get('initiatives') ?? '';
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
};

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

const EffortEstimatesContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
  });
  const [initiativeKeys, setInitiativeKeys] = useState<string[]>(() =>
    readKeysFromUrl(new URLSearchParams(searchParams.toString()))
  );
  const [filter, setFilter] = useState<EffortFilter | null>(null);
  const [activeTab, setActiveTab] = useState<'sprints' | 'details' | 'no-stories'>('sprints');
  const { data, isLoading, error, load, clear } = useEffortData();

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

  useEffect(() => {
    if (initiativeKeys.length === 0) {
      clear();
      return;
    }
    load(initiativeKeys);
  }, [initiativeKeys, load, clear]);

  const addInitiative = useCallback((init: JiraInitiative) => {
    setInitiativeKeys((prev) => (prev.includes(init.key) ? prev : [...prev, init.key]));
    setFilter(null);
  }, []);

  const bulkAddInitiatives = useCallback((inits: JiraInitiative[]) => {
    setInitiativeKeys((prev) => {
      const seen = new Set(prev);
      const additions = inits.map((i) => i.key).filter((k) => !seen.has(k));
      return additions.length === 0 ? prev : [...prev, ...additions];
    });
    setFilter(null);
  }, []);

  const removeInitiative = useCallback((key: string) => {
    setInitiativeKeys((prev) => prev.filter((k) => k !== key));
    setFilter(null);
  }, []);

  const handleSizePieSelect = useCallback((size: TshirtSize) => {
    setFilter((prev) =>
      prev?.size === size && !prev.team && !prev.initiativeKey ? null : { size }
    );
  }, []);

  const handleTeamSegmentSelect = useCallback((team: string, size: TshirtSize) => {
    setFilter((prev) =>
      prev?.team === team && prev?.size === size ? null : { team, size }
    );
  }, []);

  const handleTeamSelect = useCallback((team: string) => {
    setFilter((prev) => (prev?.team === team && !prev.size ? null : { team }));
  }, []);

  const handleInitiativeSegmentSelect = useCallback(
    (initiativeKey: string, size: TshirtSize) => {
      setFilter((prev) =>
        prev?.initiativeKey === initiativeKey && prev?.size === size
          ? null
          : { initiativeKey, size }
      );
    },
    []
  );

  const handleInitiativeSelect = useCallback((initiativeKey: string) => {
    setFilter((prev) =>
      prev?.initiativeKey === initiativeKey && !prev.size ? null : { initiativeKey }
    );
  }, []);

  const handleRefresh = useCallback(() => {
    if (isLoading || initiativeKeys.length === 0) return;
    load(initiativeKeys);
  }, [isLoading, initiativeKeys, load]);

  const displayedInitiatives = useMemo(() => {
    const byKey = new Map<string, JiraInitiative>();
    if (data) for (const init of data.initiatives) byKey.set(init.key, init);
    return initiativeKeys.map<JiraInitiative>(
      (key) =>
        byKey.get(key) ?? {
          key,
          summary: data ? '(not found)' : '(loading…)',
          status: '',
          labels: [],
        }
    );
  }, [data, initiativeKeys]);

  const pieData = useMemo(() => rollupBySize(data?.epics), [data?.epics]);
  const teamBarData = useMemo(() => rollupByTeamAndSize(data?.epics), [data?.epics]);
  const initiativeBarData = useMemo(
    () => rollupByInitiativeAndSize(data?.epics),
    [data?.epics]
  );
  const initiativeNames = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (data) for (const init of data.initiatives) map[init.key] = init.summary;
    return map;
  }, [data]);
  const teamNames = data?.teamNames ?? {};
  const filteredEpics = useMemo(
    () => applyEffortFilter(data?.epics, filter),
    [data?.epics, filter]
  );
  const filteredStories = useMemo(
    () => filteredEpics.flatMap((e) => e.stories),
    [filteredEpics]
  );

  const hasInitiatives = initiativeKeys.length > 0;
  const hasEpics = (data?.epics.length ?? 0) > 0;
  const chartsHidden = !hasEpics;

  const pieSelection =
    filter?.team || filter?.initiativeKey ? null : filter?.size ?? null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header connectionStatus={connectionStatus} />

      <Box sx={{ flex: 1, overflow: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <InitiativeControls
          existingKeys={initiativeKeys}
          onAdd={addInitiative}
          onBulkAdd={bulkAddInitiatives}
        />

        {hasInitiatives && (
          <Accordion defaultExpanded={false} disableGutters square sx={{ bgcolor: 'transparent' }}>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              sx={{ px: 0, minHeight: 0 }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Loaded Initiatives
                </Typography>
                <Chip
                  label={initiativeKeys.length}
                  size="small"
                  variant="outlined"
                />
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 0, pt: 0 }}>
              <InitiativeChips
                initiatives={displayedInitiatives}
                onRemove={removeInitiative}
              />
            </AccordionDetails>
          </Accordion>
        )}

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
            <Tabs
              value={activeTab}
              onChange={(_e, v) => setActiveTab(v as 'sprints' | 'details' | 'no-stories')}
              sx={{ borderBottom: 1, borderColor: 'divider' }}
            >
              <Tab value="sprints" label="Sprints Needed" />
              <Tab value="details" label="Details" />
              <Tab value="no-stories" label="No Stories" />
            </Tabs>

            {activeTab === 'sprints' ? (
              isLoading && !hasEpics ? (
                <Skeleton variant="rectangular" height={280} />
              ) : (
                <SprintsNeededTab stacks={teamBarData} teamNames={teamNames} />
              )
            ) : activeTab === 'details' ? (
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
                      <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, minWidth: 460 }}>
                        <SizePie
                          slices={pieData}
                          selectedSize={pieSelection}
                          onSelect={handleSizePieSelect}
                        />
                      </Box>
                      {initiativeKeys.length > 1 && (
                        <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, flex: 1, minWidth: 320 }}>
                          <InitiativeSizeColumn
                            stacks={initiativeBarData}
                            initiativeNames={initiativeNames}
                            selected={filter}
                            onSelectSegment={handleInitiativeSegmentSelect}
                            onSelectInitiative={handleInitiativeSelect}
                          />
                        </Box>
                      )}
                      <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, flex: 1, minWidth: 320 }}>
                        <TeamSizeColumn
                          stacks={teamBarData}
                          teamNames={teamNames}
                          selected={filter}
                          onSelectSegment={handleTeamSegmentSelect}
                          onSelectTeam={handleTeamSelect}
                        />
                      </Box>
                    </>
                  )}
                </Box>

                {/* Grids row */}
                {hasEpics && (
                  <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 400 }}>
                    <Box sx={{ flex: 3, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        Epics ({filteredEpics.length}{filter ? ', filtered' : ''})
                      </Typography>
                      {filteredEpics.length === 0 ? (
                        <Alert severity="info">
                          No epics match this selection — click the selected chart element again to clear the filter.
                        </Alert>
                      ) : (
                        <EffortEpicList
                          epics={filteredEpics}
                          jiraBaseUrl={jiraBaseUrl}
                          teamNames={teamNames}
                          initiativeNames={initiativeNames}
                        />
                      )}
                    </Box>
                    <Box sx={{ flex: 2, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        Stories ({filteredStories.length})
                      </Typography>
                      <EffortStoriesGrid stories={filteredStories} jiraBaseUrl={jiraBaseUrl} />
                    </Box>
                  </Box>
                )}
              </>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
                {isLoading && !hasEpics ? (
                  <Skeleton variant="rectangular" width={480} height={280} />
                ) : (
                  <>
                    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                      <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        <NoStoriesPie epics={data?.epics ?? []} teamNames={teamNames} />
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        Epics Without Stories ({(data?.epics ?? []).filter((e) => e.stories.length === 0).length})
                      </Typography>
                      <NoStoriesEpicList
                        epics={data?.epics ?? []}
                        jiraBaseUrl={jiraBaseUrl}
                        teamNames={teamNames}
                        initiativeNames={initiativeNames}
                      />
                    </Box>
                  </>
                )}
              </Box>
            )}
          </>
        )}
      </Box>

      <Tooltip title="Refresh data from JIRA">
        <span>
          <Fab
            color="primary"
            aria-label="refresh"
            onClick={handleRefresh}
            disabled={isLoading || initiativeKeys.length === 0}
            sx={{ position: 'fixed', bottom: 24, right: 24 }}
          >
            {isLoading ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
          </Fab>
        </span>
      </Tooltip>
    </Box>
  );
};

const EffortEstimates = () => (
  <Suspense
    fallback={
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    }
  >
    <EffortEstimatesContent />
  </Suspense>
);

export default EffortEstimates;
