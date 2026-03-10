'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import { EPIC_COLORS } from '@/shared/constants';

export interface PiPlanningEpicBar {
  key: string;
  summary: string;
  piPoints: number;
  isStretch: boolean;
}

interface PiPlanningChartProps {
  epics: PiPlanningEpicBar[];
  piLabel: string;
  capacity?: number;
}

// Chart layout constants
const CHART_HEIGHT = 500;
const LEGEND_WIDTH = 240;
const MARGIN = { top: 10, right: LEGEND_WIDTH + 20, bottom: 45, left: 55 };
const BAR_WIDTH = 100;
const BAR_GAP = 10;
const LEGEND_ROW_HEIGHT = 20;
const CAPACITY_COLOR = '#bdbdbd';

/**
 * SVG hatched stripe pattern definition for stretch epics.
 */
const StripePattern = ({ id, color }: { id: string; color: string }) => (
  <pattern
    id={id}
    patternUnits="userSpaceOnUse"
    width="8"
    height="8"
    patternTransform="rotate(45)"
  >
    <rect width="8" height="8" fill={color} />
    <line x1="0" y1="0" x2="0" y2="8" stroke="white" strokeWidth="3" strokeOpacity="0.5" />
  </pattern>
);

const PiPlanningChart = ({ epics, piLabel, capacity }: PiPlanningChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(500);

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

  // Build stable epic → color index map (ordered by appearance)
  const epicColorMap = useMemo(() => {
    const map = new Map<string, number>();
    epics.forEach((epic, idx) => {
      if (!map.has(epic.key)) {
        map.set(epic.key, idx);
      }
    });
    return map;
  }, [epics]);

  // Total points
  const totalPoints = useMemo(
    () => epics.reduce((sum, e) => sum + e.piPoints, 0),
    [epics]
  );

  // Only epics with points > 0 get a bar segment
  const visibleEpics = useMemo(
    () => epics.filter((e) => e.piPoints > 0),
    [epics]
  );

  // Whether to show the capacity bar
  const showCapacity = capacity !== undefined && capacity > 0;

  // Max Y value — take the higher of demand vs capacity
  const maxValue = useMemo(() => {
    const maxVal = Math.max(totalPoints, showCapacity ? capacity : 0, 10);
    return maxVal;
  }, [totalPoints, capacity, showCapacity]);

  // Chart dimensions
  const svgWidth = containerWidth - 32; // account for Paper padding
  const chartWidth = svgWidth - MARGIN.left - MARGIN.right;
  const chartHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

  // Center the bar cluster (1 or 2 bars)
  const clusterWidth = showCapacity ? BAR_WIDTH * 2 + BAR_GAP : BAR_WIDTH;
  const clusterX = Math.max(0, (chartWidth - clusterWidth) / 2);
  const demandBarX = clusterX;
  const capacityBarX = clusterX + BAR_WIDTH + BAR_GAP;

  // Y-axis scale
  const yScale = useMemo(() => {
    const niceMax = Math.ceil(maxValue * 1.15 / 50) * 50 || 50;
    const tickCount = 5;
    const tickStep = Math.ceil(niceMax / tickCount / 10) * 10 || 10;
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

  // Build stripe pattern IDs for stretch epics
  const stripePatterns = useMemo(() => {
    const patterns: { id: string; color: string }[] = [];
    for (const epic of visibleEpics) {
      if (epic.isStretch) {
        const colorIdx = epicColorMap.get(epic.key) ?? 0;
        const color = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
        const patternId = `pp-stripe-${epic.key.replace(/[^a-zA-Z0-9]/g, '-')}`;
        if (!patterns.some((p) => p.id === patternId)) {
          patterns.push({ id: patternId, color });
        }
      }
    }
    return patterns;
  }, [visibleEpics, epicColorMap]);

  // Build stacked segments (bottom-up) — now using demandBarX
  const segments = useMemo(() => {
    let stackY = chartHeight;
    const segs: {
      epic: PiPlanningEpicBar;
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      fill: string;
    }[] = [];

    for (const epic of visibleEpics) {
      const barHeight = (epic.piPoints / yScale.max) * chartHeight;
      const colorIdx = epicColorMap.get(epic.key) ?? 0;
      const baseColor = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
      const patternId = epic.isStretch
        ? `pp-stripe-${epic.key.replace(/[^a-zA-Z0-9]/g, '-')}`
        : '';
      const fill = epic.isStretch ? `url(#${patternId})` : baseColor;

      stackY -= barHeight;
      segs.push({
        epic,
        x: demandBarX,
        y: stackY,
        width: BAR_WIDTH,
        height: barHeight,
        color: baseColor,
        fill,
      });
    }
    return segs;
  }, [visibleEpics, yScale, chartHeight, demandBarX, epicColorMap]);

  // Legend height for SVG sizing — add 1 extra row for capacity legend entry
  const legendRows = epics.length + (showCapacity ? 2 : 0); // +2 for spacer + capacity
  const legendHeight = (legendRows + 1) * LEGEND_ROW_HEIGHT + 10;
  const svgHeight = Math.max(CHART_HEIGHT, MARGIN.top + legendHeight);

  // Over/under indicator
  const overUnder = showCapacity ? totalPoints - capacity : null;

  return (
    <Paper
      ref={containerRef}
      sx={{ px: 2, py: 1.5, overflow: 'auto', height: '100%' }}
      elevation={1}
    >
      <Typography variant="subtitle1" sx={{ mb: 0.25, fontWeight: 'bold' }}>
        {piLabel} Epic Points
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {epics.length > 0
          ? `${visibleEpics.length} epic${visibleEpics.length !== 1 ? 's' : ''} \u2022 ${totalPoints} total points`
          : 'Select epics to see the breakdown'}
      </Typography>

      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ display: 'block', margin: '0 auto' }}
      >
        {/* Pattern definitions for stretch epics */}
        <defs>
          {stripePatterns.map((p) => (
            <StripePattern key={p.id} id={p.id} color={p.color} />
          ))}
        </defs>

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
                strokeDasharray={tick === 0 ? 'none' : '4,4'}
              />
              <text
                x={-8}
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

          {/* Y-axis label */}
          <text
            transform={`translate(${-MARGIN.left + 14}, ${chartHeight / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={12}
            fill="#666"
          >
            Story Points
          </text>

          {/* Baseline */}
          <line
            x1={0}
            y1={chartHeight}
            x2={chartWidth}
            y2={chartHeight}
            stroke="#bdbdbd"
          />

          {/* Stacked bar segments (Demand) */}
          {segments.map((seg) => (
            <Tooltip
              key={seg.epic.key}
              title={`${seg.epic.key}: ${seg.epic.summary} — ${seg.epic.piPoints} pts${seg.epic.isStretch ? ' (Stretch)' : ''}`}
              arrow
            >
              <rect
                x={seg.x}
                y={seg.y}
                width={seg.width}
                height={seg.height}
                fill={seg.fill}
                stroke={seg.color}
                strokeWidth={0.5}
              />
            </Tooltip>
          ))}

          {/* Demand total label above bar */}
          {totalPoints > 0 && (
            <text
              x={demandBarX + BAR_WIDTH / 2}
              y={yScale.toY(totalPoints) - 6}
              textAnchor="middle"
              fontSize={13}
              fontWeight="bold"
              fill="#333"
            >
              {totalPoints}
            </text>
          )}

          {/* Demand X-axis label */}
          <text
            x={demandBarX + BAR_WIDTH / 2}
            y={chartHeight + 22}
            textAnchor="middle"
            fontSize={12}
            fontWeight="bold"
            fill="#333"
          >
            {showCapacity ? 'Demand' : piLabel}
          </text>

          {/* Capacity bar */}
          {showCapacity && (
            <>
              <Tooltip title={`Capacity: ${capacity} dev days available`} arrow>
                <rect
                  x={capacityBarX}
                  y={yScale.toY(capacity)}
                  width={BAR_WIDTH}
                  height={Math.max(0, chartHeight - yScale.toY(capacity))}
                  fill={CAPACITY_COLOR}
                  stroke="#9e9e9e"
                  strokeWidth={0.5}
                />
              </Tooltip>

              {/* Capacity value above bar */}
              <text
                x={capacityBarX + BAR_WIDTH / 2}
                y={yScale.toY(capacity) - 6}
                textAnchor="middle"
                fontSize={13}
                fontWeight="bold"
                fill="#333"
              >
                {capacity}
              </text>

              {/* Capacity X-axis label */}
              <text
                x={capacityBarX + BAR_WIDTH / 2}
                y={chartHeight + 22}
                textAnchor="middle"
                fontSize={12}
                fontWeight="bold"
                fill="#333"
              >
                Capacity
              </text>

              {/* Over/under indicator between bars */}
              {overUnder !== null && totalPoints > 0 && (
                <text
                  x={demandBarX + BAR_WIDTH + BAR_GAP / 2}
                  y={chartHeight + 38}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight="bold"
                  fill={overUnder > 0 ? '#d32f2f' : '#2e7d32'}
                >
                  {overUnder > 0 ? `+${overUnder} over` : overUnder < 0 ? `${Math.abs(overUnder)} under` : 'Balanced'}
                </text>
              )}
            </>
          )}

          {/* PI label centered under cluster when capacity shown */}
          {showCapacity && (
            <text
              x={clusterX + clusterWidth / 2}
              y={chartHeight + 38}
              textAnchor="middle"
              fontSize={11}
              fill="#666"
            >
              {piLabel}
            </text>
          )}

          {/* Legend — right side of chart */}
          <g transform={`translate(${chartWidth + 20}, 0)`}>
            {epics.map((epic, idx) => {
              const colorIdx = epicColorMap.get(epic.key) ?? 0;
              const baseColor = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
              const patternId = epic.isStretch
                ? `pp-stripe-${epic.key.replace(/[^a-zA-Z0-9]/g, '-')}`
                : '';
              const rowY = idx * LEGEND_ROW_HEIGHT;
              const hasPoints = epic.piPoints > 0;

              return (
                <g
                  key={epic.key}
                  transform={`translate(0, ${rowY})`}
                  opacity={hasPoints ? 1 : 0.35}
                >
                  <rect
                    width={14}
                    height={14}
                    fill={hasPoints ? (epic.isStretch ? `url(#${patternId})` : baseColor) : 'none'}
                    stroke={baseColor}
                    strokeWidth={hasPoints ? 0.5 : 1}
                    strokeDasharray={hasPoints ? 'none' : '3,2'}
                    rx={2}
                  />
                  <text
                    x={20}
                    y={11}
                    fontSize={11}
                    fill="#333"
                  >
                    {`${epic.key} — ${epic.piPoints} pts${epic.isStretch ? ' (S)' : ''}`}
                  </text>
                </g>
              );
            })}

            {/* Capacity legend entry */}
            {showCapacity && (
              <g transform={`translate(0, ${(epics.length + 1) * LEGEND_ROW_HEIGHT})`}>
                <rect
                  width={14}
                  height={14}
                  fill={CAPACITY_COLOR}
                  stroke="#9e9e9e"
                  strokeWidth={0.5}
                  rx={2}
                />
                <text
                  x={20}
                  y={11}
                  fontSize={11}
                  fill="#333"
                >
                  {`Capacity — ${capacity} pts`}
                </text>
              </g>
            )}
          </g>
        </g>
      </svg>
    </Paper>
  );
};

export default PiPlanningChart;
