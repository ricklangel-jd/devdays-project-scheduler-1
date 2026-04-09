'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { EPIC_COLORS } from '@/shared/constants';
import { sprintLabelFromName } from '@/shared/lib/sprint';
import type { SprintMetricsData } from '@/frontend/hooks/useSprintMetricsData';

// ── Chart constants ──────────────────────────────────────────────────

const CHART_HEIGHT = 420;
const BAR_MARGIN = { top: 30, right: 30, bottom: 100, left: 65 };
const BAR_GAP = 0.3;

const LINE_LEGEND_WIDTH = 180;
const LINE_MARGIN = { top: 30, right: LINE_LEGEND_WIDTH + 30, bottom: 80, left: 65 };
const POINT_RADIUS = 4;
const LEGEND_ROW_HEIGHT = 22;

// ── Types ────────────────────────────────────────────────────────────

interface SprintPointsByTeamChartProps {
  data: SprintMetricsData;
}

interface TeamPoints {
  projectKey: string;
  projectName: string;
  resolvedPoints: number;
  sprintName: string;
}

// ── Component ────────────────────────────────────────────────────────

const SprintPointsByTeamChart = ({ data }: SprintPointsByTeamChartProps) => {
  const barContainerRef = useRef<HTMLDivElement>(null);
  const lineContainerRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(500);
  const [lineWidth, setLineWidth] = useState(500);

  // Default to offset -1 (1 sprint back); fall back to whatever is available
  const defaultOffset = data.grids.find((g) => g.offset === -1)?.offset
    ?? data.grids[0]?.offset
    ?? -1;
  const [selectedOffset, setSelectedOffset] = useState<number>(defaultOffset);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const toggleProject = (pk: string) =>
    setSelectedProject((prev) => (prev === pk ? null : pk));

  useEffect(() => {
    const observe = (el: HTMLDivElement | null, setter: (w: number) => void) => {
      if (!el) return () => {};
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) setter(entry.contentRect.width);
      });
      observer.observe(el);
      return () => observer.disconnect();
    };
    const cleanBar = observe(barContainerRef.current, setBarWidth);
    const cleanLine = observe(lineContainerRef.current, setLineWidth);
    return () => { cleanBar(); cleanLine(); };
  }, []);

  // ── Bar chart data ────────────────────────────────────────────────

  const { teams, sprintLabel } = useMemo(() => {
    const grid = data.grids.find((g) => g.offset === selectedOffset);
    if (!grid) return { teams: [] as TeamPoints[], sprintLabel: '' };

    const teams: TeamPoints[] = grid.rows.map((row) => ({
      projectKey: row.projectKey,
      projectName: row.projectName,
      resolvedPoints: row.resolvedPoints,
      sprintName: row.sprintName,
    }));

    return { teams, sprintLabel: grid.label };
  }, [data, selectedOffset]);

  const maxBarPoints = useMemo(() => {
    let max = 0;
    for (const t of teams) if (t.resolvedPoints > max) max = t.resolvedPoints;
    return max;
  }, [teams]);

  const barChartWidth = barWidth - 48;
  const barChartArea = barChartWidth - BAR_MARGIN.left - BAR_MARGIN.right;
  const barChartHeight = CHART_HEIGHT - BAR_MARGIN.top - BAR_MARGIN.bottom;

  const barYScale = useMemo(() => {
    const niceMax = Math.max(10, Math.ceil(maxBarPoints * 1.15 / 10) * 10);
    const tickStep = Math.ceil(niceMax / 5 / 5) * 5;
    const ticks: number[] = [];
    for (let v = 0; v <= niceMax; v += tickStep) ticks.push(v);
    return { max: niceMax, ticks, toY: (v: number) => barChartHeight - (v / niceMax) * barChartHeight };
  }, [maxBarPoints, barChartHeight]);

  const barCount = teams.length;
  const totalBarWidth = barCount > 0 ? barChartArea / barCount : 0;
  const barW = totalBarWidth * (1 - BAR_GAP);
  const barOff = totalBarWidth * BAR_GAP / 2;

  // ── Line chart data ───────────────────────────────────────────────

  const { projectKeys, projectNames, projectSeries, lineSprintLabels } = useMemo(() => {
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

    const lineSprintLabels = offsets.map((off) => {
      const grid = data.grids.find((g) => g.offset === off);
      const name = grid?.rows[0]?.sprintName ?? '';
      return name ? sprintLabelFromName(name) : `Offset ${off}`;
    });

    const projectSeries = new Map<string, { points: number; sprintLabel: string }[]>();
    for (const pk of projectKeys) {
      const series = offsets.map((off, idx) => {
        const grid = data.grids.find((g) => g.offset === off);
        const row = grid?.rows.find((r) => r.projectKey === pk);
        return { points: row?.resolvedPoints ?? 0, sprintLabel: lineSprintLabels[idx] };
      });
      projectSeries.set(pk, series);
    }

    return { projectKeys, projectNames: nameMap, projectSeries, lineSprintLabels };
  }, [data]);

  const maxLinePoints = useMemo(() => {
    let max = 0;
    for (const series of projectSeries.values()) {
      for (const { points } of series) if (points > max) max = points;
    }
    return max;
  }, [projectSeries]);

  const lineSvgWidth = lineWidth - 48;
  const lineChartArea = lineSvgWidth - LINE_MARGIN.left - LINE_MARGIN.right;
  const lineChartHeight = CHART_HEIGHT - LINE_MARGIN.top - LINE_MARGIN.bottom;
  const pointCount = lineSprintLabels.length;
  const xStep = pointCount > 1 ? lineChartArea / (pointCount - 1) : lineChartArea / 2;

  const lineYScale = useMemo(() => {
    const niceMax = Math.max(10, Math.ceil(maxLinePoints * 1.15 / 10) * 10);
    const tickStep = Math.ceil(niceMax / 5 / 5) * 5;
    const ticks: number[] = [];
    for (let v = 0; v <= niceMax; v += tickStep) ticks.push(v);
    return { max: niceMax, ticks, toY: (v: number) => lineChartHeight - (v / niceMax) * lineChartHeight };
  }, [maxLinePoints, lineChartHeight]);

  const legendHeight = projectKeys.length * LEGEND_ROW_HEIGHT + 10;
  const lineSvgHeight = Math.max(CHART_HEIGHT, LINE_MARGIN.top + legendHeight);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <Box sx={{ display: 'flex', gap: 2, p: 1, overflow: 'auto' }}>

      {/* ── Bar chart ── */}
      <Paper ref={barContainerRef} sx={{ px: 3, py: 1.5, overflow: 'hidden', flex: 1, minWidth: 0 }} elevation={1}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Sprint Points by Team
          </Typography>
          <TextField
            select
            size="small"
            value={selectedOffset}
            onChange={(e) => setSelectedOffset(Number(e.target.value))}
            sx={{ minWidth: 160 }}
          >
            {data.grids.map((g) => (
              <MenuItem key={g.offset} value={g.offset}>{g.label}</MenuItem>
            ))}
          </TextField>
        </Box>

        {barCount === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            No data available for the selected sprint.
          </Typography>
        ) : (
          <svg width={barChartWidth} height={CHART_HEIGHT} style={{ display: 'block', margin: '0 auto' }}>
            <g transform={`translate(${BAR_MARGIN.left}, ${BAR_MARGIN.top})`}>
              {barYScale.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={0} y1={barYScale.toY(tick)} x2={barChartArea} y2={barYScale.toY(tick)} stroke="#e0e0e0" strokeDasharray="4,4" />
                  <text x={-10} y={barYScale.toY(tick)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#666">{tick}</text>
                </g>
              ))}
              <text transform={`translate(-50, ${barChartHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fill="#666">
                Resolved Points
              </text>
              <line x1={0} y1={barChartHeight} x2={barChartArea} y2={barChartHeight} stroke="#bdbdbd" />

              {teams.map((team, idx) => {
                const color = EPIC_COLORS[projectKeys.indexOf(team.projectKey) % EPIC_COLORS.length];
                const x = idx * totalBarWidth + barOff;
                const bh = barChartHeight - barYScale.toY(team.resolvedPoints);
                const y = barYScale.toY(team.resolvedPoints);
                return (
                  <g key={team.projectKey}>
                    <rect x={x} y={y} width={barW} height={bh} fill={color} rx={3}>
                      <title>{`${team.projectName}: ${team.resolvedPoints} pts (${team.sprintName})`}</title>
                    </rect>
                    <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#333">
                      {team.resolvedPoints}
                    </text>
                    <text x={x + barW / 2} y={barChartHeight + 14} textAnchor="end" dominantBaseline="hanging" fontSize={10} fill="#666" transform={`rotate(-45, ${x + barW / 2}, ${barChartHeight + 14})`}>
                      {team.projectName}
                    </text>
                    <text x={x + barW / 2} y={barChartHeight + 28} textAnchor="end" dominantBaseline="hanging" fontSize={9} fill="#999" transform={`rotate(-45, ${x + barW / 2}, ${barChartHeight + 28})`}>
                      {team.sprintName}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </Paper>

      {/* ── Line chart ── */}
      <Paper ref={lineContainerRef} sx={{ px: 3, py: 1.5, overflow: 'hidden', flex: 1, minWidth: 0 }} elevation={1}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.25 }}>
          Points per Sprint by Team
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Resolved points per team across all loaded sprints. Click a project to highlight.
        </Typography>

        {pointCount === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            No data available. Load metrics first.
          </Typography>
        ) : (
          <svg width={lineSvgWidth} height={lineSvgHeight} style={{ display: 'block', margin: '0 auto' }}>
            <g transform={`translate(${LINE_MARGIN.left}, ${LINE_MARGIN.top})`}>
              {/* Y-axis gridlines and labels */}
              {lineYScale.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={0} y1={lineYScale.toY(tick)} x2={lineChartArea} y2={lineYScale.toY(tick)} stroke="#e0e0e0" strokeDasharray="4,4" />
                  <text x={-10} y={lineYScale.toY(tick)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#666">{tick}</text>
                </g>
              ))}
              <text transform={`translate(-50, ${lineChartHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fill="#666">
                Resolved Points
              </text>

              {/* X-axis baseline */}
              <line x1={0} y1={lineChartHeight} x2={lineChartArea} y2={lineChartHeight} stroke="#bdbdbd" />

              {/* X-axis labels */}
              {lineSprintLabels.map((label, idx) => {
                const x = pointCount > 1 ? idx * xStep : lineChartArea / 2;
                return (
                  <g key={idx}>
                    <line x1={x} y1={lineChartHeight} x2={x} y2={lineChartHeight + 6} stroke="#bdbdbd" />
                    <text x={x} y={lineChartHeight + 14} textAnchor="end" dominantBaseline="hanging" fontSize={10} fill="#666" transform={`rotate(-45, ${x}, ${lineChartHeight + 14})`}>
                      {label}
                    </text>
                  </g>
                );
              })}

              {/* Lines + points per project */}
              {projectKeys.map((pk, pkIdx) => {
                const color = EPIC_COLORS[pkIdx % EPIC_COLORS.length];
                const series = projectSeries.get(pk) ?? [];
                const dimmed = selectedProject !== null && selectedProject !== pk;
                const groupOpacity = dimmed ? 0.15 : 1;

                const pts = series.map((s, idx) => ({
                  x: pointCount > 1 ? idx * xStep : lineChartArea / 2,
                  y: lineYScale.toY(s.points),
                  value: s.points,
                  sprintLabel: s.sprintLabel,
                }));

                const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');

                return (
                  <g key={pk} opacity={groupOpacity} onClick={() => toggleProject(pk)} style={{ cursor: 'pointer' }}>
                    {pts.length > 1 && (
                      <polyline
                        points={polyline}
                        fill="none" stroke={color}
                        strokeWidth={selectedProject === pk ? 4 : 2.5}
                        strokeLinejoin="round" strokeLinecap="round"
                      />
                    )}
                    {pts.map((p, idx) => (
                      <g key={idx}>
                        <circle
                          cx={p.x} cy={p.y}
                          r={selectedProject === pk ? POINT_RADIUS + 1 : POINT_RADIUS}
                          fill={color} stroke="white" strokeWidth={1.5}
                        >
                          <title>{`${projectNames.get(pk) ?? pk}: ${p.value} pts (${p.sprintLabel})`}</title>
                        </circle>
                        <text
                          x={p.x} y={p.y - (POINT_RADIUS + 6)}
                          textAnchor="middle" dominantBaseline="auto"
                          fontSize={10} fill={color} fontWeight="600"
                          pointerEvents="none"
                        >
                          {p.value}
                        </text>
                      </g>
                    ))}
                  </g>
                );
              })}

              {/* Legend */}
              <g transform={`translate(${lineChartArea + 20}, 0)`}>
                <text x={0} y={0} fontSize={11} fontWeight="bold" fill="#333" dominantBaseline="hanging">
                  Projects
                </text>
                {projectKeys.map((pk, idx) => {
                  const color = EPIC_COLORS[idx % EPIC_COLORS.length];
                  const y = 20 + idx * LEGEND_ROW_HEIGHT;
                  const dimmed = selectedProject !== null && selectedProject !== pk;
                  const isSelected = selectedProject === pk;
                  return (
                    <g key={pk} transform={`translate(0, ${y})`} opacity={dimmed ? 0.3 : 1} onClick={() => toggleProject(pk)} style={{ cursor: 'pointer' }}>
                      <rect width={14} height={14} fill={color} rx={2} />
                      <text x={18} y={11} fontSize={11} fill="#333" fontWeight={isSelected ? 'bold' : 'normal'}>
                        {projectNames.get(pk) ?? pk}
                      </text>
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

export default SprintPointsByTeamChart;
