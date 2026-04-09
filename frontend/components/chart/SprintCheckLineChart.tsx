'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import { EPIC_COLORS } from '@/shared/constants';
import type { SprintCheckData, TicketDetail } from '@/frontend/hooks/useSprintCheckData';
import { computeEngineerCapacity, computeTotalCapacity, type EngineerRow } from '@/shared/lib/capacity';

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

interface SprintCheckLineChartProps {
  data: SprintCheckData;
  selectedEngineers: Set<string>;
  highlightedEngineer: string | null;
  highlightedSprintId: number | null;
  onEngineerHighlight: (engineer: string) => void;
  onDataPointClick: (engineer: string, sprintId: number) => void;
  capacityRows?: EngineerRow[];
  capacitySupportPct?: number;
  selectedCapacitySprintId?: number | null;
  onCapacitySprintChange?: (sprintId: number) => void;
}

// Chart layout constants
const CHART_HEIGHT = 450;
const LEGEND_WIDTH = 220;
const MARGIN = { top: 20, right: LEGEND_WIDTH + 20, bottom: 80, left: 65 };
const POINT_RADIUS = 4;
const POINT_RADIUS_HIGHLIGHTED = 6;
const LEGEND_ROW_HEIGHT = 20;

/**
 * Build a stable color map: engineer name → color index
 * based on position in the full engineers array (not the filtered set)
 */
const buildEngineerColorMap = (engineers: string[]): Map<string, number> => {
  const map = new Map<string, number>();
  engineers.forEach((name, idx) => {
    map.set(name, idx);
  });
  return map;
};

