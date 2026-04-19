'use client';

import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { EffortEpic } from '@/shared/types';

interface NoStoriesPieProps {
  epics: EffortEpic[];
  teamNames: Record<string, string>;
}

// Distinguishable palette; repeats cyclically when projects exceed the list.
const PALETTE = [
  '#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#d32f2f',
  '#0288d1', '#7b1fa2', '#388e3c', '#f57c00', '#c62828',
  '#00838f', '#5e35b1', '#558b2f', '#ef6c00', '#ad1457',
  '#00695c', '#283593', '#827717', '#bf360c', '#4e342e',
];

interface Slice {
  projectKey: string;
  label: string;
  count: number;
  color: string;
}

const R = 100;
const CX = 130;
const CY = 130;
const LABEL_R = 70;

interface SvgSlice {
  projectKey: string;
  color: string;
  pct: number;
  pathD: string;
  midAngle: number;
}

const buildSvgSlices = (slices: Slice[]): { svgSlices: SvgSlice[]; total: number } => {
  const total = slices.reduce((s, v) => s + v.count, 0);
  if (total === 0) return { svgSlices: [], total: 0 };

  if (slices.length === 1) {
    const only = slices[0];
    return {
      svgSlices: [
        {
          projectKey: only.projectKey,
          color: only.color,
          pct: 100,
          pathD: `M ${CX - R} ${CY} A ${R} ${R} 0 1 1 ${CX + R} ${CY} A ${R} ${R} 0 1 1 ${CX - R} ${CY} Z`,
          midAngle: 0,
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

    const x1 = CX + R * Math.cos(start);
    const y1 = CY + R * Math.sin(start);
    const x2 = CX + R * Math.cos(end);
    const y2 = CY + R * Math.sin(end);
    const large = angle > Math.PI ? 1 : 0;

    out.push({
      projectKey: slice.projectKey,
      color: slice.color,
      pct: Math.round((slice.count / total) * 100),
      pathD: `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`,
      midAngle: mid,
    });
    cursor = end;
  }
  return { svgSlices: out, total };
};

const NoStoriesPie = ({ epics, teamNames }: NoStoriesPieProps) => {
  const slices = useMemo<Slice[]>(() => {
    const counts = new Map<string, number>();
    for (const epic of epics) {
      if (epic.stories.length > 0) continue;
      counts.set(epic.team, (counts.get(epic.team) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([projectKey, count], i) => ({
        projectKey,
        label: teamNames[projectKey] ?? projectKey,
        count,
        color: PALETTE[i % PALETTE.length],
      }));
  }, [epics, teamNames]);

  const { svgSlices, total } = useMemo(() => buildSvgSlices(slices), [slices]);

  if (total === 0) {
    return (
      <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 8 }}>
        <Typography variant="h6" gutterBottom>
          No empty epics
        </Typography>
        <Typography variant="body2">
          Every loaded epic has at least one non-canceled story.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5, textAlign: 'center' }}>
        Epics Without Stories, by Project
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <svg width={260} height={260} style={{ display: 'block', flexShrink: 0 }}>
          {svgSlices.map((s) => (
            <g key={s.projectKey}>
              <path d={s.pathD} fill={s.color} stroke="white" strokeWidth={2}>
                <title>{`${teamNames[s.projectKey] ?? s.projectKey}: ${slices.find((x) => x.projectKey === s.projectKey)?.count ?? 0}`}</title>
              </path>
              {s.pct >= 8 && (
                <text
                  x={CX + LABEL_R * Math.cos(s.midAngle)}
                  y={CY + LABEL_R * Math.sin(s.midAngle) + 4}
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
          ))}
          <circle cx={CX} cy={CY} r={R * 0.42} fill="white" />
          <text x={CX} y={CY - 6} textAnchor="middle" fontSize={11} fill="#555">
            epics
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

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 220 }}>
          {slices.map((s) => (
            <Box key={s.projectKey} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: '2px',
                  bgcolor: s.color,
                  flexShrink: 0,
                }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                title={s.projectKey}
                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {s.label}
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

export default NoStoriesPie;
