'use client';

import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import type { FusionEpic } from '@/shared/types';

interface EpicListProps {
  epics: FusionEpic[];
  jiraBaseUrl: string | undefined;
}

const pctColor = (pct: number) => {
  if (pct >= 80) return 'success';
  if (pct >= 40) return 'primary';
  return 'warning';
};

const EpicList = ({ epics, jiraBaseUrl }: EpicListProps) => {
  if (epics.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No epics to display.
        </Typography>
      </Paper>
    );
  }

  const colSx = { fontSize: '0.8rem', py: 0.75, px: 1.5 };
  const headerSx = {
    ...colSx,
    fontWeight: 700,
    bgcolor: 'grey.100',
    whiteSpace: 'nowrap' as const,
  };

  return (
    <TableContainer component={Paper} elevation={1} sx={{ maxHeight: '100%' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={headerSx}>Epic</TableCell>
            <TableCell sx={headerSx}>Summary</TableCell>
            <TableCell sx={headerSx}>Initiative</TableCell>
            <TableCell sx={headerSx}>Team</TableCell>
            <TableCell sx={headerSx}>Status</TableCell>
            <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Total Points</TableCell>
            <TableCell sx={{ ...headerSx, minWidth: 180 }}>% Complete</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {epics.map((e) => {
            const pct = e.totalPoints === 0 ? 0 : Math.round((e.donePoints / e.totalPoints) * 100);
            const keyCell = jiraBaseUrl ? (
              <Link href={`${jiraBaseUrl}/browse/${e.key}`} target="_blank" rel="noopener">
                {e.key}
              </Link>
            ) : (
              e.key
            );
            return (
              <TableRow key={e.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                <TableCell sx={colSx}>{keyCell}</TableCell>
                <TableCell sx={colSx}>{e.summary}</TableCell>
                <TableCell sx={colSx}>{e.initiativeKey}</TableCell>
                <TableCell sx={colSx}>{e.team}</TableCell>
                <TableCell sx={colSx}>{e.status}</TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right' }}>{e.totalPoints}</TableCell>
                <TableCell sx={colSx}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ flex: 1 }}>
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        color={pctColor(pct)}
                        sx={{ height: 8, borderRadius: 4 }}
                      />
                    </Box>
                    <Typography
                      variant="caption"
                      fontWeight={600}
                      sx={{ minWidth: 36, textAlign: 'right' }}
                    >
                      {pct}%
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default EpicList;
