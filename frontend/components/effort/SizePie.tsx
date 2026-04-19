'use client';

import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colorForSize, SIZE_RANGE_LABEL } from './sizeColors';
import type { EffortPieSlice } from './rollups';
import type { TshirtSize } from '@/shared/types';

interface SizePieProps {
  slices: EffortPieSlice[];
  selectedSize: TshirtSize | null;
  onSelect: (size: TshirtSize) => void;
}

interface SvgSlice {
  size: TshirtSize;
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
  slices: EffortPieSlice[],
  selectedSize: TshirtSize | null
): { svgSlices: SvgSlice[]; total: number } => {
  const total = slices.reduce((s, v) => s + v.count, 0);
  if (total === 0) return { svgSlices: [], total: 0 };

  // Single-slice case — draw as a full circle via two 180° arcs.
  if (slices.length === 1) {
    const only = slices[0];
    return {
      svgSlices: [
        {
          size: only.size,
          color: colorForSize(only.size),
          pct: 100,
          pathD: `M ${CX - R} ${CY} A ${R} ${R} 0 1 1 ${CX + R} ${CY} A ${R} ${R} 0 1 1 ${CX - R} ${CY} Z`,
          midAngle: 0,
          offsetX: 0,
          offsetY: 0,
        },
      ],
      total,
    };
  }

  const out: SvgSlice[] = [];
  let cursor = -Math.PI / 2;
  for (const slice of slices) {
    if (slice.count === 0) continue;
    const angle = (slice.count / total) * 2 * Math.PI;
    const start = cursor;
    const end = cursor + angle;
    const mid = cursor + angle / 2;

    const selected = selectedSize === slice.size;
    const ox = selected ? Math.cos(mid) * EXPLODE : 0;
    const oy = selected ? Math.sin(mid) * EXPLODE : 0;

    const x1 = CX + ox + R * Math.cos(start);
    const y1 = CY + oy + R * Math.sin(start);
    const x2 = CX + ox + R * Math.cos(end);
    const y2 = CY + oy + R * Math.sin(end);
    const large = angle > Math.PI ? 1 : 0;

    out.push({
      size: slice.size,
      color: colorForSize(slice.size),
      pct: Math.round((slice.count / total) * 100),
      pathD: `M ${CX + ox} ${CY + oy} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`,
      midAngle: mid,
      offsetX: ox,
      offsetY: oy,
    });
    cursor = end;
  }
  return { svgSlices: out, total };
};

const SizePie = ({ slices, selectedSize, onSelect }: SizePieProps) => {
  const { svgSlices, total } = useMemo(
    () => buildSvgSlices(slices, selectedSize),
    [slices, selectedSize]
  );

  if (total === 0) {
    return (
      <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 6 }}>
        <Typography variant="body2">No stories to chart</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5, textAlign: 'center' }}>
        Stories by T-Shirt Size
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <svg width={260} height={260} style={{ display: 'block', flexShrink: 0 }}>
          {svgSlices.map((s) => {
            const dim = selectedSize !== null && selectedSize !== s.size;
            return (
              <g
                key={s.size}
                onClick={() => onSelect(s.size)}
                style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }}
              >
                <path
                  d={s.pathD}
                  fill={s.color}
                  stroke="white"
                  strokeWidth={selectedSize === s.size ? 3 : 2}
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
                    {s.size}
                  </text>
                )}
              </g>
            );
          })}
          <circle cx={CX} cy={CY} r={R * 0.42} fill="white" />
          <text x={CX} y={CY - 6} textAnchor="middle" fontSize={11} fill="#555">
            stories
          </text>
          <text
            x={CX}
            y={CY + 12}
            textAnchor="middle"
            fontSize={18}
            fontWeight="bold"
            fill="#333"
          >
            {total}
          </text>
        </svg>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 160, flex: 1 }}>
          {slices.map((s) => (
            <Box
              key={s.size}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                cursor: 'pointer',
                opacity: selectedSize !== null && selectedSize !== s.size ? 0.5 : 1,
              }}
              onClick={() => onSelect(s.size)}
            >
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: '2px',
                  bgcolor: colorForSize(s.size),
                  flexShrink: 0,
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {s.size}
                <Typography component="span" variant="caption" color="text.disabled" sx={{ ml: 0.75 }}>
                  ({SIZE_RANGE_LABEL[s.size]})
                </Typography>
              </Typography>
              <Typography variant="caption" fontWeight={600} sx={{ ml: 'auto' }}>
                {s.count}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

export default SizePie;
