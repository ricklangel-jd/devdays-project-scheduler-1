/**
 * Hardcoded color map for known JIRA status names used on the Fusion Status
 * page. Unknown statuses fall back to UNKNOWN_COLOR and emit a one-time
 * console.warn so we can curate this list over time.
 *
 * Palette groups by JIRA status category:
 *   - To Do / not-yet-started → cool teals and purples
 *   - In Progress / active     → blues through amber
 *   - Done / closed            → greens
 *   - Blocked / paused         → reds and oranges
 */

const warned = new Set<string>();

export const STATUS_COLORS: Record<string, string> = {
  // To Do (not started)
  'Open': '#81d4fa',
  'To Do': '#81d4fa',
  'Backlog': '#4dd0e1',
  'New': '#4dd0e1',
  'Reopened': '#80cbc4',
  'Planning': '#b39ddb',
  'In Queue': '#ce93d8',
  'Selected for Development': '#9575cd',
  'Ready': '#26c6da',
  'Ready for Development': '#26a69a',

  // In Progress (active)
  'In Progress': '#1976d2',
  'In Development': '#1565c0',
  'Code Review': '#8e24aa',
  'In Review': '#ab47bc',
  'In Test': '#f59f00',
  'Testing': '#fbc02d',
  'QA': '#ffa726',
  'Acceptance': '#aed581',
  'Customer Commented': '#f48fb1',

  // Done (complete)
  'Ready for Release': '#00796b',
  'Ready for Production': '#2e7d32',
  'Resolved': '#43a047',
  'Done': '#2e7d32',
  'Closed': '#1b5e20',

  // Paused / stuck
  'Blocked': '#ef5350',
  'On Hold': '#ff8a65',
  'Rejected': '#c62828',
};

export const UNKNOWN_COLOR = '#bdbdbd';

export const colorForStatus = (status: string): string => {
  const hit = STATUS_COLORS[status];
  if (hit) return hit;
  if (!warned.has(status)) {
    warned.add(status);
    console.warn(`[Fusion] no color mapped for status "${status}" — using fallback`);
  }
  return UNKNOWN_COLOR;
};
