'use client';

import { useMemo, useState } from 'react';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import EffortStoriesGrid from './EffortStoriesGrid';
import {
  TSHIRT_SIZES,
  type EffortEpic,
  type EffortStory,
  type TshirtSize,
} from '@/shared/types';

const jiraBaseUrl = process.env.NEXT_PUBLIC_JIRA_BASE_URL?.replace(/\/$/, '');

/**
 * Midpoints of each t-shirt size range. XL is open-ended (41+), so we pick a
 * reasonable point estimate (50) rather than extrapolating from a single
 * bound.
 */
export const SIZE_MIDPOINT: Record<TshirtSize, number> = {
  XS: 3,     // mid of 1..5
  S: 10.5,   // mid of 6..15
  M: 20.5,   // mid of 16..25
  L: 33,     // mid of 26..40
  XL: 50,    // open-ended 41+ — fixed estimate
  None: 0,
};

const DEFAULT_BUFFER_PCT = 10; // default contingency buffer applied to each project's totals

const teamForStory = (story: EffortStory): string => {
  const idx = story.key.indexOf('-');
  return idx > 0 ? story.key.slice(0, idx) : story.key;
};

const pointsForStory = (story: EffortStory): number => SIZE_MIDPOINT[story.size];

interface TeamTotals {
  team: string;
  totalStories: number;
  sizeCounts: Record<TshirtSize, number>;
  // Tier-specific cumulative point totals.
  // Must = Must-Have only; mustAndShould = Must + Should; all = every story
  // (including Could-Have and Unclassified).
  mustPoints: number;
  mustAndShouldPoints: number;
  allPoints: number;
}

const emptySizeCounts = (): Record<TshirtSize, number> => {
  const out = {} as Record<TshirtSize, number>;
  for (const s of TSHIRT_SIZES) out[s] = 0;
  return out;
};

const rollup = (epics: EffortEpic[]): TeamTotals[] => {
  const byTeam = new Map<string, TeamTotals>();
  for (const epic of epics) {
    for (const story of epic.stories) {
      const team = teamForStory(story);
      const entry = byTeam.get(team) ?? {
        team,
        totalStories: 0,
        sizeCounts: emptySizeCounts(),
        mustPoints: 0,
        mustAndShouldPoints: 0,
        allPoints: 0,
      };
      entry.totalStories += 1;
      entry.sizeCounts[story.size] += 1;

      const pts = pointsForStory(story);
      entry.allPoints += pts;
      if (story.classification === 'Must-Have') {
        entry.mustPoints += pts;
        entry.mustAndShouldPoints += pts;
      } else if (story.classification === 'Should-Have') {
        entry.mustAndShouldPoints += pts;
      }
      // Could-Have and Unclassified only contribute to the "all" tier.

      byTeam.set(team, entry);
    }
  }
  return Array.from(byTeam.values());
};

const sprintsFor = (
  points: number,
  velocity: number | null,
  bufferMultiplier: number
): number | null => {
  if (velocity === null || velocity <= 0) return null;
  return (points * bufferMultiplier) / velocity;
};

interface SprintsNeededTabProps {
  epics: EffortEpic[];
  teamNames: Record<string, string>;
}

/**
 * A cell selection: a team plus either a specific size or "ALL" meaning
 * "every story in the team row regardless of size". null = no selection.
 */
type Selection = { team: string; size: TshirtSize | 'ALL' } | null;

