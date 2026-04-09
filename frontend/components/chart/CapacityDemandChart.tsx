'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import { EPIC_COLORS } from '@/shared/constants';
import type { CapacityDemandData, EpicDemand, SprintCapacityInfo } from '@/frontend/hooks/useCapacityDemandData';

export interface EpicSelection {
  epicKey: string;
  source: 'bar' | 'legend';
  piLabel?: string; // only when source === 'bar'
}

interface CapacityDemandChartProps {
  data: CapacityDemandData;
  // Legacy manual-capacity props (used when piCapacities is not provided)
  developerCount?: number;
  supportPercent?: number;
  piDaysOff?: Record<string, number>;
  // Jira-backed per-sprint capacity (when provided, replaces manual calculation)
  piCapacities?: Record<string, SprintCapacityInfo[]>;
  selectedEpicKey: string | null;
  onEpicSelect: (selection: EpicSelection | null) => void;
}

// Chart layout constants
const CHART_HEIGHT = 565;
const LEGEND_WIDTH = 260;
const MARGIN = { top: 10, right: LEGEND_WIDTH + 20, bottom: 55, left: 65 };
const BAR_WIDTH = 75;
const BAR_GAP = 10;
const CLUSTER_GAP = 50;
const CAPACITY_COLOR = '#bdbdbd';
const CAPACITY_LABEL_COLOR = '#757575';
const NO_SPRINTS_COLOR = '#fff3e0';
const NO_SPRINTS_STROKE = '#f57c00';
const NO_CAPACITY_COLOR = '#f5f5f5';
const NO_CAPACITY_STROKE = '#e0e0e0';
const LEGEND_ROW_HEIGHT = 20;

interface CapacitySegment {
  capacity: number;
  tooltipLabel: string;
  color: string;
  strokeColor: string;
}

/** Build per-sprint capacity bar segments for a PI when piCapacities is provided. */
const buildCapacitySegments = (
  piLabel: string,
  piCapacities: Record<string, SprintCapacityInfo[]>
): CapacitySegment[] => {
  const sprints = piCapacities[piLabel];
  if (!sprints || sprints.length === 0) {
    return [{
      capacity: 400,
      tooltipLabel: 'Associate Sprints Needed',
      color: NO_SPRINTS_COLOR,
      strokeColor: NO_SPRINTS_STROKE,
    }];
  }
  return sprints.map((s) => ({
    capacity: s.totalCapacity ?? 50,
    tooltipLabel: s.totalCapacity !== null
      ? `${s.sprintName}: ${s.totalCapacity} pts`
      : `${s.sprintName}: No capacity saved`,
    color: s.totalCapacity !== null ? CAPACITY_COLOR : NO_CAPACITY_COLOR,
    strokeColor: s.totalCapacity !== null ? '#9e9e9e' : NO_CAPACITY_STROKE,
  }));
};

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

const StripePattern = ({ id, color }: { id: string; color: string }) => (
  <pattern id={id} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
    <rect width="8" height="8" fill={color} />
    <line x1="0" y1="0" x2="0" y2="8" stroke="white" strokeWidth="3" strokeOpacity="0.5" />
  </pattern>
);

