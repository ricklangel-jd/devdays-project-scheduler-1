'use client';

import { Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { Header } from '@/frontend/components';
import { useAppState } from '@/frontend/hooks';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { PiStatusStory, EpicStatusData } from '@/app/api/pi-status/data/route';

// ── Constants ────────────────────────────────────────────────────────

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

// PI options: PI1_2025 through PI4_2027 (extend upper year as needed)
const PI_OPTIONS = (() => {
  const options: string[] = [];
  for (let year = 2025; year <= 2027; year++) {
    for (let q = 1; q <= 4; q++) {
      options.push(`PI${q}_${year}`);
    }
  }
  return options;
})();

// ── Types ────────────────────────────────────────────────────────────

interface PiStatusData {
  committed: EpicStatusData[];
  stretch: EpicStatusData[];
}

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

// ── Compact cell styles ──────────────────────────────────────────────

const compactCellSx = {
  fontSize: '0.75rem',
  py: 0.25,
  px: 1,
  lineHeight: 1.3,
};

const compactHeaderSx = {
  ...compactCellSx,
  fontWeight: 700,
  whiteSpace: 'nowrap' as const,
  bgcolor: 'grey.100',
};

// ── Status color helper ──────────────────────────────────────────────

const getStatusChipColor = (status: string): 'success' | 'primary' | 'default' | 'info' => {
  const lower = status.toLowerCase();
  if (lower === 'done' || lower === 'closed') return 'success';
  if (lower === 'in progress' || lower === 'in development') return 'primary';
  if (lower === 'to do' || lower === 'open' || lower === 'backlog') return 'default';
  return 'info';
};

// ── Stacked Bar Chart ────────────────────────────────────────────────

/** Ordered from bottom to top in the stacked bar */
const STATUS_ORDER: string[] = [
  'Resolved', 'Done', 'Closed',
  'Ready for Production',
  'Acceptance',
  'In Test',
  'In Review',
  'In Progress',
  'Ready',
  'Planning',
  'In Queue',
  'Customer Commented',
  'Backlog',
  'Blocked',
  'On Hold',
];

const STATUS_COLORS: Record<string, string> = {
  'Resolved': '#66bb6a',
  'Done': '#66bb6a',
  'Closed': '#66bb6a',
  'Ready for Production': '#81c784',
  'Acceptance': '#aed581',
  'In Test': '#dce775',
  'In Review': '#fff176',
  'In Progress': '#4fc3f7',
  'Ready': '#4dd0e1',
  'Planning': '#b39ddb',
  'In Queue': '#ce93d8',
  'Customer Commented': '#f48fb1',
  'Backlog': '#e0e0e0',
  'Blocked': '#ef5350',
  'On Hold': '#ff8a65',
};

const getStatusColor = (status: string): string =>
  STATUS_COLORS[status] ?? '#bdbdbd';

/** Get a canonical order index for a status (lower = closer to left in bar).
 *  Unknown statuses all map to the same tail position; add to STATUS_ORDER to fix ordering. */
const getStatusOrder = (status: string): number => {
  const idx = STATUS_ORDER.indexOf(status);
  return idx >= 0 ? idx : STATUS_ORDER.length;
};

const BAR_HEIGHT = 22;
const LABEL_WIDTH = 180;
const BAR_GAP = 6;
const CHART_RIGHT_PAD = 50;

const StackedBarChart = ({ epics, title }: { epics: EpicStatusData[]; title: string }) => {
  if (epics.length === 0) return null;

  // Collect all statuses across all epics
  const allStatuses = new Set<string>();
  for (const epic of epics) {
    for (const status of Object.keys(epic.statusBreakdown)) {
      allStatuses.add(status);
    }
  }

  // Sort statuses by the defined order
  const sortedStatuses = [...allStatuses].sort((a, b) => getStatusOrder(a) - getStatusOrder(b));

  // Find the max total points across epics to scale bars
  const maxPoints = Math.max(epics.reduce((m, e) => Math.max(m, e.totalPoints), 0), 1);

  // Totals across all epics
  const grandTotalPoints = epics.reduce((sum, e) => sum + e.totalPoints, 0);
  const grandResolvedPoints = epics.reduce((sum, e) => sum + e.resolvedPoints, 0);
  const grandRemainingPoints = grandTotalPoints - grandResolvedPoints;

  const chartWidth = 500;
  const svgWidth = LABEL_WIDTH + chartWidth + CHART_RIGHT_PAD;
  const svgHeight = epics.length * (BAR_HEIGHT + BAR_GAP) + 30; // 30 for bottom legend space

  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 1, px: 0.5 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {grandTotalPoints} pts total · {grandRemainingPoints} pts remaining
        </Typography>
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <svg width={svgWidth} height={svgHeight} style={{ display: 'block' }}>
          {epics.map((epic, rowIdx) => {
            const y = rowIdx * (BAR_HEIGHT + BAR_GAP);

            // Truncate label
            const label = epic.summary.length > 28 ? epic.summary.slice(0, 26) + '…' : epic.summary;

            // Pre-compute segment positions
            const segments: { status: string; x: number; width: number; pts: number }[] = [];
            let xCursor = LABEL_WIDTH;
            for (const status of sortedStatuses) {
              const pts = epic.statusBreakdown[status] ?? 0;
              if (pts === 0) continue;
              const width = (pts / maxPoints) * chartWidth;
              segments.push({ status, x: xCursor, width, pts });
              xCursor += width;
            }

            return (
              <g key={epic.key}>
                {/* Epic label */}
                <text
                  x={LABEL_WIDTH - 6}
                  y={y + BAR_HEIGHT / 2 + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="#333"
                  fontWeight={500}
                >
                  {label}
                </text>

                {/* Stacked segments */}
                {segments.map(({ status, x, width, pts }) => (
                  <g key={status}>
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={BAR_HEIGHT}
                      fill={getStatusColor(status)}
                      stroke="white"
                      strokeWidth={0.5}
                    />
                    {width > 20 && (
                      <text
                        x={x + width / 2}
                        y={y + BAR_HEIGHT / 2 + 4}
                        textAnchor="middle"
                        fontSize={9}
                        fill="#333"
                        fontWeight={500}
                      >
                        {pts}
                      </text>
                    )}
                  </g>
                ))}

                {/* Total label at end */}
                <text
                  x={xCursor + 4}
                  y={y + BAR_HEIGHT / 2 + 4}
                  fontSize={10}
                  fill="#666"
                  fontWeight={600}
                >
                  {epic.totalPoints}
                </text>
              </g>
            );
          })}
        </svg>
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1, px: 0.5 }}>
        {sortedStatuses.map((status) => (
          <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, bgcolor: getStatusColor(status), borderRadius: '2px', border: '1px solid #ccc' }} />
            <Typography variant="caption" sx={{ fontSize: '0.65rem', lineHeight: 1 }}>{status}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

// ── SVG Pie Chart ────────────────────────────────────────────────────

const PIE_SIZE = 80;
const PIE_RADIUS = 34;
const PIE_CENTER = PIE_SIZE / 2;

const ResolvePie = ({ percent }: { percent: number }) => {
  const clampedPct = Math.max(0, Math.min(100, percent));
  const resolvedAngle = (clampedPct / 100) * 2 * Math.PI;

  if (clampedPct === 0) {
    return (
      <svg width={PIE_SIZE} height={PIE_SIZE}>
        <circle cx={PIE_CENTER} cy={PIE_CENTER} r={PIE_RADIUS} fill="#e0e0e0" />
        <text x={PIE_CENTER} y={PIE_CENTER + 4} textAnchor="middle" fontSize={13} fontWeight="bold" fill="#666">
          0%
        </text>
      </svg>
    );
  }

  if (clampedPct >= 100) {
    return (
      <svg width={PIE_SIZE} height={PIE_SIZE}>
        <circle cx={PIE_CENTER} cy={PIE_CENTER} r={PIE_RADIUS} fill="#66bb6a" />
        <text x={PIE_CENTER} y={PIE_CENTER + 4} textAnchor="middle" fontSize={13} fontWeight="bold" fill="white">
          100%
        </text>
      </svg>
    );
  }

  // Two slices: resolved (green) and remaining (gray)
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + resolvedAngle;

  const x1 = PIE_CENTER + PIE_RADIUS * Math.cos(startAngle);
  const y1 = PIE_CENTER + PIE_RADIUS * Math.sin(startAngle);
  const x2 = PIE_CENTER + PIE_RADIUS * Math.cos(endAngle);
  const y2 = PIE_CENTER + PIE_RADIUS * Math.sin(endAngle);
  const largeArc = resolvedAngle > Math.PI ? 1 : 0;

  return (
    <svg width={PIE_SIZE} height={PIE_SIZE}>
      {/* Gray background (remaining) */}
      <circle cx={PIE_CENTER} cy={PIE_CENTER} r={PIE_RADIUS} fill="#e0e0e0" />
      {/* Green slice (resolved) */}
      <path
        d={`M ${PIE_CENTER} ${PIE_CENTER} L ${x1} ${y1} A ${PIE_RADIUS} ${PIE_RADIUS} 0 ${largeArc} 1 ${x2} ${y2} Z`}
        fill="#66bb6a"
        stroke="white"
        strokeWidth={1}
      />
      {/* Center label */}
      <text x={PIE_CENTER} y={PIE_CENTER + 4} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#333">
        {clampedPct}%
      </text>
    </svg>
  );
};

// ── Epic Card ────────────────────────────────────────────────────────

const EpicCard = ({ epic }: { epic: EpicStatusData }) => {
  return (
    <Paper elevation={1} sx={{ mb: 2, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, pt: 1.5, pb: 1, display: 'flex', alignItems: 'center', gap: 2, borderLeft: 3, borderColor: 'primary.main' }}>
        <ResolvePie percent={epic.resolvedPercent} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700} noWrap title={epic.summary}>
            {epic.summary}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Chip label={epic.status} size="small" color={getStatusChipColor(epic.status)} variant="outlined" />
            <Typography variant="caption" color="text.secondary">
              {epic.resolvedPoints}/{epic.totalPoints} pts resolved · {epic.resolvedStories}/{epic.totalStories} stories resolved
            </Typography>
            {JIRA_BASE_URL && (
              <Link
                href={`${JIRA_BASE_URL}/browse/${epic.key}`}
                target="_blank"
                rel="noopener"
                underline="hover"
                sx={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 0.25 }}
              >
                {epic.key}
                <OpenInNewIcon sx={{ fontSize: 12 }} />
              </Link>
            )}
          </Box>
        </Box>
      </Box>

      {/* Story grid — non-canceled, non-resolved */}
      {epic.stories.length > 0 && (
        <TableContainer sx={{ maxHeight: 240 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...compactHeaderSx, width: 100 }}>Key</TableCell>
                <TableCell sx={compactHeaderSx}>Summary</TableCell>
                <TableCell sx={{ ...compactHeaderSx, textAlign: 'right', width: 90 }}>Story Points</TableCell>
                <TableCell sx={{ ...compactHeaderSx, width: 110 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {epic.stories.map((story) => (
                <TableRow key={story.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                  <TableCell sx={compactCellSx}>
                    {JIRA_BASE_URL ? (
                      <Link
                        href={`${JIRA_BASE_URL}/browse/${story.key}`}
                        target="_blank"
                        rel="noopener"
                        underline="hover"
                        sx={{ fontSize: 'inherit' }}
                      >
                        {story.key}
                      </Link>
                    ) : (
                      story.key
                    )}
                  </TableCell>
                  <TableCell sx={{ ...compactCellSx, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {story.summary}
                  </TableCell>
                  <TableCell sx={{ ...compactCellSx, textAlign: 'right' }}>
                    {story.points ?? '—'}
                  </TableCell>
                  <TableCell sx={compactCellSx}>
                    <Chip label={story.status} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 20 }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {epic.stories.length === 0 && epic.resolvedPercent < 100 && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1, display: 'block' }}>
          No remaining stories
        </Typography>
      )}
    </Paper>
  );
};

// ── Column of epic cards ─────────────────────────────────────────────

const EpicColumn = ({ title, epics }: { title: string; epics: EpicStatusData[] }) => (
  <Box sx={{ flex: 1, minWidth: 0 }}>
    <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, px: 0.5 }}>
      {title} ({epics.length})
    </Typography>
    {epics.length === 0 ? (
      <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
        No epics
      </Typography>
    ) : (
      epics.map((epic) => <EpicCard key={epic.key} epic={epic} />)
    )}
  </Box>
);

// ── Main content ─────────────────────────────────────────────────────

const PiStatusContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  useEffect(() => {
    document.title = 'PI Status';
  }, []);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
  });

  const { projectKey } = useAppState();

  // Check JIRA connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch('/api/auth/validate');
        const authData = await response.json();
        setConnectionStatus({ connected: authData.valid, email: authData.email });
      } catch {
        setConnectionStatus({ connected: false });
      }
    };
    checkConnection();
  }, []);

  // ── State from URL ────────────────────────────────────────────────

  const [selectedPi, setSelectedPi] = useState<string | null>(
    () => searchParams.get(QUERY_PARAM_KEYS.PS_PI) ?? null
  );

  const [controlsOpen, setControlsOpen] = useState(true);
  const [chartsOpen, setChartsOpen] = useState(true);

  const [data, setData] = useState<PiStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── URL sync ──────────────────────────────────────────────────────

  const syncUrl = useCallback(
    (newPi?: string | null) => {
      const params = new URLSearchParams(searchParamsRef.current.toString());

      const pi = newPi !== undefined ? newPi : selectedPi;

      if (pi) {
        params.set(QUERY_PARAM_KEYS.PS_PI, pi);
      } else {
        params.delete(QUERY_PARAM_KEYS.PS_PI);
      }

      const qs = params.toString();
      router.replace(qs ? `/pi-status?${qs}` : '/pi-status', { scroll: false });
    },
    [router, selectedPi]
  );

  // ── Handlers ──────────────────────────────────────────────────────

  const handlePiChange = useCallback(
    (_event: unknown, value: string | null) => {
      setSelectedPi(value);
      syncUrl(value);
    },
    [syncUrl]
  );

  const handleLoad = useCallback(async () => {
    if (!projectKey || !selectedPi) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/pi-status/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey,
          piLabel: selectedPi,
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.message || responseData.error || 'Failed to fetch data');
      }

      setData(responseData as PiStatusData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [projectKey, selectedPi]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header connectionStatus={connectionStatus} />
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflow: 'hidden' }}>
        {/* ── Controls Bar ──────────────────────────────────────────── */}
        <Paper elevation={1}>
          <Box
            sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
            onClick={() => setControlsOpen((prev) => !prev)}
          >
            <Typography variant="subtitle2" fontWeight={700}>
              Controls
              {selectedPi && !controlsOpen && (
                <Chip label={selectedPi} size="small" color="primary" variant="outlined" sx={{ ml: 1 }} />
              )}
            </Typography>
            <IconButton size="small">
              {controlsOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
          <Collapse in={controlsOpen}>
            <Box sx={{ px: 2, pb: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              {/* PI selector */}
              <Autocomplete
                options={PI_OPTIONS}
                value={selectedPi}
                onChange={handlePiChange}
                renderInput={(params) => (
                  <TextField {...params} size="small" placeholder="Select PI..." label="PI" />
                )}
                sx={{ width: 180 }}
                size="small"
                disabled={!projectKey}
              />

              <Divider orientation="vertical" flexItem />

              {/* Load button */}
              <Button
                variant="contained"
                size="small"
                startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                onClick={handleLoad}
                disabled={!projectKey || !selectedPi || isLoading}
              >
                {isLoading ? 'Loading...' : 'Load PI Status'}
              </Button>
            </Box>
          </Collapse>
        </Paper>

        {/* ── Error ─────────────────────────────────────────────────── */}
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* ── Stacked Bar Charts ──────────────────────────────────── */}
        {data && (data.committed.length > 0 || data.stretch.length > 0) && (
          <Paper elevation={1} sx={{ flexShrink: 0 }}>
            <Box
              sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => setChartsOpen((prev) => !prev)}
            >
              <Typography variant="subtitle2" fontWeight={700}>
                Status Breakdown
              </Typography>
              <IconButton size="small">
                {chartsOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Box>
            <Collapse in={chartsOpen}>
              <Box sx={{ px: 2, pb: 1.5, display: 'flex', gap: 3 }}>
                <StackedBarChart title="Committed Epics" epics={data.committed} />
                <Divider orientation="vertical" flexItem />
                <StackedBarChart title="Stretch Epics" epics={data.stretch} />
              </Box>
            </Collapse>
          </Paper>
        )}

        {/* ── Two-column layout ─────────────────────────────────────── */}
        {data && (
          <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', gap: 3, px: 0.5 }}>
            <EpicColumn title="Committed" epics={data.committed} />
            <Divider orientation="vertical" flexItem />
            <EpicColumn title="Stretch" epics={data.stretch} />
          </Box>
        )}

        {!data && !isLoading && !error && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Select a PI and click Load to view epic status.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ── Page wrapper with Suspense ───────────────────────────────────────

const PiStatusPage = () => (
  <Suspense fallback={<Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>}>
    <PiStatusContent />
  </Suspense>
);

export default PiStatusPage;
