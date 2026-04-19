'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Chip from '@mui/material/Chip';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';
import Link from '@mui/material/Link';
import Fab from '@mui/material/Fab';
import Tooltip from '@mui/material/Tooltip';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import { Header } from '@/frontend/components';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { JiraProject } from '@/shared/types';
import type { OrphanedEpic, OrphanedEpicsResponse } from '@/app/api/epics/orphaned/route';

const JIRA_BASE_URL = process.env.NEXT_PUBLIC_JIRA_BASE_URL || '';

const checkboxIcon = <CheckBoxOutlineBlankIcon fontSize="small" />;
const checkboxCheckedIcon = <CheckBoxIcon fontSize="small" />;

const jiraLink = (key: string) =>
  JIRA_BASE_URL ? (
    <Link
      href={`${JIRA_BASE_URL}/browse/${key}`}
      target="_blank"
      rel="noopener noreferrer"
      underline="hover"
      sx={{ fontWeight: 500, fontSize: 'inherit' }}
    >
      {key}
    </Link>
  ) : (
    <>{key}</>
  );

const STATUS_COLORS: Record<string, 'default' | 'warning' | 'error' | 'success' | 'info'> = {
  'in progress': 'info',
  'resolved': 'success',
  'done': 'success',
  'closed': 'success',
  'canceled': 'default',
  'cancelled': 'default',
  'backlog': 'default',
};

const statusChip = (status: string) => (
  <Chip
    label={status}
    size="small"
    color={STATUS_COLORS[status.toLowerCase()] ?? 'warning'}
    variant="outlined"
    sx={{ fontSize: '0.72rem', height: 20 }}
  />
);

const readKeysFromUrl = (search: URLSearchParams): string[] => {
  const raw = search.get(QUERY_PARAM_KEYS.EWI_PROJECTS) ?? '';
  return raw.split(',').map((k) => k.trim()).filter((k) => k.length > 0);
};

// Distinguishable palette for up to many projects; repeats cyclically.
const PIE_COLORS = [
  '#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#d32f2f',
  '#0288d1', '#7b1fa2', '#388e3c', '#f57c00', '#c62828',
  '#00838f', '#5e35b1', '#558b2f', '#ef6c00', '#ad1457',
  '#00695c', '#283593', '#827717', '#bf360c', '#4e342e',
];

const colorForIndex = (index: number): string => PIE_COLORS[index % PIE_COLORS.length];

interface PieSlice {
  key: string;
  label: string;
  count: number;
  color: string;
}

const buildSlicesBy = (
  epics: OrphanedEpic[],
  keyOf: (epic: OrphanedEpic) => string,
  labelOf: (key: string) => string
): PieSlice[] => {
  const counts = new Map<string, number>();
  for (const epic of epics) {
    const k = keyOf(epic);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count], i) => ({
      key,
      label: labelOf(key),
      count,
      color: colorForIndex(i),
    }));
};

const PIE_R = 90;
const PIE_CX = 110;
const PIE_CY = 110;
const PIE_LABEL_R = 60;
const PIE_EXPLODE = 8;

interface CountPieProps {
  title: string;
  slices: PieSlice[];
  selected: string | null;
  onSelect: (key: string) => void;
}