const CapacityDemandChart = ({
  data,
  developerCount = 5,
  supportPercent = 10,
  piDaysOff = {},
  piCapacities,
  selectedEpicKey,
  onEpicSelect,
}: CapacityDemandChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

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

  // Legacy capacity calculation (used when piCapacities not provided)
  const workDaysPerQuarter = Math.round((365 - 104) / 4);
  const supportMultiplier = 1 - (supportPercent / 100);
  const legacyCapacityForPI = useMemo(() => {
    const map: Record<string, number> = {};
    for (const pi of data.piData) {
      const daysOff = piDaysOff[pi.label] ?? 0;
      map[pi.label] = Math.round(Math.max(0, workDaysPerQuarter - daysOff) * developerCount * supportMultiplier);
    }
    return map;
  }, [data, developerCount, workDaysPerQuarter, piDaysOff, supportMultiplier]);
  const baseCapacityPerPI = Math.round(workDaysPerQuarter * developerCount * supportMultiplier);

  // Get total capacity for a PI (either from piCapacities or legacy formula)
  const getTotalCapacity = (piLabel: string): number => {
    if (piCapacities) {
      const segs = buildCapacitySegments(piLabel, piCapacities);
      return Math.round(segs.reduce((sum, s) => sum + s.capacity, 0) * 10) / 10;
    }
    return legacyCapacityForPI[piLabel] ?? baseCapacityPerPI;
  };

  const epicColorMap = useMemo(() => buildEpicColorMap(data), [data]);

  const { legendEpics, noStoryEpics } = useMemo(() => {
    const epicInfo = new Map<string, { key: string; summary: string; isStretch: boolean }>();
    const epicHasPoints = new Map<string, boolean>();
    for (const pi of data.piData) {
      for (const epic of pi.epics) {
        if (!epicInfo.has(epic.key)) {
          epicInfo.set(epic.key, { key: epic.key, summary: epic.summary, isStretch: epic.isStretch });
          epicHasPoints.set(epic.key, false);
        }
        if (epic.totalPoints > 0) epicHasPoints.set(epic.key, true);
      }
    }
    const withStories: { key: string; summary: string; isStretch: boolean }[] = [];
    const withoutStories: { key: string; summary: string; isStretch: boolean }[] = [];
    for (const [key, info] of epicInfo) {
      if (epicHasPoints.get(key)) withStories.push(info);
      else withoutStories.push(info);
    }
    const byKey = (a: { key: string }, b: { key: string }) => {
      const [aPfx, aNum] = a.key.split('-');
      const [bPfx, bNum] = b.key.split('-');
      if (aPfx !== bPfx) return aPfx.localeCompare(bPfx);
      return parseInt(aNum, 10) - parseInt(bNum, 10);
    };
    withStories.sort(byKey);
    withoutStories.sort(byKey);
    return { legendEpics: withStories, noStoryEpics: withoutStories };
  }, [data]);

  const maxValue = useMemo(() => {
    let max = 0;
    for (const pi of data.piData) {
      const cap = getTotalCapacity(pi.label);
      if (cap > max) max = cap;
      const totalDemand = pi.epics.reduce((sum, e) => sum + e.totalPoints, 0);
      if (totalDemand > max) max = totalDemand;
    }
    return max;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, legacyCapacityForPI, baseCapacityPerPI, piCapacities]);

  const svgWidth = containerWidth - 48;
  const chartWidth = svgWidth - MARGIN.left - MARGIN.right;
  const chartHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const piCount = data.piData.length;
  const clusterWidth = BAR_WIDTH * 2 + BAR_GAP;
  const totalClustersWidth = piCount * clusterWidth + (piCount - 1) * CLUSTER_GAP;
  const clusterStartX = Math.max(0, (chartWidth - totalClustersWidth) / 2);

  const yScale = useMemo(() => {
    const niceMax = Math.ceil(maxValue * 1.15 / 50) * 50;
    const tickCount = 5;
    const tickStep = Math.ceil(niceMax / tickCount / 10) * 10;
    const ticks: number[] = [];
    for (let v = 0; v <= niceMax; v += tickStep) ticks.push(v);
    return {
      max: niceMax,
      ticks,
      toY: (value: number) => chartHeight - (value / niceMax) * chartHeight,
    };
  }, [maxValue, chartHeight]);

  const stripePatterns = useMemo(() => {
    const patterns: { id: string; color: string }[] = [];
    for (const pi of data.piData) {
      for (const epic of pi.epics) {
        if (epic.isStretch) {
          const colorIdx = epicColorMap.get(epic.key) ?? 0;
          const color = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
          const patternId = `stripe-${epic.key.replace(/[^a-zA-Z0-9]/g, '-')}`;
          if (!patterns.some((p) => p.id === patternId)) patterns.push({ id: patternId, color });
        }
      }
    }
    return patterns;
  }, [data, epicColorMap]);

  const legendTotalRows = legendEpics.length + 1;
  const legendHeight = legendTotalRows * LEGEND_ROW_HEIGHT + 10;
  const noStoriesHeight = noStoryEpics.length > 0 ? noStoryEpics.length * LEGEND_ROW_HEIGHT + 30 : 0;
  const svgHeight = Math.max(CHART_HEIGHT, MARGIN.top + legendHeight + noStoriesHeight);

  return (
    <Paper ref={containerRef} sx={{ px: 3, py: 1.5, m: 2, overflow: 'hidden' }} elevation={1}>
      <Typography variant="h6" sx={{ mb: 0.25 }}>Capacity vs Demand</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {piCapacities
          ? 'Story points demand by epic vs team capacity (per sprint, from Jira engineering capacity data)'
          : `Story points demand by epic vs team capacity (${developerCount} dev${developerCount !== 1 ? 's' : ''} \u00d7 ${workDaysPerQuarter} days \u00d7 ${100 - supportPercent}% available = ${baseCapacityPerPI} pts/quarter)`
        }
      </Typography>

      <svg width={svgWidth} height={svgHeight} style={{ display: 'block', margin: '0 auto' }} onClick={() => onEpicSelect(null)}>
        <defs>
          {stripePatterns.map((p) => <StripePattern key={p.id} id={p.id} color={p.color} />)}
        </defs>

        <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
          {/* Y-axis */}
          {yScale.ticks.map((tick) => (
            <g key={tick}>
              <line x1={0} y1={yScale.toY(tick)} x2={chartWidth} y2={yScale.toY(tick)} stroke="#e0e0e0" strokeDasharray={tick === 0 ? 'none' : '4,4'} />
              <text x={-8} y={yScale.toY(tick)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#666">{tick}</text>
            </g>
          ))}
          <text transform={`translate(${-MARGIN.left + 14}, ${chartHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fill="#666">Story Points</text>
          <line x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="#bdbdbd" />

          {/* Clusters: one per PI */}
          {data.piData.map((pi, piIdx) => {
            const clusterX = clusterStartX + piIdx * (clusterWidth + CLUSTER_GAP);
            const capX = clusterX + BAR_WIDTH + BAR_GAP;
            const totalDemand = pi.epics.reduce((sum, e) => sum + e.totalPoints, 0);
            const piTotalCapacity = getTotalCapacity(pi.label);

            // Demand bar segments (stacked bottom-up)
            let stackY = chartHeight;
            const demandSegments: {
              epic: EpicDemand; x: number; y: number; width: number; height: number; color: string; fill: string;
            }[] = [];
            for (const epic of pi.epics) {
              if (epic.totalPoints === 0) continue;
              const barHeight = (epic.totalPoints / yScale.max) * chartHeight;
              const colorIdx = epicColorMap.get(epic.key) ?? 0;
              const baseColor = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
              const patternId = epic.isStretch ? `stripe-${epic.key.replace(/[^a-zA-Z0-9]/g, '-')}` : '';
              const fill = epic.isStretch ? `url(#${patternId})` : baseColor;
              stackY -= barHeight;
              demandSegments.push({ epic, x: clusterX, y: stackY, width: BAR_WIDTH, height: barHeight, color: baseColor, fill });
            }

            return (
              <g key={pi.label}>
                {/* Demand bar */}
                {demandSegments.map((seg) => {
                  const isSelected = selectedEpicKey === seg.epic.key;
                  const isDimmed = selectedEpicKey !== null && !isSelected;
                  return (
                    <Tooltip
                      key={`${pi.label}-${seg.epic.key}`}
                      title={seg.epic.key === '__NO_EPIC__'
                        ? `No Epic — ${seg.epic.totalPoints} pts`
                        : `${seg.epic.key}: ${seg.epic.summary} — ${seg.epic.totalPoints} pts${seg.epic.isStretch ? ' (Stretch)' : ''}`
                      }
                      arrow
                    >
                      <rect
                        x={seg.x} y={seg.y} width={seg.width} height={seg.height}
                        fill={seg.fill} stroke={isSelected ? '#333' : seg.color}
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

                {totalDemand > 0 && (
                  <text x={clusterX + BAR_WIDTH / 2} y={yScale.toY(totalDemand) - 6} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#333">
                    {totalDemand}
                  </text>
                )}
                <text x={clusterX + BAR_WIDTH / 2} y={chartHeight + 14} textAnchor="middle" fontSize={10} fill="#666">Demand</text>

                {/* Capacity bar */}
                {piCapacities ? (() => {
                  const segments = buildCapacitySegments(pi.label, piCapacities);
                  let capStackY = chartHeight;
                  const topY = chartHeight - (piTotalCapacity / yScale.max) * chartHeight;
                  return (
                    <>
                      {segments.map((seg, idx) => {
                        const segH = Math.max(1, (seg.capacity / yScale.max) * chartHeight);
                        const segY = capStackY - segH;
                        capStackY = segY;
                        return (
                          <Tooltip key={idx} title={seg.tooltipLabel} arrow>
                            <rect x={capX} y={segY} width={BAR_WIDTH} height={segH} fill={seg.color} stroke={seg.strokeColor} strokeWidth={0.5} />
                          </Tooltip>
                        );
                      })}
                      <text x={capX + BAR_WIDTH / 2} y={topY - 6} textAnchor="middle" fontSize={12} fontWeight="bold" fill={CAPACITY_LABEL_COLOR}>
                        {piTotalCapacity}
                      </text>
                    </>
                  );
                })() : (
                  <>
                    <rect
                      x={capX} y={chartHeight - Math.min((piTotalCapacity / yScale.max) * chartHeight, chartHeight)}
                      width={BAR_WIDTH} height={Math.min((piTotalCapacity / yScale.max) * chartHeight, chartHeight)}
                      fill={CAPACITY_COLOR} stroke="#9e9e9e" strokeWidth={0.5}
                    />
                    <text x={capX + BAR_WIDTH / 2} y={yScale.toY(piTotalCapacity) - 6} textAnchor="middle" fontSize={12} fontWeight="bold" fill={CAPACITY_LABEL_COLOR}>
                      {piTotalCapacity}
                    </text>
                  </>
                )}

                <text x={capX + BAR_WIDTH / 2} y={chartHeight + 14} textAnchor="middle" fontSize={10} fill="#666">Capacity</text>

                {/* PI label */}
                <text x={clusterX + clusterWidth / 2} y={chartHeight + 32} textAnchor="middle" fontSize={13} fontWeight="bold" fill="#333">
                  {pi.label}
                </text>

                {/* Over/under indicator */}
                {totalDemand > 0 && (
                  <text x={clusterX + clusterWidth / 2} y={chartHeight + 48} textAnchor="middle" fontSize={11} fill={totalDemand > piTotalCapacity ? '#d32f2f' : '#2e7d32'}>
                    {totalDemand > piTotalCapacity
                      ? `+${Math.round((totalDemand - piTotalCapacity) * 10) / 10} over`
                      : `${Math.round((piTotalCapacity - totalDemand) * 10) / 10} under`}
                  </text>
                )}
              </g>
            );
          })}

          {/* Legend */}
          <g transform={`translate(${chartWidth + 20}, 0)`}>
            {legendEpics.map((epic, idx) => {
              const colorIdx = epicColorMap.get(epic.key) ?? 0;
              const baseColor = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
              const patternId = epic.isStretch ? `stripe-${epic.key.replace(/[^a-zA-Z0-9]/g, '-')}` : '';
              const rowY = idx * LEGEND_ROW_HEIGHT;
              const isSelected = selectedEpicKey === epic.key;
              const isDimmed = selectedEpicKey !== null && !isSelected;
              return (
                <g key={epic.key} transform={`translate(0, ${rowY})`} opacity={isDimmed ? 0.3 : 1} style={{ cursor: 'pointer', transition: 'opacity 0.15s ease' }}
                  onClick={(e) => { e.stopPropagation(); onEpicSelect(isSelected ? null : { epicKey: epic.key, source: 'legend' }); }}
                >
                  <rect width={14} height={14} fill={epic.isStretch ? `url(#${patternId})` : baseColor} stroke={isSelected ? '#333' : baseColor} strokeWidth={isSelected ? 2 : 0.5} rx={2} />
                  <text x={20} y={11} fontSize={11} fill="#333" fontWeight={isSelected ? 'bold' : 'normal'}>
                    {epic.key === '__NO_EPIC__' ? 'No Epic' : `${epic.key}: ${epic.summary.length > 24 ? `${epic.summary.slice(0, 24)}...` : epic.summary}${epic.isStretch ? ' (Stretch)' : ''}`}
                  </text>
                </g>
              );
            })}

            {/* Capacity legend entry */}
            <g transform={`translate(0, ${legendEpics.length * LEGEND_ROW_HEIGHT})`}>
              <rect width={14} height={14} fill={CAPACITY_COLOR} stroke="#9e9e9e" strokeWidth={0.5} rx={2} />
              <text x={20} y={11} fontSize={11} fill="#333">
                {piCapacities ? 'Capacity (Jira)' : `Capacity (${developerCount} dev${developerCount !== 1 ? 's' : ''})`}
              </text>
            </g>

            {/* No Stories section */}
            {noStoryEpics.length > 0 && (() => {
              const noStoriesStartY = (legendEpics.length + 1) * LEGEND_ROW_HEIGHT + 10;
              return (
                <g transform={`translate(0, ${noStoriesStartY})`}>
                  <text fontSize={12} fontWeight="bold" fill="#999" y={-4}>No Stories</text>
                  {noStoryEpics.map((epic, idx) => {
                    const colorIdx = epicColorMap.get(epic.key) ?? 0;
                    const baseColor = EPIC_COLORS[colorIdx % EPIC_COLORS.length];
                    const rowY = idx * LEGEND_ROW_HEIGHT + 10;
                    const isSelected = selectedEpicKey === epic.key;
                    const isDimmed = selectedEpicKey !== null && !isSelected;
                    return (
                      <g key={epic.key} transform={`translate(0, ${rowY})`} opacity={isDimmed ? 0.3 : 1} style={{ cursor: 'pointer', transition: 'opacity 0.15s ease' }}
                        onClick={(e) => { e.stopPropagation(); onEpicSelect(isSelected ? null : { epicKey: epic.key, source: 'legend' }); }}
                      >
                        <rect width={14} height={14} fill="none" stroke={isSelected ? '#333' : baseColor} strokeWidth={isSelected ? 2 : 1} strokeDasharray="3,2" rx={2} />
                        <text x={20} y={11} fontSize={11} fill="#999" fontWeight={isSelected ? 'bold' : 'normal'}>
                          {epic.key === '__NO_EPIC__' ? 'No Epic' : `${epic.key}: ${epic.summary.length > 24 ? `${epic.summary.slice(0, 24)}...` : epic.summary}`}
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
