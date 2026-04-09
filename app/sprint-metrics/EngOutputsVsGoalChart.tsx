'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SprintMetricsData } from '@/frontend/hooks/useSprintMetricsData';

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

// ── Chart constants ──────────────────────────────────────────────────

const CHART_HEIGHT = 380;
const MARGIN = { top: 30, right: 30, bottom: 110, left: 65 };
const GROUP_GAP = 0.25;  // fraction of group width left as gap between groups
const BAR_GAP = 2;       // px between the two bars within a group

const COLOR_CAPACITY = '#1976d2';   // blue
const COLOR_MET = '#2e7d32';        // green  — resolved >= capacity
const COLOR_CLOSE = '#ed6c02';      // amber  — resolved >= 80% capacity
const COLOR_LOW = '#d32f2f';        // red    — resolved < 80% capacity

const resolvedColor = (resolved: number, capacity: number): string => {
  if (capacity === 0) return COLOR_MET;
  const ratio = resolved / capacity;
  if (ratio >= 1) return COLOR_MET;
  if (ratio >= 0.8) return COLOR_CLOSE;
  return COLOR_LOW;
};

// ── Compact cell styling (mirrors SprintMetricsContent) ──────────────

const compactCellSx = { fontSize: '0.75rem', py: 0.25, px: 1, lineHeight: 1.3 };
const compactHeaderSx = {
  ...compactCellSx,
  fontWeight: 700,
  whiteSpace: 'normal' as const,
  verticalAlign: 'bottom',
  bgcolor: 'grey.100',
};

// ── Types ────────────────────────────────────────────────────────────

interface EngOutputsVsGoalChartProps {
  data: SprintMetricsData;
}

interface EngRow {
  name: string;
  projectKey: string;
  projectName: string;
  capacity: number;
  resolvedPoints: number;
}

// ── Component ────────────────────────────────────────────────────────

