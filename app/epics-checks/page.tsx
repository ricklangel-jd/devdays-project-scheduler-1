'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
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
import Fab from '@mui/material/Fab';
import Tooltip from '@mui/material/Tooltip';
import Link from '@mui/material/Link';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Header } from '@/frontend/components';
import { useAppState } from '@/frontend/hooks';
import type { EpicsChecksResponse } from '@/app/api/epics-checks/data/route';

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

const jiraLink = (key: string) =>
  JIRA_BASE_URL ? (
    <Link href={`${JIRA_BASE_URL}/browse/${key}`} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ fontWeight: 500, fontSize: 'inherit' }}>
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

interface StoryInfo { key: string; summary: string; status: string }

const StoriesList = ({ stories }: { stories: StoryInfo[] }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
    {stories.map((s) => (
      <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
          {jiraLink(s.key)}
        </Typography>
        {statusChip(s.status)}
        <Typography variant="caption" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
          {s.summary}
        </Typography>
      </Box>
    ))}
  </Box>
);

interface GridProps {
  title: string;
  description: string;
  items: EpicsChecksResponse['notStartedWithActiveStories'];
  emptyMessage: string;
  storyColumnLabel: string;
}

const EpicCheckGrid = ({ title, description, items, emptyMessage, storyColumnLabel }: GridProps) => {
  const colSx = { fontSize: '0.82rem', py: 0.75, px: 1.5, verticalAlign: 'top' };
  const headerSx = { ...colSx, fontWeight: 700, bgcolor: 'grey.100', whiteSpace: 'nowrap' as const };

  return (
    <Paper elevation={1} sx={{ mb: 3 }}>
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <WarningAmberIcon sx={{ color: 'warning.main', fontSize: 20 }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <Chip label={items.length} size="small" color={items.length > 0 ? 'warning' : 'default'} sx={{ ml: 0.5 }} />
        </Box>
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={headerSx}>Epic</TableCell>
              <TableCell sx={headerSx}>Summary</TableCell>
              <TableCell sx={headerSx}>Epic Status</TableCell>
              <TableCell sx={headerSx}>{storyColumnLabel}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} sx={{ textAlign: 'center', py: 3, color: 'text.secondary', fontSize: '0.85rem' }}>
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.epicKey} sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                  <TableCell sx={{ ...colSx, whiteSpace: 'nowrap', fontWeight: 500 }}>
                    {jiraLink(item.epicKey)}
                  </TableCell>
                  <TableCell sx={{ ...colSx, maxWidth: 320 }}>
                    {item.epicSummary}
                  </TableCell>
                  <TableCell sx={{ ...colSx, whiteSpace: 'nowrap' }}>
                    {statusChip(item.epicStatus)}
                  </TableCell>
                  <TableCell sx={colSx}>
                    <StoriesList stories={item.stories} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

const EpicsChecksContent = () => {
  const { projectKey } = useAppState();
  const [data, setData] = useState<EpicsChecksResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevKeyRef = useRef<string>('');

  const load = useCallback(async (pk: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/epics-checks/data?projectKey=${encodeURIComponent(pk)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!projectKey) {
      setData(null);
      prevKeyRef.current = '';
      return;
    }
    if (projectKey === prevKeyRef.current) return;
    prevKeyRef.current = projectKey;
    load(projectKey);
  }, [projectKey, load]);

  const handleRefresh = useCallback(() => {
    if (!projectKey || isLoading) return;
    prevKeyRef.current = '';
    load(projectKey);
  }, [projectKey, isLoading, load]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header />
      <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}

        {!projectKey ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', color: 'text.secondary' }}>
            <Typography variant="h6" gutterBottom>Select a Project</Typography>
            <Typography variant="body2">Choose a JIRA project to check epic consistency</Typography>
          </Box>
        ) : isLoading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%' }}>
            <CircularProgress sx={{ mb: 2 }} />
            <Typography variant="h6" color="text.secondary">Loading Epic Data...</Typography>
          </Box>
        ) : data ? (
          <>
            <EpicCheckGrid
              title="Epics Not Started with Active Stories"
              description="These epics are not 'In Progress' but have stories that are not in backlog, resolved, or canceled — work is happening without the epic being started."
              items={data.notStartedWithActiveStories}
              emptyMessage="No issues found — all active stories have their epics in progress."
              storyColumnLabel="Active Stories"
            />
            <EpicCheckGrid
              title="In-Progress or Resolved Epics with Only Backlog Stories"
              description="These epics are marked 'In Progress' or 'Resolved' but every story is still in backlog — no actual work has been started or completed."
              items={data.inProgressWithOnlyBacklog}
              emptyMessage="No issues found — all in-progress or resolved epics have active stories."
              storyColumnLabel="Backlog Stories"
            />
          </>
        ) : null}
      </Box>

      <Tooltip title="Refresh data from JIRA">
        <span>
          <Fab
            color="primary"
            aria-label="refresh"
            onClick={handleRefresh}
            disabled={isLoading || !projectKey}
            sx={{ position: 'fixed', bottom: 24, right: 24 }}
          >
            {isLoading ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
          </Fab>
        </span>
      </Tooltip>
    </Box>
  );
};

const EpicsChecks = () => (
  <Suspense fallback={
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <CircularProgress />
    </Box>
  }>
    <EpicsChecksContent />
  </Suspense>
);

export default EpicsChecks;
