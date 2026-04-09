'use client';

import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Typography from '@mui/material/Typography';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { EpicStoryRow } from '@/shared/types';

// JIRA base URL from environment
const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

type SortField = 'key' | 'summary' | 'sprintName' | 'status' | 'storyPoints' | 'storyPointEstimate' | 'assignee';
type SortDirection = 'asc' | 'desc';

interface Column {
  field: SortField;
  label: string;
  width?: number | string;
}

const COLUMNS: Column[] = [
  { field: 'key', label: 'Key', width: 110 },
  { field: 'summary', label: 'Summary' },
  { field: 'sprintName', label: 'Sprint', width: 160 },
  { field: 'status', label: 'Status', width: 110 },
  { field: 'storyPoints', label: 'Story Points', width: 100 },
  { field: 'storyPointEstimate', label: 'SP Estimate', width: 100 },
  { field: 'assignee', label: 'Assignee', width: 150 },
];

const compareValues = (
  a: EpicStoryRow,
  b: EpicStoryRow,
  field: SortField,
  direction: SortDirection
): number => {
  const multiplier = direction === 'asc' ? 1 : -1;

  switch (field) {
    case 'key':
      return multiplier * a.key.localeCompare(b.key);
    case 'summary':
      return multiplier * a.summary.localeCompare(b.summary);
    case 'storyPoints': {
      const aVal = a.storyPoints ?? -1;
      const bVal = b.storyPoints ?? -1;
      return multiplier * (aVal - bVal);
    }
    case 'storyPointEstimate': {
      const aVal = a.storyPointEstimate ?? -1;
      const bVal = b.storyPointEstimate ?? -1;
      return multiplier * (aVal - bVal);
    }
    case 'sprintName':
      return multiplier * (a.sprintName ?? '').localeCompare(b.sprintName ?? '');
    case 'status':
      return multiplier * a.status.localeCompare(b.status);
    case 'assignee':
      return multiplier * (a.assignee ?? '').localeCompare(b.assignee ?? '');
    default:
      return 0;
  }
};

/**
 * Check if a status is canceled/cancelled (case-insensitive)
 */
const isCanceledStatus = (status: string): boolean => {
  const lower = status.toLowerCase();
  return lower === 'canceled' || lower === 'cancelled';
};

/**
 * Check if a status is resolved/done (case-insensitive)
 */
const isResolvedStatus = (status: string): boolean => {
  const lower = status.toLowerCase();
  return lower === 'resolved' || lower === 'done' || lower === 'closed';
};

/**
 * Color palette for pie chart slices (status-based).
 * Known statuses get fixed colors; others get assigned from a generic palette.
 */
const STATUS_COLORS: Record<string, string> = {
  'to do': '#90a4ae',
  'open': '#90a4ae',
  'backlog': '#b0bec5',
  'in progress': '#42a5f5',
  'in review': '#7e57c2',
  'in development': '#42a5f5',
  'resolved': '#66bb6a',
  'done': '#66bb6a',
  'closed': '#4caf50',
  'ready for test': '#ffa726',
  'testing': '#ffa726',
  'blocked': '#ef5350',
};

const FALLBACK_COLORS = [
  '#78909c', '#8d6e63', '#ff7043', '#26a69a', '#5c6bc0',
  '#ec407a', '#ab47bc', '#29b6f6', '#9ccc65', '#ffca28',
];

const getStatusColor = (status: string, fallbackIndex: number): string => {
  const lower = status.toLowerCase();
  return STATUS_COLORS[lower] ?? FALLBACK_COLORS[fallbackIndex % FALLBACK_COLORS.length];
};

/**
 * Pie chart data item
 */
interface PieSlice {
  status: string;
  points: number;
  color: string;
}

/**
 * SVG pie chart component for story points by status
 */
const PIE_SIZE = 200;
const PIE_RADIUS = 81;
const PIE_CENTER = PIE_SIZE / 2;

