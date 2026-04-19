'use client';

import { Suspense, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
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
import CloseIcon from '@mui/icons-material/Close';
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

// ── Stories by project chart ──────────────────────────────────────────

const LABEL_W = 100;
const BAR_H = 24;
const BAR_GAP = 5;
const BAR_AREA_W = 160;
const CHART_PAD = { top: 8, right: 38, bottom: 22, left: LABEL_W + 10 };

interface ProjectBar {
  project: string;
  total: number;
  totalBarWidth: number;
  segments: { status: string; count: number; x: number; width: number; color: string }[];
}

interface StoriesByProjectChartProps {
  stories: InitiativeStory[];
  statusColorMap: Map<string, string>;
  barSelection: { project: string; status: string | null } | null;
  onBarClick: (project: string, status: string | null) => void;
}

const StoriesByProjectChart = ({ stories, statusColorMap, barSelection, onBarClick }: StoriesByProjectChartProps) => {
  const { bars, allStatuses, maxCount } = useMemo(() => {
    const projectMap = new Map<string, Map<string, number>>();
    for (const story of stories) {
      if (!projectMap.has(story.project)) projectMap.set(story.project, new Map());
      const sm = projectMap.get(story.project)!;
      sm.set(story.status, (sm.get(story.status) ?? 0) + 1);
    }
    const allStatuses = [...new Set(stories.map((s) => s.status))];
    const projectList = [...projectMap.entries()].sort((a, b) => {
      const ta = [...a[1].values()].reduce((s, v) => s + v, 0);
      const tb = [...b[1].values()].reduce((s, v) => s + v, 0);
      return tb - ta;
    });
    const maxCount = Math.max(...projectList.map(([, sm]) => [...sm.values()].reduce((s, v) => s + v, 0)), 1);
    const bars: ProjectBar[] = projectList.map(([project, statusMap]) => {
      const total = [...statusMap.values()].reduce((s, v) => s + v, 0);
      let cursor = 0;
      const segments = allStatuses
        .filter((st) => (statusMap.get(st) ?? 0) > 0)
        .map((status) => {
          const count = statusMap.get(status) ?? 0;
          const w = (count / maxCount) * BAR_AREA_W;
          const x = cursor;
          cursor += w;
          return { status, count, x, width: w, color: statusColorMap.get(status) ?? '#9e9e9e' };
        });
      return { project, total, segments, totalBarWidth: cursor };
    });
    return { bars, allStatuses, maxCount };
  }, [stories, statusColorMap]);

  const svgW = CHART_PAD.left + BAR_AREA_W + CHART_PAD.right;
  const svgH = CHART_PAD.top + bars.length * (BAR_H + BAR_GAP) + CHART_PAD.bottom;

  const tickValues = useMemo(() => {
    const step = Math.ceil(maxCount / 5);
    const ticks: number[] = [];
    for (let v = 0; v <= maxCount; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < maxCount) ticks.push(maxCount);
    return ticks;
  }, [maxCount]);

  return (
    <Box>
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        {/* X-axis gridlines */}
        {tickValues.map((v) => {
          const x = CHART_PAD.left + (v / maxCount) * BAR_AREA_W;
          return (
            <g key={v}>
              <line x1={x} y1={CHART_PAD.top} x2={x} y2={svgH - CHART_PAD.bottom} stroke="#e0e0e0" strokeWidth={1} />
              <text x={x} y={svgH - CHART_PAD.bottom + 14} textAnchor="middle" fontSize={11} fill="#9e9e9e">{v}</text>
            </g>
          );
        })}
        {/* Bars */}
        {bars.map(({ project, total, segments, totalBarWidth }, rowIdx) => {
          const y = CHART_PAD.top + rowIdx * (BAR_H + BAR_GAP);
          const rowDimmed = barSelection !== null && barSelection.project !== project;
          return (
            <g key={project}>
              <text
                x={CHART_PAD.left - 6}
                y={y + BAR_H / 2 + 4}
                textAnchor="end"
                fontSize={13}
                fill="#424242"
                opacity={rowDimmed ? 0.25 : 1}
                style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
                onClick={() => onBarClick(project, null)}
              >
                {project.length > 20 ? project.slice(0, 18) + '…' : project}
              </text>
              {segments.map(({ status, count, x, width, color }) => {
                const segDimmed = rowDimmed || (
                  barSelection?.project === project &&
                  barSelection.status !== null &&
                  barSelection.status !== status
                );
                return (
                  <g key={status} style={{ cursor: 'pointer' }} onClick={() => onBarClick(project, status)}>
                    <rect
                      x={CHART_PAD.left + x} y={y} width={width} height={BAR_H}
                      fill={color}
                      opacity={segDimmed ? 0.2 : 0.88}
                      style={{ transition: 'opacity 0.2s ease' }}
                    />
                    {width > 20 && (
                      <text
                        x={CHART_PAD.left + x + width / 2}
                        y={y + BAR_H / 2 + 4}
                        textAnchor="middle"
                        fontSize={13}
                        fontWeight="bold"
                        fill="white"
                        opacity={segDimmed ? 0.2 : 1}
                        style={{ pointerEvents: 'none', transition: 'opacity 0.2s ease' }}
                      >
                        {count}
                      </text>
                    )}
                  </g>
                );
              })}
              <text
                x={CHART_PAD.left + totalBarWidth + 4}
                y={y + BAR_H / 2 + 4}
                fontSize={13}
                fontWeight="bold"
                fill="#424242"
                opacity={rowDimmed ? 0.25 : 1}
                style={{ pointerEvents: 'none', transition: 'opacity 0.2s ease' }}
              >
                {total}
              </text>
            </g>
          );
        })}
      </svg>
      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 0.5 }}>
        {allStatuses.map((status) => (
          <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 8, height: 8, bgcolor: statusColorMap.get(status) ?? '#9e9e9e', borderRadius: '2px', flexShrink: 0 }} />
            <Typography variant="caption" color="text.secondary">{status}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

// ── Stories by project summary grid ──────────────────────────────────

const STORY_RESOLVED_SET = new Set(['done', 'closed', 'resolved']);

interface ProjectStorySummary {
  project: string;
  total: number;
  points: number;
  resolved: number;
  pctResolved: number;
}

type ProjectSortCol = 'project' | 'total' | 'points' | 'pctResolved';

interface StoriesByProjectGridProps {
  stories: InitiativeStory[];
}

const StoriesByProjectGrid = ({ stories }: StoriesByProjectGridProps) => {
  const [sortCol, setSortCol] = useState<ProjectSortCol>('project');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (col: ProjectSortCol) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  };

  const rows = useMemo((): ProjectStorySummary[] => {
    const map = new Map<string, { total: number; points: number; resolved: number }>();
    for (const story of stories) {
      const s = map.get(story.project) ?? { total: 0, points: 0, resolved: 0 };
      s.total += 1;
      s.points += story.points ?? 0;
      if (STORY_RESOLVED_SET.has(story.status.toLowerCase())) s.resolved += 1;
      map.set(story.project, s);
    }
    return [...map.entries()].map(([project, { total, points, resolved }]) => ({
      project,
      total,
      points,
      resolved,
      pctResolved: total > 0 ? Math.round((resolved / total) * 100) : 0,
    }));
  }, [stories]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortCol === 'project') return a.project.localeCompare(b.project) * dir;
      if (sortCol === 'total') return (a.total - b.total) * dir;
      if (sortCol === 'points') return (a.points - b.points) * dir;
      return (a.pctResolved - b.pctResolved) * dir;
    });
  }, [rows, sortCol, sortDir]);

  const SortHeader = ({ col, label, width, align }: { col: ProjectSortCol; label: string; width?: number; align?: 'right' }) => (
    <TableCell sx={{ ...headerCellSx, ...(width ? { width } : {}), ...(align ? { textAlign: align } : {}) }}>
      <TableSortLabel active={sortCol === col} direction={sortCol === col ? sortDir : 'asc'} onClick={() => handleSort(col)} sx={{ fontSize: 'inherit' }}>
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <TableContainer component={Paper} elevation={1} sx={{ maxHeight: 320, overflow: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <SortHeader col="project" label="Project" />
            <SortHeader col="total" label="Stories" width={80} align="right" />
            <SortHeader col="points" label="Points" width={80} align="right" />
            <TableCell sx={{ ...headerCellSx, minWidth: 200 }}>
              <TableSortLabel active={sortCol === 'pctResolved'} direction={sortCol === 'pctResolved' ? sortDir : 'asc'} onClick={() => handleSort('pctResolved')} sx={{ fontSize: 'inherit' }}>
                % Resolved
              </TableSortLabel>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={row.project} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
              <TableCell sx={cellSx}>{row.project}</TableCell>
              <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{row.total}</TableCell>
              <TableCell sx={{ ...cellSx, textAlign: 'right' }}>{row.points > 0 ? row.points : '—'}</TableCell>
              <TableCell sx={cellSx}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ flex: 1, bgcolor: 'grey.200', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                    <Box sx={{ width: `${row.pctResolved}%`, height: '100%', bgcolor: row.pctResolved >= 80 ? 'success.main' : row.pctResolved >= 40 ? 'primary.main' : 'warning.main', borderRadius: 4 }} />
                  </Box>
                  <Typography variant="caption" fontWeight={600} sx={{ minWidth: 36, textAlign: 'right' }}>
                    {row.pctResolved}%
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 60 }}>
                    ({row.resolved}/{row.total})
                  </Typography>
                </Box>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

// ── Main content ──────────────────────────────────────────────────────

interface InitiativeEntry {
  key: string;
  data: InitiativeStatusResponse;
}

const InitiativeStatusContent = () => {
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initiatives, setInitiatives] = useState<InitiativeEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedStoryStatus, setSelectedStoryStatus] = useState<string | null>(null);
  const [barSelection, setBarSelection] = useState<{ project: string; status: string | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedData = initiatives.find((i) => i.key === selectedKey)?.data ?? null;

  // Reset chart filters whenever the active initiative changes
  useEffect(() => {
    setSelectedStatus(null);
    setSelectedStoryStatus(null);
    setBarSelection(null);
  }, [selectedKey]);

  const load = useCallback(async (key: string) => {
    const trimmed = key.trim().toUpperCase();
    if (!trimmed) return;
    // Already loaded — just select it
    if (initiatives.some((i) => i.key === trimmed)) {
      setSelectedKey(trimmed);
      setInputValue('');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/initiative-status/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initiativeKey: trimmed }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? 'Failed to load');
      setInitiatives((prev) => [...prev, { key: trimmed, data: json }]);
      setSelectedKey(trimmed);
      setInputValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [initiatives]);

  const removeInitiative = useCallback((key: string) => {
    setInitiatives((prev) => prev.filter((i) => i.key !== key));
    setSelectedKey((prev) => {
      if (prev !== key) return prev;
      const idx = initiatives.findIndex((i) => i.key === key);
      const remaining = initiatives.filter((i) => i.key !== key);
      if (remaining.length === 0) return null;
      return remaining[Math.min(idx, remaining.length - 1)].key;
    });
  }, [initiatives]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') load(inputValue);
  };

  // Epic pie slices (scoped to selected initiative)
  const epicStatusCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (selectedData) {
      for (const epic of selectedData.epics) {
        map.set(epic.status, (map.get(epic.status) ?? 0) + 1);
      }
    }
    return map;
  }, [selectedData]);
  const epicPieSlices = buildPieSlices(epicStatusCounts);
  const epicSliceColorMap = new Map(epicPieSlices.map((s) => [s.status, s.color]));

  // Color map for story statuses
  const storyStatusColorMap = useMemo(() => {
    if (!selectedData) return new Map<string, string>();
    const statuses = [...new Set(selectedData.stories.map((s) => s.status))];
    return new Map(statuses.map((status, idx) => [status, STATUS_PALETTE[idx % STATUS_PALETTE.length]]));
  }, [selectedData]);

  const filteredEpics = useMemo(() =>
    selectedData ? (selectedStatus ? selectedData.epics.filter((e) => e.status === selectedStatus) : selectedData.epics) : [],
  [selectedData, selectedStatus]);

  // Story pie slices — filtered to stories whose epic matches the selected epic status
  const storyPieSlices = useMemo(() => {
    if (!selectedData || selectedData.stories.length === 0) return [];
    const eligibleEpicKeys = selectedStatus
      ? new Set(selectedData.epics.filter((e) => e.status === selectedStatus).map((e) => e.key))
      : new Set(selectedData.epics.map((e) => e.key));
    const counts = new Map<string, number>();
    for (const story of selectedData.stories) {
      if (!eligibleEpicKeys.has(story.epicKey)) continue;
      counts.set(story.status, (counts.get(story.status) ?? 0) + 1);
    }
    return buildPieSlices(counts);
  }, [selectedData, selectedStatus]);

  const handleSliceClick = (status: string) => {
    setSelectedStatus((prev) => (prev === status ? null : status));
    setSelectedStoryStatus(null);
  };

  const handleStorySliceClick = (status: string) => {
    setSelectedStoryStatus((prev) => (prev === status ? null : status));
  };

  const filteredStories = useMemo(() => {
    if (!selectedData) return [];
    let stories = selectedData.stories;
    if (selectedStatus) {
      const epicKeys = new Set(selectedData.epics.filter((e) => e.status === selectedStatus).map((e) => e.key));
      stories = stories.filter((s) => epicKeys.has(s.epicKey));
    }
    if (selectedStoryStatus) {
      stories = stories.filter((s) => s.status === selectedStoryStatus);
    }
    return stories;
  }, [selectedData, selectedStatus, selectedStoryStatus]);

  // Bar chart selection → filter stories directly by project and story status
  const barFilteredStories = useMemo(() => {
    if (!selectedData) return [];
    if (!barSelection) return selectedData.stories;
    const { project, status: barStatus } = barSelection;
    return selectedData.stories.filter(
      (s) => s.project === project && (barStatus === null || s.status === barStatus)
    );
  }, [selectedData, barSelection]);

  const handleBarClick = useCallback((project: string, status: string | null) => {
    setBarSelection((prev) => {
      if (prev?.project === project && prev?.status === status) return null;
      return { project, status };
    });
  }, []);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header />
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left panel: initiative list ── */}
        <Box sx={{
          width: 260, flexShrink: 0,
          borderRight: '1px solid', borderColor: 'divider',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Add input */}
          <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Initiatives</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                inputRef={inputRef}
                placeholder="e.g. IN-2495"
                size="small"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                sx={{ flex: 1 }}
              />
              <Button
                variant="contained"
                size="small"
                onClick={() => load(inputValue)}
                disabled={loading || !inputValue.trim()}
                sx={{ minWidth: 0, px: 1.5 }}
              >
                {loading ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : 'Add'}
              </Button>
            </Box>
            {error && (
              <Alert severity="error" onClose={() => setError(null)} sx={{ mt: 1, py: 0, fontSize: '0.75rem' }}>
                {error}
              </Alert>
            )}
          </Box>

          {/* Initiative list */}
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            {initiatives.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block' }}>
                No initiatives loaded yet. Enter a key above.
              </Typography>
            ) : (
              initiatives.map(({ key, data: iData }) => {
                const isSelected = selectedKey === key;
                return (
                  <Box
                    key={key}
                    onClick={() => setSelectedKey(key)}
                    sx={{
                      display: 'flex', alignItems: 'flex-start', px: 1.5, py: 1, gap: 0.5,
                      cursor: 'pointer',
                      borderLeft: '3px solid',
                      borderColor: isSelected ? 'primary.main' : 'transparent',
                      bgcolor: isSelected ? 'action.selected' : 'transparent',
                      '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" fontFamily="monospace" fontWeight={700} display="block">
                        {key}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block"
                        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {iData.initiativeSummary}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {iData.epics.length} epic{iData.epics.length !== 1 ? 's' : ''} · {iData.stories.length} stor{iData.stories.length !== 1 ? 'ies' : 'y'}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      onClick={(e) => { e.stopPropagation(); removeInitiative(key); }}
                      sx={{ mt: -0.5, mr: -0.75, flexShrink: 0 }}
                      aria-label={`Remove ${key}`}
                    >
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                );
              })
            )}
          </Box>
        </Box>

        {/* ── Right panel: selected initiative view ── */}
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: 2 }}>
          {!selectedData ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Typography color="text.secondary">
                {initiatives.length === 0 ? 'Add an initiative key to get started.' : 'Select an initiative from the list.'}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

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

              {/* Row 2: stories by project chart + story grid */}
              {selectedData.stories.length > 0 && (
                <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
                  <Box sx={{ flexShrink: 0 }}>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.75 }}>
                      Stories by Project
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {[...new Set(selectedData.stories.map((s) => s.project))].length} project{[...new Set(selectedData.stories.map((s) => s.project))].length !== 1 ? 's' : ''}
                      </Typography>
                    </Typography>
                    <Paper elevation={1} sx={{ p: 2 }}>
                      <StoriesByProjectChart
                        stories={selectedData.stories}
                        statusColorMap={storyStatusColorMap}
                        barSelection={barSelection}
                        onBarClick={handleBarClick}
                      />
                    </Paper>
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.75 }}>
                      {barSelection
                        ? `${barSelection.project}${barSelection.status ? ` · ${barSelection.status}` : ''}`
                        : 'Stories'}
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {barFilteredStories.length} stor{barFilteredStories.length !== 1 ? 'ies' : 'y'}
                        {barSelection && (
                          <Typography
                            component="span"
                            variant="caption"
                            color="primary"
                            sx={{ ml: 1, cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => setBarSelection(null)}
                          >
                            clear
                          </Typography>
                        )}
                      </Typography>
                    </Typography>
                    <StoryGrid stories={barFilteredStories} />
                  </Box>
                </Box>
              )}

              {/* Row 3: story pie (with inline legend) + story grid */}
              {storyPieSlices.length > 0 && selectedData.stories.length > 0 && (
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
                        ({filteredStories.length}{filteredStories.length !== selectedData.stories.length ? ` of ${selectedData.stories.length}` : ''})
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
    </Box>
  );
};

const InitiativeStatusPage = () => (
  <Suspense>
    <InitiativeStatusContent />
  </Suspense>
);

export default InitiativeStatusPage;
