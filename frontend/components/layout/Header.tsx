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

// Carry ALL query params when navigating between pages so no page loses its selections
const ALL_PARAMS = Object.values(QUERY_PARAM_KEYS) as string[];

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