const StatusPieChart = ({ stories, epicStatus }: { stories: EpicStoryRow[]; epicStatus: string | null }) => {
  // Aggregate story points by status, excluding canceled
  const { slices, totalPoints } = useMemo(() => {
    const statusMap = new Map<string, number>();

    for (const story of stories) {
      if (isCanceledStatus(story.status)) continue;
      // Use effective points: storyPoints if available, else storyPointEstimate, else 0
      const pts = story.storyPoints ?? story.storyPointEstimate ?? 0;
      statusMap.set(story.status, (statusMap.get(story.status) ?? 0) + pts);
    }

    let fallbackIdx = 0;
    const result: PieSlice[] = [];
    let total = 0;

    for (const [status, points] of statusMap) {
      if (points <= 0) continue;
      result.push({
        status,
        points,
        color: getStatusColor(status, fallbackIdx++),
      });
      total += points;
    }

    // Sort by points descending for visual consistency
    result.sort((a, b) => b.points - a.points);

    return { slices: result, totalPoints: total };
  }, [stories]);

  // Compute resolved percentage (by story count, not points)
  const resolvedPercent = useMemo(() => {
    const nonCanceled = stories.filter((s) => !isCanceledStatus(s.status));
    if (nonCanceled.length === 0) return 0;
    const resolved = nonCanceled.filter((s) => isResolvedStatus(s.status));
    return Math.round((resolved.length / nonCanceled.length) * 100);
  }, [stories]);

  if (totalPoints === 0) {
    return (
      <Box sx={{ textAlign: 'center', p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          No story points to chart
        </Typography>
      </Box>
    );
  }

  // Build SVG arcs
  let currentAngle = -Math.PI / 2; // Start at top

  const arcs = slices.map((slice) => {
    const sliceAngle = (slice.points / totalPoints) * 2 * Math.PI;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

    // For a full circle (single status), use two arcs
    if (sliceAngle >= 2 * Math.PI - 0.001) {
      return {
        ...slice,
        path: `M ${PIE_CENTER} ${PIE_CENTER - PIE_RADIUS}
               A ${PIE_RADIUS} ${PIE_RADIUS} 0 1 1 ${PIE_CENTER} ${PIE_CENTER + PIE_RADIUS}
               A ${PIE_RADIUS} ${PIE_RADIUS} 0 1 1 ${PIE_CENTER} ${PIE_CENTER - PIE_RADIUS} Z`,
      };
    }

    const x1 = PIE_CENTER + PIE_RADIUS * Math.cos(startAngle);
    const y1 = PIE_CENTER + PIE_RADIUS * Math.sin(startAngle);
    const x2 = PIE_CENTER + PIE_RADIUS * Math.cos(endAngle);
    const y2 = PIE_CENTER + PIE_RADIUS * Math.sin(endAngle);
    const largeArc = sliceAngle > Math.PI ? 1 : 0;

    return {
      ...slice,
      path: `M ${PIE_CENTER} ${PIE_CENTER} L ${x1} ${y1} A ${PIE_RADIUS} ${PIE_RADIUS} 0 ${largeArc} 1 ${x2} ${y2} Z`,
    };
  });

  // Legend for pie chart
  const legendY = PIE_SIZE + 4;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: PIE_SIZE + 20 }}>
      {epicStatus && (
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.25 }}>
          Epic: {epicStatus}
        </Typography>
      )}
      <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 0.5 }}>
        {resolvedPercent}% Resolved
      </Typography>
      <svg width={PIE_SIZE} height={PIE_SIZE + slices.length * 18 + 8}>
        {/* Pie slices */}
        {arcs.map((arc) => (
          <path
            key={arc.status}
            d={arc.path}
            fill={arc.color}
            stroke="white"
            strokeWidth={1.5}
          >
            <title>{`${arc.status}: ${arc.points} pts`}</title>
          </path>
        ))}

        {/* Legend */}
        {slices.map((slice, idx) => (
          <g key={slice.status} transform={`translate(0, ${legendY + idx * 18})`}>
            <rect width={12} height={12} fill={slice.color} rx={2} />
            <text x={16} y={10} fontSize={11} fill="#333">
              {slice.status} ({slice.points})
            </text>
          </g>
        ))}
      </svg>
    </Box>
  );
};

