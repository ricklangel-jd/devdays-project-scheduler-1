'use client';

import { useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
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

// Params shared between both views (exclude view-specific ones like 'epics')
const SHARED_PARAMS = [
  QUERY_PARAM_KEYS.PROJECT,
  QUERY_PARAM_KEYS.BOARD,
  QUERY_PARAM_KEYS.SPRINTS,
  QUERY_PARAM_KEYS.MAX_DEVS,
  QUERY_PARAM_KEYS.DAILY_CAPS,
  QUERY_PARAM_KEYS.SPRINT_DATES,
  QUERY_PARAM_KEYS.AUTO_ADJUST_START,
  QUERY_PARAM_KEYS.SIDEBAR_COLLAPSED,
] as string[];

interface HeaderProps {
  connectionStatus?: {
    connected: boolean;
    email?: string;
  };
}

const Header = ({ connectionStatus }: HeaderProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = pathname === '/capacity-v-demand' ? 2 : pathname === '/sprint-view' ? 1 : 0;

  // Build URLs that preserve shared query params
  const sharedQueryString = useMemo(() => {
    const params = new URLSearchParams();
    for (const key of SHARED_PARAMS) {
      const value = searchParams.get(key);
      if (value) {
        params.set(key, value);
      }
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [searchParams]);

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
            href={`/${sharedQueryString}`}
          />
          <Tab
            label="Sprint View"
            component={NextLink}
            href={`/sprint-view${sharedQueryString}`}
          />
          <Tab
            label="Capacity v Demand"
            component={NextLink}
            href={`/capacity-v-demand${sharedQueryString}`}
          />
        </Tabs>
        <Box>
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
