'use client';

import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';

interface HeaderProps {
  connectionStatus?: {
    connected: boolean;
    email?: string;
  };
}

const Header = ({ connectionStatus }: HeaderProps) => {
  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar>
        <Typography variant="h6" component="h1" sx={{ flexGrow: 1 }}>
          DevDays GANTT Chart
        </Typography>
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
