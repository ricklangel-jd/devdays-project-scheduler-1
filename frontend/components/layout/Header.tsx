'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { QUERY_PARAM_KEYS } from '@/shared/types';
import type { JiraProject } from '@/shared/types';
import ProjectSearch from '@/frontend/components/sidebar/ProjectSearch';
import BoardSelector from '@/frontend/components/sidebar/BoardSelector';

// Carry ALL query params when navigating between pages so no page loses its selections
const ALL_PARAMS = Object.values(QUERY_PARAM_KEYS) as string[];

// Params to clear when the project changes (downstream selections across all pages)
const PARAMS_TO_CLEAR_ON_PROJECT_CHANGE: string[] = [
  QUERY_PARAM_KEYS.BOARD,
  QUERY_PARAM_KEYS.SPRINTS,
  QUERY_PARAM_KEYS.DAILY_CAPS,
  QUERY_PARAM_KEYS.SPRINT_DATES,
  QUERY_PARAM_KEYS.PI_LABELS,
  QUERY_PARAM_KEYS.PI_SPRINTS,
  QUERY_PARAM_KEYS.PI_DAYS_OFF,
  QUERY_PARAM_KEYS.SC_SPRINTS,
  QUERY_PARAM_KEYS.TS_PI_LABELS,
  QUERY_PARAM_KEYS.TS_PI_SPRINTS,
  QUERY_PARAM_KEYS.PP_PI,
  QUERY_PARAM_KEYS.PP_SUPPORT_PCT,
  QUERY_PARAM_KEYS.PP_EXCLUDE_S7,
  QUERY_PARAM_KEYS.PP_DAYS_OFF,
];

// Params to clear when the board changes (downstream selections across all pages)
const PARAMS_TO_CLEAR_ON_BOARD_CHANGE: string[] = [
  QUERY_PARAM_KEYS.SPRINTS,
  QUERY_PARAM_KEYS.DAILY_CAPS,
  QUERY_PARAM_KEYS.SPRINT_DATES,
  QUERY_PARAM_KEYS.PI_SPRINTS,
  QUERY_PARAM_KEYS.SC_SPRINTS,
  QUERY_PARAM_KEYS.SV_FUTURE_SPRINTS,
  QUERY_PARAM_KEYS.TS_PI_SPRINTS,
  QUERY_PARAM_KEYS.SP_SPRINT,
  QUERY_PARAM_KEYS.CAP_SPRINT,
  QUERY_PARAM_KEYS.PA_SPRINT,
];

// Navigation menu structure
const NAV_MENUS = [
  {
    label: 'Planning',
    items: [
      { label: 'Schedule View', path: '/' },
      { label: 'Sprint View', path: '/sprint-view' },
      { label: 'Capacity v Demand', path: '/capacity-v-demand' },
      { label: 'PI Planning', path: '/pi-planning' },
      { label: 'Sprint Planning', path: '/sprint-planning' },
      { label: 'Capacity', path: '/capacity' },
    ],
  },
  {
    label: 'Status',
    items: [
      { label: 'Sprint Check', path: '/sprint-check' },
      { label: 'Time Spent', path: '/time-spent' },
      { label: 'Sprint Metrics', path: '/sprint-metrics' },
      { label: 'PI Status', path: '/pi-status' },
      { label: 'Pointing Accuracy', path: '/pointing-accuracy' },
    ],
  },
  {
    label: 'Project Status',
    items: [
      { label: 'Initiative Status', path: '/initiative-status' },
    ],
  },
] as const;

interface HeaderProps {
  connectionStatus?: {
    connected: boolean;
    email?: string;
  };
}

