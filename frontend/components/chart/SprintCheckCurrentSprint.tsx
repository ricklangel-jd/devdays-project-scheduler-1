'use client';

import { useMemo } from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { EPIC_COLORS } from '@/shared/constants';
import type { SprintCheckData, TicketDetail } from '@/frontend/hooks/useSprintCheckData';

type CurrentSprintData = SprintCheckData['currentSprint'];

interface SprintCheckCurrentSprintProps {
  currentSprint: CurrentSprintData;
  tickets: TicketDetail[];
  highlightedEngineer: string | null;
  onEngineerHighlight: (engineer: string) => void;
}

// Status stacking order: bottom → top
const STATUS_ORDER = [
  'resolved', 'ready for production', 'acceptance', 'in review',
  'in test', 'in progress', 'backlog', 'planning', 'ready', 'blocked',
];

const STATUS_COLORS: Record<string, string> = {
  'resolved': '#4caf50',
  'done': '#4caf50',
  'closed': '#2e7d32',
  'ready for production': '#66bb6a',
  'acceptance': '#ab47bc',
  'in review': '#7e57c2',
  'in test': '#ffa726',
  'testing': '#ffa726',
  'in progress': '#42a5f5',
  'in development': '#42a5f5',
  'backlog': '#b0bec5',
  'planning': '#90a4ae',
  'to do': '#90a4ae',
  'open': '#90a4ae',
  'ready': '#2196f3',
  'blocked': '#ef5350',
};

const FALLBACK_STATUS_COLORS = [
  '#78909c', '#8d6e63', '#ff7043', '#26a69a', '#5c6bc0',
];

const getStatusColor = (status: string, fallbackIndex: number): string => {
  const lower = status.toLowerCase();
  return STATUS_COLORS[lower] ?? FALLBACK_STATUS_COLORS[fallbackIndex % FALLBACK_STATUS_COLORS.length];
};

/** Get the sort index for a status (lower = bottom of stack) */
const getStatusOrder = (status: string): number => {
  const idx = STATUS_ORDER.indexOf(status.toLowerCase());
  return idx >= 0 ? idx : STATUS_ORDER.length; // unknown statuses go between ready and blocked
};

// Pie chart constants (50% larger than original 220/90)
const PIE_SIZE = 330;
const PIE_RADIUS = 135;
const PIE_CENTER = PIE_SIZE / 2;

interface PieSlice {
  engineer: string;
  points: number;
  percentage: number;
  color: string;
}

