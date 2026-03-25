'use client';

import React, { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Paper from '@mui/material/Paper';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import { Header, Sidebar, MainContent } from '@/frontend/components';
import { SprintPlanningSidebarContent } from '@/frontend/components/sidebar';
import { useAppState } from '@/frontend/hooks';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { PointingAccuracyRow, PointingAccuracyResponse } from '@/app/api/pointing-accuracy/data/route';

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

type PointingCategory =
  | 'Overpointed >= 20%'
  | 'Overpointed >= 10%'
  | 'Accurately Pointed'
  | 'Underpointed >= 0%'
  | 'Underpointed >= 20%';

// Color for each category — yellow (overpointed) → neutral → red (underpointed)
const CATEGORY_COLOR: Record<PointingCategory, string> = {
  'Overpointed >= 20%':  '#FFF176', // yellow
  'Overpointed >= 10%':  '#FFF9C4', // light yellow
  'Accurately Pointed':  '#F1F8E9', // very light green (near-parity neutral)
  'Underpointed >= 0%':  '#FFE0B2', // light orange
  'Underpointed >= 20%': '#FFCDD2', // light red
};

// Symmetric % difference: (SP − DevDays) / ((SP + DevDays) / 2) × 100
// Positive → SP higher (Overpointed), Negative → DevDays higher (Underpointed).
// Symmetric so +20 and −20 represent equal distances from parity.
//
// Thresholds (symPct):
//  >= 20  → Overpointed >= 20%
//  >= 10  → Overpointed >= 10%
//  > -10  → Accurately Pointed   (within ±10% of parity)
//  >= -20 → Underpointed >= 0%   (DevDays moderately higher)
//  <  -20 → Underpointed >= 20%
const symPct = (points: number, devDays: number): number =>
  ((points - devDays) / ((points + devDays) / 2)) * 100;

const getCategory = (points: number, devDays: number): PointingCategory => {
  if (devDays === 0 && points === 0) return 'Accurately Pointed';
  if (devDays === 0) return 'Overpointed >= 20%';  // pointed, no time logged
  if (points === 0)  return 'Underpointed >= 20%'; // time logged, not pointed
  // Small stories (0.5 or 1 pt) with ≤1 dev day logged are considered accurately pointed
  if ((points === 0.5 || points === 1) && devDays <= 1) return 'Accurately Pointed';
  const p = symPct(points, devDays);
  if (p >= 20)  return 'Overpointed >= 20%';
  if (p >= 10)  return 'Overpointed >= 10%';
  if (p > -10)  return 'Accurately Pointed';
  if (p >= -20) return 'Underpointed >= 0%';
  return 'Underpointed >= 20%';
};

const getCategoryPct = (points: number, devDays: number): string => {
  if (devDays === 0 && points === 0) return 'No points or time logged';
  if (devDays === 0) return 'No time logged — cannot calculate %';
  if (points === 0)  return 'No story points — Dev Days logged with no estimate';
  const p = Math.round(symPct(points, devDays) * 10) / 10;
  if (p > 0) return `Overpointed by ${p}% (symmetric)`;
  if (p < 0) return `Underpointed by ${Math.abs(p)}% (symmetric)`;
  return 'SP equals Dev Days exactly';
};

type SortField = 'key' | 'summary' | 'points' | 'hoursLogged' | 'devDaysLogged' | 'issueType' | 'category';
type SortDir = 'asc' | 'desc';

const CATEGORY_ORDER: PointingCategory[] = [
  'Overpointed >= 20%',
  'Overpointed >= 10%',
  'Accurately Pointed',
  'Underpointed >= 0%',
  'Underpointed >= 20%',
];

// ── Collapsible legend ────────────────────────────────────────────────
const LegendPanel = () => {
  const [open, setOpen] = React.useState(false);
  return (
    <Paper elevation={1} sx={{ px: 1.5, py: 0.75, bgcolor: 'grey.50', flexShrink: 0, maxWidth: 420 }}>
      <Box
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen((v) => !v)}
      >
        <Typography variant="caption" fontWeight={700}>How Over/Under Pointing Is Calculated</Typography>
        <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>{open ? '▲' : '▼'}</Typography>
      </Box>
      {open && (
        <Box sx={{ mt: 0.75 }}>
          <Typography variant="caption" component="div" color="text.secondary" sx={{ lineHeight: 1.65 }}>
            <b>Formula (symmetric %):</b><br />
            <Box component="span" sx={{ fontFamily: 'monospace', display: 'block', my: 0.5, pl: 1 }}>
              (SP − Dev Days) ÷ ((SP + Dev Days) ÷ 2) × 100
            </Box>
            Positive = Overpointed (SP higher), Negative = Underpointed (Dev Days higher).
            Using the average of both values as the denominator makes +20% and −20% equal distances from parity.
          </Typography>
          <Typography variant="caption" component="div" color="text.secondary" sx={{ lineHeight: 1.65, mt: 0.75 }}>
            <b>Categories:</b>
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 0.25 }}>
            {(Object.entries(CATEGORY_COLOR) as [PointingCategory, string][]).map(([label, bg]) => (
              <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Box sx={{ width: 12, height: 12, bgcolor: bg, border: '1px solid #ccc', borderRadius: 0.5, flexShrink: 0 }} />
                <Typography variant="caption" color="text.secondary">
                  <b>{label}</b>
                  {label === 'Overpointed >= 20%'  && ' — symmetric % ≥ 20'}
                  {label === 'Overpointed >= 10%'  && ' — symmetric % 10–19.9'}
                  {label === 'Accurately Pointed'  && ' — symmetric % within ±10 (or SP ≤ 1 pt with ≤ 1 dev day)'}
                  {label === 'Underpointed >= 0%'  && ' — symmetric % −10 to −19.9'}
                  {label === 'Underpointed >= 20%' && ' — symmetric % ≤ −20'}
                </Typography>
              </Box>
            ))}
          </Box>
          <Typography variant="caption" component="div" color="text.secondary" sx={{ mt: 0.75, lineHeight: 1.65 }}>
            <b>Hover</b> the Story Points cell on any row to see that story's exact symmetric %.
          </Typography>
        </Box>
      )}
    </Paper>
  );
};

const PointingAccuracyContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => { searchParamsRef.current = searchParams; });

  const { projectKey, sidebarCollapsed, setSidebarCollapsed } = useAppState();
  const boardParam = searchParams.get(QUERY_PARAM_KEYS.BOARD);
  const boardId = boardParam ? parseInt(boardParam, 10) || undefined : undefined;

  const sprintParam = searchParams.get(QUERY_PARAM_KEYS.PA_SPRINT);
  const selectedSprintId = sprintParam ? parseInt(sprintParam, 10) || null : null;

  const [connectionStatus, setConnectionStatus] = useState({ connected: false, email: undefined as string | undefined });
  const [data, setData] = useState<PointingAccuracyResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('key');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Connection check
  useEffect(() => {
    fetch('/api/auth/validate')
      .then((r) => r.json())
      .then((d) => setConnectionStatus({ connected: d.valid, email: d.email }))
      .catch(() => setConnectionStatus({ connected: false, email: undefined }));
  }, []);

  // Update URL when sprint selection changes
  const handleSprintChange = useCallback((sprintId: number) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    params.set(QUERY_PARAM_KEYS.PA_SPRINT, sprintId.toString());
    router.push(`?${params.toString()}`, { scroll: false });
  }, [router]);

  // Fetch data when sprintId or boardId changes
  const prevFetchKey = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedSprintId || !boardId) {
      setData(null);
      setError(null);
      prevFetchKey.current = null;
      return;
    }

    const fetchKey = `${selectedSprintId}-${boardId}`;
    if (prevFetchKey.current === fetchKey) return;
    prevFetchKey.current = fetchKey;

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setData(null);

    const params = new URLSearchParams({ sprintId: selectedSprintId.toString(), boardId: boardId.toString() });
    fetch(`/api/pointing-accuracy/data?${params}`)
      .then((r) => r.json())
      .then((d: PointingAccuracyResponse & { error?: string }) => {
        if (cancelled) return;
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message ?? 'Failed to load data');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedSprintId, boardId]);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return field;
    });
  }, []);

  const sortedRows = useMemo((): PointingAccuracyRow[] => {
    if (!data) return [];
    const rows = [...data.rows];
    rows.sort((a, b) => {
      const mult = sortDir === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'key': return mult * a.key.localeCompare(b.key);
        case 'summary': return mult * a.summary.localeCompare(b.summary);
        case 'issueType': return mult * a.issueType.localeCompare(b.issueType);
        case 'points': return mult * (a.points - b.points);
        case 'hoursLogged': return mult * (a.hoursLogged - b.hoursLogged);
        case 'devDaysLogged': return mult * (a.devDaysLogged - b.devDaysLogged);
        case 'category': {
          const ai = CATEGORY_ORDER.indexOf(getCategory(a.points, a.devDaysLogged));
          const bi = CATEGORY_ORDER.indexOf(getCategory(b.points, b.devDaysLogged));
          return mult * (ai - bi);
        }
        default: return 0;
      }
    });
    return rows;
  }, [data, sortField, sortDir]);

  const headerCellSx = { fontWeight: 700, whiteSpace: 'nowrap', bgcolor: 'grey.100' };
  const cellSx = { py: 0.5 };

  const SortHeader = ({ field, label, align }: { field: SortField; label: string; align?: 'left' | 'right' }) => (
    <TableCell sx={{ ...headerCellSx, textAlign: align ?? 'left' }}>
      <TableSortLabel
        active={sortField === field}
        direction={sortField === field ? sortDir : 'asc'}
        onClick={() => handleSort(field)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header connectionStatus={connectionStatus} />
      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed}>
          <SprintPlanningSidebarContent
            boardId={boardId}
            projectKey={projectKey}
            selectedSprintId={selectedSprintId}
            isLoading={isLoading}
            onSprintChange={handleSprintChange}
          />
        </Sidebar>
        <MainContent>
          {error && (
            <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>
          )}
          {isLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 3 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">Loading sprint stories…</Typography>
            </Box>
          )}
          {!boardId && !isLoading && (
            <Box sx={{ p: 3 }}>
              <Typography variant="body2" color="text.secondary">
                Select a project and board, then choose a sprint.
              </Typography>
            </Box>
          )}
          {data && (() => {
            const totalPoints = data.rows.reduce((s, r) => s + r.points, 0);
            const totalDevDays = Math.round(data.rows.reduce((s, r) => s + r.devDaysLogged, 0) * 100) / 100;
            // Symmetric %: (SP − DevDays) / ((SP + DevDays) / 2) × 100
            const pctDiff = (totalPoints === 0 && totalDevDays === 0)
              ? null
              : Math.round(symPct(totalPoints, totalDevDays) * 10) / 10;
            const pctLabel = pctDiff === null
              ? 'N/A (no time logged)'
              : pctDiff > 0
                ? `Overpointed ${pctDiff}%`
                : pctDiff < 0
                  ? `Underpointed ${Math.abs(pctDiff)}%`
                  : 'Accurately Pointed';
            const pctColor = pctDiff === null ? 'text.secondary'
              : pctDiff > 0  ? 'warning.dark'
              : pctDiff < 0  ? 'error.main'
              : 'success.main';

            return (
            <Box sx={{ overflow: 'auto', height: '100%', p: 1.5 }}>
              {/* Title row + legend toggle */}
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle1" fontWeight={700}>
                  {data.sprintName}
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1.5 }}>
                    {sortedRows.length} issue{sortedRows.length !== 1 ? 's' : ''}
                  </Typography>
                </Typography>
                <LegendPanel />
              </Box>
              {/* Summary bar */}
              <Box sx={{ display: 'flex', gap: 3, mb: 1.5, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Total Story Points</Typography>
                  <Typography variant="h6" fontWeight={700} lineHeight={1.2}>{totalPoints}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Total Dev Days Logged</Typography>
                  <Typography variant="h6" fontWeight={700} lineHeight={1.2}>{totalDevDays}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Overall</Typography>
                  <Typography variant="h6" fontWeight={700} lineHeight={1.2} color={pctColor}>
                    {pctLabel}
                  </Typography>
                </Box>
              </Box>
              <Paper elevation={1}>
                <TableContainer>
                  <Table size="small" sx={{ tableLayout: 'auto' }}>
                    <TableHead>
                      <TableRow>
                        <SortHeader field="key" label="Key" />
                        <SortHeader field="issueType" label="Type" />
                        <SortHeader field="summary" label="Summary" />
                        <SortHeader field="points" label="Story Points" align="right" />
                        <SortHeader field="hoursLogged" label="Hours Logged" align="right" />
                        <SortHeader field="devDaysLogged" label="DevDays Logged" align="right" />
                        <SortHeader field="category" label="Category" />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedRows.map((row) => {
                        const category = getCategory(row.points, row.devDaysLogged);
                        const categoryBg = CATEGORY_COLOR[category];
                        return (
                        <TableRow key={row.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                          <TableCell sx={{ ...cellSx, whiteSpace: 'nowrap' }}>
                            {JIRA_BASE_URL ? (
                              <Link
                                href={`${JIRA_BASE_URL}/browse/${row.key}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                underline="hover"
                                sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                              >
                                {row.key}
                              </Link>
                            ) : (
                              <Typography sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{row.key}</Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ ...cellSx, color: 'text.secondary', fontSize: '0.75rem' }}>
                            {row.issueType}
                          </TableCell>
                          <TableCell sx={{ ...cellSx, maxWidth: 480 }}>
                            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {row.summary}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ ...cellSx, textAlign: 'right', fontWeight: 600, bgcolor: categoryBg }}>
                            <Tooltip title={getCategoryPct(row.points, row.devDaysLogged)} placement="top" arrow>
                              <span>{row.points === 0 ? '—' : row.points}</span>
                            </Tooltip>
                          </TableCell>
                          <TableCell sx={{ ...cellSx, textAlign: 'right' }}>
                            {row.hoursLogged === 0 ? '—' : row.hoursLogged}
                          </TableCell>
                          <TableCell sx={{ ...cellSx, textAlign: 'right' }}>
                            {row.devDaysLogged === 0 ? '—' : row.devDaysLogged}
                          </TableCell>
                          <TableCell sx={{ ...cellSx, fontSize: '0.75rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                            {category}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                      {sortedRows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>
                            No issues found in this sprint.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </Box>
            );
          })()}
        </MainContent>
      </Box>
    </Box>
  );
};

const PointingAccuracyPage = () => (
  <Suspense fallback={<CircularProgress />}>
    <PointingAccuracyContent />
  </Suspense>
);

export default PointingAccuracyPage;
