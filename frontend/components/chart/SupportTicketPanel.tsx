'use client';

import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Link from '@mui/material/Link';
import Chip from '@mui/material/Chip';
import type { SupportTicket } from '@/frontend/hooks/useSprintCheckData';

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

// ── Status colors ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  'in progress': '#42a5f5',
  'in development': '#42a5f5',
  'in review': '#7e57c2',
  'in test': '#ffa726',
  'acceptance': '#ab47bc',
  'ready for production': '#66bb6a',
  'blocked': '#ef5350',
  'on hold': '#ff8a65',
  'backlog': '#b0bec5',
  'open': '#90a4ae',
  'to do': '#90a4ae',
  'ready': '#2196f3',
  'planning': '#90a4ae',
  'in queue': '#ce93d8',
  'customer commented': '#f48fb1',
};

const FALLBACK_COLORS = ['#78909c', '#8d6e63', '#ff7043', '#26a69a', '#5c6bc0'];

const getStatusBgColor = (status: string, idx: number): string =>
  STATUS_COLORS[status.toLowerCase()] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];

// ── Pie chart ────────────────────────────────────────────────────────

const PIE_SIZE = 240;
const PIE_RADIUS = 96;
const PIE_CENTER = PIE_SIZE / 2;

interface PieSlice {
  status: string;
  count: number;
  color: string;
  pct: number;
}

const StatusPieChart = ({ tickets }: { tickets: SupportTicket[] }) => {
  if (tickets.length === 0) return null;

  // Count by status
  const countMap = new Map<string, number>();
  for (const t of tickets) {
    countMap.set(t.status, (countMap.get(t.status) ?? 0) + 1);
  }

  const total = tickets.length;
  const slices: PieSlice[] = Array.from(countMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([status, count], idx) => ({
      status,
      count,
      color: getStatusBgColor(status, idx),
      pct: Math.round((count / total) * 100),
    }));

  // Build arcs
  let currentAngle = -Math.PI / 2;
  const arcs = slices.map((slice) => {
    const angle = (slice.count / total) * 2 * Math.PI;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    if (angle >= 2 * Math.PI - 0.001) {
      return {
        ...slice,
        path: `M ${PIE_CENTER} ${PIE_CENTER - PIE_RADIUS} A ${PIE_RADIUS} ${PIE_RADIUS} 0 1 1 ${PIE_CENTER} ${PIE_CENTER + PIE_RADIUS} A ${PIE_RADIUS} ${PIE_RADIUS} 0 1 1 ${PIE_CENTER} ${PIE_CENTER - PIE_RADIUS} Z`,
      };
    }

    const x1 = PIE_CENTER + PIE_RADIUS * Math.cos(startAngle);
    const y1 = PIE_CENTER + PIE_RADIUS * Math.sin(startAngle);
    const x2 = PIE_CENTER + PIE_RADIUS * Math.cos(endAngle);
    const y2 = PIE_CENTER + PIE_RADIUS * Math.sin(endAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    return {
      ...slice,
      path: `M ${PIE_CENTER} ${PIE_CENTER} L ${x1} ${y1} A ${PIE_RADIUS} ${PIE_RADIUS} 0 ${largeArc} 1 ${x2} ${y2} Z`,
    };
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: PIE_SIZE + 20 }}>
      <svg width={PIE_SIZE} height={PIE_SIZE}>
        {arcs.map((arc) => (
          <path key={arc.status} d={arc.path} fill={arc.color} stroke="white" strokeWidth={1.5}>
            <title>{`${arc.status}: ${arc.count} (${arc.pct}%)`}</title>
          </path>
        ))}
        {/* Center label */}
        <text x={PIE_CENTER} y={PIE_CENTER - 6} textAnchor="middle" fontSize={18} fontWeight="bold" fill="#333">
          {total}
        </text>
        <text x={PIE_CENTER} y={PIE_CENTER + 14} textAnchor="middle" fontSize={11} fill="#666">
          open tickets
        </text>
      </svg>

      {/* Legend */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, justifyContent: 'center', maxWidth: PIE_SIZE + 40 }}>
        {slices.map((s) => (
          <Box key={s.status} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: s.color, flexShrink: 0 }} />
            <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
              {s.status} ({s.count})
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

// ── Compact table styles ─────────────────────────────────────────────

const cellSx = { fontSize: '0.75rem', py: 0.25, px: 1, lineHeight: 1.3 };
const headerSx = { ...cellSx, fontWeight: 700, whiteSpace: 'nowrap' as const, bgcolor: 'grey.100' };

// ── Panel ────────────────────────────────────────────────────────────

interface SupportTicketPanelProps {
  tickets: SupportTicket[];
}

const SupportTicketPanel = ({ tickets }: SupportTicketPanelProps) => {
  if (tickets.length === 0) {
    return (
      <Paper sx={{ px: 3, py: 2, m: 2 }} elevation={1}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Open Support Tickets
        </Typography>
        <Typography variant="body2" color="text.secondary">
          No open support tickets assigned to sprints in this PI.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ px: 3, py: 1.5, m: 2 }} elevation={1}>
      <Typography variant="h6" sx={{ mb: 0.25 }}>
        Open Support Tickets
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Service desk tickets still open and assigned to a sprint in this PI ({tickets.length} total)
      </Typography>

      <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Grid */}
        <TableContainer sx={{ flex: 1, minWidth: 400, maxHeight: 400 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...headerSx, width: 110 }}>Key</TableCell>
                <TableCell sx={headerSx}>Summary</TableCell>
                <TableCell sx={{ ...headerSx, width: 140 }}>Status</TableCell>
                <TableCell sx={{ ...headerSx, width: 180 }}>Sprint</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tickets.map((ticket, idx) => (
                <TableRow key={ticket.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                  <TableCell sx={cellSx}>
                    {JIRA_BASE_URL ? (
                      <Link
                        href={`${JIRA_BASE_URL}/browse/${ticket.key}`}
                        target="_blank"
                        rel="noopener"
                        underline="hover"
                        sx={{ fontSize: 'inherit' }}
                      >
                        {ticket.key}
                      </Link>
                    ) : (
                      ticket.key
                    )}
                  </TableCell>
                  <TableCell sx={{ ...cellSx, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ticket.summary}
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <Chip
                      label={ticket.status}
                      size="small"
                      variant="filled"
                      sx={{
                        fontSize: '0.68rem',
                        height: 20,
                        bgcolor: getStatusBgColor(ticket.status, idx),
                        color: 'white',
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ ...cellSx, color: 'text.secondary' }}>
                    {ticket.sprintName}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Pie chart */}
        <StatusPieChart tickets={tickets} />
      </Box>
    </Paper>
  );
};

export default SupportTicketPanel;
