'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { EPIC_COLORS } from '@/shared/constants';
import type { SprintMetricsData } from '@/frontend/hooks/useSprintMetricsData';

// ── Chart constants ──────────────────────────────────────────────────

const CHART_HEIGHT = 420;
const MARGIN = { top: 30, right: 30, bottom: 100, left: 65 };
const BAR_GAP = 0.3; // fraction of bar width used as gap between bars

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);

  // Default to offset -1 (1 sprint back); fall back to whatever is available
  const defaultOffset = data.grids.find((g) => g.offset === -1)?.offset
    ?? data.grids[0]?.offset
    ?? -1;
  const [selectedOffset, setSelectedOffset] = useState<number>(defaultOffset);

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

  const maxPoints = useMemo(() => {
    let max = 0;
    for (const t of teams) {
      if (t.resolvedPoints > max) max = t.resolvedPoints;
    }
    return max;
  }, [teams]);

  // Chart dimensions
  const svgWidth = containerWidth - 48;
  const chartWidth = svgWidth - MARGIN.left - MARGIN.right;
  const chartHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

  const yScale = useMemo(() => {
    const niceMax = Math.max(10, Math.ceil(maxPoints * 1.15 / 10) * 10);
    const tickStep = Math.ceil(niceMax / 5 / 5) * 5;
    const ticks: number[] = [];
    for (let v = 0; v <= niceMax; v += tickStep) ticks.push(v);
    return {
      max: niceMax,
      ticks,
      toY: (value: number) => chartHeight - (value / niceMax) * chartHeight,
    };
  }, [maxPoints, chartHeight]);

  const barCount = teams.length;
  const totalBarWidth = barCount > 0 ? chartWidth / barCount : 0;
  const barWidth = totalBarWidth * (1 - BAR_GAP);
  const barOffset = totalBarWidth * BAR_GAP / 2;

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
      <Paper ref={containerRef} sx={{ px: 3, py: 1.5, overflow: 'hidden' }} elevation={1}>
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
          <svg width={svgWidth} height={CHART_HEIGHT} style={{ display: 'block', margin: '0 auto' }}>
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
                Resolved Points
              </text>

              {/* X-axis baseline */}
              <line x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="#bdbdbd" />

              {/* Bars */}
              {teams.map((team, idx) => {
                const color = EPIC_COLORS[idx % EPIC_COLORS.length];
                const x = idx * totalBarWidth + barOffset;
                const barHeight = chartHeight - yScale.toY(team.resolvedPoints);
                const y = yScale.toY(team.resolvedPoints);

                return (
                  <g key={team.projectKey}>
                    {/* Bar */}
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      fill={color}
                      rx={3}
                    >
                      <title>{`${team.projectName}: ${team.resolvedPoints} pts (${team.sprintName})`}</title>
                    </rect>

                    {/* Points label on top of bar */}
                    <text
                      x={x + barWidth / 2}
                      y={y - 6}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight="bold"
                      fill="#333"
                    >
                      {team.resolvedPoints}
                    </text>

                    {/* X-axis label — project name */}
                    <text
                      x={x + barWidth / 2}
                      y={chartHeight + 14}
                      textAnchor="end"
                      dominantBaseline="hanging"
                      fontSize={10}
                      fill="#666"
                      transform={`rotate(-45, ${x + barWidth / 2}, ${chartHeight + 14})`}
                    >
                      {team.projectName}
                    </text>
                    {/* X-axis label — sprint name */}
                    <text
                      x={x + barWidth / 2}
                      y={chartHeight + 28}
                      textAnchor="end"
                      dominantBaseline="hanging"
                      fontSize={9}
                      fill="#999"
                      transform={`rotate(-45, ${x + barWidth / 2}, ${chartHeight + 28})`}
                    >
                      {team.sprintName}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </Paper>
    </Box>
  );
};

export default SprintPointsByTeamChart;
