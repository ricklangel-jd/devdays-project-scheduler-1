'use client';

import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colorForSize } from './sizeColors';
import { TSHIRT_SIZES, type TshirtSize } from '@/shared/types';
import type { EffortTeamStack } from './rollups';

interface TeamSizeColumnProps {
  stacks: EffortTeamStack[];
  teamNames: Record<string, string>;
  selected: { team?: string; size?: TshirtSize } | null;
  onSelectSegment: (team: string, size: TshirtSize) => void;
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

const TeamSizeColumn = ({
  stacks,
  teamNames,
  selected,
  onSelectSegment,
  onSelectTeam,
}: TeamSizeColumnProps) => {
  const { maxTotal, presentSizes } = useMemo(() => {
    let max = 0;
    const present = new Set<TshirtSize>();
    for (const s of stacks) {
      if (s.total > max) max = s.total;
      for (const size of TSHIRT_SIZES) {
        if ((s.bySize[size] ?? 0) > 0) present.add(size);
      }
    }
    return {
      maxTotal: max,
      presentSizes: TSHIRT_SIZES.filter((s) => present.has(s)),
    };
  }, [stacks]);

  if (stacks.length === 0 || maxTotal === 0) {
    return (
      <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 6 }}>
        <Typography variant="body2">No stories to chart</Typography>
      </Box>
    );
  }

  const chartWidth = LEFT_PAD + stacks.length * (COL_WIDTH + COL_GAP);
  const innerHeight = CHART_HEIGHT - TOP_PAD - BOTTOM_PAD;

  const segmentDim = (team: string, size: TshirtSize) => {
    if (!selected) return false;
    if (selected.team && selected.size) {
      return !(selected.team === team && selected.size === size);
    }
    if (selected.team) return selected.team !== team;
    if (selected.size) return selected.size !== size;
    return false;
  };

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5, textAlign: 'center' }}>
        Stories by Team × Size
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <svg width={chartWidth} height={CHART_HEIGHT} style={{ display: 'block' }}>
          <line
            x1={LEFT_PAD}
            y1={TOP_PAD + innerHeight}
            x2={chartWidth}
            y2={TOP_PAD + innerHeight}
            stroke="#ccc"
          />
          <text x={LEFT_PAD - 6} y={TOP_PAD + 4} fontSize={10} fill="#666" textAnchor="end">
            {maxTotal}
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
            let cursorY = TOP_PAD + innerHeight;
            const segments = presentSizes
              .filter((sz) => (stack.bySize[sz] ?? 0) > 0)
              .map((size) => {
                const value = stack.bySize[size];
                const h = (value / maxTotal) * innerHeight;
                cursorY -= h;
                return { size, value, y: cursorY, h };
              });

            return (
              <g key={stack.team}>
                {segments.map((seg) => {
                  const dim = segmentDim(stack.team, seg.size);
                  return (
                    <rect
                      key={seg.size}
                      x={xLeft}
                      y={seg.y}
                      width={COL_WIDTH}
                      height={seg.h}
                      fill={colorForSize(seg.size)}
                      stroke="white"
                      strokeWidth={1}
                      opacity={dim ? 0.35 : 1}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onSelectSegment(stack.team, seg.size)}
                    >
                      <title>{`${teamNames[stack.team] ?? stack.team} · ${seg.size}: ${seg.value}`}</title>
                    </rect>
                  );
                })}
                <text x={cx} y={topY - 4} textAnchor="middle" fontSize={10} fill="#666">
                  {stack.total}
                </text>
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

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1 }}>
        {presentSizes.map((size) => (
          <Box key={size} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '2px',
                bgcolor: colorForSize(size),
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {size}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default TeamSizeColumn;