const Header = ({ connectionStatus: connectionStatusProp }: HeaderProps) => {
  const pathname = usePathname();
  const [internalConnectionStatus, setInternalConnectionStatus] = useState<{ connected: boolean; email?: string } | null>(null);

  useEffect(() => {
    if (connectionStatusProp !== undefined) return; // prop takes precedence — no need to fetch
    let cancelled = false;
    fetch('/api/auth/validate')
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setInternalConnectionStatus({ connected: d.valid, email: d.email }); })
      .catch(() => { if (!cancelled) setInternalConnectionStatus({ connected: false }); });
    return () => { cancelled = true; };
  }, [connectionStatusProp]);

  const connectionStatus = connectionStatusProp ?? internalConnectionStatus;
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  // Menu anchor state — tracks which menu is open
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const handleMenuOpen = useCallback((event: React.MouseEvent<HTMLElement>, menuLabel: string) => {
    setAnchorEl(event.currentTarget);
    setOpenMenu(menuLabel);
  }, []);

  const handleMenuClose = useCallback(() => {
    setAnchorEl(null);
    setOpenMenu(null);
  }, []);

  // Determine which menu group the current page belongs to
  const activeMenuLabel = useMemo(() => {
    for (const menu of NAV_MENUS) {
      const match = menu.items.some((item) =>
        item.path === '/' ? pathname === '/' : pathname === item.path
      );
      if (match) return menu.label;
    }
    return null;
  }, [pathname]);

  // Find the active page label for display in the button
  const activePageLabel = useMemo(() => {
    for (const menu of NAV_MENUS) {
      for (const item of menu.items) {
        const isActive = item.path === '/' ? pathname === '/' : pathname === item.path;
        if (isActive) return item.label;
      }
    }
    return null;
  }, [pathname]);

  const projectKey = searchParams.get(QUERY_PARAM_KEYS.PROJECT) ?? undefined;
  const boardIdParam = searchParams.get(QUERY_PARAM_KEYS.BOARD);
  const boardId = boardIdParam ? parseInt(boardIdParam, 10) || undefined : undefined;

  // Build URLs that preserve all query params across page navigation
  const preservedQueryString = useMemo(() => {
    const params = new URLSearchParams();
    for (const key of ALL_PARAMS) {
      const value = searchParams.get(key);
      if (value) {
        params.set(key, value);
      }
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [searchParams]);

  // Params that Time Spent preserves across project/board changes
  const TIME_SPENT_PRESERVED: string[] = [
    QUERY_PARAM_KEYS.TS_PI_LABELS,
    QUERY_PARAM_KEYS.TS_PI_SPRINTS,
  ];

  const isTimeSpent = pathname === '/time-spent';

  // Sprint Metrics manages its own project/board selections
  const isSprintMetrics = pathname === '/sprint-metrics';

  // Handle project selection — set project and clear downstream params
  const handleProjectSelect = useCallback((project: JiraProject) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    params.set(QUERY_PARAM_KEYS.PROJECT, project.key);
    for (const key of PARAMS_TO_CLEAR_ON_PROJECT_CHANGE) {
      if (isTimeSpent && TIME_SPENT_PRESERVED.includes(key)) continue;
      params.delete(key);
    }
    const qs = params.toString();
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    router.push(newUrl, { scroll: false });
  }, [router, pathname, isTimeSpent]);

  // Handle board selection — set board and clear downstream params
  const handleBoardSelect = useCallback((selectedBoardId: number) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    params.set(QUERY_PARAM_KEYS.BOARD, selectedBoardId.toString());
    for (const key of PARAMS_TO_CLEAR_ON_BOARD_CHANGE) {
      if (isTimeSpent && TIME_SPENT_PRESERVED.includes(key)) continue;
      params.delete(key);
    }
    const qs = params.toString();
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    router.push(newUrl, { scroll: false });
  }, [router, pathname, isTimeSpent]);

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar>
        <Typography variant="h6" component="h1" sx={{ mr: 2 }}>
          {activePageLabel ?? 'DevDays'}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexGrow: 1 }}>
          {NAV_MENUS.map((menu) => {
            const isActiveGroup = activeMenuLabel === menu.label;
            const menuId = `nav-menu-${menu.label.toLowerCase()}`;

            return (
              <Box key={menu.label}>
                <Button
                  id={`${menuId}-button`}
                  aria-controls={openMenu === menu.label ? menuId : undefined}
                  aria-haspopup="true"
                  aria-expanded={openMenu === menu.label ? 'true' : undefined}
                  onClick={(e) => handleMenuOpen(e, menu.label)}
                  endIcon={<KeyboardArrowDownIcon />}
                  sx={{
                    textTransform: 'none',
                    fontWeight: isActiveGroup ? 700 : 400,
                    color: isActiveGroup ? 'primary.main' : 'text.primary',
                    borderBottom: isActiveGroup ? 2 : 0,
                    borderColor: 'primary.main',
                    borderRadius: 0,
                    px: 2,
                    minHeight: 48,
                  }}
                >
                  {menu.label}
                </Button>
                <Menu
                  id={menuId}
                  anchorEl={anchorEl}
                  open={openMenu === menu.label}
                  onClose={handleMenuClose}
                  MenuListProps={{ 'aria-labelledby': `${menuId}-button` }}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                >
                  {menu.items.map((item) => {
                    const href = item.path === '/'
                      ? `/${preservedQueryString}`
                      : `${item.path}${preservedQueryString}`;
                    const isActive = item.path === '/'
                      ? pathname === '/'
                      : pathname === item.path;

                    return (
                      <MenuItem
                        key={item.path}
                        component={NextLink}
                        href={href}
                        selected={isActive}
                        onClick={handleMenuClose}
                      >
                        <ListItemText>{item.label}</ListItemText>
                      </MenuItem>
                    );
                  })}
                </Menu>
              </Box>
            );
          })}

        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 2 }}>
          <Box sx={{ width: 250 }}>
            <ProjectSearch
              onProjectSelect={handleProjectSelect}
              selectedProjectKey={projectKey}
              disabled={isSprintMetrics}
            />
          </Box>
          {projectKey && (
            <Chip
              label={projectKey}
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
          <Box sx={{ width: 200 }}>
            <BoardSelector
              projectKey={projectKey}
              selectedBoardId={boardId}
              onBoardSelect={handleBoardSelect}
              disabled={isSprintMetrics || !projectKey}
            />
          </Box>
          {connectionStatus === null ? null : connectionStatus.connected ? (
            <Chip
              icon={<CheckCircleIcon />}
              label={`Connected: ${connectionStatus.email}`}
              color="success"
              variant="outlined"
              size="small"
            />
          ) : (
            <Chip
              icon={<ErrorIcon />}
              label="Not Connected"
              color="error"
              variant="outlined"
              size="small"
            />
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
