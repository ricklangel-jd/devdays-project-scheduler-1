'use client';

import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colorForStatus } from './statusColors';
import type { PieSlice } from './rollups';

interface StatusPieProps {
  slices: PieSlice[];
  selectedStatus: string | null;
  onSelect: (status: string) => void;
}

interface SvgSlice {
  status: string;
  color: string;
  pct: number;
  pathD: string;
  midAngle: number;
  offsetX: number;
  offsetY: number;
}

const R = 100;
const CX = 130;
const CY = 130;
const LABEL_R = 70;
const EXPLODE = 8;

const buildSvgSlices = (
  slices: PieSlice[],
  selectedStatus: string | null
): { svgSlices: SvgSlice[]; total: number } => {
  const total = slices.reduce((s, v) => s + v.points, 0);
  if (total === 0) return { svgSlices: [], total: 0 };

  const out: SvgSlice[] = [];
  let cursor = -Math.PI / 2;
  for (const slice of slices) {
    if (slice.points === 0) continue;
    const angle = (slice.points / total) * 2 * Math.PI;
    const start = cursor;
    const end = cursor + angle;
    const mid = cursor + angle / 2;

    const selected = selectedStatus === slice.status;
    const ox = selected ? Math.cos(mid) * EXPLODE : 0;
    const oy = selected ? Math.sin(mid) * EXPLODE : 0;

    const x1 = CX + ox + R * Math.cos(start);
    const y1 = CY + oy + R * Math.sin(start);
    const x2 = CX + ox + R * Math.cos(end);
    const y2 = CY + oy + R * Math.sin(end);
    const large = angle > Math.PI ? 1 : 0;

    out.push({
      status: slice.status,
      color: colorForStatus(slice.status),
      pct: Math.round((slice.points / total) * 100),
      pathD: `M ${CX + ox} ${CY + oy} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`,
      midAngle: mid,
      offsetX: ox,
      offsetY: oy,
    });
    cursor = end;
  }
  return { svgSlices: out, total };
};

const StatusPie = ({ slices, selectedStatus, onSelect }: StatusPieProps) => {
  const { svgSlices, total } = useMemo(
    () => buildSvgSlices(slices, selectedStatus),
    [slices, selectedStatus]
  );

  if (total === 0) {
    return (
      <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 6 }}>
        <Typography variant="body2">No points to chart</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5, textAlign: 'center' }}>
        Points by Status
      </Typography>
      <svg width={260} height={260} style={{ display: 'block' }}>
        {svgSlices.map((s) => {
          const dim = selectedStatus !== null && selectedStatus !== s.status;
          return (
            <g
              key={s.status}
              onClick={() => onSelect(s.status)}
              style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }}
            >
              <path
                d={s.pathD}
                fill={s.color}
                stroke="white"
                strokeWidth={selectedStatus === s.status ? 3 : 2}
              />
              {s.pct >= 8 && (
                <text
                  x={CX + s.offsetX + LABEL_R * Math.cos(s.midAngle)}
                  y={CY + s.offsetY + LABEL_R * Math.sin(s.midAngle) + 4}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight="bold"
                  fill="white"
                  style={{ pointerEvents: 'none' }}
                >
                  {s.pct}%
                </text>
              )}
            </g>
          );
        })}
        <circle cx={CX} cy={CY} r={R * 0.42} fill="white" />
        <text x={CX} y={CY - 6} textAnchor="middle" fontSize={11} fill="#555">
          total
        </text>
        <text
          x={CX}
          y={CY + 12}
          textAnchor="middle"
          fontSize={18}
          fontWeight="bold"
          fill="#333"
        >
          {Math.round(total)}
        </text>
      </svg>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
        {slices.map((s) => (
          <Box
            key={s.status}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              cursor: 'pointer',
              opacity:
                selectedStatus !== null && selectedStatus !== s.status ? 0.5 : 1,
            }}
            onClick={() => onSelect(s.status)}
          >
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: '2px',
                bgcolor: colorForStatus(s.status),
                flexShrink: 0,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {s.status}
            </Typography>
            <Typography variant="caption" fontWeight={600} sx={{ ml: 'auto' }}>
              {Math.round(s.points)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default StatusPie;
