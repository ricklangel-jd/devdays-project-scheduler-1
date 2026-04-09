'use client';

import { Suspense, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import CircularProgress from '@mui/material/CircularProgress';
import TableSortLabel from '@mui/material/TableSortLabel';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Autocomplete from '@mui/material/Autocomplete';
import { Header } from '@/frontend/components';
import type { InitiativeEpic, InitiativeStory, InitiativeStatusResponse } from '@/app/api/initiative-status/data/route';

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

// ── Status colours ────────────────────────────────────────────────────

const STATUS_PALETTE = [
  '#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#0288d1',
  '#d32f2f', '#00796b', '#c2185b', '#512da8', '#1565c0',
  '#f57c00', '#388e3c', '#0097a7', '#ad1457', '#283593',
];

// ── Pie chart ─────────────────────────────────────────────────────────

const PIE_SIZE = 260;
const PIE_RADIUS = 100;
const PIE_CENTER = PIE_SIZE / 2;

interface PieSlice {
  status: string;
  count: number;
  color: string;
  startAngle: number;
  endAngle: number;
  pathD: string;
}

function buildPieSlices(statusCounts: Map<string, number>): PieSlice[] {
  const total = Array.from(statusCounts.values()).reduce((s, v) => s + v, 0);
  if (total === 0) return [];

  const entries = Array.from(statusCounts.entries());
  const slices: PieSlice[] = [];
  let cursor = -Math.PI / 2;

  entries.forEach(([status, count], idx) => {
    const angle = (count / total) * 2 * Math.PI;
    const startAngle = cursor;
    const endAngle = cursor + angle;
    const color = STATUS_PALETTE[idx % STATUS_PALETTE.length];

    let pathD: string;
    if (entries.length === 1) {
      // Full circle — arc path degenerates, use two half-arcs
      const top = `${PIE_CENTER} ${PIE_CENTER - PIE_RADIUS}`;
      const bottom = `${PIE_CENTER} ${PIE_CENTER + PIE_RADIUS}`;
      pathD = `M ${top} A ${PIE_RADIUS} ${PIE_RADIUS} 0 1 1 ${bottom} A ${PIE_RADIUS} ${PIE_RADIUS} 0 1 1 ${top} Z`;
    } else {
      const x1 = PIE_CENTER + PIE_RADIUS * Math.cos(startAngle);
      const y1 = PIE_CENTER + PIE_RADIUS * Math.sin(startAngle);
      const x2 = PIE_CENTER + PIE_RADIUS * Math.cos(endAngle);
      const y2 = PIE_CENTER + PIE_RADIUS * Math.sin(endAngle);
      const largeArc = angle > Math.PI ? 1 : 0;
      pathD = `M ${PIE_CENTER} ${PIE_CENTER} L ${x1} ${y1} A ${PIE_RADIUS} ${PIE_RADIUS} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    }

    slices.push({ status, count, color, startAngle, endAngle, pathD });
    cursor = endAngle;
  });

  return slices;
}

interface StatusPieProps {
  slices: PieSlice[];
  selectedStatus: string | null;
  onSliceClick: (status: string) => void;
}

const StatusPie = ({ slices, selectedStatus, onSliceClick }: StatusPieProps) => (
  <svg width={PIE_SIZE} height={PIE_SIZE} style={{ display: 'block' }}>
    {slices.map((slice) => {
      const isSelected = selectedStatus === slice.status;
      const isDimmed = selectedStatus !== null && !isSelected;
      let transform = '';
      if (isSelected && slices.length > 1) {
        const mid = (slice.startAngle + slice.endAngle) / 2;
        transform = `translate(${8 * Math.cos(mid)}, ${8 * Math.sin(mid)})`;
      }
      const mid = (slice.startAngle + slice.endAngle) / 2;
      const labelR = PIE_RADIUS * 0.65;
      const lx = PIE_CENTER + labelR * Math.cos(mid);
      const ly = PIE_CENTER + labelR * Math.sin(mid);
      const sliceAngle = slice.endAngle - slice.startAngle;

      return (
        <g
          key={slice.status}
          onClick={() => onSliceClick(slice.status)}
          style={{ cursor: 'pointer' }}
          transform={transform}
        >
          <path
            d={slice.pathD}
            fill={slice.color}
            stroke="white"
            strokeWidth={2}
            opacity={isDimmed ? 0.3 : 1}
            style={{ transition: 'opacity 0.2s ease' }}
          />
          {sliceAngle > 0.2 && (
            <text
              x={lx}
              y={ly + 4}
              textAnchor="middle"
              fontSize={13}
              fontWeight="bold"
              fill="white"
              style={{ pointerEvents: 'none' }}
            >
              {slice.count}
            </text>
          )}
        </g>
      );
    })}
  </svg>
);

// ── Compact cell styles ───────────────────────────────────────────────

const headerCellSx = {
  fontSize: '0.75rem',
  py: 0.5,
  px: 1,
  fontWeight: 700,
  bgcolor: 'grey.100',
  whiteSpace: 'nowrap' as const,
};

const cellSx = {
  fontSize: '0.75rem',
  py: 0.25,
  px: 1,
  lineHeight: 1.3,
};

// ── Date formatting ───────────────────────────────────────────────────

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
};

// ── Epic grid ─────────────────────────────────────────────────────────

type EpicSortCol = 'key' | 'summary' | 'assignee' | 'project' | 'status' | 'statusCategoryChangedDate' | 'parent';
type SortDir = 'asc' | 'desc';

interface EpicGridProps {
  epics: InitiativeEpic[];
  statusColor: string;
}

const EpicGrid = ({ epics, statusColor }: EpicGridProps) => {
  const [sortCol, setSortCol] = useState<EpicSortCol>('summary');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  const projects = useMemo(() =>
    [...new Set(epics.map((e) => e.project))].sort(),
  [epics]);

  const handleSort = (col: EpicSortCol) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  };

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const rows = projectFilter ? epics.filter((e) => e.project === projectFilter) : epics;
    return [...rows].sort((a, b) => {
      if (sortCol === 'statusCategoryChangedDate')
        return (a.statusCategoryChangedDate ?? '').localeCompare(b.statusCategoryChangedDate ?? '') * dir;
      if (sortCol === 'parent')
        return (a.parent?.key ?? '').localeCompare(b.parent?.key ?? '') * dir;
      return (a[sortCol] ?? '').toLowerCase().localeCompare((b[sortCol] ?? '').toLowerCase()) * dir;
    });
  }, [epics, sortCol, sortDir, projectFilter]);

  const SortHeader = ({ col, label, width }: { col: EpicSortCol; label: string; width?: number }) => (
    <TableCell sx={{ ...headerCellSx, ...(width ? { width } : {}), borderTop: `3px solid ${statusColor}` }}>
      <TableSortLabel active={sortCol === col} direction={sortCol === col ? sortDir : 'asc'} onClick={() => handleSort(col)} sx={{ fontSize: 'inherit' }}>
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Autocomplete
        options={projects}
        value={projectFilter}
        onChange={(_e, v) => setProjectFilter(v)}
        size="small"
        sx={{ width: 260 }}
        renderInput={(params) => <TextField {...params} label="Filter by project" placeholder="All projects" size="small" />}
      />
      <TableContainer component={Paper} elevation={1} sx={{ maxHeight: PIE_SIZE, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <SortHeader col="key" label="Key" width={110} />
              <SortHeader col="summary" label="Summary" />
              <SortHeader col="project" label="Project" width={140} />
              <SortHeader col="status" label="Status" width={120} />
              <SortHeader col="assignee" label="Assignee" width={140} />
              <SortHeader col="statusCategoryChangedDate" label="Status Changed" width={130} />
              <SortHeader col="parent" label="Parent" width={160} />
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((epic) => (
              <TableRow key={epic.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                <TableCell sx={cellSx}>
                  {JIRA_BASE_URL ? (
                    <Link href={`${JIRA_BASE_URL}/browse/${epic.key}`} target="_blank" rel="noopener" underline="hover" sx={{ fontSize: 'inherit', fontFamily: 'monospace', fontWeight: 500 }}>
                      {epic.key}
                    </Link>
                  ) : (
                    <Typography sx={{ fontSize: 'inherit', fontFamily: 'monospace', fontWeight: 500 }}>{epic.key}</Typography>
                  )}
                </TableCell>
                <TableCell sx={{ ...cellSx, maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {epic.summary}
                </TableCell>
                <TableCell sx={cellSx}>{epic.project}</TableCell>
                <TableCell sx={cellSx}>{epic.status}</TableCell>
                <TableCell sx={cellSx}>{epic.assignee ?? '—'}</TableCell>
                <TableCell sx={cellSx}>{formatDate(epic.statusCategoryChangedDate)}</TableCell>
                <TableCell sx={{ ...cellSx, maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {epic.parent ? `${epic.parent.key}: ${epic.parent.summary}` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

// ── Story grid ────────────────────────────────────────────────────────

type StorySortCol = 'key' | 'summary' | 'points' | 'status' | 'project' | 'statusCategoryChangedDate';

interface StoryGridProps {
  stories: InitiativeStory[];
}

const StoryGrid = ({ stories }: StoryGridProps) => {
  const [sortCol, setSortCol] = useState<StorySortCol>('project');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (col: StorySortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...stories].sort((a, b) => {
      if (sortCol === 'points') {
        return ((a.points ?? -1) - (b.points ?? -1)) * dir;
      }
      if (sortCol === 'statusCategoryChangedDate') {
        return (a.statusCategoryChangedDate ?? '').localeCompare(b.statusCategoryChangedDate ?? '') * dir;
      }
      return ((a[sortCol] ?? '') as string).toLowerCase().localeCompare(((b[sortCol] ?? '') as string).toLowerCase()) * dir;
    });
  }, [stories, sortCol, sortDir]);

  const SortHeader = ({ col, label, width, align }: { col: StorySortCol; label: string; width?: number; align?: 'right' }) => (
    <TableCell sx={{ ...headerCellSx, ...(width ? { width } : {}), ...(align ? { textAlign: align } : {}) }}>
      <TableSortLabel
        active={sortCol === col}
        direction={sortCol === col ? sortDir : 'asc'}
        onClick={() => handleSort(col)}
        sx={{ fontSize: 'inherit' }}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <TableContainer component={Paper} elevation={1} sx={{ maxHeight: 320, overflow: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <SortHeader col="key" label="Key" width={110} />
            <SortHeader col="summary" label="Summary" />
            <SortHeader col="points" label="Points" width={70} align="right" />
            <SortHeader col="status" label="Status" width={130} />
            <SortHeader col="project" label="Project" width={140} />
            <SortHeader col="statusCategoryChangedDate" label="Status Changed" width={130} />
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((story) => (
            <TableRow key={story.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
              <TableCell sx={cellSx}>
                {JIRA_BASE_URL ? (
                  <Link href={`${JIRA_BASE_URL}/browse/${story.key}`} target="_blank" rel="noopener" underline="hover" sx={{ fontSize: 'inherit', fontFamily: 'monospace', fontWeight: 500 }}>
                    {story.key}
                  </Link>
                ) : (
                  <Typography sx={{ fontSize: 'inherit', fontFamily: 'monospace', fontWeight: 500 }}>{story.key}</Typography>
                )}
              </TableCell>
              <TableCell sx={{ ...cellSx, maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {story.summary}
              </TableCell>
              <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{story.points ?? '—'}</TableCell>
              <TableCell sx={cellSx}>{story.status}</TableCell>
              <TableCell sx={cellSx}>{story.project}</TableCell>
              <TableCell sx={cellSx}>{formatDate(story.statusCategoryChangedDate)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

// ── Main content ──────────────────────────────────────────────────────

const InitiativeStatusContent = () => {
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InitiativeStatusResponse | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedStoryStatus, setSelectedStoryStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (key: string) => {
    const trimmed = key.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setSelectedStatus(null);
    setSelectedStoryStatus(null);
    try {
      const res = await fetch('/api/initiative-status/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initiativeKey: trimmed }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? 'Failed to load');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') load(inputValue);
  };

  // Epic pie slices
  const epicStatusCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (data) {
      for (const epic of data.epics) {
        map.set(epic.status, (map.get(epic.status) ?? 0) + 1);
      }
    }
    return map;
  }, [data]);
  const epicPieSlices = buildPieSlices(epicStatusCounts);
  const epicSliceColorMap = new Map(epicPieSlices.map((s) => [s.status, s.color]));

  const filteredEpics = useMemo(() =>
    data ? (selectedStatus ? data.epics.filter((e) => e.status === selectedStatus) : data.epics) : [],
  [data, selectedStatus]);

  // Story pie slices — filtered to stories whose epic matches the selected status
  const storyPieSlices = useMemo(() => {
    if (!data || data.stories.length === 0) return [];
    const eligibleEpicKeys = selectedStatus
      ? new Set(data.epics.filter((e) => e.status === selectedStatus).map((e) => e.key))
      : new Set(data.epics.map((e) => e.key));
    const counts = new Map<string, number>();
    for (const story of data.stories) {
      if (!eligibleEpicKeys.has(story.epicKey)) continue;
      counts.set(story.status, (counts.get(story.status) ?? 0) + 1);
    }
    return buildPieSlices(counts);
  }, [data, selectedStatus]);

  const handleSliceClick = (status: string) => {
    setSelectedStatus((prev) => (prev === status ? null : status));
    setSelectedStoryStatus(null);
  };

  const handleStorySliceClick = (status: string) => {
    setSelectedStoryStatus((prev) => (prev === status ? null : status));
  };

  const filteredStories = useMemo(() => {
    if (!data) return [];
    let stories = data.stories;
    if (selectedStatus) {
      const epicKeys = new Set(data.epics.filter((e) => e.status === selectedStatus).map((e) => e.key));
      stories = stories.filter((s) => epicKeys.has(s.epicKey));
    }
    if (selectedStoryStatus) {
      stories = stories.filter((s) => s.status === selectedStoryStatus);
    }
    return stories;
  }, [data, selectedStatus, selectedStoryStatus]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header />

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: 2, gap: 2, overflow: 'hidden' }}>

        {/* Input row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <TextField
            inputRef={inputRef}
            label="Initiative Key"
            placeholder="e.g. IN-2495"
            size="small"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            sx={{ width: 200 }}
          />
          <Button
            variant="contained"
            size="small"
            onClick={() => load(inputValue)}
            disabled={loading || !inputValue.trim()}
          >
            {loading ? <CircularProgress size={16} sx={{ color: 'inherit' }} /> : 'Load'}
          </Button>
          {data && (
            <Typography variant="subtitle2" color="text.secondary">
              {data.initiativeSummary} — {data.epics.length} epic{data.epics.length !== 1 ? 's' : ''}
            </Typography>
          )}
        </Box>

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

        {data && (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 3, overflow: 'auto' }}>

            {/* Row 1: epic pie (with inline legend) + epic grid */}
            <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
              <Box sx={{ flexShrink: 0 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>Epics by Status</Typography>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                  <StatusPie slices={epicPieSlices} selectedStatus={selectedStatus} onSliceClick={handleSliceClick} />
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pt: 0.5 }}>
                    {epicPieSlices.map((slice) => (
                      <Box key={slice.status} onClick={() => handleSliceClick(slice.status)}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', borderRadius: 1, px: 0.5, py: 0.25,
                          opacity: selectedStatus !== null && selectedStatus !== slice.status ? 0.4 : 1,
                          transition: 'opacity 0.2s ease', '&:hover': { bgcolor: 'action.hover' } }}
                      >
                        <Box sx={{ width: 12, height: 12, bgcolor: slice.color, borderRadius: '2px', flexShrink: 0 }} />
                        <Typography variant="caption" sx={{ lineHeight: 1.2 }}>{slice.status}</Typography>
                        <Chip label={slice.count} size="small" sx={{ height: 16, fontSize: '0.65rem', ml: 1 }} />
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  {selectedStatus ?? 'All Epics'}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    {filteredEpics.length} epic{filteredEpics.length !== 1 ? 's' : ''}
                  </Typography>
                </Typography>
                <EpicGrid epics={filteredEpics} statusColor={epicSliceColorMap.get(selectedStatus ?? '') ?? '#9e9e9e'} />
              </Box>
            </Box>

            {/* Row 2: story pie (with inline legend) + story grid */}
            {storyPieSlices.length > 0 && data && data.stories.length > 0 && (
              <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
                <Box sx={{ flexShrink: 0 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                    Stories by Status
                    {selectedStatus && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>({selectedStatus})</Typography>
                    )}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                    <StatusPie slices={storyPieSlices} selectedStatus={selectedStoryStatus} onSliceClick={handleStorySliceClick} />
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pt: 0.5 }}>
                      {storyPieSlices.map((slice) => (
                        <Box key={slice.status} onClick={() => handleStorySliceClick(slice.status)}
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', borderRadius: 1, px: 0.5, py: 0.25,
                            opacity: selectedStoryStatus !== null && selectedStoryStatus !== slice.status ? 0.4 : 1,
                            transition: 'opacity 0.2s ease', '&:hover': { bgcolor: 'action.hover' } }}
                        >
                          <Box sx={{ width: 12, height: 12, bgcolor: slice.color, borderRadius: '2px', flexShrink: 0 }} />
                          <Typography variant="caption" sx={{ lineHeight: 1.2 }}>{slice.status}</Typography>
                          <Chip label={slice.count} size="small" sx={{ height: 16, fontSize: '0.65rem', ml: 1 }} />
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    Stories
                    {selectedStoryStatus && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>· filtered: {selectedStoryStatus}</Typography>
                    )}
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      ({filteredStories.length}{filteredStories.length !== data.stories.length ? ` of ${data.stories.length}` : ''})
                    </Typography>
                  </Typography>
                  <StoryGrid stories={filteredStories} />
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

const InitiativeStatusPage = () => (
  <Suspense>
    <InitiativeStatusContent />
  </Suspense>
);

export default InitiativeStatusPage;
