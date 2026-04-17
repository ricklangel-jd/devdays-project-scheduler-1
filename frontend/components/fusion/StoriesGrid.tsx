'use client';

import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import type { FusionStory } from '@/shared/types';

interface StoriesGridProps {
  stories: FusionStory[];
  jiraBaseUrl: string | undefined;
}

const StoriesGrid = ({ stories, jiraBaseUrl }: StoriesGridProps) => {
  if (stories.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No stories to display.
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
            <TableCell sx={headerSx}>Story</TableCell>
            <TableCell sx={headerSx}>Summary</TableCell>
            <TableCell sx={headerSx}>Epic</TableCell>
            <TableCell sx={headerSx}>Status</TableCell>
            <TableCell sx={headerSx}>Assignee</TableCell>
            <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Dev Days</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {stories.map((s) => {
            const keyCell = jiraBaseUrl ? (
              <Link href={`${jiraBaseUrl}/browse/${s.key}`} target="_blank" rel="noopener">
                {s.key}
              </Link>
            ) : (
              s.key
            );
            return (
              <TableRow key={s.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                <TableCell sx={colSx}>{keyCell}</TableCell>
                <TableCell sx={colSx}>{s.summary}</TableCell>
                <TableCell sx={colSx}>{s.epicKey}</TableCell>
                <TableCell sx={colSx}>{s.status}</TableCell>
                <TableCell sx={colSx}>{s.assignee ?? '—'}</TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right' }}>{s.devDays}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default StoriesGrid;
