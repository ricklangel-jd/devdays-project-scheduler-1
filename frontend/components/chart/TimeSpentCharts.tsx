'use client';

import { useMemo, useCallback } from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DownloadIcon from '@mui/icons-material/Download';
import { EPIC_COLORS } from '@/shared/constants';
import type { TimeSpentData, InitiativeInfo, EpicInfo } from '@/frontend/hooks/useTimeSpentData';

// ── CSV export ────────────────────────────────────────────────────────

/** Escape a value for CSV: wrap in quotes if it contains a comma, quote, or newline. */
const csvCell = (value: string | number): string => {
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

const buildCsvContent = (data: TimeSpentData): string => {
  const rows: string[] = ['Key,Summary,Points'];
  for (const initiative of data.initiatives) {
    for (const epic of initiative.epics) {
      rows.push(`${csvCell(epic.key)},${csvCell(epic.summary)},${csvCell(epic.totalPoints)}`);
    }
  }
  return rows.join('\r\n');
};

const saveEpicsCsv = async (data: TimeSpentData): Promise<void> => {
  const csv = buildCsvContent(data);

  // Use the File System Access API for a native Save As dialog where available
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  if (typeof window !== 'undefined' && typeof win.showSaveFilePicker === 'function') {
    try {
      const handle = await win.showSaveFilePicker({
        suggestedName: 'epics.csv',
        types: [{ description: 'CSV Spreadsheet', accept: { 'text/csv': ['.csv'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(csv);
      await writable.close();
      return;
    } catch (err) {
      // User cancelled — no fallback needed
      if ((err as { name?: string }).name === 'AbortError') return;
      // Other error — fall through to anchor download
    }
  }

  // Fallback: trigger browser download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'epics.csv';
  a.click();
  URL.revokeObjectURL(url);
};

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

interface TimeSpentChartsProps {
  data: TimeSpentData;
  selectedInitiative: string | null;
  selectedEpic: string | null;
  onInitiativeSelect: (key: string) => void;
  onEpicSelect: (key: string) => void;
}

// Pie chart constants
const PIE_SIZE = 400;
const PIE_RADIUS = 160;
const PIE_CENTER = PIE_SIZE / 2;

interface PieSlice {
  key: string;
  label: string;
  points: number;
  percentage: number;
  color: string;
}

const buildArcs = (slices: PieSlice[]) => {
  let currentAngle = -Math.PI / 2;
  const totalPoints = slices.reduce((sum, s) => sum + s.points, 0);

  return slices.map((slice) => {
    const sliceAngle = totalPoints > 0 ? (slice.points / totalPoints) * 2 * Math.PI : 0;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

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
};

/** Reusable pie chart with clickable slices and legend */
const PieChart = ({
  title,
  subtitle,
  slices,
  highlightedKey,
  onSliceClick,
}: {
  title: string;
  subtitle: string;
  slices: PieSlice[];
  highlightedKey: string | null;
  onSliceClick: (key: string) => void;
}) => {
  const totalPoints = slices.reduce((sum, s) => sum + s.points, 0);
  const arcs = buildArcs(slices);

  if (totalPoints === 0) {
    return (
      <Box sx={{ textAlign: 'center', p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary">
          No story points found
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Typography variant="h6" sx={{ mb: 0.25 }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {subtitle} ({totalPoints} total points)
      </Typography>

      <svg width={PIE_SIZE} height={PIE_SIZE}>
        {arcs.map((arc) => {
          const isHighlighted = highlightedKey === arc.key;
          const isDimmed = highlightedKey !== null && !isHighlighted;
          return (
            <path
              key={arc.key}
              d={arc.path}
              fill={arc.color}
              stroke={isHighlighted ? '#333' : 'white'}
              strokeWidth={isHighlighted ? 3 : 2}
              opacity={isDimmed ? 0.25 : 1}
              style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
              onClick={() => onSliceClick(arc.key)}
            >
              <title>{`${arc.label}: ${arc.points} pts (${arc.percentage}%)`}</title>
            </path>
          );
        })}
      </svg>

      {/* Legend */}
      <Box sx={{ mt: 1, maxWidth: PIE_SIZE, width: '100%' }}>
        {slices.map((slice) => {
          const isHighlighted = highlightedKey === slice.key;
          const isDimmed = highlightedKey !== null && !isHighlighted;
          return (
            <Box
              key={slice.key}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                py: 0.25,
                px: 0.5,
                cursor: 'pointer',
                opacity: isDimmed ? 0.4 : 1,
                transition: 'opacity 0.2s ease',
                fontWeight: isHighlighted ? 'bold' : 'normal',
                '&:hover': { bgcolor: 'action.hover' },
                borderRadius: 0.5,
              }}
              onClick={() => onSliceClick(slice.key)}
            >
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: '2px',
                  backgroundColor: slice.color,
                  flexShrink: 0,
                }}
              />
              <Typography
                variant="body2"
                sx={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 12,
                }}
              >
                {slice.label}
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
                {slice.points} pts ({slice.percentage}%)
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

const TimeSpentCharts = ({ data, selectedInitiative, selectedEpic, onInitiativeSelect, onEpicSelect }: TimeSpentChartsProps) => {
  const handleExport = useCallback(() => saveEpicsCsv(data), [data]);
  // Build initiative pie slices
  const initiativeSlices = useMemo((): PieSlice[] => {
    const totalPoints = data.initiatives.reduce((sum, init) => sum + init.totalPoints, 0);
    return data.initiatives.map((init, idx) => ({
      key: init.key,
      label: init.summary,
      points: init.totalPoints,
      percentage: totalPoints > 0 ? Math.round((init.totalPoints / totalPoints) * 1000) / 10 : 0,
      color: EPIC_COLORS[idx % EPIC_COLORS.length],
    }));
  }, [data.initiatives]);

  // Build epic pie slices for selected initiative
  const selectedInitData: InitiativeInfo | null = useMemo(() => {
    if (!selectedInitiative) return null;
    return data.initiatives.find((init) => init.key === selectedInitiative) ?? null;
  }, [data.initiatives, selectedInitiative]);

  const epicSlices = useMemo((): PieSlice[] => {
    if (!selectedInitData) return [];
    const totalPoints = selectedInitData.totalPoints;
    return selectedInitData.epics.map((epic, idx) => ({
      key: epic.key,
      label: `${epic.key}: ${epic.summary}`,
      points: epic.totalPoints,
      percentage: totalPoints > 0 ? Math.round((epic.totalPoints / totalPoints) * 1000) / 10 : 0,
      color: EPIC_COLORS[idx % EPIC_COLORS.length],
    }));
  }, [selectedInitData]);

  // Build story pie slices for selected epic
  const selectedEpicData: EpicInfo | null = useMemo(() => {
    if (!selectedEpic || !selectedInitData) return null;
    return selectedInitData.epics.find((e) => e.key === selectedEpic) ?? null;
  }, [selectedInitData, selectedEpic]);

  const storySlices = useMemo((): PieSlice[] => {
    if (!selectedEpicData) return [];
    const totalPoints = selectedEpicData.totalPoints;
    return selectedEpicData.stories.map((story, idx) => ({
      key: story.key,
      label: `${story.key}: ${story.summary}`,
      points: story.points,
      percentage: totalPoints > 0 ? Math.round((story.points / totalPoints) * 1000) / 10 : 0,
      color: EPIC_COLORS[idx % EPIC_COLORS.length],
    }));
  }, [selectedEpicData]);

  // No-op handler for story pie (no drill-down from stories)
  const handleStoryClick = () => {};

  if (data.initiatives.length === 0) {
    return (
      <Paper sx={{ px: 3, py: 2, m: 2 }} elevation={1}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Time Spent
        </Typography>
        <Typography variant="body2" color="text.secondary">
          No epics with stories found in the selected sprints
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ px: 3, py: 2, m: 2 }} elevation={1}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<DownloadIcon />}
          onClick={handleExport}
        >
          Export Epics
        </Button>
      </Box>
      <Box sx={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Initiative pie chart */}
        <PieChart
          title="Initiatives"
          subtitle="Story points by initiative"
          slices={initiativeSlices}
          highlightedKey={selectedInitiative}
          onSliceClick={onInitiativeSelect}
        />

        {/* Epic pie chart for selected initiative */}
        {selectedInitData && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <PieChart
              title={selectedInitData.summary}
              subtitle="Story points by epic"
              slices={epicSlices}
              highlightedKey={selectedEpic}
              onSliceClick={onEpicSelect}
            />
            {JIRA_BASE_URL && selectedEpic ? (
              <Button
                variant="outlined"
                size="small"
                startIcon={<OpenInNewIcon />}
                href={`${JIRA_BASE_URL}/browse/${selectedEpic}`}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ mt: 1 }}
              >
                Open in Jira
              </Button>
            ) : JIRA_BASE_URL ? (
              <Button
                variant="outlined"
                size="small"
                startIcon={<OpenInNewIcon />}
                disabled
                sx={{ mt: 1 }}
              >
                Open in Jira
              </Button>
            ) : null}
          </Box>
        )}

        {/* Story pie chart for selected epic */}
        {selectedEpicData && (
          <PieChart
            title={`${selectedEpicData.key}: ${selectedEpicData.summary}`}
            subtitle="Story points by story"
            slices={storySlices}
            highlightedKey={null}
            onSliceClick={handleStoryClick}
          />
        )}
      </Box>
    </Paper>
  );
};

export default TimeSpentCharts;
