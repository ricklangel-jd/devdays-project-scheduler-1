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
 * Roll up story points (devDays) grouped by story status. Canceled stories
 * are already excluded upstream in the API.
 */
export const rollupByStatus = (epics: FusionEpic[] | undefined): PieSlice[] => {
  if (!epics || epics.length === 0) return [];
  const bucket = new Map<string, number>();
  for (const epic of epics) {
    for (const story of epic.stories) {
      bucket.set(story.status, (bucket.get(story.status) ?? 0) + story.devDays);
    }
  }
  return Array.from(bucket.entries())
    .map(([status, points]) => ({ status, points }))
    .sort((a, b) => b.points - a.points || a.status.localeCompare(b.status));
};

/**
 * Roll up story points grouped by team (epic's team), stacked by story status.
 */
export const rollupByTeamAndStatus = (
  epics: FusionEpic[] | undefined
): TeamStack[] => {
  if (!epics || epics.length === 0) return [];
  const stacks = new Map<string, TeamStack>();
  for (const epic of epics) {
    for (const story of epic.stories) {
      const stack = stacks.get(epic.team) ?? {
        team: epic.team,
        total: 0,
        byStatus: {},
      };
      stack.total += story.devDays;
      stack.byStatus[story.status] =
        (stack.byStatus[story.status] ?? 0) + story.devDays;
      stacks.set(epic.team, stack);
    }
  }
  return Array.from(stacks.values()).sort((a, b) => b.total - a.total);
};

/**
 * Apply the current chart filter to the epic list. When `status` is set, we
 * narrow each epic's `stories` array to the matching stories and drop epics
 * that have no matches — so the stories grid naturally shows the filtered
 * subset via `filteredEpics.flatMap(e => e.stories)`.
 */
export const applyFilter = (
  epics: FusionEpic[] | undefined,
  filter: ChartFilter | null
): FusionEpic[] => {
  if (!epics) return [];
  if (!filter) return epics;
  const result: FusionEpic[] = [];
  for (const epic of epics) {
    if (filter.team && epic.team !== filter.team) continue;
    if (!filter.status) {
      result.push(epic);
      continue;
    }
    const matching = epic.stories.filter(s => s.status === filter.status);
    if (matching.length === 0) continue;
    result.push({ ...epic, stories: matching });
  }
  return result;
};

