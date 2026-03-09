'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import { EPIC_COLORS } from '@/shared/constants';
import type { CapacityDemandData, EpicDemand } from '@/frontend/hooks/useCapacityDemandData';

export interface EpicSelection {
  epicKey: string;
  source: 'bar' | 'legend';
  piLabel?: string; // only when source === 'bar'
}

interface CapacityDemandChartProps {
  data: CapacityDemandData;
  developerCount: number;
  supportPercent?: number; // % of capacity reserved for support (default 10)
  piDaysOff?: Record<string, number>; // piLabel → days off
  selectedEpicKey: string | null;
  onEpicSelect: (selection: EpicSelection | null) => void;
}

// Chart layout constants
const CHART_HEIGHT = 450;
const LEGEND_WIDTH = 260;
const MARGIN = { top: 10, right: LEGEND_WIDTH + 20, bottom: 50, left: 60 };
const BAR_WIDTH = 60;
const BAR_GAP = 8; // gap between demand and capacity bars within a cluster
const CLUSTER_GAP = 40; // gap between PI clusters
const CAPACITY_COLOR = '#bdbdbd';
const CAPACITY_LABEL_COLOR = '#757575';
const LEGEND_ROW_HEIGHT = 20;

/**
 * Build a stable color map across all PIs so the same epic always gets the same color.
 */
const buildEpicColorMap = (data: CapacityDemandData): Map<string, number> => {
  const colorMap = new Map<string, number>();
  let colorIndex = 0;

  for (const pi of data.piData) {
    for (const epic of pi.epics) {
      if (!colorMap.has(epic.key)) {
        colorMap.set(epic.key, colorIndex);
        colorIndex++;
      }
    }
  }

  return colorMap;
};

