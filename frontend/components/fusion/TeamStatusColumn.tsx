'use client';

import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colorForStatus } from './statusColors';
import type { TeamStack } from './rollups';

interface TeamStatusColumnProps {
  stacks: TeamStack[];
  teamNames: Record<string, string>; // project key → project name
  selected: { team?: string; status?: string } | null;
  onSelectSegment: (team: string, status: string) => void;
  onSelectTeam: (team: string) => void;
}

const LABEL_MAX_CHARS = 24;
const truncate = (s: string) =>
  s.length > LABEL_MAX_CHARS ? `${s.slice(0, LABEL_MAX_CHARS - 1)}…` : s;

const CHART_HEIGHT = 240;
const COL_WIDTH = 48;
const COL_GAP = 16;
const TOP_PAD = 20;
const BOTTOM_PAD = 80;
const LEFT_PAD = 40;
const LABEL_ROTATE_DEG = -30;

const TeamStatusColumn = ({
  stacks,
  teamNames,
  selected,
  onSelectSegment,
  onSelectTeam,
}: TeamStatusColumnProps) => {
  const { maxTotal, allStatuses } = useMemo(() => {
    let max = 0;
    const statuses = new Set<string>();
    for (const s of stacks) {
      if (s.total > max) max = s.total;
      for (const k of Object.keys(s.byStatus)) statuses.add(k);
    }
    return {
      maxTotal: max,
      allStatuses: Array.from(statuses).sort((a, b) => a.localeCompare(b)),
    };
  }, [stacks]);

  if (stacks.length === 0 || maxTotal === 0) {
    return (
      <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 6 }}>
        <Typography variant="body2">No points to chart</Typography>
      </Box>
    );
  }

  const chartWidth = LEFT_PAD + stacks.length * (COL_WIDTH + COL_GAP);
  const innerHeight = CHART_HEIGHT - TOP_PAD - BOTTOM_PAD;

  const segmentDim = (team: string, status: string) => {
    if (!selected) return false;
    if (selected.team && selected.status) {
      return !(selected.team === team && selected.status === status);
    }
    if (selected.team) return selected.team !== team;
    if (selected.status) return selected.status !== status;
    return false;
  };

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5, textAlign: 'center' }}>
        Points by Team × Status
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <svg width={chartWidth} height={CHART_HEIGHT} style={{ display: 'block' }}>
          {/* Y-axis baseline */}
          <line
            x1={LEFT_PAD}
            y1={TOP_PAD + innerHeight}
            x2={chartWidth}
            y2={TOP_PAD + innerHeight}
            stroke="#ccc"
          />
          {/* Max label */}
          <text x={LEFT_PAD - 6} y={TOP_PAD + 4} fontSize={10} fill="#666" textAnchor="end">
            {Math.round(maxTotal)}
          </text>
          <text
            x={LEFT_PAD - 6}
            y={TOP_PAD + innerHeight + 4}
            fontSize={10}
            fill="#666"
            textAnchor="end"
          >
            0
          </text>

          {stacks.map((stack, colIdx) => {
            const xLeft = LEFT_PAD + colIdx * (COL_WIDTH + COL_GAP);
            const cx = xLeft + COL_WIDTH / 2;
            const topY = TOP_PAD + innerHeight - (stack.total / maxTotal) * innerHeight;
            const labelAnchorY = TOP_PAD + innerHeight + 8;
            // Build segments ordered by allStatuses for stable stacking
            let cursorY = TOP_PAD + innerHeight;
            const segments = allStatuses
              .filter(st => (stack.byStatus[st] ?? 0) > 0)
              .map(status => {
                const value = stack.byStatus[status];
                const h = (value / maxTotal) * innerHeight;
                cursorY -= h;
                return { status, value, y: cursorY, h };
              });

            return (
              <g key={stack.team}>
                {segments.map(seg => {
                  const dim = segmentDim(stack.team, seg.status);
                  return (
                    <rect
                      key={seg.status}
                      x={xLeft}
                      y={seg.y}
                      width={COL_WIDTH}
                      height={seg.h}
                      fill={colorForStatus(seg.status)}
                      stroke="white"
                      strokeWidth={1}
                      opacity={dim ? 0.35 : 1}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onSelectSegment(stack.team, seg.status)}
                    >
                      <title>{`${teamNames[stack.team] ?? stack.team} · ${seg.status}: ${Math.round(seg.value)}`}</title>
                    </rect>
                  );
                })}
                {/* total label — sits above the column top */}
                <text
                  x={cx}
                  y={topY - 4}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#666"
                >
                  {Math.round(stack.total)}
                </text>
                {/* team label — angled; shows project name, falls back to code */}
                <text
                  x={cx}
                  y={labelAnchorY}
                  textAnchor="end"
                  transform={`rotate(${LABEL_ROTATE_DEG} ${cx} ${labelAnchorY})`}
                  fontSize={11}
                  fontWeight={selected?.team === stack.team ? 700 : 400}
                  fill="#333"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelectTeam(stack.team)}
                >
                  {truncate(teamNames[stack.team] ?? stack.team)}
                  <title>
                    {teamNames[stack.team]
                      ? `${stack.team} — ${teamNames[stack.team]}`
                      : stack.team}
                  </title>
                </text>
              </g>
            );
          })}
        </svg>
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1 }}>
        {allStatuses.map(status => (
          <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '2px',
                bgcolor: colorForStatus(status),
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {status}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default TeamStatusColumn;
