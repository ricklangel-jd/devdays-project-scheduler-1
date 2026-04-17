/**
 * Hardcoded color map for known JIRA status names used on the Fusion Status
 * page. Unknown statuses fall back to UNKNOWN_COLOR and emit a one-time
 * console.warn so we can curate this list over time.
 */

const warned = new Set<string>();

export const STATUS_COLORS: Record<string, string> = {
  'Backlog': '#9e9e9e',
  'Selected for Development': '#7e57c2',
  'In Progress': '#1976d2',
  'In Test': '#f59f00',
  'Code Review': '#8e24aa',
  'Ready for Release': '#00796b',
  'Resolved': '#2e7d32',
  'Done': '#1b5e20',
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
