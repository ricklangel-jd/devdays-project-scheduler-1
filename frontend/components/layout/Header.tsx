'use client';

import { useMemo, useCallback, useRef, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
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
];

// Params to clear when the board changes (downstream selections across all pages)
const PARAMS_TO_CLEAR_ON_BOARD_CHANGE: string[] = [
  QUERY_PARAM_KEYS.SPRINTS,
  QUERY_PARAM_KEYS.DAILY_CAPS,
  QUERY_PARAM_KEYS.SPRINT_DATES,
  QUERY_PARAM_KEYS.PI_SPRINTS,
  QUERY_PARAM_KEYS.SC_SPRINTS,
];

interface HeaderProps {
  connectionStatus?: {
    connected: boolean;
    email?: string;
  };
}

const Header = ({ connectionStatus }: HeaderProps) => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  });

  const currentTab = pathname === '/sprint-check' ? 4 : pathname === '/all-work' ? 3 : pathname === '/capacity-v-demand' ? 2 : pathname === '/sprint-view' ? 1 : 0;
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

  // Handle project selection — set project and clear all downstream params
  const handleProjectSelect = useCallback((project: JiraProject) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    params.set(QUERY_PARAM_KEYS.PROJECT, project.key);
    for (const key of PARAMS_TO_CLEAR_ON_PROJECT_CHANGE) {
      params.delete(key);
    }
    const qs = params.toString();
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    router.push(newUrl, { scroll: false });
  }, [router, pathname]);

  // Handle board selection — set board and clear all downstream params
  const handleBoardSelect = useCallback((selectedBoardId: number) => {
    const params = new URLSearchParams(searchParamsRef.current.toString());
    params.set(QUERY_PARAM_KEYS.BOARD, selectedBoardId.toString());
    for (const key of PARAMS_TO_CLEAR_ON_BOARD_CHANGE) {
      params.delete(key);
    }
    const qs = params.toString();
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    router.push(newUrl, { scroll: false });
  }, [router, pathname]);

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar>
        <Typography variant="h6" component="h1" sx={{ mr: 2 }}>
          DevDays
        </Typography>
        <Tabs
          value={currentTab}
          sx={{
            flexGrow: 1,
            minHeight: 48,
            '& .MuiTab-root': { minHeight: 48 },
          }}
        >
          <Tab
            label="Schedule View"
            component={NextLink}
            href={`/${preservedQueryString}`}
          />
          <Tab
            label="Sprint View"
            component={NextLink}
            href={`/sprint-view${preservedQueryString}`}
          />
          <Tab
            label="Capacity v Demand"
            component={NextLink}
            href={`/capacity-v-demand${preservedQueryString}`}
          />
          <Tab
            label="All Work"
            component={NextLink}
            href={`/all-work${preservedQueryString}`}
          />
          <Tab
            label="Sprint Check"
            component={NextLink}
            href={`/sprint-check${preservedQueryString}`}
          />
        </Tabs>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 2 }}>
          <Box sx={{ width: 250 }}>
            <ProjectSearch
              onProjectSelect={handleProjectSelect}
              selectedProjectKey={projectKey}
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
              disabled={!projectKey}
            />
          </Box>
          {connectionStatus?.connected ? (
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
