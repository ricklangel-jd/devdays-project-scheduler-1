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
import type { EffortEpic } from '@/shared/types';

interface NoStoriesEpicListProps {
  epics: EffortEpic[];
  jiraBaseUrl: string | undefined;
  teamNames: Record<string, string>;
  initiativeNames: Record<string, string>;
}

type SortField = 'key' | 'summary' | 'initiativeKey' | 'team' | 'status' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

const updatedAtTime = (e: EffortEpic): number => {
  if (!e.updatedAt) return 0;
  const t = Date.parse(e.updatedAt);
  return Number.isNaN(t) ? 0 : t;
};

const formatUpdatedAt = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
};

const compareEpics = (
  a: EffortEpic,
  b: EffortEpic,
  field: SortField,
  direction: SortDirection,
  teamNames: Record<string, string>,
  initiativeNames: Record<string, string>
): number => {
  const mul = direction === 'asc' ? 1 : -1;
  switch (field) {
    case 'key':
      return mul * a.key.localeCompare(b.key);
    case 'summary':
      return mul * a.summary.localeCompare(b.summary);
    case 'initiativeKey':
      return (
        mul *
        (initiativeNames[a.initiativeKey] ?? a.initiativeKey).localeCompare(
          initiativeNames[b.initiativeKey] ?? b.initiativeKey
        )
      );
    case 'team':
      return mul * (teamNames[a.team] ?? a.team).localeCompare(teamNames[b.team] ?? b.team);
    case 'status':
      return mul * a.status.localeCompare(b.status);
    case 'updatedAt':
      return mul * (updatedAtTime(a) - updatedAtTime(b));
    default:
      return 0;
  }
};

const NoStoriesEpicList = ({
  epics,
  jiraBaseUrl,
  teamNames,
  initiativeNames,
}: NoStoriesEpicListProps) => {
  const [sortField, setSortField] = useState<SortField>('key');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const emptyEpics = useMemo(
    () => epics.filter((e) => e.stories.length === 0),
    [epics]
  );

  const sortedEpics = useMemo(
    () =>
      [...emptyEpics].sort((a, b) =>
        compareEpics(a, b, sortField, sortDirection, teamNames, initiativeNames)
      ),
    [emptyEpics, sortField, sortDirection, teamNames, initiativeNames]
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  if (emptyEpics.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Every loaded epic has at least one non-canceled story.
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

  const headerCell = (field: SortField, label: string) => (
    <TableCell
      sx={headerSx}
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
            {headerCell('key', 'Epic')}
            {headerCell('summary', 'Summary')}
            {headerCell('initiativeKey', 'Initiative')}
            {headerCell('team', 'Team')}
            {headerCell('status', 'Status')}
            {headerCell('updatedAt', 'Last Changed')}
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedEpics.map((e) => {
            const keyCell = jiraBaseUrl ? (
              <Link href={`${jiraBaseUrl}/browse/${e.key}`} target="_blank" rel="noopener">
                {e.key}
              </Link>
            ) : (
              e.key
            );
            return (
              <TableRow key={e.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                <TableCell sx={colSx}>{keyCell}</TableCell>
                <TableCell sx={colSx}>{e.summary}</TableCell>
                <TableCell
                  sx={colSx}
                  title={initiativeNames[e.initiativeKey] ? e.initiativeKey : undefined}
                >
                  {initiativeNames[e.initiativeKey] ?? e.initiativeKey}
                </TableCell>
                <TableCell sx={colSx} title={teamNames[e.team] ? e.team : undefined}>
                  {teamNames[e.team] ?? e.team}
                </TableCell>
                <TableCell sx={colSx}>{e.status}</TableCell>
                <TableCell sx={colSx}>{formatUpdatedAt(e.updatedAt)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default NoStoriesEpicList;