interface EpicStoriesGridProps {
  stories: EpicStoryRow[];
  isLoading: boolean;
  epicKey: string | null;
  epicStatus: string | null;
}

const EpicStoriesGrid = ({ stories, isLoading, epicKey, epicStatus }: EpicStoriesGridProps) => {
  const [sortField, setSortField] = useState<SortField>('key');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedStories = useMemo(
    () => [...stories].sort((a, b) => compareValues(a, b, sortField, sortDirection)),
    [stories, sortField, sortDirection]
  );

  // No epic selected — show placeholder
  if (!epicKey && !isLoading) {
    return (
      <Paper sx={{ p: 3, m: 2, textAlign: 'center' }} elevation={1}>
        <Typography variant="body2" color="text.secondary">
          Select an epic to view its stories
        </Typography>
      </Paper>
    );
  }

  const isNoEpic = epicKey === '__NO_EPIC__';
  const displayEpicLabel = isNoEpic ? 'No Epic' : epicKey;

  // Loading state
  if (isLoading) {
    return (
      <Paper sx={{ p: 3, m: 2, textAlign: 'center' }} elevation={1}>
        <CircularProgress size={24} sx={{ mr: 1 }} />
        <Typography variant="body2" color="text.secondary" component="span">
          Loading stories for {displayEpicLabel}...
        </Typography>
      </Paper>
    );
  }

  // Epic selected but no stories
  if (epicKey && stories.length === 0) {
    return (
      <Paper sx={{ p: 3, m: 2, textAlign: 'center' }} elevation={1}>
        <Typography variant="body2" color="text.secondary">
          No stories found for {displayEpicLabel}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ m: 2, overflow: 'hidden' }} elevation={1}>
      <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" fontWeight="bold">
          Stories for {displayEpicLabel}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          ({stories.length} {stories.length === 1 ? 'story' : 'stories'})
        </Typography>
        {JIRA_BASE_URL && epicKey && !isNoEpic && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<OpenInNewIcon />}
            onClick={() => window.open(`${JIRA_BASE_URL}/browse/${epicKey}`, '_blank')}
            sx={{ ml: 'auto' }}
          >
            Open in Jira
          </Button>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 2 }}>
        {/* Table */}
        <TableContainer sx={{ maxHeight: 400, flexGrow: 1 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {COLUMNS.map((col) => (
                  <TableCell
                    key={col.field}
                    sx={{
                      fontWeight: 'bold',
                      bgcolor: 'grey.100',
                      fontSize: 12,
                      width: col.width,
                    }}
                    sortDirection={sortField === col.field ? sortDirection : false}
                  >
                    <TableSortLabel
                      active={sortField === col.field}
                      direction={sortField === col.field ? sortDirection : 'asc'}
                      onClick={() => handleSort(col.field)}
                    >
                      {col.label}
                    </TableSortLabel>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedStories.map((story) => {
                const ticketUrl = JIRA_BASE_URL
                  ? `${JIRA_BASE_URL}/browse/${story.key}`
                  : null;

                return (
                  <TableRow key={story.key} hover>
                    <TableCell sx={{ fontSize: 12 }}>
                      {ticketUrl ? (
                        <Link
                          href={ticketUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{ fontWeight: 500, fontSize: 12 }}
                        >
                          {story.key}
                        </Link>
                      ) : (
                        <Typography variant="body2" fontWeight={500} sx={{ fontSize: 12 }}>
                          {story.key}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      {story.summary}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      {story.sprintName ?? '—'}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      {story.status}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      {story.storyPoints !== null ? story.storyPoints : '—'}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      {story.storyPointEstimate !== null ? story.storyPointEstimate : '—'}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      {story.assignee ?? '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Pie chart */}
        <Box sx={{ pr: 2, py: 1, flexShrink: 0 }}>
          <StatusPieChart stories={stories} epicStatus={epicStatus} />
        </Box>
      </Box>
    </Paper>
  );
};

export default EpicStoriesGrid;