const EngOutputsVsGoalChart = ({ data }: EngOutputsVsGoalChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);

  // Available projects (derived from data)
  const projects = useMemo(() => {
    const seen = new Set<string>();
    const result: { key: string; name: string }[] = [];
    for (const grid of data.grids) {
      for (const row of grid.rows) {
        if (!seen.has(row.projectKey)) {
          seen.add(row.projectKey);
          result.push({ key: row.projectKey, name: row.projectName });
        }
      }
    }
    return result;
  }, [data]);

  // Defaults: All projects, 1 sprint back
  const defaultOffset =
    data.grids.find((g) => g.offset === -1)?.offset ?? data.grids[0]?.offset ?? -1;
  const [selectedProjectKey, setSelectedProjectKey] = useState('ALL');
  const [selectedOffset, setSelectedOffset] = useState<number>(defaultOffset);

  // Selected engineer for the story drill-down
  const [selectedEng, setSelectedEng] = useState<{ projectKey: string; name: string } | null>(null);

  // Clear selection when the sprint or project filter changes
  useEffect(() => { setSelectedEng(null); }, [selectedOffset, selectedProjectKey]);

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

  // Build flat list of engineers for the selected sprint + project filter
  const { engRows, sprintLabel, multiProject, showCapacity } = useMemo(() => {
    const grid = data.grids.find((g) => g.offset === selectedOffset);
    if (!grid) return { engRows: [] as EngRow[], sprintLabel: '', multiProject: false, showCapacity: false };

    const filteredRows =
      selectedProjectKey === 'ALL'
        ? grid.rows
        : grid.rows.filter((r) => r.projectKey === selectedProjectKey);

    const engRows: EngRow[] = [];
    for (const row of filteredRows) {
      if (!row.engineerOutputs) continue;
      for (const eng of row.engineerOutputs) {
        engRows.push({
          name: eng.name,
          projectKey: row.projectKey,
          projectName: row.projectName,
          capacity: eng.capacity,
          resolvedPoints: eng.resolvedPoints,
        });
      }
    }

    // Show capacity column/bars only if at least one engineer has capacity data
    const showCapacity = engRows.some((e) => e.capacity > 0);

    return {
      engRows,
      sprintLabel: grid.label,
      multiProject: filteredRows.length > 1,
      showCapacity,
    };
  }, [data, selectedOffset, selectedProjectKey]);

  // Y scale
  const maxVal = useMemo(() => {
    let max = 0;
    for (const e of engRows) {
      if (e.capacity > max) max = e.capacity;
      if (e.resolvedPoints > max) max = e.resolvedPoints;
    }
    return max;
  }, [engRows]);

  const svgWidth = containerWidth - 48;
  const chartWidth = svgWidth - MARGIN.left - MARGIN.right;
  const chartHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

  const yScale = useMemo(() => {
    const niceMax = Math.max(10, Math.ceil(maxVal * 1.15 / 5) * 5);
    const tickStep = Math.max(1, Math.ceil(niceMax / 6 / 2) * 2);
    const ticks: number[] = [];
    for (let v = 0; v <= niceMax; v += tickStep) ticks.push(v);
    return {
      max: niceMax,
      ticks,
      toY: (value: number) => chartHeight - (value / niceMax) * chartHeight,
    };
  }, [maxVal, chartHeight]);

  // Stories resolved by the selected engineer in the selected sprint
  const selectedStories = useMemo(() => {
    if (!selectedEng) return [];
    const grid = data.grids.find((g) => g.offset === selectedOffset);
    if (!grid) return [];
    const row = grid.rows.find((r) => r.projectKey === selectedEng.projectKey);
    if (!row) return [];
    return row.issues.filter(
      (issue) => issue.categories.includes('resolved') && issue.assignee === selectedEng.name
    );
  }, [data, selectedOffset, selectedEng]);

  const groupCount = engRows.length;
  const groupWidth = groupCount > 0 ? chartWidth / groupCount : 0;
  const innerWidth = groupWidth * (1 - GROUP_GAP);
  const barWidth = Math.max(4, (innerWidth - BAR_GAP) / 2);
  const groupPad = (groupWidth - innerWidth) / 2;

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Controls */}
      <Paper elevation={1} sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" fontWeight={700}>
          Eng Outputs vs Goal
        </Typography>
        <TextField
          select
          size="small"
          label="Project"
          value={selectedProjectKey}
          onChange={(e) => setSelectedProjectKey(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="ALL">All</MenuItem>
          {projects.map((p) => (
            <MenuItem key={p.key} value={p.key}>{p.name}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Sprint"
          value={selectedOffset}
          onChange={(e) => setSelectedOffset(Number(e.target.value))}
          sx={{ minWidth: 160 }}
        >
          {data.grids.map((g) => (
            <MenuItem key={g.offset} value={g.offset}>{g.label}</MenuItem>
          ))}
        </TextField>
        <Typography variant="body2" color="text.secondary">
          {sprintLabel}{engRows.length > 0 ? ` — ${engRows.length} engineer${engRows.length !== 1 ? 's' : ''}` : ''}
        </Typography>
      </Paper>

      {engRows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          No resolved issues with assignees found for the selected sprint / project.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {/* Table */}
          <Paper elevation={1} sx={{ flexShrink: 0, overflow: 'hidden' }}>
            <TableContainer>
              <Table size="small" sx={{ tableLayout: 'auto' }}>
                <TableHead>
                  <TableRow>
                    {multiProject && <TableCell sx={compactHeaderSx}>Project</TableCell>}
                    <TableCell sx={compactHeaderSx}>Engineer</TableCell>
                    {showCapacity && <TableCell sx={{ ...compactHeaderSx, textAlign: 'right' }}>Capacity</TableCell>}
                    <TableCell sx={{ ...compactHeaderSx, textAlign: 'right' }}>Points Resolved</TableCell>
                    {showCapacity && <TableCell sx={{ ...compactHeaderSx, textAlign: 'right' }}>vs Goal</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {engRows.map((eng, idx) => {
                    const diff = Math.round((eng.resolvedPoints - eng.capacity) * 10) / 10;
                    const color = eng.capacity > 0 ? resolvedColor(eng.resolvedPoints, eng.capacity) : undefined;
                    const isSelected = selectedEng?.projectKey === eng.projectKey && selectedEng?.name === eng.name;
                    return (
                      <TableRow key={`${eng.projectKey}-${eng.name}-${idx}`} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' }, ...(isSelected ? { bgcolor: 'action.selected' } : {}) }}>
                        {multiProject && <TableCell sx={compactCellSx}>{eng.projectName}</TableCell>}
                        <TableCell sx={compactCellSx}>{eng.name}</TableCell>
                        {showCapacity && (
                          <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>
                            {eng.capacity > 0 ? eng.capacity : '—'}
                          </TableCell>
                        )}
                        <TableCell
                          sx={{
                            ...compactCellSx,
                            textAlign: 'right',
                            ...(color ? { color, fontWeight: 600 } : {}),
                            cursor: 'pointer',
                            textDecoration: isSelected ? 'underline' : 'none',
                            '&:hover': { textDecoration: 'underline' },
                          }}
                          onClick={() => setSelectedEng(isSelected ? null : { projectKey: eng.projectKey, name: eng.name })}
                        >
                          {eng.resolvedPoints}
                        </TableCell>
                        {showCapacity && (
                          <TableCell sx={{ ...compactCellSx, textAlign: 'right', ...(color ? { color, fontWeight: 600 } : {}) }}>
                            {eng.capacity > 0 ? (diff >= 0 ? `+${diff}` : diff) : '—'}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {/* Chart */}
          <Paper ref={containerRef} elevation={1} sx={{ flex: 1, minWidth: 400, overflow: 'hidden', px: 2, py: 1 }}>
            {/* Legend */}
            <Box sx={{ display: 'flex', gap: 2, mb: 0.5, flexWrap: 'wrap' }}>
              {showCapacity && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: 12, height: 12, bgcolor: COLOR_CAPACITY, borderRadius: 0.5 }} />
                  <Typography variant="caption">Capacity</Typography>
                </Box>
              )}
              {showCapacity ? (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 12, height: 12, bgcolor: COLOR_MET, borderRadius: 0.5 }} />
                    <Typography variant="caption">Resolved (met goal)</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 12, height: 12, bgcolor: COLOR_CLOSE, borderRadius: 0.5 }} />
                    <Typography variant="caption">Resolved (≥80%)</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 12, height: 12, bgcolor: COLOR_LOW, borderRadius: 0.5 }} />
                    <Typography variant="caption">Resolved (&lt;80%)</Typography>
                  </Box>
                </>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: 12, height: 12, bgcolor: COLOR_MET, borderRadius: 0.5 }} />
                  <Typography variant="caption">Resolved</Typography>
                </Box>
              )}
            </Box>

            <svg width={svgWidth} height={CHART_HEIGHT} style={{ display: 'block' }}>
              <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
                {/* Y-axis gridlines + labels */}
                {yScale.ticks.map((tick) => (
                  <g key={tick}>
                    <line
                      x1={0} y1={yScale.toY(tick)}
                      x2={chartWidth} y2={yScale.toY(tick)}
                      stroke="#e0e0e0" strokeDasharray="4,4"
                    />
                    <text x={-10} y={yScale.toY(tick)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#666">
                      {tick}
                    </text>
                  </g>
                ))}

                {/* Y-axis title */}
                <text
                  transform={`translate(-50, ${chartHeight / 2}) rotate(-90)`}
                  textAnchor="middle" fontSize={12} fill="#666"
                >
                  Points
                </text>

                {/* X-axis baseline */}
                <line x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="#bdbdbd" />

                {/* Grouped bars */}
                {engRows.map((eng, idx) => {
                  const gx = idx * groupWidth + groupPad;
                  // When no capacity data, use the full inner width for a single bar
                  const singleBar = !showCapacity || eng.capacity === 0;
                  const effectiveBarWidth = singleBar ? innerWidth : barWidth;
                  const resBarX = singleBar ? gx : gx + barWidth + BAR_GAP;
                  const barColor = eng.capacity > 0
                    ? resolvedColor(eng.resolvedPoints, eng.capacity)
                    : COLOR_MET;

                  const capY = yScale.toY(eng.capacity);
                  const resY = yScale.toY(eng.resolvedPoints);
                  const capH = chartHeight - capY;
                  const resH = chartHeight - resY;

                  const labelX = gx + innerWidth / 2;
                  const labelY = chartHeight + 14;

                  return (
                    <g key={`${eng.projectKey}-${eng.name}-${idx}`}>
                      {/* Capacity bar — only when capacity data exists */}
                      {showCapacity && eng.capacity > 0 && (
                        <>
                          <rect x={gx} y={capY} width={barWidth} height={capH} fill={COLOR_CAPACITY} rx={2}>
                            <title>{`${eng.name} — Capacity: ${eng.capacity}`}</title>
                          </rect>
                          <text x={gx + barWidth / 2} y={capY - 4} textAnchor="middle" fontSize={10} fill="#333">
                            {eng.capacity}
                          </text>
                        </>
                      )}

                      {/* Resolved bar */}
                      <rect x={resBarX} y={resY} width={effectiveBarWidth} height={resH} fill={barColor} rx={2}>
                        <title>{`${eng.name} — Resolved: ${eng.resolvedPoints}`}</title>
                      </rect>
                      {eng.resolvedPoints > 0 && (
                        <text x={resBarX + effectiveBarWidth / 2} y={resY - 4} textAnchor="middle" fontSize={10} fill="#333">
                          {eng.resolvedPoints}
                        </text>
                      )}

                      {/* X-axis engineer label */}
                      <text
                        x={labelX} y={labelY}
                        textAnchor="end" dominantBaseline="hanging"
                        fontSize={10} fill="#555"
                        transform={`rotate(-45, ${labelX}, ${labelY})`}
                      >
                        {eng.name}
                      </text>

                      {/* X-axis project label (only in multi-project view) */}
                      {multiProject && (
                        <text
                          x={labelX} y={labelY + 14}
                          textAnchor="end" dominantBaseline="hanging"
                          fontSize={9} fill="#999"
                          transform={`rotate(-45, ${labelX}, ${labelY + 14})`}
                        >
                          {eng.projectName}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          </Paper>
        </Box>
      )}

      {/* ── Story drill-down grid ──────────────────────────────────── */}
      {selectedEng && (
        <Paper elevation={1} sx={{ overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, bgcolor: 'grey.100', borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="caption" fontWeight={700}>
              Stories resolved by {selectedEng.name}
              {multiProject && ` (${engRows.find((e) => e.projectKey === selectedEng.projectKey && e.name === selectedEng.name)?.projectName ?? selectedEng.projectKey})`}
            </Typography>
          </Box>
          {selectedStories.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
              No resolved stories found.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={compactHeaderSx}>Key</TableCell>
                    <TableCell sx={{ ...compactHeaderSx, whiteSpace: 'normal' }}>Summary</TableCell>
                    <TableCell sx={{ ...compactHeaderSx, textAlign: 'right' }}>Points</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {selectedStories.map((issue) => (
                    <TableRow key={issue.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                      <TableCell sx={compactCellSx}>
                        <Link
                          href={`${JIRA_BASE_URL}/browse/${issue.key}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          underline="hover"
                          sx={{ fontSize: 'inherit' }}
                        >
                          {issue.key}
                        </Link>
                      </TableCell>
                      <TableCell sx={{ ...compactCellSx, whiteSpace: 'normal' }}>{issue.summary}</TableCell>
                      <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>{issue.points}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}
    </Box>
  );
};

export default EngOutputsVsGoalChart;
