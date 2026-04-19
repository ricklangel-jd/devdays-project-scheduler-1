'use client';

import { useMemo, useState } from 'react';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { TSHIRT_SIZES, type EffortStory, type TshirtSize } from '@/shared/types';
import { colorForSize } from './sizeColors';

interface EffortStoriesGridProps {
  stories: EffortStory[];
  jiraBaseUrl: string | undefined;
}

type SortField = 'key' | 'summary' | 'epicKey' | 'status' | 'assignee' | 'size';
type SortDirection = 'asc' | 'desc';

const sizeIndex = (s: TshirtSize): number => TSHIRT_SIZES.indexOf(s);

const compareStories = (
  a: EffortStory,
  b: EffortStory,
  field: SortField,
  direction: SortDirection
): number => {
  const mul = direction === 'asc' ? 1 : -1;
  switch (field) {
    case 'key':
      return mul * a.key.localeCompare(b.key);
    case 'summary':
      return mul * a.summary.localeCompare(b.summary);
    case 'epicKey':
      return mul * a.epicKey.localeCompare(b.epicKey);
    case 'status':
      return mul * a.status.localeCompare(b.status);
    case 'assignee':
      return mul * (a.assignee ?? '').localeCompare(b.assignee ?? '');
    case 'size':
      return mul * (sizeIndex(a.size) - sizeIndex(b.size));
    default:
      return 0;
  }
};

const SizeChip = ({ size }: { size: TshirtSize }) => (
  <Box
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 28,
      px: 0.75,
      py: 0.25,
      borderRadius: 0.5,
      fontSize: '0.75rem',
      fontWeight: 600,
      bgcolor: colorForSize(size),
      color: size === 'None' ? 'text.primary' : 'white',
    }}
  >
    {size}
  </Box>
);

const EffortStoriesGrid = ({ stories, jiraBaseUrl }: EffortStoriesGridProps) => {
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
    () => [...stories].sort((a, b) => compareStories(a, b, sortField, sortDirection)),
    [stories, sortField, sortDirection]
  );

  if (stories.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No stories to display.
        </Typography>
      </Paper>
    );
  }

  const colSx = { fontSize: '0.8rem', py: 0.75, px: 1.5 };
  const headerSx = {
    ...colSx,
    fontWeight: 700,
    bgcolor: 'grey.100',
    whiteSpace: 'nowrap' as const,
  };

  const headerCell = (
    field: SortField,
    label: string,
    extraSx: Record<string, unknown> = {}
  ) => (
    <TableCell
      sx={{ ...headerSx, ...extraSx }}
      sortDirection={sortField === field ? sortDirection : false}
    >
      <TableSortLabel
        active={sortField === field}
        direction={sortField === field ? sortDirection : 'asc'}
        onClick={() => handleSort(field)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <TableContainer component={Paper} elevation={1} sx={{ maxHeight: '100%' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {headerCell('key', 'Story')}
            {headerCell('summary', 'Summary')}
            {headerCell('epicKey', 'Epic')}
            {headerCell('status', 'Status')}
            {headerCell('assignee', 'Assignee')}
            {headerCell('size', 'Size', { textAlign: 'center' })}
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedStories.map((s) => {
            const keyCell = jiraBaseUrl ? (
              <Link href={`${jiraBaseUrl}/browse/${s.key}`} target="_blank" rel="noopener">
                {s.key}
              </Link>
            ) : (
              s.key
            );
            return (
              <TableRow key={s.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                <TableCell sx={colSx}>{keyCell}</TableCell>
                <TableCell sx={colSx}>{s.summary}</TableCell>
                <TableCell sx={colSx}>{s.epicKey}</TableCell>
                <TableCell sx={colSx}>{s.status}</TableCell>
                <TableCell sx={colSx}>{s.assignee ?? '—'}</TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'center' }}>
                  <SizeChip size={s.size} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default EffortStoriesGrid;
