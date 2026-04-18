'use client';

import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colorForStatus } from './statusColors';
import type { InitiativeStack } from './rollups';

interface InitiativeStatusColumnProps {
  stacks: InitiativeStack[];
}

const CHART_HEIGHT = 220;
const COL_WIDTH = 48;
const COL_GAP = 16;
const TOP_PAD = 20;
const BOTTOM_PAD = 40;
const LEFT_PAD = 40;

const InitiativeStatusColumn = ({ stacks }: InitiativeStatusColumnProps) => {
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

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5, textAlign: 'center' }}>
        Points by Initiative × Status
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
              <g key={stack.initiativeKey}>
                {segments.map(seg => (
                  <rect
                    key={seg.status}
                    x={xLeft}
                    y={seg.y}
                    width={COL_WIDTH}
                    height={seg.h}
                    fill={colorForStatus(seg.status)}
                    stroke="white"
                    strokeWidth={1}
                  >
                    <title>{`${stack.initiativeKey} · ${seg.status}: ${Math.round(seg.value)}`}</title>
                  </rect>
                ))}
                <text
                  x={xLeft + COL_WIDTH / 2}
                  y={TOP_PAD + innerHeight + 14}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#333"
                >
                  {stack.initiativeKey}
                </text>
                <text
                  x={xLeft + COL_WIDTH / 2}
                  y={TOP_PAD + innerHeight + 28}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#666"
                >
                  {Math.round(stack.total)}
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

export default InitiativeStatusColumn;