const EngineerPieChart = ({
  currentSprint,
  highlightedEngineer,
  onEngineerHighlight,
}: {
  currentSprint: NonNullable<CurrentSprintData>;
  highlightedEngineer: string | null;
  onEngineerHighlight: (engineer: string) => void;
}) => {
  const { slices, totalPoints } = useMemo(() => {
    const result: PieSlice[] = currentSprint.engineers.map((eng, idx) => ({
      engineer: eng.engineer,
      points: eng.totalPoints,
      percentage: eng.percentage,
      color: EPIC_COLORS[idx % EPIC_COLORS.length],
    }));

    return { slices: result, totalPoints: currentSprint.totalPoints };
  }, [currentSprint]);

  if (totalPoints === 0) {
    return (
      <Box sx={{ textAlign: 'center', p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          No story points in current sprint
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

    // For a full circle (single engineer), use two arcs
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: PIE_SIZE + 20 }}>
      <svg width={PIE_SIZE} height={PIE_SIZE}>
        {/* Pie slices */}
        {arcs.map((arc) => {
          const isHighlighted = highlightedEngineer === arc.engineer;
          const isDimmed = highlightedEngineer !== null && !isHighlighted;
          return (
            <path
              key={arc.engineer}
              d={arc.path}
              fill={arc.color}
              stroke={isHighlighted ? '#333' : 'white'}
              strokeWidth={isHighlighted ? 3 : 2}
              opacity={isDimmed ? 0.25 : 1}
              style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
              onClick={() => onEngineerHighlight(arc.engineer)}
            >
              <title>{`${arc.engineer}: ${arc.points} pts (${arc.percentage}%)`}</title>
            </path>
          );
        })}
      </svg>
    </Box>
  );
};

// Stacked column chart constants
const STACK_CHART_HEIGHT = 330;
const STACK_MARGIN = { top: 15, right: 15, bottom: 70, left: 45 };
const BAR_WIDTH = 50;
const BAR_GAP = 20;
interface StatusSegment {
  status: string;
  points: number;
  color: string;
  tickets: { key: string; summary: string; points: number }[];
}

interface StackedBarSegment extends StatusSegment {
  y: number;
  height: number;
}

interface EngineerBar {
  engineer: string;
  totalPoints: number;
  segments: StatusSegment[];
}

const StatusStackedChart = ({
  currentSprint,
  tickets,
  highlightedEngineer,
  onEngineerHighlight,
}: {
  currentSprint: NonNullable<CurrentSprintData>;
  tickets: TicketDetail[];
  highlightedEngineer: string | null;
  onEngineerHighlight: (engineer: string) => void;
}) => {
  const { bars, maxPoints, legendStatuses } = useMemo(() => {
    // Filter tickets for current sprint and deduplicate by key
    const sprintTickets = tickets.filter((t) => t.sprintId === currentSprint.id);
    const byKey = new Map<string, TicketDetail>();
    for (const t of sprintTickets) {
      byKey.set(t.key, t); // last occurrence wins (dedup)
    }
    const deduped = Array.from(byKey.values());

    // Group by engineer → status → tickets
    const engineerMap = new Map<string, Map<string, TicketDetail[]>>();
    for (const t of deduped) {
      if (!engineerMap.has(t.engineer)) engineerMap.set(t.engineer, new Map());
      const statusMap = engineerMap.get(t.engineer)!;
      const lower = t.status.toLowerCase();
      if (!statusMap.has(lower)) statusMap.set(lower, []);
      statusMap.get(lower)!.push(t);
    }

    // Track all statuses that appear
    const allStatuses = new Set<string>();

    // Build bars sorted by total points descending
    let maxPts = 0;
    const result: EngineerBar[] = Array.from(engineerMap.entries())
      .map(([engineer, statusMap]) => {
        // Build segments in status order
        const segments: { status: string; displayStatus: string; points: number; color: string; tickets: { key: string; summary: string; points: number }[] }[] = [];

        // Collect all statuses for this engineer, sort by STATUS_ORDER
        const statusEntries = Array.from(statusMap.entries()).sort(
          (a, b) => getStatusOrder(a[0]) - getStatusOrder(b[0])
        );

        let fallbackIdx = 0;
        for (const [statusLower, statusTickets] of statusEntries) {
          const pts = statusTickets.reduce((sum, t) => sum + t.storyPoints, 0);
          if (pts === 0) continue;
          allStatuses.add(statusLower);
          segments.push({
            status: statusLower,
            displayStatus: statusTickets[0].status, // preserve original casing
            points: pts,
            color: getStatusColor(statusLower, fallbackIdx++),
            tickets: statusTickets.map((t) => ({ key: t.key, summary: t.summary, points: t.storyPoints })),
          });
        }

        const totalPoints = segments.reduce((sum, s) => sum + s.points, 0);
        if (totalPoints > maxPts) maxPts = totalPoints;
        return { engineer, totalPoints, segments };
      })
      .filter((b) => b.totalPoints > 0)
      .sort((a, b) => b.totalPoints - a.totalPoints);

    // Build legend entries from all statuses in order
    const legendEntries = Array.from(allStatuses)
      .sort((a, b) => getStatusOrder(a) - getStatusOrder(b))
      .map((s, idx) => ({
        status: s,
        // Find original casing from any ticket
        display: deduped.find((t) => t.status.toLowerCase() === s)?.status ?? s,
        color: getStatusColor(s, idx),
      }));

    return { bars: result, maxPoints: maxPts, legendStatuses: legendEntries };
  }, [tickets, currentSprint.id]);

  if (bars.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', p: 2, minWidth: 200 }}>
        <Typography variant="body2" color="text.secondary">
          No pointed tickets in current sprint
        </Typography>
      </Box>
    );
  }

  const chartWidth = STACK_MARGIN.left + bars.length * (BAR_WIDTH + BAR_GAP) - BAR_GAP + STACK_MARGIN.right;
  const chartInnerHeight = STACK_CHART_HEIGHT - STACK_MARGIN.top - STACK_MARGIN.bottom;

  // Y-axis scale
  const yMax = maxPoints > 0 ? maxPoints : 1;
  const yScale = (val: number) => chartInnerHeight - (val / yMax) * chartInnerHeight;

  // Gridlines (nice round numbers)
  const gridStep = yMax <= 5 ? 1 : yMax <= 20 ? 5 : yMax <= 50 ? 10 : Math.ceil(yMax / 5 / 10) * 10;
  const gridLines: number[] = [];
  for (let v = gridStep; v <= yMax; v += gridStep) {
    gridLines.push(v);
  }

  // Compute y positions for each segment (stack bottom-up)
  const barsWithPositions = bars.map((bar) => {
    let currentY = 0;
    const positioned = bar.segments.map((seg) => {
      const height = (seg.points / yMax) * chartInnerHeight;
      const y = chartInnerHeight - currentY - height;
      currentY += height;
      return { ...seg, y, height };
    });
    return { ...bar, segments: positioned };
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: Math.max(chartWidth, 250) }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5, textAlign: 'center', fontSize: 12 }}>
        Status Breakdown
      </Typography>
      <svg width={chartWidth} height={STACK_CHART_HEIGHT} style={{ display: 'block' }}>
        <g transform={`translate(${STACK_MARGIN.left}, ${STACK_MARGIN.top})`}>
          {/* Gridlines */}
          {gridLines.map((v) => (
            <g key={v}>
              <line
                x1={0}
                y1={yScale(v)}
                x2={chartWidth - STACK_MARGIN.left - STACK_MARGIN.right}
                y2={yScale(v)}
                stroke="#e0e0e0"
                strokeDasharray="3,3"
              />
              <text x={-8} y={yScale(v) + 4} textAnchor="end" fontSize={10} fill="#666">
                {v}
              </text>
            </g>
          ))}
          {/* Zero line */}
          <line
            x1={0}
            y1={chartInnerHeight}
            x2={chartWidth - STACK_MARGIN.left - STACK_MARGIN.right}
            y2={chartInnerHeight}
            stroke="#bdbdbd"
          />
          <text x={-8} y={chartInnerHeight + 4} textAnchor="end" fontSize={10} fill="#666">
            0
          </text>

          {/* Bars */}
          {barsWithPositions.map((bar, barIdx) => {
            const isHighlighted = highlightedEngineer === bar.engineer;
            const isDimmed = highlightedEngineer !== null && !isHighlighted;
            const x = barIdx * (BAR_WIDTH + BAR_GAP);

            return (
              <g
                key={bar.engineer}
                opacity={isDimmed ? 0.25 : 1}
                style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
                onClick={() => onEngineerHighlight(bar.engineer)}
              >
                {bar.segments.map((seg, segIdx) => (
                  <rect
                    key={`${bar.engineer}-${seg.status}-${segIdx}`}
                    x={x}
                    y={seg.y}
                    width={BAR_WIDTH}
                    height={Math.max(seg.height, 1)}
                    fill={seg.color}
                    stroke={isHighlighted ? '#333' : 'white'}
                    strokeWidth={isHighlighted ? 1.5 : 0.5}
                  >
                    <title>{`${bar.engineer}\n${seg.status}: ${seg.points} pts\n${seg.tickets.map((t) => `${t.key}: ${t.summary} (${t.points})`).join('\n')}`}</title>
                  </rect>
                ))}
                {/* Total label on top of bar */}
                <text
                  x={x + BAR_WIDTH / 2}
                  y={yScale(bar.totalPoints) - 4}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={isHighlighted ? 'bold' : 'normal'}
                  fill="#333"
                >
                  {bar.totalPoints}
                </text>
                {/* Engineer name on X axis */}
                <text
                  x={x + BAR_WIDTH / 2}
                  y={chartInnerHeight + 12}
                  textAnchor="end"
                  fontSize={10}
                  fill="#333"
                  fontWeight={isHighlighted ? 'bold' : 'normal'}
                  transform={`rotate(-45, ${x + BAR_WIDTH / 2}, ${chartInnerHeight + 12})`}
                >
                  {bar.engineer.length > 15 ? `${bar.engineer.slice(0, 14)}…` : bar.engineer}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5, justifyContent: 'center', px: 1 }}>
        {legendStatuses.map((ls) => (
          <Box key={ls.status} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 1 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: ls.color, flexShrink: 0 }} />
            <Typography variant="caption" sx={{ fontSize: 10, whiteSpace: 'nowrap' }}>
              {ls.display}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

const SprintCheckCurrentSprint = ({ currentSprint, tickets, highlightedEngineer, onEngineerHighlight }: SprintCheckCurrentSprintProps) => {
  if (!currentSprint) {
    return (
      <Paper sx={{ px: 3, py: 2, m: 2 }} elevation={1}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Current Sprint
        </Typography>
        <Typography variant="body2" color="text.secondary">
          No active sprint detected for this board
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ px: 3, py: 1.5, m: 2 }} elevation={1}>
      <Typography variant="h6" sx={{ mb: 0.25 }}>
        Current Sprint: {currentSprint.name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Story point distribution by engineer ({currentSprint.totalPoints} total points)
      </Typography>

      <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Pie chart */}
        <EngineerPieChart
          currentSprint={currentSprint}
          highlightedEngineer={highlightedEngineer}
          onEngineerHighlight={onEngineerHighlight}
        />

        {/* Table */}
        <TableContainer sx={{ flex: 1, minWidth: 300, maxHeight: 400 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>Engineer</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold', width: 110 }}>Story Points</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold', width: 100 }}>% of Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {currentSprint.engineers.map((eng, idx) => {
                const isHighlighted = highlightedEngineer === eng.engineer;
                const isDimmed = highlightedEngineer !== null && !isHighlighted;
                return (
                  <TableRow
                    key={eng.engineer}
                    hover
                    onClick={() => onEngineerHighlight(eng.engineer)}
                    sx={{
                      cursor: 'pointer',
                      opacity: isDimmed ? 0.4 : 1,
                      transition: 'opacity 0.2s ease',
                      backgroundColor: isHighlighted ? 'action.selected' : undefined,
                    }}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            borderRadius: '2px',
                            backgroundColor: EPIC_COLORS[idx % EPIC_COLORS.length],
                            flexShrink: 0,
                          }}
                        />
                        <Typography
                          component="span"
                          sx={{
                            fontSize: 'inherit',
                            fontWeight: isHighlighted ? 'bold' : 'normal',
                            textDecoration: isHighlighted ? 'underline' : 'none',
                          }}
                        >
                          {eng.engineer}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="right">{eng.totalPoints}</TableCell>
                    <TableCell align="right">{eng.percentage}%</TableCell>
                  </TableRow>
                );
              })}
              {/* Total row */}
              <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: '2px solid', borderColor: 'divider' } }}>
                <TableCell>Total</TableCell>
                <TableCell align="right">{currentSprint.totalPoints}</TableCell>
                <TableCell align="right">100%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>

        {/* Stacked column chart: status breakdown per engineer */}
        <StatusStackedChart
          currentSprint={currentSprint}
          tickets={tickets}
          highlightedEngineer={highlightedEngineer}
          onEngineerHighlight={onEngineerHighlight}
        />
      </Box>
    </Paper>
  );
};

export default SprintCheckCurrentSprint;
