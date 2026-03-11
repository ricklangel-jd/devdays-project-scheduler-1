'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { EPIC_COLORS } from '@/shared/constants';
import type { SprintMetricsData } from '@/frontend/hooks/useSprintMetricsData';

// ── Chart constants ──────────────────────────────────────────────────

const CHART_HEIGHT = 420;
const LEGEND_WIDTH = 180;
const MARGIN = { top: 30, right: LEGEND_WIDTH + 30, bottom: 80, left: 65 };
const POINT_RADIUS = 4;
const LEGEND_ROW_HEIGHT = 22;

// ── Helpers ──────────────────────────────────────────────────────────

const linearRegression = (xs: number[], ys: number[]): { m: number; b: number } => {
  const n = xs.length;
  if (n < 2) return { m: 0, b: ys[0] ?? 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { m: 0, b: sumY / n };

  const m = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;
  return { m, b };
};

// ── Types ────────────────────────────────────────────────────────────

interface CarryoverTrendChartProps {
  data: SprintMetricsData;
}

interface SprintCarryover {
  offset: number;
  sprintName: string;
  carryover: number;
}

// ── Component ────────────────────────────────────────────────────────

const CarryoverTrendChart = ({ data }: CarryoverTrendChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const toggleProject = (pk: string) =>
    setSelectedProject((prev) => (prev === pk ? null : pk));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Build per-project carryover series (sorted by offset ascending = oldest first)
  const { projectKeys, projectNames, projectCarryovers, sprintLabels } = useMemo(() => {
    const offsets = data.grids.map((g) => g.offset).sort((a, b) => a - b);

    const keySet = new Set<string>();
    const nameMap = new Map<string, string>();
    for (const grid of data.grids) {
      for (const row of grid.rows) {
        keySet.add(row.projectKey);
        if (!nameMap.has(row.projectKey)) nameMap.set(row.projectKey, row.projectName);
      }
    }
    const projectKeys = Array.from(keySet);
    const projectNames = nameMap;

    const sprintLabels: string[] = offsets.map((off) => {
      const grid = data.grids.find((g) => g.offset === off);
      if (!grid || grid.rows.length === 0) return `Offset ${off}`;
      return grid.rows[0].sprintName;
    });

    const projectCarryovers = new Map<string, SprintCarryover[]>();

    for (const pk of projectKeys) {
      const series: SprintCarryover[] = [];

      for (const offset of offsets) {
        const grid = data.grids.find((g) => g.offset === offset);
        const row = grid?.rows.find((r) => r.projectKey === pk);
        const sprintName = row?.sprintName ?? `Sprint ${offset}`;
        const carryover = row?.carryoverPoints ?? 0;

        series.push({ offset, sprintName, carryover });
      }

      projectCarryovers.set(pk, series);
    }

    return { projectKeys, projectNames, projectCarryovers, sprintLabels };
  }, [data]);

  const maxCarryover = useMemo(() => {
    let max = 0;
    for (const series of projectCarryovers.values()) {
      for (const s of series) {
        if (s.carryover > max) max = s.carryover;
      }
    }
    return max;
  }, [projectCarryovers]);

  // Chart dimensions
  const svgWidth = containerWidth - 48;
  const chartWidth = svgWidth - MARGIN.left - MARGIN.right;
  const chartHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const pointCount = sprintLabels.length;
  const xStep = pointCount > 1 ? chartWidth / (pointCount - 1) : chartWidth / 2;

  const yScale = useMemo(() => {
    const niceMax = Math.max(10, Math.ceil(maxCarryover * 1.15 / 10) * 10);
    const tickStep = Math.ceil(niceMax / 5 / 5) * 5;
    const ticks: number[] = [];
    for (let v = 0; v <= niceMax; v += tickStep) ticks.push(v);
    return {
      max: niceMax,
      ticks,
      toY: (value: number) => chartHeight - (value / niceMax) * chartHeight,
    };
  }, [maxCarryover, chartHeight]);

  const legendHeight = projectKeys.length * LEGEND_ROW_HEIGHT + 10;
  const svgHeight = Math.max(CHART_HEIGHT, MARGIN.top + legendHeight);

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
      <Paper ref={containerRef} sx={{ px: 3, py: 1.5, overflow: 'hidden' }} elevation={1}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.25 }}>
          Carryover Trend
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Carryover points per project per sprint. Dashed lines show the linear trend.
        </Typography>

        {pointCount === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            No data available. Load metrics first.
          </Typography>
        ) : (
          <svg width={svgWidth} height={svgHeight} style={{ display: 'block', margin: '0 auto' }}>
            <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
              {/* Y-axis gridlines and labels */}
              {yScale.ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={0} y1={yScale.toY(tick)}
                    x2={chartWidth} y2={yScale.toY(tick)}
                    stroke="#e0e0e0" strokeDasharray="4,4"
                  />
                  <text
                    x={-10} y={yScale.toY(tick)}
                    textAnchor="end" dominantBaseline="middle"
                    fontSize={11} fill="#666"
                  >
                    {tick}
                  </text>
                </g>
              ))}

              {/* Y-axis title */}
              <text
                transform={`translate(-50, ${chartHeight / 2}) rotate(-90)`}
                textAnchor="middle" fontSize={12} fill="#666"
              >
                Carryover (pts)
              </text>

              {/* X-axis baseline */}
              <line x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="#bdbdbd" />

              {/* X-axis labels */}
              {sprintLabels.map((label, idx) => {
                const x = pointCount > 1 ? idx * xStep : chartWidth / 2;
                return (
                  <g key={idx}>
                    <line x1={x} y1={chartHeight} x2={x} y2={chartHeight + 6} stroke="#bdbdbd" />
                    <text
                      x={x} y={chartHeight + 14}
                      textAnchor="end" dominantBaseline="hanging"
                      fontSize={10} fill="#666"
                      transform={`rotate(-45, ${x}, ${chartHeight + 14})`}
                    >
                      {label}
                    </text>
                  </g>
                );
              })}

              {/* Lines + trend per project */}
              {projectKeys.map((pk, pkIdx) => {
                const color = EPIC_COLORS[pkIdx % EPIC_COLORS.length];
                const series = projectCarryovers.get(pk) ?? [];
                const dimmed = selectedProject !== null && selectedProject !== pk;
                const groupOpacity = dimmed ? 0.15 : 1;

                const points = series.map((s, idx) => ({
                  x: pointCount > 1 ? idx * xStep : chartWidth / 2,
                  y: yScale.toY(s.carryover),
                  carryover: s.carryover,
                  sprintName: s.sprintName,
                }));

                const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');

                const xs = points.map((_, i) => i);
                const ys = points.map((p) => p.carryover);
                const { m, b } = linearRegression(xs, ys);

                const trendStartY = yScale.toY(b);
                const trendEndY = yScale.toY(m * (points.length - 1) + b);
                const trendStartX = points[0]?.x ?? 0;
                const trendEndX = points[points.length - 1]?.x ?? chartWidth;

                return (
                  <g key={pk} opacity={groupOpacity} onClick={() => toggleProject(pk)} style={{ cursor: 'pointer' }}>
                    {points.length > 1 && (
                      <polyline
                        points={polyline}
                        fill="none" stroke={color}
                        strokeWidth={dimmed ? 2.5 : selectedProject === pk ? 4 : 2.5}
                        strokeLinejoin="round" strokeLinecap="round"
                      />
                    )}

                    {points.length > 1 && (
                      <line
                        x1={trendStartX} y1={trendStartY}
                        x2={trendEndX} y2={trendEndY}
                        stroke={color} strokeWidth={1.5}
                        strokeDasharray="6,4" opacity={0.6}
                      />
                    )}

                    {points.map((p, idx) => (
                      <circle
                        key={idx}
                        cx={p.x} cy={p.y} r={selectedProject === pk ? POINT_RADIUS + 1 : POINT_RADIUS}
                        fill={color} stroke="white" strokeWidth={1.5}
                      >
                        <title>{`${projectNames.get(pk) ?? pk}: ${p.carryover} pts (${p.sprintName})`}</title>
                      </circle>
                    ))}
                  </g>
                );
              })}

              {/* Legend */}
              <g transform={`translate(${chartWidth + 20}, 0)`}>
                <text x={0} y={0} fontSize={11} fontWeight="bold" fill="#333" dominantBaseline="hanging">
                  Projects
                </text>
                {projectKeys.map((pk, idx) => {
                  const color = EPIC_COLORS[idx % EPIC_COLORS.length];
                  const y = 20 + idx * LEGEND_ROW_HEIGHT;
                  const dimmed = selectedProject !== null && selectedProject !== pk;
                  const isSelected = selectedProject === pk;
                  return (
                    <g
                      key={pk}
                      transform={`translate(0, ${y})`}
                      opacity={dimmed ? 0.3 : 1}
                      onClick={() => toggleProject(pk)}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect width={14} height={14} fill={color} rx={2} />
                      <text x={18} y={11} fontSize={11} fill="#333" fontWeight={isSelected ? 'bold' : 'normal'}>{projectNames.get(pk) ?? pk}</text>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        )}
      </Paper>
    </Box>
  );
};

export default CarryoverTrendChart;
