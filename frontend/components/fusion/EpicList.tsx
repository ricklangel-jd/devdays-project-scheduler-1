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
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import type { FusionEpic } from '@/shared/types';

interface EpicListProps {
  epics: FusionEpic[];
  jiraBaseUrl: string | undefined;
}

type SortField =
  | 'key'
  | 'summary'
  | 'initiativeKey'
  | 'linkedVia'
  | 'team'
  | 'status'
  | 'totalPoints'
  | 'percentComplete'
  | 'updatedAt';
type SortDirection = 'asc' | 'desc';

const pctColor = (pct: number) => {
  if (pct >= 80) return 'success';
  if (pct >= 40) return 'primary';
  return 'warning';
};

const percentOf = (e: FusionEpic): number =>
  e.totalPoints === 0 ? 0 : (e.donePoints / e.totalPoints) * 100;

const linkedViaSortKey = (e: FusionEpic): string =>
  e.linkedVia?.[0]?.epicKey ?? '';

// JIRA "updated" is ISO with timezone; Date.parse handles it, falls back to 0 for null/invalid
const updatedAtTime = (e: FusionEpic): number => {
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
  a: FusionEpic,
  b: FusionEpic,
  field: SortField,
  direction: SortDirection
): number => {
  const mul = direction === 'asc' ? 1 : -1;
  switch (field) {
    case 'key':
      return mul * a.key.localeCompare(b.key);
    case 'summary':
      return mul * a.summary.localeCompare(b.summary);
    case 'initiativeKey':
      return mul * a.initiativeKey.localeCompare(b.initiativeKey);
    case 'linkedVia':
      return mul * linkedViaSortKey(a).localeCompare(linkedViaSortKey(b));
    case 'team':
      return mul * a.team.localeCompare(b.team);
    case 'status':
      return mul * a.status.localeCompare(b.status);
    case 'totalPoints':
      return mul * (a.totalPoints - b.totalPoints);
    case 'percentComplete':
      return mul * (percentOf(a) - percentOf(b));
    case 'updatedAt':
      return mul * (updatedAtTime(a) - updatedAtTime(b));
    default:
      return 0;
  }
};

const EpicList = ({ epics, jiraBaseUrl }: EpicListProps) => {
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

  const sortedEpics = useMemo(
    () => [...epics].sort((a, b) => compareEpics(a, b, sortField, sortDirection)),
    [epics, sortField, sortDirection]
  );

  if (epics.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No epics to display.
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
            {headerCell('key', 'Epic')}
            {headerCell('summary', 'Summary')}
            {headerCell('initiativeKey', 'Initiative')}
            {headerCell('linkedVia', 'Linked To')}
            {headerCell('team', 'Team')}
            {headerCell('status', 'Status')}
            {headerCell('totalPoints', 'Total Points', { textAlign: 'right' })}
            {headerCell('percentComplete', '% Complete', { minWidth: 180 })}
            {headerCell('updatedAt', 'Last Changed')}
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedEpics.map((e) => {
            const pct = Math.round(percentOf(e));
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
                <TableCell sx={colSx}>{e.initiativeKey}</TableCell>
                <TableCell sx={colSx}>
                  {e.linkedVia && e.linkedVia.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                      {e.linkedVia.map((l) => {
                        const label = `${l.epicKey} (${l.linkType})`;
                        return jiraBaseUrl ? (
                          <Link
                            key={`${l.epicKey}-${l.linkType}`}
                            href={`${jiraBaseUrl}/browse/${l.epicKey}`}
                            target="_blank"
                            rel="noopener"
                            sx={{ fontSize: '0.8rem' }}
                          >
                            {label}
                          </Link>
                        ) : (
                          <Typography
                            key={`${l.epicKey}-${l.linkType}`}
                            variant="caption"
                            component="span"
                          >
                            {label}
                          </Typography>
                        );
                      })}
                    </Box>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell sx={colSx}>{e.team}</TableCell>
                <TableCell sx={colSx}>{e.status}</TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right' }}>{Math.round(e.totalPoints)}</TableCell>
                <TableCell sx={colSx}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ flex: 1 }}>
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        color={pctColor(pct)}
                        sx={{ height: 8, borderRadius: 4 }}
                      />
                    </Box>
                    <Typography
                      variant="caption"
                      fontWeight={600}
                      sx={{ minWidth: 36, textAlign: 'right' }}
                    >
                      {pct}%
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell sx={colSx}>{formatUpdatedAt(e.updatedAt)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default EpicList;