const CountPie = ({ title, slices, selected, onSelect }: CountPieProps) => {
  const total = slices.reduce((s, v) => s + v.count, 0);

  const svgSlices = useMemo(() => {
    if (total === 0) return [];
    const out: Array<{
      key: string;
      color: string;
      pct: number;
      pathD: string;
      midAngle: number;
      offsetX: number;
      offsetY: number;
    }> = [];

    // Single-slice case (100%) — SVG arc can't render a full circle with a single path,
    // so render as a full circle centered at (cx, cy).
    if (slices.length === 1) {
      const only = slices[0];
      out.push({
        key: only.key,
        color: only.color,
        pct: 100,
        pathD: `M ${PIE_CX - PIE_R} ${PIE_CY} A ${PIE_R} ${PIE_R} 0 1 1 ${PIE_CX + PIE_R} ${PIE_CY} A ${PIE_R} ${PIE_R} 0 1 1 ${PIE_CX - PIE_R} ${PIE_CY} Z`,
        midAngle: 0,
        offsetX: 0,
        offsetY: 0,
      });
      return out;
    }

    let cursor = -Math.PI / 2;
    for (const s of slices) {
      if (s.count === 0) continue;
      const angle = (s.count / total) * 2 * Math.PI;
      const start = cursor;
      const end = cursor + angle;
      const mid = cursor + angle / 2;

      const isSelected = selected === s.key;
      const ox = isSelected ? Math.cos(mid) * PIE_EXPLODE : 0;
      const oy = isSelected ? Math.sin(mid) * PIE_EXPLODE : 0;

      const x1 = PIE_CX + ox + PIE_R * Math.cos(start);
      const y1 = PIE_CY + oy + PIE_R * Math.sin(start);
      const x2 = PIE_CX + ox + PIE_R * Math.cos(end);
      const y2 = PIE_CY + oy + PIE_R * Math.sin(end);
      const large = angle > Math.PI ? 1 : 0;

      out.push({
        key: s.key,
        color: s.color,
        pct: Math.round((s.count / total) * 100),
        pathD: `M ${PIE_CX + ox} ${PIE_CY + oy} L ${x1} ${y1} A ${PIE_R} ${PIE_R} 0 ${large} 1 ${x2} ${y2} Z`,
        midAngle: mid,
        offsetX: ox,
        offsetY: oy,
      });
      cursor = end;
    }
    return out;
  }, [slices, selected, total]);

  if (total === 0) {
    return (
      <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 4 }}>
        <Typography variant="body2">No epics to chart</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5, textAlign: 'center' }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <svg width={220} height={220} style={{ display: 'block', flexShrink: 0 }}>
          {svgSlices.map((s) => {
            const dim = selected !== null && selected !== s.key;
            return (
              <g
                key={s.key}
                onClick={() => onSelect(s.key)}
                style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }}
              >
                <path
                  d={s.pathD}
                  fill={s.color}
                  stroke="white"
                  strokeWidth={selected === s.key ? 3 : 2}
                />
                {s.pct >= 8 && (
                  <text
                    x={PIE_CX + s.offsetX + PIE_LABEL_R * Math.cos(s.midAngle)}
                    y={PIE_CY + s.offsetY + PIE_LABEL_R * Math.sin(s.midAngle) + 4}
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
          <circle cx={PIE_CX} cy={PIE_CY} r={PIE_R * 0.42} fill="white" />
          <text x={PIE_CX} y={PIE_CY - 6} textAnchor="middle" fontSize={11} fill="#555">
            total
          </text>
          <text
            x={PIE_CX}
            y={PIE_CY + 12}
            textAnchor="middle"
            fontSize={18}
            fontWeight="bold"
            fill="#333"
          >
            {total}
          </text>
        </svg>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 180, flex: 1 }}>
          {slices.map((s) => (
            <Box
              key={s.key}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                cursor: 'pointer',
                opacity: selected !== null && selected !== s.key ? 0.5 : 1,
              }}
              onClick={() => onSelect(s.key)}
            >
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
                title={s.label}
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

const EpicsWithoutInitiativeContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [allProjects, setAllProjects] = useState<JiraProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [selectedKeys, setSelectedKeys] = useState<string[]>(() =>
    readKeysFromUrl(new URLSearchParams(searchParams.toString()))
  );

  const [epics, setEpics] = useState<OrphanedEpic[] | null>(null);
  const [epicsLoading, setEpicsLoading] = useState(false);
  const [epicsError, setEpicsError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // Load all projects once
  useEffect(() => {
    let cancelled = false;
    setProjectsLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/projects');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load projects');
        if (!cancelled) setAllProjects(json.projects ?? []);
      } catch (err) {
        if (!cancelled) setProjectsError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep URL param in sync
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const current = params.get(QUERY_PARAM_KEYS.EWI_PROJECTS) ?? '';
    const next = selectedKeys.join(',');
    if (current === next) return;
    if (next.length === 0) params.delete(QUERY_PARAM_KEYS.EWI_PROJECTS);
    else params.set(QUERY_PARAM_KEYS.EWI_PROJECTS, next);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }, [selectedKeys, router]);

  const loadEpics = useCallback(async (keys: string[]) => {
    if (keys.length === 0) {
      setEpics(null);
      setEpicsError(null);
      return;
    }
    setEpicsLoading(true);
    setEpicsError(null);
    try {
      const res = await fetch(
        `/api/epics/orphaned?projectKeys=${encodeURIComponent(keys.join(','))}`
      );
      const json: OrphanedEpicsResponse | { error: string } = await res.json();
      if (!res.ok) {
        throw new Error('error' in json ? json.error : 'Failed to load epics');
      }
      setEpics('epics' in json ? json.epics : []);
      setProjectFilter(null);
      setStatusFilter(null);
    } catch (err) {
      setEpicsError(err instanceof Error ? err.message : 'Unknown error');
      setEpics(null);
    } finally {
      setEpicsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEpics(selectedKeys);
  }, [selectedKeys, loadEpics]);

  const selectedProjects = useMemo(() => {
    const byKey = new Map(allProjects.map((p) => [p.key, p]));
    return selectedKeys.map<JiraProject>(
      (key) => byKey.get(key) ?? { key, name: key }
    );
  }, [allProjects, selectedKeys]);

  const handleProjectsChange = useCallback(
    (_e: React.SyntheticEvent, value: JiraProject[]) => {
      setSelectedKeys(value.map((p) => p.key));
    },
    []
  );

  const handleRefresh = useCallback(() => {
    if (epicsLoading || selectedKeys.length === 0) return;
    loadEpics(selectedKeys);
  }, [epicsLoading, selectedKeys, loadEpics]);

  const projectNames = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const p of allProjects) map[p.key] = p.name;
    return map;
  }, [allProjects]);

  const nameFor = useCallback(
    (projectKey: string) => projectNames[projectKey] ?? projectKey,
    [projectNames]
  );

  // Project pie reflects the status filter (but not its own selection)
  const projectPieSlices = useMemo(() => {
    const source = statusFilter
      ? (epics ?? []).filter((e) => e.status === statusFilter)
      : (epics ?? []);
    return buildSlicesBy(source, (e) => e.projectKey, (k) => nameFor(k));
  }, [epics, statusFilter, nameFor]);

  // Status pie reflects the project filter (but not its own selection)
  const statusPieSlices = useMemo(() => {
    const source = projectFilter
      ? (epics ?? []).filter((e) => e.projectKey === projectFilter)
      : (epics ?? []);
    return buildSlicesBy(source, (e) => e.status, (k) => k);
  }, [epics, projectFilter]);

  const handleProjectPieSelect = useCallback((projectKey: string) => {
    setProjectFilter((prev) => (prev === projectKey ? null : projectKey));
  }, []);

  const handleStatusPieSelect = useCallback((status: string) => {
    setStatusFilter((prev) => (prev === status ? null : status));
  }, []);

  const filteredEpics = useMemo(() => {
    if (!epics) return [];
    return epics.filter((e) =>
      (!projectFilter || e.projectKey === projectFilter) &&
      (!statusFilter || e.status === statusFilter)
    );
  }, [epics, projectFilter, statusFilter]);

  const colSx = { fontSize: '0.82rem', py: 0.75, px: 1.5, verticalAlign: 'top' };
  const headerSx = { ...colSx, fontWeight: 700, bgcolor: 'grey.100', whiteSpace: 'nowrap' as const };

  const totalCount = epics?.length ?? 0;
  const rowCount = filteredEpics.length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header />
      <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2 }}>
        <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
            Epics Without Initiative
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select one or more projects to see epics that have no parent (not linked to an initiative).
          </Typography>
          <Autocomplete
            multiple
            disableCloseOnSelect
            size="small"
            options={allProjects}
            value={selectedProjects}
            loading={projectsLoading}
            getOptionLabel={(option) => `${option.key}: ${option.name}`}
            isOptionEqualToValue={(option, value) => option.key === value.key}
            onChange={handleProjectsChange}
            renderOption={(props, option, { selected }) => {
              const { key, ...rest } = props;
              return (
                <li key={key} {...rest}>
                  <Checkbox
                    icon={checkboxIcon}
                    checkedIcon={checkboxCheckedIcon}
                    sx={{ mr: 1 }}
                    checked={selected}
                  />
                  <Box>
                    <Typography variant="body2" fontWeight="medium">
                      {option.key}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {option.name}
                    </Typography>
                  </Box>
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Projects"
                placeholder={selectedKeys.length === 0 ? 'Select projects...' : ''}
                slotProps={{
                  input: {
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {projectsLoading && <CircularProgress color="inherit" size={16} />}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  },
                }}
              />
            )}
          />
          {projectsError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {projectsError}
            </Alert>
          )}
        </Paper>

        {epicsError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {epicsError}
          </Alert>
        )}

        {selectedKeys.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, color: 'text.secondary' }}>
            <Typography variant="h6" gutterBottom>
              Select a Project
            </Typography>
            <Typography variant="body2">
              Choose one or more projects to load their orphaned epics
            </Typography>
          </Box>
        ) : epicsLoading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8 }}>
            <CircularProgress sx={{ mb: 2 }} />
            <Typography variant="h6" color="text.secondary">
              Loading Epics...
            </Typography>
          </Box>
        ) : epics ? (
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <Paper elevation={1} sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ px: 2, pt: 2, pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  Epics
                </Typography>
                <Chip
                  label={projectFilter ? `${rowCount} of ${totalCount}` : rowCount}
                  size="small"
                  color={rowCount > 0 ? 'warning' : 'default'}
                />
                {projectFilter && (
                  <Chip
                    label={`Project: ${nameFor(projectFilter)}`}
                    size="small"
                    variant="outlined"
                    color="primary"
                    onDelete={() => setProjectFilter(null)}
                  />
                )}
                {statusFilter && (
                  <Chip
                    label={`Status: ${statusFilter}`}
                    size="small"
                    variant="outlined"
                    color="primary"
                    onDelete={() => setStatusFilter(null)}
                  />
                )}
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={headerSx}>Key</TableCell>
                      <TableCell sx={headerSx}>Summary</TableCell>
                      <TableCell sx={headerSx}>Status</TableCell>
                      <TableCell sx={headerSx}>Project</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rowCount === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} sx={{ textAlign: 'center', py: 3, color: 'text.secondary', fontSize: '0.85rem' }}>
                          {totalCount === 0
                            ? 'No orphaned epics found in the selected project(s).'
                            : 'No epics match the current filter.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredEpics.map((epic) => (
                        <TableRow key={epic.key} sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                          <TableCell sx={{ ...colSx, whiteSpace: 'nowrap', fontWeight: 500 }}>
                            {jiraLink(epic.key)}
                          </TableCell>
                          <TableCell sx={colSx}>
                            {epic.summary}
                          </TableCell>
                          <TableCell sx={{ ...colSx, whiteSpace: 'nowrap' }}>
                            {statusChip(epic.status)}
                          </TableCell>
                          <TableCell sx={colSx}>
                            {nameFor(epic.projectKey)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
            {totalCount > 0 && (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  flexShrink: 0,
                  position: 'sticky',
                  top: 0,
                }}
              >
                <Paper elevation={1} sx={{ p: 2 }}>
                  <CountPie
                    title="Epics by Project"
                    slices={projectPieSlices}
                    selected={projectFilter}
                    onSelect={handleProjectPieSelect}
                  />
                </Paper>
                <Paper elevation={1} sx={{ p: 2 }}>
                  <CountPie
                    title="Epics by Status"
                    slices={statusPieSlices}
                    selected={statusFilter}
                    onSelect={handleStatusPieSelect}
                  />
                </Paper>
              </Box>
            )}
          </Box>
        ) : null}
      </Box>

      <Tooltip title="Refresh data from JIRA">
        <span>
          <Fab
            color="primary"
            aria-label="refresh"
            onClick={handleRefresh}
            disabled={epicsLoading || selectedKeys.length === 0}
            sx={{ position: 'fixed', bottom: 24, right: 24 }}
          >
            {epicsLoading ? <CircularProgress size={24} color="inherit" /> : <RefreshIcon />}
          </Fab>
        </span>
      </Tooltip>
    </Box>
  );
};

const EpicsWithoutInitiative = () => (
  <Suspense
    fallback={
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    }
  >
    <EpicsWithoutInitiativeContent />
  </Suspense>
);

export default EpicsWithoutInitiative;
