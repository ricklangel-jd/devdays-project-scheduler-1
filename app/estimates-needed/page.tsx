'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Fab from '@mui/material/Fab';
import Tooltip from '@mui/material/Tooltip';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Header, InitiativeControls, InitiativeChips } from '@/frontend/components';
import { useAppState } from '@/frontend/hooks';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { JiraInitiative } from '@/shared/types';
import type {
  EstimatesNeededEpic,
  EstimatesNeededResponse,
  EstimatesNeededStory,
} from '@/app/api/estimates-needed/data/route';

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

const jiraLink = (key: string) =>
  JIRA_BASE_URL ? (
    <Link
      href={`${JIRA_BASE_URL}/browse/${key}`}
      target="_blank"
      rel="noopener noreferrer"
      underline="hover"
      sx={{ fontWeight: 500, fontSize: 'inherit' }}
    >
      {key}
    </Link>
  ) : (
    <>{key}</>
  );

const STATUS_COLORS: Record<string, 'default' | 'warning' | 'error' | 'success' | 'info'> = {
  'in progress': 'info',
  'resolved': 'success',
  'done': 'success',
  'closed': 'success',
  'canceled': 'default',
  'cancelled': 'default',
  'backlog': 'default',
};

const statusChip = (status: string) => (
  <Chip
    label={status}
    size="small"
    color={STATUS_COLORS[status.toLowerCase()] ?? 'warning'}
    variant="outlined"
    sx={{ fontSize: '0.72rem', height: 20 }}
  />
);

const readKeysFromUrl = (search: URLSearchParams): string[] => {
  const raw = search.get(QUERY_PARAM_KEYS.EN_INITIATIVES) ?? '';
  return raw.split(',').map((k) => k.trim()).filter((k) => k.length > 0);
};

const colSx = { fontSize: '0.82rem', py: 0.75, px: 1.5, verticalAlign: 'top' };
const headerSx = { ...colSx, fontWeight: 700, bgcolor: 'grey.100', whiteSpace: 'nowrap' as const };

interface EpicsGridProps {
  epics: EstimatesNeededEpic[];
  selectedEpicKey: string | null;
  onSelect: (key: string) => void;
}

