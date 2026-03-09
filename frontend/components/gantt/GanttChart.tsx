'use client';

import { useMemo, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { DateTime } from 'luxon';
import Divider from '@mui/material/Divider';
import type { GanttData, SprintDateOverride, ScheduledEpic } from '@/shared/types';
import { parseDate, isWeekend, TIMEZONE } from '@/shared/utils/dates';
import TimelineHeader from './TimelineHeader';
import EpicRow from './EpicRow';
import DependencyLines from './DependencyLines';

import { EPIC_COLORS } from '@/shared/constants';

interface GanttChartProps {
  data: GanttData;
  maxDevelopers: number;
  onDailyCapacityChange?: (dayIndex: number, date: string, capacity: number) => void;
  sprintDateOverrides?: SprintDateOverride[];
}

// Width per day in pixels
const DAY_WIDTH = 30;
// Height per ticket row
const ROW_HEIGHT = 40;
// Width of the left labels column
const LABEL_WIDTH = 280;
// Width of Previous/Future blocks in days
const BLOCK_WIDTH_DAYS = 3;

const GanttChart = ({ data, maxDevelopers, onDailyCapacityChange, sprintDateOverrides = [] }: GanttChartProps) => {
  const { epics, sprints, dailyCapacities, projectStartDate, totalDays } = data;

  // Calculate today's date in the configured timezone
  const today = useMemo(() => DateTime.now().setZone(TIMEZONE).toISODate() ?? '', []);

  // Track expanded state for each epic
  const [expandedEpics, setExpandedEpics] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    epics.forEach((epic) => {
      initial[epic.key] = true;
    });
    return initial;
  });

  const toggleEpicExpanded = useCallback((epicKey: string) => {
    setExpandedEpics((prev) => ({
      ...prev,
      [epicKey]: !prev[epicKey],
    }));
  }, []);

  // Get color for an epic based on its index
  const getEpicColor = useCallback((index: number) => {
    return EPIC_COLORS[index % EPIC_COLORS.length];
  }, []);

  // Calculate total days to display (always work days - weekends excluded)
  const totalDisplayDays = useMemo(() => {
    if (sprints.length === 0) return totalDays;
    const startDt = parseDate(projectStartDate);
    const lastSprint = sprints[sprints.length - 1];
    const lastSprintEnd = parseDate(lastSprint.endDate);
    // Count work days between start and last sprint end
    let workDays = 0;
    let current = startDt;
    while (current <= lastSprintEnd) {
      if (!isWeekend(current)) workDays++;
      current = current.plus({ days: 1 });
    }
    return Math.max(totalDays, workDays);
  }, [sprints, projectStartDate, totalDays]);

  // Sort epics by priority override (lower = higher priority), then by totalDevDays (longest first)
  const sortEpicsByPriority = useCallback((epicList: ScheduledEpic[]): ScheduledEpic[] => {
    return [...epicList].sort((a, b) => {
      // Epics with priority override come first
      if (a.priorityOverride !== undefined && b.priorityOverride === undefined) return -1;
      if (a.priorityOverride === undefined && b.priorityOverride !== undefined) return 1;

      // If both have overrides, compare them (fall through to secondary if equal)
      if (a.priorityOverride !== undefined && b.priorityOverride !== undefined) {
        const priorityDiff = a.priorityOverride - b.priorityOverride;
        if (priorityDiff !== 0) return priorityDiff;
      }

      // Secondary: totalDevDays (longest first)
      return b.totalDevDays - a.totalDevDays;
    });
  }, []);

  // Group epics by commit type for section dividers, sorted by priority within each group
  const epicsByType = useMemo(() => {
    const commits = sortEpicsByPriority(epics.filter(e => e.commitType === 'commit'));
    const stretches = sortEpicsByPriority(epics.filter(e => e.commitType === 'stretch'));
    const others = sortEpicsByPriority(epics.filter(e => e.commitType === 'none'));
    return { commits, stretches, others };
  }, [epics, sortEpicsByPriority]);

  // Check if any epic has a Previous block (to add left offset)
  const hasPreviousBlocks = useMemo(() => {
    return epics.some(epic => epic.previousBlock);
  }, [epics]);

  // Check if any epic has a Future block (to add right space)
  const hasFutureBlocks = useMemo(() => {
    return epics.some(epic => epic.futureBlock);
  }, [epics]);

  // Calculate left offset for Previous blocks
  const previousBlockOffset = hasPreviousBlocks ? BLOCK_WIDTH_DAYS * DAY_WIDTH : 0;

  // Calculate right space for Future blocks
  const futureBlockSpace = hasFutureBlocks ? BLOCK_WIDTH_DAYS * DAY_WIDTH : 0;

  // Calculate chart dimensions (include offset and future block space)
  const chartWidth = useMemo(() => {
    return Math.max(previousBlockOffset + totalDisplayDays * DAY_WIDTH + futureBlockSpace, 800);
  }, [totalDisplayDays, previousBlockOffset, futureBlockSpace]);

  // Compute sprint boundary x-positions for vertical dividers
  const sprintBoundaryXs = useMemo(() => {
    if (!dailyCapacities || dailyCapacities.length === 0) return [];

    // Find the first dayIndex for each sprint (ordered by dayIndex)
    const sprintFirstDay = new Map<number, number>();
    for (const day of dailyCapacities) {
      if (!sprintFirstDay.has(day.sprintId)) {
        sprintFirstDay.set(day.sprintId, day.dayIndex);
      }
    }

    const sorted = [...sprintFirstDay.entries()].sort((a, b) => a[1] - b[1]);

    // Skip the first sprint — its left edge is the chart start, not a boundary
    return sorted.slice(1).map(([, dayIndex]) => previousBlockOffset + dayIndex * DAY_WIDTH);
  }, [dailyCapacities, previousBlockOffset]);

  return (
    <Paper elevation={0} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Summary bar */}
      <Box
        sx={{
          p: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          gap: 3,
          bgcolor: 'grey.50',
        }}
      >
        <Typography variant="body2">
          <strong>Total Dev Days:</strong> {data.totalDevDays}
        </Typography>
        <Typography variant="body2">
          <strong>Duration:</strong> {totalDays} work days
        </Typography>
        <Typography variant="body2">
          <strong>Start:</strong> {projectStartDate}
        </Typography>
        <Typography variant="body2">
          <strong>End:</strong> {data.projectEndDate}
        </Typography>
      </Box>

      {/* Scrollable chart area */}
      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        <Box sx={{ display: 'flex', minWidth: LABEL_WIDTH + chartWidth }}>
          {/* Labels column */}
          <Box
            sx={{
              width: LABEL_WIDTH,
              minWidth: LABEL_WIDTH,
              flexShrink: 0,
              position: 'sticky',
              left: 0,
              zIndex: 3,
              bgcolor: 'background.paper',
              borderRight: 1,
              borderColor: 'divider',
            }}
          >
            {/* Header spacer - 5 rows: months, sprint names, dates, capacity input, usage */}
            {/* This is the "no man's land" corner that covers both sticky header and sticky labels */}
            <Box sx={{
              height: 132,
              borderBottom: 1,
              borderColor: 'divider',
              position: 'sticky',
              top: 0,
              zIndex: 4,
              bgcolor: 'background.paper',
            }} />

            {/* Epic labels grouped by commit type */}
            {/* Commits section header */}
            {epicsByType.commits.length > 0 && (
              <Box sx={{ height: 20, display: 'flex', alignItems: 'center', bgcolor: 'grey.100', borderBottom: 2, borderColor: 'black' }}>
                <Typography variant="caption" sx={{ px: 1, fontWeight: 'bold', color: 'text.secondary', fontSize: 10 }}>
                  COMMITS
                </Typography>
              </Box>
            )}
            {epicsByType.commits.map((epic) => {
              const globalIndex = epics.findIndex(e => e.key === epic.key);
              return (
                <EpicRow
                  key={epic.key}
                  epic={epic}
                  labelOnly
                  dayWidth={DAY_WIDTH}
                  rowHeight={ROW_HEIGHT}
                  startDate={projectStartDate}
                  expanded={expandedEpics[epic.key] ?? true}
                  onToggleExpanded={() => toggleEpicExpanded(epic.key)}
                  epicColor={getEpicColor(globalIndex)}
                  totalDays={totalDisplayDays}
                />
              );
            })}
            {/* Stretches section header */}
            {epicsByType.stretches.length > 0 && (
              <Box sx={{ height: 20, display: 'flex', alignItems: 'center', bgcolor: 'grey.100', borderBottom: 2, borderColor: 'black' }}>
                <Typography variant="caption" sx={{ px: 1, fontWeight: 'bold', color: 'text.secondary', fontSize: 10 }}>
                  STRETCHES
                </Typography>
              </Box>
            )}
            {epicsByType.stretches.map((epic) => {
              const globalIndex = epics.findIndex(e => e.key === epic.key);
              return (
                <EpicRow
                  key={epic.key}
                  epic={epic}
                  labelOnly
                  dayWidth={DAY_WIDTH}
                  rowHeight={ROW_HEIGHT}
                  startDate={projectStartDate}
                  expanded={expandedEpics[epic.key] ?? true}
                  onToggleExpanded={() => toggleEpicExpanded(epic.key)}
                  epicColor={getEpicColor(globalIndex)}
                  totalDays={totalDisplayDays}
                />
              );
            })}
            {/* Others section header */}
            {epicsByType.others.length > 0 && (
              <Box sx={{ height: 20, display: 'flex', alignItems: 'center', bgcolor: 'grey.100', borderBottom: 2, borderColor: 'black' }}>
                <Typography variant="caption" sx={{ px: 1, fontWeight: 'bold', color: 'text.secondary', fontSize: 10 }}>
                  OTHER
                </Typography>
              </Box>
            )}
            {epicsByType.others.map((epic) => {
              const globalIndex = epics.findIndex(e => e.key === epic.key);
              return (
                <EpicRow
                  key={epic.key}
                  epic={epic}
                  labelOnly
                  dayWidth={DAY_WIDTH}
                  rowHeight={ROW_HEIGHT}
                  startDate={projectStartDate}
                  expanded={expandedEpics[epic.key] ?? true}
                  onToggleExpanded={() => toggleEpicExpanded(epic.key)}
                  epicColor={getEpicColor(globalIndex)}
                  totalDays={totalDisplayDays}
                />
              );
            })}
          </Box>

          {/* Chart area */}
          <Box sx={{ flexGrow: 1 }}>
            {/* Timeline header */}
            <TimelineHeader
              sprints={sprints}
              dailyCapacities={dailyCapacities}
              startDate={projectStartDate}
              dayWidth={DAY_WIDTH}
              maxDevelopers={maxDevelopers}
              onDailyCapacityChange={onDailyCapacityChange}
              today={today}
              sprintDateOverrides={sprintDateOverrides}
              chartLeftOffset={previousBlockOffset}
            />

            {/* Epic rows with ticket bars */}
            <Box sx={{ position: 'relative' }}>
              {/* Dependency lines overlay */}
              <DependencyLines
                epics={epics}
                expandedEpics={expandedEpics}
                dayWidth={DAY_WIDTH}
                rowHeight={ROW_HEIGHT}
                totalDays={totalDisplayDays}
                chartLeftOffset={previousBlockOffset}
                sectionHeaderHeight={20}
                hasCommits={epicsByType.commits.length > 0}
                hasStretches={epicsByType.stretches.length > 0}
                hasOthers={epicsByType.others.length > 0}
              />

              {/* Sprint boundary vertical lines */}
              {sprintBoundaryXs.map((x, idx) => (
                <Box
                  key={`sprint-boundary-${idx}`}
                  sx={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: x,
                    width: 0,
                    borderLeft: '1px dashed',
                    borderColor: 'grey.400',
                    zIndex: 1,
                    pointerEvents: 'none',
                  }}
                />
              ))}

              {/* Epic rows grouped by commit type */}
              {/* Commits section header */}
              {epicsByType.commits.length > 0 && (
                <Box sx={{ height: 20, borderBottom: 2, borderColor: 'black', bgcolor: 'grey.100' }} />
              )}
              {epicsByType.commits.map((epic) => {
                const globalIndex = epics.findIndex(e => e.key === epic.key);
                return (
                  <EpicRow
                    key={epic.key}
                    epic={epic}
                    dayWidth={DAY_WIDTH}
                    rowHeight={ROW_HEIGHT}
                    startDate={projectStartDate}
                    expanded={expandedEpics[epic.key] ?? true}
                    onToggleExpanded={() => toggleEpicExpanded(epic.key)}
                    epicColor={getEpicColor(globalIndex)}
                    today={today}
                    dailyCapacities={dailyCapacities}
                    totalDays={totalDisplayDays}
                    chartLeftOffset={previousBlockOffset}
                  />
                );
              })}
              {/* Stretches section header */}
              {epicsByType.stretches.length > 0 && (
                <Box sx={{ height: 20, borderBottom: 2, borderColor: 'black', bgcolor: 'grey.100' }} />
              )}
              {epicsByType.stretches.map((epic) => {
                const globalIndex = epics.findIndex(e => e.key === epic.key);
                return (
                  <EpicRow
                    key={epic.key}
                    epic={epic}
                    dayWidth={DAY_WIDTH}
                    rowHeight={ROW_HEIGHT}
                    startDate={projectStartDate}
                    expanded={expandedEpics[epic.key] ?? true}
                    onToggleExpanded={() => toggleEpicExpanded(epic.key)}
                    epicColor={getEpicColor(globalIndex)}
                    today={today}
                    dailyCapacities={dailyCapacities}
                    totalDays={totalDisplayDays}
                    chartLeftOffset={previousBlockOffset}
                  />
                );
              })}
              {/* Others section header */}
              {epicsByType.others.length > 0 && (
                <Box sx={{ height: 20, borderBottom: 2, borderColor: 'black', bgcolor: 'grey.100' }} />
              )}
              {epicsByType.others.map((epic) => {
                const globalIndex = epics.findIndex(e => e.key === epic.key);
                return (
                  <EpicRow
                    key={epic.key}
                    epic={epic}
                    dayWidth={DAY_WIDTH}
                    rowHeight={ROW_HEIGHT}
                    startDate={projectStartDate}
                    expanded={expandedEpics[epic.key] ?? true}
                    onToggleExpanded={() => toggleEpicExpanded(epic.key)}
                    epicColor={getEpicColor(globalIndex)}
                    today={today}
                    dailyCapacities={dailyCapacities}
                    totalDays={totalDisplayDays}
                    chartLeftOffset={previousBlockOffset}
                  />
                );
              })}
            </Box>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
};

export default GanttChart;
export { DAY_WIDTH, ROW_HEIGHT, LABEL_WIDTH };
