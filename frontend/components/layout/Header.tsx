'use client';

import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface HeaderProps {
  connectionStatus?: {
    connected: boolean;
    email?: string;
  };
}

const NAV_LINKS = [
  { href: '/', label: 'Gantt' },
  { href: '/fusion-status', label: 'Fusion Status' },
] as const;

const Header = ({ connectionStatus }: HeaderProps) => {
  const pathname = usePathname();

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar sx={{ gap: 2 }}>
        <Typography variant="h6" component="h1" sx={{ mr: 2 }}>
          DevDays
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexGrow: 1 }}>
          {NAV_LINKS.map(link => {
            const active = pathname === link.href;
            return (
              <Button
                key={link.href}
                component={Link}
                href={link.href}
                size="small"
                variant={active ? 'contained' : 'text'}
                color={active ? 'primary' : 'inherit'}
              >
                {link.label}
              </Button>
            );
          })}
        </Box>
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