const EpicsGrid = ({ epics, selectedEpicKey, onSelect }: EpicsGridProps) => (
  <Paper elevation={1} sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
    <Box sx={{ px: 2, pt: 2, pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        Epics with Stories Missing T-Shirt Sizing
      </Typography>
      <Chip label={epics.length} size="small" color={epics.length > 0 ? 'warning' : 'default'} />
    </Box>
    <TableContainer>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={headerSx}>Epic</TableCell>
            <TableCell sx={headerSx}>Summary</TableCell>
            <TableCell sx={headerSx}>Status</TableCell>
            <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Missing</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {epics.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} sx={{ textAlign: 'center', py: 3, color: 'text.secondary', fontSize: '0.85rem' }}>
                No epics in this project need estimates.
              </TableCell>
            </TableRow>
          ) : (
            epics.map((epic) => {
              const isSelected = epic.epicKey === selectedEpicKey;
              return (
                <TableRow
                  key={epic.epicKey}
                  hover
                  selected={isSelected}
                  onClick={() => onSelect(epic.epicKey)}
                  sx={{
                    cursor: 'pointer',
                    '&:nth-of-type(even)': { bgcolor: 'grey.50' },
                    '&.Mui-selected': { bgcolor: 'primary.light' },
                    '&.Mui-selected:hover': { bgcolor: 'primary.light' },
                  }}
                >
                  <TableCell sx={{ ...colSx, whiteSpace: 'nowrap', fontWeight: 500 }}>
                    {jiraLink(epic.epicKey)}
                  </TableCell>
                  <TableCell sx={colSx}>{epic.epicSummary}</TableCell>
                  <TableCell sx={{ ...colSx, whiteSpace: 'nowrap' }}>
                    {statusChip(epic.epicStatus)}
                  </TableCell>
                  <TableCell sx={{ ...colSx, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <Chip
                      label={`${epic.missingTshirtCount} / ${epic.totalStories}`}
                      size="small"
                      color="warning"
                      sx={{ fontSize: '0.72rem', height: 20 }}
                    />
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  </Paper>
);

interface StoriesPanelProps {
  epic: EstimatesNeededEpic | null;
}

const StoriesPanel = ({ epic }: StoriesPanelProps) => {
  if (!epic) {
    return (
      <Paper elevation={1} sx={{ flex: 1, p: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">Select an epic on the left to view its stories.</Typography>
      </Paper>
    );
  }

  // Missing-first, then by key
  const sortedStories: EstimatesNeededStory[] = [...epic.stories].sort((a, b) => {
    if (a.isMissingTshirt !== b.isMissingTshirt) return a.isMissingTshirt ? -1 : 1;
    return a.key.localeCompare(b.key);
  });

  return (
    <Paper elevation={1} sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2, pt: 2, pb: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Stories in {jiraLink(epic.epicKey)}
          {epic.epicSummary && (
            <Typography component="span" variant="subtitle1" color="text.secondary" sx={{ fontWeight: 400, ml: 1 }}>
              — {epic.epicSummary}
            </Typography>
          )}
        </Typography>
        <Chip
          label={`${epic.missingTshirtCount} missing`}
          size="small"
          color="warning"
        />
        <Chip
          label={`${epic.totalStories} total`}
          size="small"
          variant="outlined"
        />
      </Box>
      <TableContainer>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={headerSx}>Story</TableCell>
              <TableCell sx={headerSx}>Summary</TableCell>
              <TableCell sx={headerSx}>Status</TableCell>
              <TableCell sx={headerSx}>T-Shirt</TableCell>
              <TableCell sx={headerSx}>Assignee</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedStories.map((story) => (
              <TableRow
                key={story.key}
                sx={{
                  '&:nth-of-type(even)': { bgcolor: 'grey.50' },
                  bgcolor: story.isMissingTshirt ? 'warning.lighter' : undefined,
                }}
              >
                <TableCell sx={{ ...colSx, whiteSpace: 'nowrap', fontWeight: 500 }}>
                  {jiraLink(story.key)}
                </TableCell>
                <TableCell sx={colSx}>{story.summary}</TableCell>
                <TableCell sx={{ ...colSx, whiteSpace: 'nowrap' }}>
                  {statusChip(story.status)}
                </TableCell>
                <TableCell sx={{ ...colSx, whiteSpace: 'nowrap' }}>
                  {story.isMissingTshirt ? (
                    <Chip label="Missing" size="small" color="warning" sx={{ fontSize: '0.72rem', height: 20 }} />
                  ) : (
                    <Chip
                      label={story.tshirtSize}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: '0.72rem', height: 20 }}
                    />
                  )}
                </TableCell>
                <TableCell sx={{ ...colSx, whiteSpace: 'nowrap' }}>
                  {story.assignee ?? <Typography variant="caption" color="text.secondary">—</Typography>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

const EstimatesNeededContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { projectKey } = useAppState();

  const [initiativeKeys, setInitiativeKeys] = useState<string[]>(() =>
    readKeysFromUrl(new URLSearchParams(searchParams.toString()))
  );
  const [data, setData] = useState<EstimatesNeededResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEpicKey, setSelectedEpicKey] = useState<string | null>(null);
  const [excludeBlocked, setExcludeBlocked] = useState(false);

  // Keep URL param in sync
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const current = params.get(QUERY_PARAM_KEYS.EN_INITIATIVES) ?? '';
    const next = initiativeKeys.join(',');
    if (current === next) return;
    if (next.length === 0) params.delete(QUERY_PARAM_KEYS.EN_INITIATIVES);
    else params.set(QUERY_PARAM_KEYS.EN_INITIATIVES, next);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }, [initiativeKeys, router]);

  const load = useCallback(async (keys: string[], proj: string | undefined) => {
    if (!proj || keys.length === 0) {
      setData(null);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const url =
        `/api/estimates-needed/data?projectKey=${encodeURIComponent(proj)}` +
        `&initiatives=${encodeURIComponent(keys.join(','))}`;
      const res = await fetch(url);
      const json: EstimatesNeededResponse | { error: string } = await res.json();
      if (!res.ok) throw new Error('error' in json ? json.error : 'Failed to load');
      setData(json as EstimatesNeededResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load(initiativeKeys, projectKey);
  }, [initiativeKeys, projectKey, load]);

  // Apply the "exclude blocked" toggle: drop any story in Blocked status, and
  // drop epics that are no longer interesting afterwards. An epic is dropped
  // when the filter leaves it with zero stories overall, or zero stories
  // still missing a T-shirt size — in either case there's nothing to act on.
  const visibleEpics = useMemo(() => {
    if (!data) return [];
    if (!excludeBlocked) return data.epics;
    const out: EstimatesNeededEpic[] = [];
    for (const epic of data.epics) {
      const kept = epic.stories.filter(
        (s) => s.status.toLowerCase() !== 'blocked'
      );
      if (kept.length === 0) continue;
      const missing = kept.filter((s) => s.isMissingTshirt).length;
      if (missing === 0) continue;
      out.push({
        ...epic,
        stories: kept,
        totalStories: kept.length,
        missingTshirtCount: missing,
      });
    }
    return out;
  }, [data, excludeBlocked]);

  // Reset selection whenever the visible epic set changes (either fresh
  // data or the "exclude blocked" toggle trimmed the current selection).
  useEffect(() => {
    if (visibleEpics.length === 0) {
      setSelectedEpicKey(null);
      return;
    }
    setSelectedEpicKey((prev) => {
      if (prev && visibleEpics.some((e) => e.epicKey === prev)) return prev;
      return visibleEpics[0].epicKey;
    });
  }, [visibleEpics]);

  const addInitiative = useCallback((init: JiraInitiative) => {
    setInitiativeKeys((prev) => (prev.includes(init.key) ? prev : [...prev, init.key]));
  }, []);

  const bulkAddInitiatives = useCallback((inits: JiraInitiative[]) => {
    setInitiativeKeys((prev) => {
      const seen = new Set(prev);
      const additions = inits.map((i) => i.key).filter((k) => !seen.has(k));
      return additions.length === 0 ? prev : [...prev, ...additions];
    });
  }, []);

  const removeInitiative = useCallback((key: string) => {
    setInitiativeKeys((prev) => prev.filter((k) => k !== key));
  }, []);

  const handleRefresh = useCallback(() => {
    if (isLoading || !projectKey || initiativeKeys.length === 0) return;
    load(initiativeKeys, projectKey);
  }, [isLoading, projectKey, initiativeKeys, load]);

  // Chips show the server-returned summary when available; otherwise fall
  // back to a placeholder so the user can still remove the key.
  const displayedInitiatives = useMemo<JiraInitiative[]>(() => {
    const byKey = new Map<string, JiraInitiative>();
    if (data) for (const init of data.initiatives) byKey.set(init.key, init);
    return initiativeKeys.map((key) =>
      byKey.get(key) ?? {
        key,
        summary: data ? '(not found)' : '(loading…)',
        status: '',
        labels: [],
      }
    );
  }, [data, initiativeKeys]);

  const selectedEpic = useMemo(() => {
    if (!selectedEpicKey) return null;
    return visibleEpics.find((e) => e.epicKey === selectedEpicKey) ?? null;
  }, [visibleEpics, selectedEpicKey]);

  const emptyState = !projectKey
    ? 'Select a project at the top of the page.'
    : initiativeKeys.length === 0
      ? 'Add at least one initiative to load epics.'
      : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header />

      <Box sx={{ flex: 1, overflow: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <InitiativeControls
          existingKeys={initiativeKeys}
          onAdd={addInitiative}
          onBulkAdd={bulkAddInitiatives}
        />
        {initiativeKeys.length > 0 && (
          <Accordion defaultExpanded={false} disableGutters square sx={{ bgcolor: 'transparent' }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Loaded Initiatives
                </Typography>
                <Chip label={initiativeKeys.length} size="small" variant="outlined" />
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

        {emptyState ? (
          <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 8 }}>
            <Typography variant="h6" gutterBottom>
              {emptyState}
            </Typography>
          </Box>
        ) : isLoading && !data ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8 }}>
            <CircularProgress sx={{ mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              Loading epics and stories…
            </Typography>
          </Box>
        ) : data ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={excludeBlocked}
                    onChange={(e) => setExcludeBlocked(e.target.checked)}
                  />
                }
                label="Exclude blocked stories"
              />
              {excludeBlocked && (
                <Typography variant="caption" color="text.secondary">
                  Epics with no remaining non-blocked stories are hidden.
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 400, alignItems: 'stretch' }}>
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex' }}>
                <EpicsGrid
                  epics={visibleEpics}
                  selectedEpicKey={selectedEpicKey}
                  onSelect={setSelectedEpicKey}
                />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex' }}>
                <StoriesPanel epic={selectedEpic} />
              </Box>
            </Box>
          </>
        ) : null}
      </Box>

      <Tooltip title="Refresh data from JIRA">
        <span>
          <Fab
            color="primary"
            aria-label="refresh"
            onClick={handleRefresh}
            disabled={isLoading || !projectKey || initiativeKeys.length === 0}
            sx={{ position: 'fixed', bottom: 24, right: 24 }}
          >
            {isLoading ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
          </Fab>
        </span>
      </Tooltip>
    </Box>
  );
};

const EstimatesNeeded = () => (
  <Suspense
    fallback={
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    }
  >
    <EstimatesNeededContent />
  </Suspense>
);

export default EstimatesNeeded;