const SprintsNeededTab = ({ epics, teamNames }: SprintsNeededTabProps) => {
  // Per-project velocity and buffer, both kept as strings so the input can
  // round-trip empty / in-progress values. Empty buffer falls back to the
  // default so calculations keep working if the user clears the field.
  const [velocities, setVelocities] = useState<Record<string, string>>({});
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<Selection>(null);

  const isSelected = (team: string, size: TshirtSize | 'ALL') =>
    selection?.team === team && selection?.size === size;

  const toggleSelection = (team: string, size: TshirtSize | 'ALL') => {
    setSelection((prev) =>
      prev?.team === team && prev?.size === size ? null : { team, size }
    );
  };

  const selectedStories = useMemo<EffortStory[]>(() => {
    if (!selection) return [];
    const all = epics.flatMap((e) => e.stories);
    return all.filter((s) => {
      if (teamForStory(s) !== selection.team) return false;
      if (selection.size === 'ALL') return true;
      return s.size === selection.size;
    });
  }, [epics, selection]);

  const rows = useMemo(() => {
    const totals = rollup(epics);
    return totals
      .map((t) => {
        const rawVelocity = velocities[t.team];
        const parsedVelocity = rawVelocity ? Number(rawVelocity) : NaN;
        const velocity =
          !Number.isNaN(parsedVelocity) && parsedVelocity > 0 ? parsedVelocity : null;

        const rawBuffer = buffers[t.team];
        const bufferInput = rawBuffer ?? String(DEFAULT_BUFFER_PCT);
        const parsedBuffer = bufferInput === '' ? NaN : Number(bufferInput);
        const bufferPct = Number.isNaN(parsedBuffer) ? DEFAULT_BUFFER_PCT : parsedBuffer;
        // (points + points × buffer%) ÷ velocity  ≡  points × (1 + buffer%) ÷ velocity
        const bufferMultiplier = 1 + bufferPct / 100;

        return {
          team: t.team,
          name: teamNames[t.team] ?? t.team,
          sizeCounts: t.sizeCounts,
          totalStories: t.totalStories,
          mustPoints: t.mustPoints,
          mustAndShouldPoints: t.mustAndShouldPoints,
          allPoints: t.allPoints,
          velocityInput: rawVelocity ?? '',
          bufferInput,
          sprintsMust: sprintsFor(t.mustPoints, velocity, bufferMultiplier),
          sprintsMustAndShould: sprintsFor(t.mustAndShouldPoints, velocity, bufferMultiplier),
          sprintsAll: sprintsFor(t.allPoints, velocity, bufferMultiplier),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [epics, teamNames, velocities, buffers]);

  const colSx = { fontSize: '0.85rem', py: 0.75, px: 1.5 };
  const headerSx = {
    ...colSx,
    fontWeight: 700,
    bgcolor: 'grey.100',
    whiteSpace: 'nowrap' as const,
  };

  const formatSprints = (v: number | null) =>
    v === null ? (
      <Typography variant="caption" color="text.disabled">—</Typography>
    ) : (
      v.toFixed(1)
    );

  if (rows.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No projects with stories in the loaded initiatives.
        </Typography>
      </Paper>
    );
  }

  return (
    <Box sx={{ pt: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Sprints needed per project, based on midpoint-converted story-point totals
        plus a per-project contingency buffer (default {DEFAULT_BUFFER_PCT}%) at the
        velocity you enter. Stories are bucketed by
        <code> Must-Have</code> / <code>Should-Have</code> / <code>Could-Have</code> labels;
        Could-Have and Unclassified work is included only in the <b>+ Could (All)</b> tier.
        Formula: <code>(tier points + (tier points × buffer%)) ÷ velocity</code>.
      </Typography>
      <TableContainer component={Paper} elevation={1}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={headerSx}>Project</TableCell>
              {TSHIRT_SIZES.map((size) => (
                <TableCell key={size} sx={{ ...headerSx, textAlign: 'center' }}>
                  {size}
                </TableCell>
              ))}
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Stories</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Total Points</TableCell>
              <TableCell
                sx={{ ...headerSx, textAlign: 'right' }}
                title="Contingency percentage added to tier points before dividing by velocity"
              >
                % Buffer
              </TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Velocity</TableCell>
              <TableCell
                sx={{ ...headerSx, textAlign: 'right' }}
                title="Sprints needed if committing only Must-Have stories"
              >
                Sprints (Must)
              </TableCell>
              <TableCell
                sx={{ ...headerSx, textAlign: 'right' }}
                title="Sprints needed for Must-Have + Should-Have stories"
              >
                Sprints (+ Should)
              </TableCell>
              <TableCell
                sx={{ ...headerSx, textAlign: 'right' }}
                title="Sprints needed for every story (including Could-Have and Unclassified)"
              >
                Sprints (+ Could / All)
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.team}
                hover
                sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}
              >
                <TableCell sx={colSx} title={row.team}>
                  {row.name}
                </TableCell>
                {TSHIRT_SIZES.map((size) => {
                  const count = row.sizeCounts[size] ?? 0;
                  // All size columns (including None) are clickable when the
                  // count is > 0 — zero-count cells have nothing to show.
                  const clickable = count > 0;
                  const active = isSelected(row.team, size);
                  return (
                    <TableCell
                      key={size}
                      onClick={clickable ? () => toggleSelection(row.team, size) : undefined}
                      sx={{
                        ...colSx,
                        textAlign: 'center',
                        cursor: clickable ? 'pointer' : 'default',
                        bgcolor: active ? 'primary.light' : undefined,
                        fontWeight: active ? 700 : undefined,
                        '&:hover': clickable ? { bgcolor: active ? 'primary.light' : 'action.hover' } : undefined,
                      }}
                    >
                      {count}
                    </TableCell>
                  );
                })}
                <TableCell
                  onClick={row.totalStories > 0 ? () => toggleSelection(row.team, 'ALL') : undefined}
                  sx={{
                    ...colSx,
                    textAlign: 'right',
                    fontWeight: isSelected(row.team, 'ALL') ? 700 : 500,
                    cursor: row.totalStories > 0 ? 'pointer' : 'default',
                    bgcolor: isSelected(row.team, 'ALL') ? 'primary.light' : undefined,
                    '&:hover': row.totalStories > 0
                      ? { bgcolor: isSelected(row.team, 'ALL') ? 'primary.light' : 'action.hover' }
                      : undefined,
                  }}
                >
                  {row.totalStories}
                </TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right', fontWeight: 500 }}>
                  {row.allPoints.toFixed(1)}
                </TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right', py: 0.25 }}>
                  <TextField
                    value={row.bufferInput}
                    onChange={(e) =>
                      setBuffers((prev) => ({ ...prev, [row.team]: e.target.value }))
                    }
                    size="small"
                    type="number"
                    placeholder={String(DEFAULT_BUFFER_PCT)}
                    slotProps={{
                      htmlInput: {
                        min: 0,
                        step: 'any',
                        style: { textAlign: 'right', fontSize: '0.85rem' },
                      },
                    }}
                    sx={{ width: 70 }}
                  />
                </TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right', py: 0.25 }}>
                  <TextField
                    value={row.velocityInput}
                    onChange={(e) =>
                      setVelocities((prev) => ({ ...prev, [row.team]: e.target.value }))
                    }
                    size="small"
                    type="number"
                    placeholder="velocity"
                    slotProps={{
                      htmlInput: {
                        min: 0,
                        step: 'any',
                        style: { textAlign: 'right', fontSize: '0.85rem' },
                      },
                    }}
                    sx={{ width: 90 }}
                  />
                </TableCell>
                <TableCell
                  sx={{ ...colSx, textAlign: 'right', fontWeight: 600 }}
                  title={`Must: ${row.mustPoints.toFixed(1)} pts`}
                >
                  {formatSprints(row.sprintsMust)}
                </TableCell>
                <TableCell
                  sx={{ ...colSx, textAlign: 'right', fontWeight: 600 }}
                  title={`Must + Should: ${row.mustAndShouldPoints.toFixed(1)} pts`}
                >
                  {formatSprints(row.sprintsMustAndShould)}
                </TableCell>
                <TableCell
                  sx={{ ...colSx, textAlign: 'right', fontWeight: 600 }}
                  title={`All: ${row.allPoints.toFixed(1)} pts`}
                >
                  {formatSprints(row.sprintsAll)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {selection && (
        <Box sx={{ mt: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Stories in {teamNames[selection.team] ?? selection.team}
              {selection.size !== 'ALL' && ` · size ${selection.size}`}
            </Typography>
            <Chip
              label={`${selectedStories.length} ${selectedStories.length === 1 ? 'story' : 'stories'}`}
              size="small"
              color={selectedStories.length > 0 ? 'primary' : 'default'}
              variant="outlined"
            />
            <Chip
              label="Clear"
              size="small"
              variant="outlined"
              onClick={() => setSelection(null)}
              onDelete={() => setSelection(null)}
            />
          </Box>
          <EffortStoriesGrid stories={selectedStories} jiraBaseUrl={jiraBaseUrl} />
        </Box>
      )}
    </Box>
  );
};

export default SprintsNeededTab;
