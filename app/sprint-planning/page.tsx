'use client';

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Fab from '@mui/material/Fab';
import Tooltip from '@mui/material/Tooltip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Header, Sidebar, MainContent } from '@/frontend/components';
import SprintPlanningSidebarContent from '@/frontend/components/sidebar/SprintPlanningSidebarContent';
import { useAppState } from '@/frontend/hooks';
import { useSprintPlanningData } from '@/frontend/hooks/useSprintPlanningData';
import type { ParentGroup, StoryRow, ReadinessLabel } from '@/frontend/hooks/useSprintPlanningData';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import { EPIC_COLORS } from '@/shared/constants';

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

// ── Capacity data (loaded from JIRA via capacity storage API) ─────────

interface CapacityEngineerRow {
  name: string;
  isTechLead: boolean;
  daysOut: number;
  capacity: number;
}

interface SavedCapacityData {
  engineers: CapacityEngineerRow[];
  supportPct: number;
  totalCapacity: number;
}

const parseCapacityPayload = (raw: string): SavedCapacityData | null => {
  try {
    const semicolon = raw.indexOf(';');
    const supportPct = semicolon !== -1 ? parseInt(raw.slice(0, semicolon), 10) : 10;
    const engineerPart = semicolon !== -1 ? raw.slice(semicolon + 1) : raw;
    const engineers: CapacityEngineerRow[] = engineerPart.split('|').map((entry) => {
      const [namePart, tlPart, doPart, pctPart] = entry.split(':');
      const name = decodeURIComponent(namePart);
      const isTechLead = tlPart === '1';
      const daysOut = parseFloat(doPart);
      const capacityPct = pctPart !== undefined ? parseInt(pctPart, 10) : 100;
      const capacity = isTechLead ? 0 : Math.round(Math.max(0, 10 - daysOut) * (capacityPct / 100) * 10) / 10;
      return { name, isTechLead, daysOut, capacity };
    });
    if (engineers.some((e) => !e.name || isNaN(e.daysOut))) return null;
    const rawTotal = engineers.reduce((sum, e) => sum + e.capacity, 0);
    const totalCapacity = Math.round(rawTotal * (1 - supportPct / 100) * 10) / 10;
    return { engineers, supportPct, totalCapacity };
  } catch {
    return null;
  }
};