/** Detail grid: shows individual tickets for highlighted engineer, or empty state */
const TicketDetailGrid = ({
  tickets,
  sprints,
  highlightedEngineer,
  highlightedSprintId,
}: {
  tickets: TicketDetail[];
  sprints: { id: number; name: string }[];
  highlightedEngineer: string | null;
  highlightedSprintId: number | null;
}) => {
  const filtered = useMemo(() => {
    if (!highlightedEngineer) return [];
    let result = tickets.filter((t) => t.engineer === highlightedEngineer);
    if (highlightedSprintId !== null) {
      result = result.filter((t) => t.sprintId === highlightedSprintId);
    }

    // Build sprint order map (higher index = later sprint)
    const sprintOrder = new Map<number, number>();
    sprints.forEach((s, idx) => sprintOrder.set(s.id, idx));

    // Deduplicate by key, keeping the entry from the latest sprint
    const byKey = new Map<string, TicketDetail>();
    for (const t of result) {
      const existing = byKey.get(t.key);
      if (!existing || (sprintOrder.get(t.sprintId) ?? 0) > (sprintOrder.get(existing.sprintId) ?? 0)) {
        byKey.set(t.key, t);
      }
    }

    const deduped = Array.from(byKey.values());
    deduped.sort((a, b) => a.key.localeCompare(b.key));
    return deduped;
  }, [tickets, sprints, highlightedEngineer, highlightedSprintId]);

  const sprintLabel = highlightedSprintId !== null
    ? filtered[0]?.sprintName ?? ''
    : 'all selected sprints';

  return (
    <Paper sx={{ p: 1.5, flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }} elevation={1}>
      {highlightedEngineer ? (
        <>
          <Typography variant="subtitle2" sx={{ mb: 0.25, fontSize: 13 }}>
            {highlightedEngineer} — {sprintLabel}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, fontSize: 11 }}>
            {filtered.length} item{filtered.length !== 1 ? 's' : ''} · {filtered.reduce((sum, t) => sum + t.storyPoints, 0)} total points
          </Typography>
        </>
      ) : (
        <Typography variant="subtitle2" sx={{ mb: 0.25, fontSize: 13 }}>
          Engineer Items
        </Typography>
      )}
      <TableContainer sx={{ flex: 1, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', py: 0.5, fontSize: 11 }}>Key</TableCell>
              <TableCell sx={{ fontWeight: 'bold', py: 0.5, fontSize: 11 }}>Summary</TableCell>
              <TableCell align="right" sx={{ fontWeight: 'bold', py: 0.5, fontSize: 11, width: 40 }}>Pts</TableCell>
              <TableCell sx={{ fontWeight: 'bold', py: 0.5, fontSize: 11, width: 110 }}>Sprint</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((ticket) => (
              <TableRow key={ticket.key} hover>
                <TableCell sx={{ py: 0.25, whiteSpace: 'nowrap', fontSize: 11 }}>
                  {JIRA_BASE_URL ? (
                    <Link
                      href={`${JIRA_BASE_URL}/browse/${ticket.key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      underline="hover"
                      sx={{ fontSize: 11, fontWeight: 500 }}
                    >
                      {ticket.key}
                    </Link>
                  ) : (
                    ticket.key
                  )}
                </TableCell>
                <TableCell sx={{ py: 0.25, fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ticket.summary}
                </TableCell>
                <TableCell align="right" sx={{ py: 0.25, fontSize: 11 }}>{ticket.storyPoints}</TableCell>
                <TableCell sx={{ py: 0.25, fontSize: 11, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ticket.sprintName}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} sx={{ textAlign: 'center', py: 3, color: 'text.secondary', fontSize: 12 }}>
                  {highlightedEngineer ? 'No items found' : 'Click an engineer to view their items'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

/** Read-only engineer capacity grid for Sprint Check page */
const ReadOnlyCapacityGrid = ({
  rows,
  supportPct,
}: {
  rows: EngineerRow[];
  supportPct: number;
}) => {
  const totalCapacity = computeTotalCapacity(rows, supportPct);
  const colSx = { fontSize: '0.78rem', py: 0.4, px: 1 };
  const headerSx = { ...colSx, fontWeight: 700, bgcolor: 'grey.100', whiteSpace: 'nowrap' as const };

  return (
    <Paper sx={{ p: 1, flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }} elevation={1}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ fontSize: 13 }}>
          Engineer Capacity
        </Typography>
        <Typography variant="caption" color="primary.main" sx={{ fontWeight: 600 }}>
          {totalCapacity} pts{supportPct > 0 ? ` (${supportPct}% support)` : ''}
        </Typography>
      </Box>
      <TableContainer sx={{ flex: 1, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={headerSx}>Engineer</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'center' }}>TL</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Days Out</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>% Cap</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Capacity</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const capacity = computeEngineerCapacity(row);
              return (
                <TableRow
                  key={row.name}
                  sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' }, opacity: row.ignore ? 0.45 : 1 }}
                >
                  <TableCell sx={colSx}>{row.name}</TableCell>
                  <TableCell sx={{ ...colSx, textAlign: 'center', color: row.isTechLead ? 'primary.main' : 'transparent' }}>
                    ✓
                  </TableCell>
                  <TableCell sx={{ ...colSx, textAlign: 'right' }}>{row.daysOut}</TableCell>
                  <TableCell sx={{ ...colSx, textAlign: 'right' }}>{row.capacityPct}%</TableCell>
                  <TableCell sx={{ ...colSx, textAlign: 'right', fontWeight: 600, color: capacity === 0 ? 'text.disabled' : 'text.primary' }}>
                    {capacity}
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow sx={{ borderTop: '2px solid', borderColor: 'grey.300' }}>
              <TableCell sx={{ ...colSx, fontWeight: 700 }} colSpan={4}>Total</TableCell>
              <TableCell sx={{ ...colSx, textAlign: 'right', fontWeight: 700 }}>{totalCapacity}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

const SprintCheckLineChart = ({
  data,
  selectedEngineers,
  highlightedEngineer,
  highlightedSprintId,
  onEngineerHighlight,
  onDataPointClick,
  capacityRows,
  capacitySupportPct = 10,
  selectedCapacitySprintId,
  onCapacitySprintChange,
}: SprintCheckLineChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // Responsive width tracking
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const engineerColorMap = useMemo(() => buildEngineerColorMap(data.engineers), [data.engineers]);

  // Build per-engineer per-sprint lookup: engineer → sprintId → totalPoints
  const engineerSprintMap = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    for (const entry of data.sprintData) {
      if (!map.has(entry.engineer)) {
        map.set(entry.engineer, new Map());
      }
      map.get(entry.engineer)!.set(entry.sprintId, entry.totalPoints);
    }
    return map;
  }, [data.sprintData]);

  // Max value across all visible engineers (exclude Unassigned)
  const maxValue = useMemo(() => {
    let max = 0;
    for (const entry of data.sprintData) {
      if (entry.engineer === 'Unassigned') continue;
      if (selectedEngineers.has(entry.engineer) && entry.totalPoints > max) {
        max = entry.totalPoints;
      }
    }
    return max;
  }, [data.sprintData, selectedEngineers]);

  // Chart dimensions
  const svgWidth = containerWidth - 48; // account for Paper padding
  const chartWidth = svgWidth - MARGIN.left - MARGIN.right;
  const chartHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const sprintCount = data.sprints.length;

  // X-axis step: evenly space sprints
  const xStep = sprintCount > 1 ? chartWidth / (sprintCount - 1) : chartWidth / 2;

  // Y-axis scale with nice ticks
  const yScale = useMemo(() => {
    const niceMax = Math.max(10, Math.ceil(maxValue * 1.15 / 10) * 10);
    const tickCount = 5;
    const tickStep = Math.ceil(niceMax / tickCount / 5) * 5;
    const ticks: number[] = [];
    for (let v = 0; v <= niceMax; v += tickStep) {
      ticks.push(v);
    }
    return {
      max: niceMax,
      ticks,
      toY: (value: number) => chartHeight - (value / niceMax) * chartHeight,
    };
  }, [maxValue, chartHeight]);

  // Visible engineers for legend (exclude Unassigned from the line chart)
  const visibleEngineers = useMemo(
    () => data.engineers.filter((e) => e !== 'Unassigned' && selectedEngineers.has(e)),
    [data.engineers, selectedEngineers]
  );

  // Legend height for SVG sizing
  const legendHeight = visibleEngineers.length * LEGEND_ROW_HEIGHT + 10;
  const svgHeight = Math.max(CHART_HEIGHT, MARGIN.top + legendHeight);

  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', m: 2 }}>
      {/* Chart */}
      <Paper
        ref={containerRef}
        sx={{ px: 3, py: 1.5, overflow: 'hidden', flex: 1, minWidth: 0 }}
        elevation={1}
      >
        <Typography variant="h6" sx={{ mb: 0.25 }}>
          Story Points by Engineer
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          Total story points per engineer across selected sprints
          {highlightedEngineer && (
            <Typography component="span" variant="body2" color="primary" sx={{ ml: 1, fontWeight: 'bold' }}>
              — Showing: {highlightedEngineer}
            </Typography>
          )}
        </Typography>

        <svg
          width={svgWidth}
          height={svgHeight}
          style={{ display: 'block', margin: '0 auto' }}
        >
          <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
            {/* Y-axis gridlines and labels */}
            {yScale.ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={0}
                  y1={yScale.toY(tick)}
                  x2={chartWidth}
                  y2={yScale.toY(tick)}
                  stroke="#e0e0e0"
                  strokeDasharray="4,4"
                />
                <text
                  x={-10}
                  y={yScale.toY(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="#666"
                >
                  {tick}
                </text>
              </g>
            ))}

            {/* Y-axis title */}
            <text
              transform={`translate(-50, ${chartHeight / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize={12}
              fill="#666"
            >
              Story Points
            </text>

            {/* X-axis baseline */}
            <line
              x1={0}
              y1={chartHeight}
              x2={chartWidth}
              y2={chartHeight}
              stroke="#bdbdbd"
            />

            {/* X-axis labels (sprint names, rotated) */}
            {data.sprints.map((sprint, idx) => {
              const x = sprintCount > 1 ? idx * xStep : chartWidth / 2;
              return (
                <g key={sprint.id}>
                  {/* Vertical tick */}
                  <line
                    x1={x}
                    y1={chartHeight}
                    x2={x}
                    y2={chartHeight + 6}
                    stroke="#bdbdbd"
                  />
                  <text
                    x={x}
                    y={chartHeight + 14}
                    textAnchor="end"
                    dominantBaseline="hanging"
                    fontSize={10}
                    fill="#666"
                    transform={`rotate(-45, ${x}, ${chartHeight + 14})`}
                  >
                    {sprint.name}
                  </text>
                </g>
              );
            })}

            {/* Lines and data points for each visible engineer */}
            {visibleEngineers.map((engineer) => {
              const colorIdx = engineerColorMap.get(engineer) ?? 0;
              const color = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
              const sprintMap = engineerSprintMap.get(engineer);
              const isHighlighted = highlightedEngineer === engineer;
              const isDimmed = highlightedEngineer !== null && !isHighlighted;

              // Build points array
              const points = data.sprints.map((sprint, idx) => {
                const x = sprintCount > 1 ? idx * xStep : chartWidth / 2;
                const pts = sprintMap?.get(sprint.id) ?? 0;
                const y = yScale.toY(pts);
                return { x, y, pts, sprintName: sprint.name, sprintId: sprint.id };
              });

              // Filter to only sprints where engineer has data
              const activePoints = points.filter((p) => p.pts > 0);

              // Polyline string (only connect points that have data)
              const polylinePoints = activePoints.map((p) => `${p.x},${p.y}`).join(' ');

              return (
                <g
                  key={engineer}
                  opacity={isDimmed ? 0.15 : 1}
                  style={{ transition: 'opacity 0.2s ease' }}
                >
                  {/* Line connecting data points */}
                  {activePoints.length > 1 && (
                    <polyline
                      points={polylinePoints}
                      fill="none"
                      stroke={color}
                      strokeWidth={isHighlighted ? 3.5 : 2.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  )}

                  {/* Data point circles */}
                  {activePoints.map((p, idx) => {
                    const isPointHighlighted = isHighlighted && highlightedSprintId === p.sprintId;
                    const radius = isPointHighlighted ? POINT_RADIUS_HIGHLIGHTED : (isHighlighted ? POINT_RADIUS + 1 : POINT_RADIUS);
                    return (
                      <g key={idx}>
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={radius}
                          fill={isPointHighlighted ? '#fff' : color}
                          stroke={isPointHighlighted ? color : 'white'}
                          strokeWidth={isPointHighlighted ? 3 : 1.5}
                          style={{ cursor: 'pointer' }}
                          onClick={() => onDataPointClick(engineer, p.sprintId)}
                        >
                          <title>{`${engineer}: ${p.pts} pts (${p.sprintName})`}</title>
                        </circle>
                        <text
                          x={p.x}
                          y={p.y - (radius + 6)}
                          textAnchor="middle"
                          dominantBaseline="auto"
                          fontSize={10}
                          fill={color}
                          fontWeight="600"
                          pointerEvents="none"
                        >
                          {p.pts}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Right legend (clickable) */}
            <g transform={`translate(${chartWidth + 20}, 0)`}>
              <text
                x={0}
                y={0}
                fontSize={11}
                fontWeight="bold"
                fill="#333"
                dominantBaseline="hanging"
              >
                Engineers
              </text>
              {visibleEngineers.map((engineer, idx) => {
                const colorIdx = engineerColorMap.get(engineer) ?? 0;
                const color = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
                const y = 20 + idx * LEGEND_ROW_HEIGHT;
                const displayName = engineer.length > 22
                  ? engineer.slice(0, 20) + '...'
                  : engineer;
                const isHighlighted = highlightedEngineer === engineer;
                const isDimmed = highlightedEngineer !== null && !isHighlighted;

                return (
                  <g
                    key={engineer}
                    transform={`translate(0, ${y})`}
                    style={{ cursor: 'pointer' }}
                    opacity={isDimmed ? 0.35 : 1}
                    onClick={() => onEngineerHighlight(engineer)}
                  >
                    <rect
                      width={14}
                      height={14}
                      fill={color}
                      rx={2}
                    />
                    <text
                      x={18}
                      y={11}
                      fontSize={11}
                      fill="#333"
                      fontWeight={isHighlighted ? 'bold' : 'normal'}
                      textDecoration={isHighlighted ? 'underline' : 'none'}
                    >
                      {displayName}
                    </text>
                    {/* Invisible wider hitbox for easier clicking */}
                    <rect
                      width={LEGEND_WIDTH - 20}
                      height={LEGEND_ROW_HEIGHT}
                      fill="transparent"
                      y={-3}
                    />
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
      </Paper>

      {/* Right panel: sprint picker + capacity grid + ticket detail grid */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: CHART_HEIGHT + 60, minWidth: 380, maxWidth: 520, overflow: 'hidden' }}>
        {onCapacitySprintChange && data.sprints.length > 0 && (
          <TextField
            select
            size="small"
            label="Capacity Sprint"
            value={selectedCapacitySprintId ?? ''}
            onChange={(e) => onCapacitySprintChange(Number(e.target.value))}
            sx={{ width: '100%' }}
          >
            {data.sprints.map((s) => (
              <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
            ))}
          </TextField>
        )}
        {capacityRows && capacityRows.length > 0 && (
          <ReadOnlyCapacityGrid rows={capacityRows} supportPct={capacitySupportPct} />
        )}
        <TicketDetailGrid
          tickets={data.tickets}
          sprints={data.sprints}
          highlightedEngineer={highlightedEngineer}
          highlightedSprintId={highlightedSprintId}
        />
      </Box>
    </Box>
  );
};

export default SprintCheckLineChart;
