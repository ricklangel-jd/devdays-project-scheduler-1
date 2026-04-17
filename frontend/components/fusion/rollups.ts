import type { FusionEpic } from '@/shared/types';

export interface ChartFilter {
  status?: string;
  team?: string;
}

export interface PieSlice {
  status: string;
  points: number;
}

export interface TeamStack {
  team: string;
  total: number;
  byStatus: Record<string, number>;
}

/**
 * Roll up total points grouped by epic status.
 * Epics with totalPoints of 0 are still counted under their status so zero
 * segments do not silently disappear from the filter controls.
 */
export const rollupByStatus = (epics: FusionEpic[] | undefined): PieSlice[] => {
  if (!epics || epics.length === 0) return [];
  const bucket = new Map<string, number>();
  for (const epic of epics) {
    bucket.set(epic.status, (bucket.get(epic.status) ?? 0) + epic.totalPoints);
  }
  return Array.from(bucket.entries())
    .map(([status, points]) => ({ status, points }))
    .sort((a, b) => b.points - a.points || a.status.localeCompare(b.status));
};

/**
 * Roll up total points grouped by team, stacked by status.
 */
export const rollupByTeamAndStatus = (
  epics: FusionEpic[] | undefined
): TeamStack[] => {
  if (!epics || epics.length === 0) return [];
  const stacks = new Map<string, TeamStack>();
  for (const epic of epics) {
    const stack = stacks.get(epic.team) ?? {
      team: epic.team,
      total: 0,
      byStatus: {},
    };
    stack.total += epic.totalPoints;
    stack.byStatus[epic.status] =
      (stack.byStatus[epic.status] ?? 0) + epic.totalPoints;
    stacks.set(epic.team, stack);
  }
  return Array.from(stacks.values()).sort((a, b) => b.total - a.total);
};

/**
 * Apply the current chart filter to the epic list.
 * - filter = null: return all epics.
 * - filter.status set: keep epics whose status matches.
 * - filter.team set: keep epics whose team matches.
 * - both set: keep epics matching BOTH.
 */
export const applyFilter = (
  epics: FusionEpic[] | undefined,
  filter: ChartFilter | null
): FusionEpic[] => {
  if (!epics) return [];
  if (!filter) return epics;
  return epics.filter(e => {
    if (filter.status && e.status !== filter.status) return false;
    if (filter.team && e.team !== filter.team) return false;
    return true;
  });
};

/* Sanity-check examples (uncomment to run in a scratch file):
 *
 * import type { FusionEpic } from '@/shared/types';
 * const epics: FusionEpic[] = [
 *   { key: 'A-1', summary: '', initiativeKey: 'I', team: 'A',
 *     status: 'In Progress', totalPoints: 10, donePoints: 3, stories: [] },
 *   { key: 'A-2', summary: '', initiativeKey: 'I', team: 'A',
 *     status: 'Backlog', totalPoints: 5, donePoints: 0, stories: [] },
 *   { key: 'B-1', summary: '', initiativeKey: 'I', team: 'B',
 *     status: 'In Progress', totalPoints: 7, donePoints: 0, stories: [] },
 * ];
 * console.assert(rollupByStatus(epics).find(s => s.status === 'In Progress')?.points === 17);
 * console.assert(rollupByTeamAndStatus(epics).find(t => t.team === 'A')?.total === 15);
 * console.assert(applyFilter(epics, { team: 'A', status: 'Backlog' }).length === 1);
 */
