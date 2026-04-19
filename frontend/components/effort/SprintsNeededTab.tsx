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
import { TSHIRT_SIZES, type TshirtSize } from '@/shared/types';
import type { EffortTeamStack } from './rollups';

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

const CONTINGENCY = 1.10; // +10% buffer

const totalPointsForStack = (stack: EffortTeamStack): number => {
  let total = 0;
  for (const size of TSHIRT_SIZES) {
    total += (stack.bySize[size] ?? 0) * SIZE_MIDPOINT[size];
  }
  return total;
};

interface SprintsNeededTabProps {
  stacks: EffortTeamStack[];
  teamNames: Record<string, string>;
}

const SprintsNeededTab = ({ stacks, teamNames }: SprintsNeededTabProps) => {
  // Velocity state keyed by project key. Empty string while the user hasn't
  // entered a value; parsed to a number when computing sprints.
  const [velocities, setVelocities] = useState<Record<string, string>>({});

  const rows = useMemo(() => {
    return stacks
      .map((stack) => {
        const totalPoints = totalPointsForStack(stack);
        const rawVelocity = velocities[stack.team];
        const velocity = rawVelocity ? Number(rawVelocity) : NaN;
        const hasVelocity = !Number.isNaN(velocity) && velocity > 0;
        const sprints = hasVelocity
          ? (totalPoints * CONTINGENCY) / velocity
          : null;
        return {
          team: stack.team,
          name: teamNames[stack.team] ?? stack.team,
          counts: stack.bySize,
          totalStories: stack.total,
          totalPoints,
          velocityInput: rawVelocity ?? '',
          sprints,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [stacks, teamNames, velocities]);

  const colSx = { fontSize: '0.85rem', py: 0.75, px: 1.5 };
  const headerSx = {
    ...colSx,
    fontWeight: 700,
    bgcolor: 'grey.100',
    whiteSpace: 'nowrap' as const,
  };

  if (stacks.length === 0) {
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
        plus a 10% buffer, at the velocity you enter.
        Formula: <code>(total × 1.10) ÷ velocity</code>.
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
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Velocity</TableCell>
              <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Sprints</TableCell>
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
                {TSHIRT_SIZES.map((size) => (
                  <TableCell key={size} sx={{ ...colSx, textAlign: 'center' }}>
                    {row.counts[size] ?? 0}
                  </TableCell>
                ))}
                <TableCell sx={{ ...colSx, textAlign: 'right', fontWeight: 500 }}>
                  {row.totalStories}
                </TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right', fontWeight: 500 }}>
                  {row.totalPoints.toFixed(1)}
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
                <TableCell sx={{ ...colSx, textAlign: 'right', fontWeight: 600 }}>
                  {row.sprints === null ? (
                    <Typography variant="caption" color="text.disabled">
                      —
                    </Typography>
                  ) : (
                    row.sprints.toFixed(1)
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default SprintsNeededTab;