/**
 * SVG hatched stripe pattern definition for a given color.
 * Creates diagonal lines over a solid background.
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

const CapacityDemandChart = ({ data, developerCount, supportPercent = 10, piDaysOff = {}, selectedEpicKey, onEpicSelect }: CapacityDemandChartProps) => {
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

  // Capacity per PI quarter (working days only: 261 work days/year / 4 quarters ~ 65)
  const workDaysPerQuarter = Math.round((365 - 104) / 4); // 365 days - 104 weekend days

  // Support multiplier (e.g., 10% support → 0.9 multiplier)
  const supportMultiplier = 1 - (supportPercent / 100);

  // Per-PI capacity (subtracting days off, then applying support %)
  const capacityForPI = useMemo(() => {
    const map: Record<string, number> = {};
    for (const pi of data.piData) {
      const daysOff = piDaysOff[pi.label] ?? 0;
      map[pi.label] = Math.round(Math.max(0, workDaysPerQuarter - daysOff) * developerCount * supportMultiplier);
    }
    return map;
  }, [data, developerCount, workDaysPerQuarter, piDaysOff, supportMultiplier]);

  // Base capacity (no days off) for subtitle
  const baseCapacityPerPI = Math.round(workDaysPerQuarter * developerCount * supportMultiplier);

  // Build stable epic → color index map
  const epicColorMap = useMemo(() => buildEpicColorMap(data), [data]);

  // Collect all unique epics, split into those with stories vs without
  const { legendEpics, noStoryEpics } = useMemo(() => {
    const epicInfo = new Map<string, { key: string; summary: string; isStretch: boolean }>();
    const epicHasPoints = new Map<string, boolean>();

    for (const pi of data.piData) {
      for (const epic of pi.epics) {
        if (!epicInfo.has(epic.key)) {
          epicInfo.set(epic.key, {
            key: epic.key,
            summary: epic.summary,
            isStretch: epic.isStretch,
          });
          epicHasPoints.set(epic.key, false);
        }
        if (epic.totalPoints > 0) {
          epicHasPoints.set(epic.key, true);
        }
      }
    }

    const withStories: { key: string; summary: string; isStretch: boolean }[] = [];
    const withoutStories: { key: string; summary: string; isStretch: boolean }[] = [];

    for (const [key, info] of epicInfo) {
      if (epicHasPoints.get(key)) {
        withStories.push(info);
      } else {
        withoutStories.push(info);
      }
    }

    return { legendEpics: withStories, noStoryEpics: withoutStories };
  }, [data]);

  // Calculate max Y value (using per-PI capacities)
  const maxValue = useMemo(() => {
    let max = 0;
    for (const pi of data.piData) {
      const cap = capacityForPI[pi.label] ?? baseCapacityPerPI;
      if (cap > max) max = cap;
      const totalDemand = pi.epics.reduce((sum, e) => sum + e.totalPoints, 0);
      if (totalDemand > max) max = totalDemand;
    }
    return max;
  }, [data, capacityForPI, baseCapacityPerPI]);

  // Chart dimensions
  const svgWidth = containerWidth - 48; // account for Paper padding
  const chartWidth = svgWidth - MARGIN.left - MARGIN.right;
  const chartHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const piCount = data.piData.length;
  const clusterWidth = BAR_WIDTH * 2 + BAR_GAP;

  // Center clusters within available width
  const totalClustersWidth = piCount * clusterWidth + (piCount - 1) * CLUSTER_GAP;
  const clusterStartX = Math.max(0, (chartWidth - totalClustersWidth) / 2);

  // Y-axis scale: compute nice tick values
  const yScale = useMemo(() => {
    const niceMax = Math.ceil(maxValue * 1.15 / 50) * 50; // Round up to nearest 50, add 15% headroom
    const tickCount = 5;
    const tickStep = Math.ceil(niceMax / tickCount / 10) * 10;
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
    for (const pi of data.piData) {
      for (const epic of pi.epics) {
        if (epic.isStretch) {
          const colorIdx = epicColorMap.get(epic.key) ?? 0;
          const color = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
          const patternId = `stripe-${epic.key.replace(/[^a-zA-Z0-9]/g, '-')}`;
          if (!patterns.some((p) => p.id === patternId)) {
            patterns.push({ id: patternId, color });
          }
        }
      }
    }
    return patterns;
  }, [data, epicColorMap]);

  // Legend + No Stories height for SVG sizing
  const legendTotalRows = legendEpics.length + 1; // +1 for capacity entry
  const legendHeight = legendTotalRows * LEGEND_ROW_HEIGHT + 10;
  const noStoriesHeight = noStoryEpics.length > 0
    ? noStoryEpics.length * LEGEND_ROW_HEIGHT + 30 // +30 for header + gap
    : 0;
  const svgHeight = Math.max(CHART_HEIGHT, MARGIN.top + legendHeight + noStoriesHeight);

  return (
    <Paper
      ref={containerRef}
      sx={{ px: 3, py: 1.5, m: 2, overflow: 'hidden' }}
      elevation={1}
    >
      <Typography variant="h6" sx={{ mb: 0.25 }}>
        Capacity vs Demand
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        Story points demand by epic vs team capacity ({developerCount} dev{developerCount !== 1 ? 's' : ''} &times; {workDaysPerQuarter} days &times; {100 - supportPercent}% available = {baseCapacityPerPI} pts/quarter)
      </Typography>

      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ display: 'block', margin: '0 auto' }}
        onClick={() => onEpicSelect(null)}
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

          {/* Clusters: one per PI */}
          {data.piData.map((pi, piIdx) => {
            const clusterX = clusterStartX + piIdx * (clusterWidth + CLUSTER_GAP);
            const totalDemand = pi.epics.reduce((sum, e) => sum + e.totalPoints, 0);
            const piCapacity = capacityForPI[pi.label] ?? baseCapacityPerPI;

            // Build stacked segments (bottom-up)
            let stackY = chartHeight;
            const segments: {
              epic: EpicDemand;
              x: number;
              y: number;
              width: number;
              height: number;
              color: string;
              fill: string;
            }[] = [];

            for (const epic of pi.epics) {
              if (epic.totalPoints === 0) continue;
              const barHeight = (epic.totalPoints / yScale.max) * chartHeight;
              const colorIdx = epicColorMap.get(epic.key) ?? 0;
              const baseColor = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
              const patternId = epic.isStretch
                ? `stripe-${epic.key.replace(/[^a-zA-Z0-9]/g, '-')}`
                : '';
              const fill = epic.isStretch ? `url(#${patternId})` : baseColor;

              stackY -= barHeight;
              segments.push({
                epic,
                x: clusterX,
                y: stackY,
                width: BAR_WIDTH,
                height: barHeight,
                color: baseColor,
                fill,
              });
            }

            // Capacity bar
            const capBarHeight = Math.min(
              (piCapacity / yScale.max) * chartHeight,
              chartHeight
            );
            const capBarY = chartHeight - capBarHeight;

            return (
              <g key={pi.label}>
                {/* Demand bar (stacked) */}
                {segments.map((seg) => {
                  const isSelected = selectedEpicKey === seg.epic.key;
                  const isDimmed = selectedEpicKey !== null && !isSelected;

                  return (
                    <Tooltip
                      key={`${pi.label}-${seg.epic.key}`}
                      title={`${seg.epic.key}: ${seg.epic.summary} — ${seg.epic.totalPoints} pts${seg.epic.isStretch ? ' (Stretch)' : ''}`}
                      arrow
                    >
                      <rect
                        x={seg.x}
                        y={seg.y}
                        width={seg.width}
                        height={seg.height}
                        fill={seg.fill}
                        stroke={isSelected ? '#333' : seg.color}
                        strokeWidth={isSelected ? 2 : 0.5}
                        opacity={isDimmed ? 0.25 : 1}
                        style={{ cursor: 'pointer', transition: 'opacity 0.15s ease' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEpicSelect(isSelected ? null : { epicKey: seg.epic.key, source: 'bar', piLabel: pi.label });
                        }}
                      />
                    </Tooltip>
                  );
                })}

                {/* Demand total label */}
                {totalDemand > 0 && (
                  <text
                    x={clusterX + BAR_WIDTH / 2}
                    y={yScale.toY(totalDemand) - 6}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight="bold"
                    fill="#333"
                  >
                    {totalDemand}
                  </text>
                )}

                {/* Demand bar label */}
                <text
                  x={clusterX + BAR_WIDTH / 2}
                  y={chartHeight + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#666"
                >
                  Demand
                </text>

                {/* Capacity bar */}
                <rect
                  x={clusterX + BAR_WIDTH + BAR_GAP}
                  y={capBarY}
                  width={BAR_WIDTH}
                  height={capBarHeight}
                  fill={CAPACITY_COLOR}
                  stroke="#9e9e9e"
                  strokeWidth={0.5}
                />

                {/* Capacity value label */}
                <text
                  x={clusterX + BAR_WIDTH + BAR_GAP + BAR_WIDTH / 2}
                  y={capBarY - 6}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight="bold"
                  fill={CAPACITY_LABEL_COLOR}
                >
                  {piCapacity}
                </text>

                {/* Capacity bar label */}
                <text
                  x={clusterX + BAR_WIDTH + BAR_GAP + BAR_WIDTH / 2}
                  y={chartHeight + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#666"
                >
                  Capacity
                </text>

                {/* PI label (below both bars) */}
                <text
                  x={clusterX + clusterWidth / 2}
                  y={chartHeight + 32}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight="bold"
                  fill="#333"
                >
                  {pi.label}
                </text>

                {/* Over/under indicator */}
                {totalDemand > 0 && (
                  <text
                    x={clusterX + clusterWidth / 2}
                    y={chartHeight + 48}
                    textAnchor="middle"
                    fontSize={11}
                    fill={totalDemand > piCapacity ? '#d32f2f' : '#2e7d32'}
                  >
                    {totalDemand > piCapacity
                      ? `+${totalDemand - piCapacity} over`
                      : `${piCapacity - totalDemand} under`}
                  </text>
                )}
              </g>
            );
          })}

          {/* Legend — right side of chart */}
          <g transform={`translate(${chartWidth + 20}, 0)`}>
            {legendEpics.map((epic, idx) => {
              const colorIdx = epicColorMap.get(epic.key) ?? 0;
              const baseColor = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
              const patternId = epic.isStretch
                ? `stripe-${epic.key.replace(/[^a-zA-Z0-9]/g, '-')}`
                : '';
              const rowY = idx * LEGEND_ROW_HEIGHT;
              const isSelected = selectedEpicKey === epic.key;
              const isDimmed = selectedEpicKey !== null && !isSelected;

              return (
                <g
                  key={epic.key}
                  transform={`translate(0, ${rowY})`}
                  opacity={isDimmed ? 0.3 : 1}
                  style={{ cursor: 'pointer', transition: 'opacity 0.15s ease' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEpicSelect(isSelected ? null : { epicKey: epic.key, source: 'legend' });
                  }}
                >
                  <rect
                    width={14}
                    height={14}
                    fill={epic.isStretch ? `url(#${patternId})` : baseColor}
                    stroke={isSelected ? '#333' : baseColor}
                    strokeWidth={isSelected ? 2 : 0.5}
                    rx={2}
                  />
                  <text
                    x={20}
                    y={11}
                    fontSize={11}
                    fill="#333"
                    fontWeight={isSelected ? 'bold' : 'normal'}
                  >
                    {epic.key}: {epic.summary.length > 24 ? `${epic.summary.slice(0, 24)}...` : epic.summary}
                    {epic.isStretch ? ' (Stretch)' : ''}
                  </text>
                </g>
              );
            })}

            {/* Capacity legend entry */}
            <g transform={`translate(0, ${legendEpics.length * LEGEND_ROW_HEIGHT})`}>
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
                Capacity ({developerCount} dev{developerCount !== 1 ? 's' : ''})
              </text>
            </g>

            {/* No Stories section */}
            {noStoryEpics.length > 0 && (() => {
              const noStoriesStartY = (legendEpics.length + 1) * LEGEND_ROW_HEIGHT + 10;
              return (
                <g transform={`translate(0, ${noStoriesStartY})`}>
                  <text
                    fontSize={12}
                    fontWeight="bold"
                    fill="#999"
                    y={-4}
                  >
                    No Stories
                  </text>

                  {noStoryEpics.map((epic, idx) => {
                    const colorIdx = epicColorMap.get(epic.key) ?? 0;
                    const baseColor = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
                    const rowY = idx * LEGEND_ROW_HEIGHT + 10;
                    const isSelected = selectedEpicKey === epic.key;
                    const isDimmed = selectedEpicKey !== null && !isSelected;

                    return (
                      <g
                        key={epic.key}
                        transform={`translate(0, ${rowY})`}
                        opacity={isDimmed ? 0.3 : 1}
                        style={{ cursor: 'pointer', transition: 'opacity 0.15s ease' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEpicSelect(isSelected ? null : { epicKey: epic.key, source: 'legend' });
                        }}
                      >
                        <rect
                          width={14}
                          height={14}
                          fill="none"
                          stroke={isSelected ? '#333' : baseColor}
                          strokeWidth={isSelected ? 2 : 1}
                          strokeDasharray="3,2"
                          rx={2}
                        />
                        <text
                          x={20}
                          y={11}
                          fontSize={11}
                          fill="#999"
                          fontWeight={isSelected ? 'bold' : 'normal'}
                        >
                          {epic.key}: {epic.summary.length > 24 ? `${epic.summary.slice(0, 24)}...` : epic.summary}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })()}
          </g>
        </g>
      </svg>
    </Paper>
  );
};

export default CapacityDemandChart;