const loadCapacityFromJira = async (
  projectKey: string,
  sprintId: number,
  sprintName: string
): Promise<SavedCapacityData | null> => {
  try {
    const params = new URLSearchParams({ projectKey, sprintId: sprintId.toString(), sprintName });
    const res = await fetch(`/api/capacity/storage?${params}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ? parseCapacityPayload(json.data) : null;
  } catch {
    return null;
  }
};

// ── Capacity vs Points bar chart ──────────────────────────────────────

interface CapacityVsPointsChartProps {
  totalCapacity: number;
  parents: import('@/frontend/hooks/useSprintPlanningData').ParentGroup[];
  highlightedKey: string | null;
  onEpicClick: (key: string) => void;
}

const BAR_WIDTH = 60;
const BAR_GAP = 16;
const CHART_HEIGHT = 220;
const CHART_PADDING = { top: 16, right: 16, bottom: 48, left: 40 };

const CapacityVsPointsChart = ({ totalCapacity, parents, highlightedKey, onEpicClick }: CapacityVsPointsChartProps) => {
  const totalPoints = parents.reduce((s, p) => s + p.points, 0);
  const maxVal = Math.max(totalCapacity, totalPoints, 1);

  const chartW = BAR_WIDTH * 2 + BAR_GAP + CHART_PADDING.left + CHART_PADDING.right;
  const chartH = CHART_HEIGHT + CHART_PADDING.top + CHART_PADDING.bottom;
  const plotH = CHART_HEIGHT;

  const toY = (val: number) => plotH - (val / maxVal) * plotH;

  // Build stacked segments for the story points bar
  const segments: { key: string; color: string; y: number; h: number }[] = [];
  let cursor = plotH;
  parents.forEach((p, idx) => {
    const h = (p.points / maxVal) * plotH;
    cursor -= h;
    segments.push({ key: p.parentKey, color: EPIC_COLORS[idx % EPIC_COLORS.length], y: cursor, h });
  });

  const capBarH = (totalCapacity / maxVal) * plotH;
  const capBarY = plotH - capBarH;
  const barX1 = CHART_PADDING.left; // capacity bar
  const barX2 = CHART_PADDING.left + BAR_WIDTH + BAR_GAP; // story points bar

  // Y-axis tick count
  const ticks = 5;

  return (
    <Box sx={{ flexShrink: 0 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.75, fontWeight: 600, color: 'text.secondary', textAlign: 'center' }}>
        Capacity vs Points
      </Typography>
      <svg width={chartW} height={chartH} style={{ display: 'block' }}>
        <g transform={`translate(0, ${CHART_PADDING.top})`}>
          {/* Y-axis ticks */}
          {Array.from({ length: ticks + 1 }, (_, i) => {
            const val = Math.round((maxVal / ticks) * i * 10) / 10;
            const y = toY(val);
            return (
              <g key={i}>
                <line x1={CHART_PADDING.left - 4} y1={y} x2={CHART_PADDING.left + BAR_WIDTH * 2 + BAR_GAP} y2={y} stroke="#e0e0e0" strokeWidth={1} />
                <text x={CHART_PADDING.left - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#757575">{val}</text>
              </g>
            );
          })}

          {/* Capacity bar */}
          <rect x={barX1} y={capBarY} width={BAR_WIDTH} height={capBarH} fill="#1976d2" opacity={0.85} />
          <text x={barX1 + BAR_WIDTH / 2} y={capBarY - 4} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#1976d2">
            {totalCapacity}
          </text>
          <text x={barX1 + BAR_WIDTH / 2} y={plotH + 16} textAnchor="middle" fontSize={11} fill="#424242">Capacity</text>

          {/* Story points stacked bar */}
          {segments.map(({ key, color, y, h }) => {
            const isHighlighted = highlightedKey === key;
            const isDimmed = highlightedKey !== null && !isHighlighted;
            return (
              <rect
                key={key}
                x={barX2}
                y={y}
                width={BAR_WIDTH}
                height={h}
                fill={color}
                opacity={isDimmed ? 0.25 : 0.9}
                stroke="white"
                strokeWidth={1}
                style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
                onClick={() => onEpicClick(key)}
              />
            );
          })}
          <text x={barX2 + BAR_WIDTH / 2} y={toY(totalPoints) - 4} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#424242">
            {totalPoints}
          </text>
          <text x={barX2 + BAR_WIDTH / 2} y={plotH + 16} textAnchor="middle" fontSize={11} fill="#424242">Points</text>

          {/* Diff label */}
          {(() => {
            const diff = Math.round((totalCapacity - totalPoints) * 10) / 10;
            const sign = diff >= 0 ? '+' : '';
            const color = diff >= 0 ? '#2e7d32' : '#c62828';
            return (
              <text x={chartW / 2} y={plotH + 34} textAnchor="middle" fontSize={11} fontWeight="bold" fill={color}>
                {sign}{diff} pts {diff >= 0 ? 'under' : 'over'}
              </text>
            );
          })()}

          {/* Baseline */}
          <line x1={CHART_PADDING.left} y1={plotH} x2={CHART_PADDING.left + BAR_WIDTH * 2 + BAR_GAP} y2={plotH} stroke="#424242" strokeWidth={1} />
        </g>
      </svg>
    </Box>
  );
};

// ── Read-only capacity grid ───────────────────────────────────────────

interface CapacityGridProps {
  capacityData: SavedCapacityData;
}

const CapacityGrid = ({ capacityData }: CapacityGridProps) => {
  const colSx = { fontSize: '0.78rem', py: 0.5, px: 1 };
  const headerSx = { ...colSx, fontWeight: 700, bgcolor: 'grey.100', whiteSpace: 'nowrap' as const };

  return (
    <Box sx={{ flexShrink: 0 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.75, fontWeight: 600, color: 'text.secondary' }}>
        Engineer Capacity
        {capacityData.supportPct > 0 && (
          <Typography component="span" variant="caption" sx={{ ml: 1 }}>
            ({capacityData.supportPct}% support)
          </Typography>
        )}
      </Typography>
      <TableContainer component={Paper} elevation={1} sx={{ maxWidth: 320 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={headerSx}>Engineer</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'center' }}>TL</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Days Out</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Capacity</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {capacityData.engineers.map((eng) => (
              <TableRow key={eng.name} sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                <TableCell sx={colSx}>{eng.name}</TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'center' }}>{eng.isTechLead ? '✓' : ''}</TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right' }}>{eng.daysOut > 0 ? eng.daysOut : '—'}</TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right', fontWeight: 600, color: eng.capacity === 0 ? 'text.disabled' : 'text.primary' }}>
                  {eng.capacity}
                </TableCell>
              </TableRow>
            ))}
            <TableRow sx={{ borderTop: 2, borderColor: 'grey.300' }}>
              <TableCell sx={{ ...colSx, fontWeight: 700 }} colSpan={3}>Total</TableCell>
              <TableCell sx={{ ...colSx, textAlign: 'right', fontWeight: 700 }}>{capacityData.totalCapacity}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

// ── Shared pie helpers ────────────────────────────────────────────────

const PIE_SIZE = 260;
const PIE_CENTER = PIE_SIZE / 2;
const PIE_RADIUS = 100;

function buildSlices<T>(
  items: T[],
  getValue: (item: T) => number,
  getKey: (item: T) => string,
  colors: string[]
) {
  const total = items.reduce((sum, item) => sum + getValue(item), 0);
  if (total === 0) return { slices: [], total };

  const slices: {
    key: string;
    color: string;
    value: number;
    startAngle: number;
    endAngle: number;
    pathD: string;
  }[] = [];

  let cursor = -Math.PI / 2;

  items.forEach((item, idx) => {
    const value = getValue(item);
    if (value === 0) return;
    const color = colors[idx % colors.length];
    const angle = (value / total) * 2 * Math.PI;
    const startAngle = cursor;
    const endAngle = cursor + angle;

    const x1 = PIE_CENTER + PIE_RADIUS * Math.cos(startAngle);
    const y1 = PIE_CENTER + PIE_RADIUS * Math.sin(startAngle);
    const x2 = PIE_CENTER + PIE_RADIUS * Math.cos(endAngle);
    const y2 = PIE_CENTER + PIE_RADIUS * Math.sin(endAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    const pathD =
      `M ${PIE_CENTER} ${PIE_CENTER} ` +
      `L ${x1} ${y1} ` +
      `A ${PIE_RADIUS} ${PIE_RADIUS} 0 ${largeArc} 1 ${x2} ${y2} ` +
      `Z`;

    slices.push({ key: getKey(item), color, value, startAngle, endAngle, pathD });
    cursor = endAngle;
  });

  return { slices, total };
}

// ── Epic breakdown pie ────────────────────────────────────────────────

interface EpicPieChartProps {
  parents: ParentGroup[];
  highlightedKey: string | null;
  onSliceClick: (key: string) => void;
}

const EpicPieChart = ({ parents, highlightedKey, onSliceClick }: EpicPieChartProps) => {
  const { slices } = useMemo(
    () => buildSlices(parents, (p) => p.points, (p) => p.parentKey, EPIC_COLORS),
    [parents]
  );

  if (slices.length === 0) return null;

  return (
    <svg width={PIE_SIZE} height={PIE_SIZE} style={{ display: 'block', flexShrink: 0 }}>
      {slices.map(({ key, color, startAngle, endAngle, pathD }) => {
        const isHighlighted = highlightedKey === key;
        const isDimmed = highlightedKey !== null && !isHighlighted;
        let transform = '';
        if (isHighlighted) {
          const mid = (startAngle + endAngle) / 2;
          transform = `translate(${6 * Math.cos(mid)}, ${6 * Math.sin(mid)})`;
        }
        return (
          <g key={key} onClick={() => onSliceClick(key)} style={{ cursor: 'pointer' }} transform={transform}>
            <path
              d={pathD}
              fill={color}
              stroke="white"
              strokeWidth={2}
              opacity={isDimmed ? 0.3 : 1}
              style={{ transition: 'opacity 0.2s ease' }}
            />
          </g>
        );
      })}
    </svg>
  );
};

// ── Readiness pie (reused for count + points) ────────────────────────

const READINESS_ORDER: ReadinessLabel[] = ['Ready-For-Sprint', 'Needs-Refinement', 'New'];
const READINESS_COLORS: Record<ReadinessLabel, string> = {
  'Ready-For-Sprint': '#2e7d32',
  'Needs-Refinement': '#ed6c02',
  'New': '#9e9e9e',
};

interface ReadinessBucket {
  label: ReadinessLabel;
  count: number;
  points: number;
}

interface ReadinessPieProps {
  buckets: ReadinessBucket[];
  valueKey: 'count' | 'points';
  highlightedReadiness: ReadinessLabel | null;
  onSliceClick: (label: ReadinessLabel) => void;
}

const ReadinessPie = ({ buckets, valueKey, highlightedReadiness, onSliceClick }: ReadinessPieProps) => {
  const { slices } = useMemo(
    () =>
      buildSlices(
        buckets,
        (b) => b[valueKey],
        (b) => b.label,
        buckets.map((b) => READINESS_COLORS[b.label])
      ),
    [buckets, valueKey]
  );

  if (slices.length === 0) return null;

  return (
    <svg width={PIE_SIZE} height={PIE_SIZE} style={{ display: 'block', flexShrink: 0 }}>
      {slices.map(({ key, color, startAngle, endAngle, pathD, value }) => {
        const label = key as ReadinessLabel;
        const isHighlighted = highlightedReadiness === label;
        const isDimmed = highlightedReadiness !== null && !isHighlighted;
        let transform = '';
        if (isHighlighted) {
          const mid = (startAngle + endAngle) / 2;
          transform = `translate(${6 * Math.cos(mid)}, ${6 * Math.sin(mid)})`;
        }
        return (
          <g key={key} onClick={() => onSliceClick(label)} style={{ cursor: 'pointer' }} transform={transform}>
            <path
              d={pathD}
              fill={color}
              stroke="white"
              strokeWidth={2}
              opacity={isDimmed ? 0.3 : 1}
              style={{ transition: 'opacity 0.2s ease' }}
            />
            {/* Center label showing value */}
            {value > 0 && (() => {
              const mid = (startAngle + endAngle) / 2;
              const lx = PIE_CENTER + PIE_RADIUS * 0.62 * Math.cos(mid);
              const ly = PIE_CENTER + PIE_RADIUS * 0.62 * Math.sin(mid);
              const angle = (endAngle - startAngle);
              if (angle < 0.25) return null;
              return (
                <text
                  x={lx}
                  y={ly + 4}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight="bold"
                  fill="white"
                  style={{ pointerEvents: 'none' }}
                >
                  {value}
                </text>
              );
            })()}
          </g>
        );
      })}
    </svg>
  );
};

// ── Epic table ────────────────────────────────────────────────────────

type EpicSortField = 'parentSummary' | 'points' | 'percent';
type SortDir = 'asc' | 'desc';

interface PlanningTableProps {
  parents: ParentGroup[];
  highlightedKey: string | null;
  onRowClick: (key: string) => void;
}

const PlanningTable = ({ parents, highlightedKey, onRowClick }: PlanningTableProps) => {
  const [sortField, setSortField] = useState<EpicSortField>('parentSummary');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (field: EpicSortField) => {
    if (field === sortField) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    return [...parents].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'parentSummary') cmp = a.parentSummary.localeCompare(b.parentSummary);
      else if (sortField === 'points') cmp = a.points - b.points;
      else cmp = a.percent - b.percent;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [parents, sortField, sortDir]);

  const colSx = { fontSize: '0.78rem', py: 0.5, px: 1 };
  const headerSx = { ...colSx, fontWeight: 700, bgcolor: 'grey.100', whiteSpace: 'nowrap' as const };

  return (
    <TableContainer component={Paper} elevation={1} sx={{ flex: 1, minWidth: 280 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={headerSx}>
              <TableSortLabel active={sortField === 'parentSummary'} direction={sortField === 'parentSummary' ? sortDir : 'asc'} onClick={() => handleSort('parentSummary')}>
                Parent
              </TableSortLabel>
            </TableCell>
            <TableCell sx={{ ...headerSx, textAlign: 'right' }}>
              <TableSortLabel active={sortField === 'points'} direction={sortField === 'points' ? sortDir : 'asc'} onClick={() => handleSort('points')}>
                Points
              </TableSortLabel>
            </TableCell>
            <TableCell sx={{ ...headerSx, textAlign: 'right' }}>
              <TableSortLabel active={sortField === 'percent'} direction={sortField === 'percent' ? sortDir : 'asc'} onClick={() => handleSort('percent')}>
                % of Sprint
              </TableSortLabel>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((parent) => {
            const color = EPIC_COLORS[parents.indexOf(parent) % EPIC_COLORS.length];
            const isHighlighted = highlightedKey === parent.parentKey;
            const isDimmed = highlightedKey !== null && !isHighlighted;
            return (
              <TableRow
                key={parent.parentKey}
                hover
                selected={isHighlighted}
                onClick={() => onRowClick(parent.parentKey)}
                sx={{
                  cursor: 'pointer',
                  opacity: isDimmed ? 0.4 : 1,
                  transition: 'opacity 0.2s ease',
                  '&.Mui-selected': { bgcolor: 'action.selected' },
                  '&:nth-of-type(even)': { bgcolor: isHighlighted ? undefined : 'grey.50' },
                }}
              >
                <TableCell sx={colSx}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: color, flexShrink: 0 }} />
                    <Typography variant="body2" sx={{ fontSize: 'inherit', fontWeight: isHighlighted ? 700 : 400 }}>
                      {parent.parentSummary}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right' }}>{parent.points}</TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right' }}>{parent.percent}%</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

// ── Story readiness table ─────────────────────────────────────────────

type StorySortField = 'key' | 'summary' | 'points' | 'status' | 'readiness';

const READINESS_CHIP_PROPS: Record<ReadinessLabel, { label: string; color: 'success' | 'warning' | 'default' }> = {
  'Ready-For-Sprint': { label: 'Ready-For-Sprint', color: 'success' },
  'Needs-Refinement': { label: 'Needs-Refinement', color: 'warning' },
  'New': { label: 'New', color: 'default' },
};

const READINESS_SORT_ORDER: Record<ReadinessLabel, number> = {
  'Ready-For-Sprint': 0,
  'Needs-Refinement': 1,
  'New': 2,
};

interface StoryTableProps {
  stories: StoryRow[];
  highlightedReadiness: ReadinessLabel | null;
  highlightedStoryKey: string | null;
  highlightedEpicKey: string | null;
  onRowClick: (key: string, readiness: ReadinessLabel) => void;
}

const StoryTable = ({ stories, highlightedReadiness, highlightedStoryKey, highlightedEpicKey, onRowClick }: StoryTableProps) => {
  const [sortField, setSortField] = useState<StorySortField>('key');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (field: StorySortField) => {
    if (field === sortField) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    return [...stories].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'key') cmp = a.key.localeCompare(b.key);
      else if (sortField === 'summary') cmp = a.summary.localeCompare(b.summary);
      else if (sortField === 'points') cmp = a.points - b.points;
      else if (sortField === 'status') cmp = a.status.localeCompare(b.status);
      else cmp = READINESS_SORT_ORDER[a.readiness] - READINESS_SORT_ORDER[b.readiness];
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [stories, sortField, sortDir]);

  const colSx = { fontSize: '0.78rem', py: 0.5, px: 1 };
  const headerSx = { ...colSx, fontWeight: 700, bgcolor: 'grey.100', whiteSpace: 'nowrap' as const };

  return (
    <TableContainer component={Paper} elevation={1} sx={{ flex: 1, minWidth: 320, maxHeight: 360, overflow: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={headerSx}>
              <TableSortLabel active={sortField === 'key'} direction={sortField === 'key' ? sortDir : 'asc'} onClick={() => handleSort('key')}>
                Key
              </TableSortLabel>
            </TableCell>
            <TableCell sx={headerSx}>
              <TableSortLabel active={sortField === 'summary'} direction={sortField === 'summary' ? sortDir : 'asc'} onClick={() => handleSort('summary')}>
                Summary
              </TableSortLabel>
            </TableCell>
            <TableCell sx={{ ...headerSx, textAlign: 'right' }}>
              <TableSortLabel active={sortField === 'points'} direction={sortField === 'points' ? sortDir : 'asc'} onClick={() => handleSort('points')}>
                Points
              </TableSortLabel>
            </TableCell>
            <TableCell sx={headerSx}>
              <TableSortLabel active={sortField === 'status'} direction={sortField === 'status' ? sortDir : 'asc'} onClick={() => handleSort('status')}>
                Status
              </TableSortLabel>
            </TableCell>
            <TableCell sx={headerSx}>
              <TableSortLabel active={sortField === 'readiness'} direction={sortField === 'readiness' ? sortDir : 'asc'} onClick={() => handleSort('readiness')}>
                Readiness
              </TableSortLabel>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((story) => {
            const isStoryHighlighted = highlightedStoryKey === story.key;
            const isReadinessMatch = highlightedReadiness === story.readiness;
            const isEpicMatch = highlightedEpicKey !== null && highlightedEpicKey === story.parentKey;
            // Priority: story key > readiness > epic
            const isHighlighted = isStoryHighlighted || (highlightedStoryKey === null && isReadinessMatch) || (highlightedStoryKey === null && highlightedReadiness === null && isEpicMatch);
            const isDimmed = !isHighlighted && (highlightedStoryKey !== null || highlightedReadiness !== null || highlightedEpicKey !== null);
            const { label: chipLabel, color: chipColor } = READINESS_CHIP_PROPS[story.readiness];
            const textColor = story.status.toLowerCase() === 'blocked' ? 'error.main' : undefined;

            return (
              <TableRow
                key={story.key}
                hover
                selected={isHighlighted}
                onClick={() => onRowClick(story.key, story.readiness)}
                sx={{
                  cursor: 'pointer',
                  opacity: isDimmed ? 0.3 : 1,
                  transition: 'opacity 0.2s ease',
                  '&.Mui-selected': { bgcolor: 'action.selected' },
                  '&:nth-of-type(even)': { bgcolor: isHighlighted ? undefined : 'grey.50' },
                }}
              >
                <TableCell sx={{ ...colSx, fontWeight: isHighlighted ? 700 : 400, whiteSpace: 'nowrap', color: textColor }}>
                  {JIRA_BASE_URL ? (
                    <Link
                      href={`${JIRA_BASE_URL}/browse/${story.key}`}
                      target="_blank"
                      rel="noopener"
                      underline="hover"
                      onClick={(e) => e.stopPropagation()}
                      sx={{ fontSize: 'inherit', fontWeight: 'inherit' }}
                    >
                      {story.key}
                    </Link>
                  ) : (
                    story.key
                  )}
                </TableCell>
                <TableCell sx={{ ...colSx, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: textColor }}>
                  {story.summary}
                </TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right', color: textColor }}>{story.points || '—'}</TableCell>
                <TableCell sx={{ ...colSx, color: textColor }}>{story.status}</TableCell>
                <TableCell sx={colSx}>
                  <Chip label={chipLabel} color={chipColor} size="small" variant="outlined" sx={{ fontSize: '0.68rem', height: 20 }} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

// ── Main page content ─────────────────────────────────────────────────

const SprintPlanningContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
  });

  const { projectKey, sidebarCollapsed, setSidebarCollapsed } = useAppState();

  const { data, isLoading, error, generate, clear } = useSprintPlanningData();

  const boardParam = searchParams.get(QUERY_PARAM_KEYS.BOARD);
  const boardId = boardParam ? parseInt(boardParam, 10) || undefined : undefined;

  const sprintParam = searchParams.get(QUERY_PARAM_KEYS.SP_SPRINT);
  const selectedSprintId = sprintParam ? parseInt(sprintParam, 10) || null : null;

  // Capacity data from localStorage (saved by Capacity page)
  const [savedCapacity, setSavedCapacity] = useState<SavedCapacityData | null>(null);

  // Epic breakdown highlight
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);

  // Story readiness highlights — pie slice and story row are separate
  const [highlightedReadiness, setHighlightedReadiness] = useState<ReadinessLabel | null>(null);
  const [highlightedStoryKey, setHighlightedStoryKey] = useState<string | null>(null);

  // Clear cache on mount so stale data (missing parentKey) is never served
  useEffect(() => { clear(); }, []);

  // Clear data when board changes
  useEffect(() => {
    clear();
    setHighlightedKey(null);
    setHighlightedReadiness(null);
    setHighlightedStoryKey(null);
  }, [boardId]);

  // URL update helper
  const updateUrl = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const newUrl = params.toString() ? `?${params.toString()}` : '/sprint-planning';
    router.push(newUrl, { scroll: false });
  }, [router]);

  const handleSprintChange = useCallback((sprintId: number, _sprintName: string) => {
    updateUrl(QUERY_PARAM_KEYS.SP_SPRINT, sprintId.toString());
  }, [updateUrl]);

  const prevValuesRef = useRef<{ sprintId: number; boardId: number } | null>(null);

  useEffect(() => {
    if (!selectedSprintId || !boardId) {
      prevValuesRef.current = null;
      setSavedCapacity(null);
      clear();
      return;
    }
    const prev = prevValuesRef.current;
    if (prev && prev.sprintId === selectedSprintId && prev.boardId === boardId) return;
    prevValuesRef.current = { sprintId: selectedSprintId, boardId };
    prevCapacityKeyRef.current = '';
    setSavedCapacity(null);
    generate(selectedSprintId, boardId);
  }, [selectedSprintId, boardId, generate, clear]);

  // Load capacity from JIRA once sprint data (and sprint name) is available
  const prevCapacityKeyRef = useRef<string>('');
  useEffect(() => {
    if (!data || !selectedSprintId || !projectKey) return;
    const key = `${projectKey}:${selectedSprintId}`;
    if (key === prevCapacityKeyRef.current) return;
    prevCapacityKeyRef.current = key;
    loadCapacityFromJira(projectKey, selectedSprintId, data.sprintName).then(setSavedCapacity);
  }, [data, selectedSprintId, projectKey]);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch('/api/auth/validate');
        const authData = await response.json();
        setConnectionStatus({ connected: authData.valid, email: authData.email });
      } catch {
        setConnectionStatus({ connected: false });
      }
    };
    checkConnection();
  }, []);

  const handleRefresh = useCallback(() => {
    if (!selectedSprintId || !boardId || isLoading) return;
    clear();
    generate(selectedSprintId, boardId);
  }, [selectedSprintId, boardId, isLoading, clear, generate]);

  const handleEpicHighlight = useCallback((key: string) => {
    setHighlightedKey((prev) => (prev === key ? null : key));
    setHighlightedReadiness(null);
    setHighlightedStoryKey(null);
  }, []);

  // Clicking a readiness slice highlights that readiness bucket (clears story key)
  const handleReadinessSliceClick = useCallback((label: ReadinessLabel) => {
    setHighlightedReadiness((prev) => (prev === label ? null : label));
    setHighlightedStoryKey(null);
    setHighlightedKey(null);
  }, []);

  // Clicking a story row highlights that story key and its readiness bucket
  const handleStoryRowClick = useCallback((key: string, readiness: ReadinessLabel) => {
    setHighlightedKey(null);
    setHighlightedStoryKey((prev) => {
      if (prev === key) {
        setHighlightedReadiness(null);
        return null;
      }
      setHighlightedReadiness(readiness);
      return key;
    });
  }, []);

  // Compute readiness buckets from stories
  const readinessBuckets = useMemo((): ReadinessBucket[] => {
    if (!data) return [];
    const map: Record<ReadinessLabel, { count: number; points: number }> = {
      'Ready-For-Sprint': { count: 0, points: 0 },
      'Needs-Refinement': { count: 0, points: 0 },
      'New': { count: 0, points: 0 },
    };
    for (const story of data.stories) {
      map[story.readiness].count += 1;
      map[story.readiness].points += story.points;
    }
    return READINESS_ORDER.map((label) => ({ label, ...map[label] })).filter((b) => b.count > 0);
  }, [data]);

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
            <Alert severity="error" sx={{ m: 2 }}>
              {error}
            </Alert>
          )}

          {data ? (
            <Box sx={{ overflow: 'auto', height: '100%', p: 2 }}>

              {/* ── Epic Breakdown ── */}
              <Typography variant="h6" sx={{ mb: 1.5, fontWeight: 600 }}>
                Epic Breakdown
                <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                  {data.totalPoints} total pts
                </Typography>
                <Typography component="span" variant="body2" color="success.main" sx={{ ml: 1.5 }}>
                  {data.completedPoints} completed
                </Typography>
                <Typography component="span" variant="body2" color="warning.main" sx={{ ml: 1.5 }}>
                  {data.remainingPoints} remaining
                </Typography>
              </Typography>

              <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexWrap: 'wrap', mb: 3 }}>
                <EpicPieChart
                  parents={data.parents}
                  highlightedKey={highlightedKey}
                  onSliceClick={handleEpicHighlight}
                />
                <PlanningTable
                  parents={data.parents}
                  highlightedKey={highlightedKey}
                  onRowClick={handleEpicHighlight}
                />
                {savedCapacity && (
                  <CapacityVsPointsChart
                    totalCapacity={savedCapacity.totalCapacity}
                    parents={data.parents}
                    highlightedKey={highlightedKey}
                    onEpicClick={handleEpicHighlight}
                  />
                )}
                {savedCapacity && <CapacityGrid capacityData={savedCapacity} />}
              </Box>

              <Divider sx={{ mb: 3 }} />

              {/* ── Story Readiness ── */}
              <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexWrap: 'wrap' }}>

                {/* Count pie */}
                <Box sx={{ flexShrink: 0 }}>
                  <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600, textAlign: 'center' }}>
                    Story Readiness By Count
                  </Typography>
                  <ReadinessPie
                    buckets={readinessBuckets}
                    valueKey="count"
                    highlightedReadiness={highlightedReadiness}
                    onSliceClick={handleReadinessSliceClick}
                  />
                </Box>

                {/* Points pie */}
                <Box sx={{ flexShrink: 0 }}>
                  <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600, textAlign: 'center' }}>
                    Story Readiness By Points
                  </Typography>
                  <ReadinessPie
                    buckets={readinessBuckets}
                    valueKey="points"
                    highlightedReadiness={highlightedReadiness}
                    onSliceClick={handleReadinessSliceClick}
                  />
                </Box>

                {/* Story table */}
                <StoryTable
                  stories={data.stories}
                  highlightedReadiness={highlightedReadiness}
                  highlightedStoryKey={highlightedStoryKey}
                  highlightedEpicKey={highlightedKey}
                  onRowClick={handleStoryRowClick}
                />
              </Box>

            </Box>
          ) : (
            <Box
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'text.secondary',
              }}
            >
              {isLoading ? (
                <>
                  <CircularProgress sx={{ mb: 2 }} />
                  <Typography variant="h6" gutterBottom>
                    Loading Sprint Planning Data...
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6" gutterBottom>
                    {!projectKey
                      ? 'Select a Project'
                      : !boardId
                        ? 'Select a Board'
                        : !selectedSprintId
                          ? 'Select a Sprint'
                          : 'Loading...'}
                  </Typography>
                  <Typography variant="body2">
                    {!projectKey
                      ? 'Choose a JIRA project to get started'
                      : !boardId
                        ? 'Choose a board to load sprints'
                        : !selectedSprintId
                          ? 'Choose a sprint from the sidebar'
                          : ''}
                  </Typography>
                </>
              )}
            </Box>
          )}
        </MainContent>
      </Box>

      <Tooltip title="Refresh data from JIRA">
        <span>
          <Fab
            color="primary"
            aria-label="refresh"
            onClick={handleRefresh}
            disabled={isLoading || !selectedSprintId || !boardId}
            sx={{ position: 'fixed', bottom: 24, right: 24 }}
          >
            {isLoading ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
          </Fab>
        </span>
      </Tooltip>
    </Box>
  );
};

const SprintPlanning = () => {
  return (
    <Suspense
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      }
    >
      <SprintPlanningContent />
    </Suspense>
  );
};

export default SprintPlanning;
