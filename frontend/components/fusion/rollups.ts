import type { FusionEpic, FusionStory } from '@/shared/types';

export interface ChartFilter {
  status?: string;
  team?: string;
  initiativeKey?: string;
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

export interface InitiativeStack {
  initiativeKey: string;
  total: number;
  byStatus: Record<string, number>;
}

// The "team" for a story is its JIRA project key — the prefix of its issue
// key (e.g. "FOO-42" → "FOO"). Stories can cross projects from an epic's
// project, so we derive this per story rather than inheriting from the epic.
const teamForStory = (story: FusionStory): string => {
  const idx = story.key.indexOf('-');
  return idx > 0 ? story.key.slice(0, idx) : story.key;
};

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
 * Roll up story points grouped by team, stacked by story status. "Team" is
 * derived from each story's own JIRA project key, not the epic's — so stories
 * that a team picked up from another project's epic still land in their own
 * team's column.
 */
export const rollupByTeamAndStatus = (
  epics: FusionEpic[] | undefined
): TeamStack[] => {
  if (!epics || epics.length === 0) return [];
  const stacks = new Map<string, TeamStack>();
  for (const epic of epics) {
    for (const story of epic.stories) {
      const team = teamForStory(story);
      const stack = stacks.get(team) ?? {
        team,
        total: 0,
        byStatus: {},
      };
      stack.total += story.devDays;
      stack.byStatus[story.status] =
        (stack.byStatus[story.status] ?? 0) + story.devDays;
      stacks.set(team, stack);
    }
  }
  return Array.from(stacks.values()).sort((a, b) => b.total - a.total);
};

/**
 * Roll up story points grouped by the epic's parent initiative, stacked by
 * story status. Epics whose parent isn't one of the loaded initiatives
 * (typically linked-in epics) fall under their actual parent key, or
 * "(no initiative)" when the parent is missing entirely.
 */
export const rollupByInitiativeAndStatus = (
  epics: FusionEpic[] | undefined
): InitiativeStack[] => {
  if (!epics || epics.length === 0) return [];
  const stacks = new Map<string, InitiativeStack>();
  for (const epic of epics) {
    const initiativeKey = epic.initiativeKey || '(no initiative)';
    for (const story of epic.stories) {
      const stack = stacks.get(initiativeKey) ?? {
        initiativeKey,
        total: 0,
        byStatus: {},
      };
      stack.total += story.devDays;
      stack.byStatus[story.status] =
        (stack.byStatus[story.status] ?? 0) + story.devDays;
      stacks.set(initiativeKey, stack);
    }
  }
  return Array.from(stacks.values()).sort((a, b) => b.total - a.total);
};

/**
 * Apply the current chart filter to the epic list. Both `team` and `status`
 * now narrow the stories within each epic (team is a per-story attribute
 * derived from the story's project key). An epic is kept only when it has at
 * least one surviving story, so the stories grid and rollups stay in sync via
 * `filteredEpics.flatMap(e => e.stories)`.
 */
export const applyFilter = (
  epics: FusionEpic[] | undefined,
  filter: ChartFilter | null
): FusionEpic[] => {
  if (!epics) return [];
  if (!filter) return epics;
  const result: FusionEpic[] = [];
  for (const epic of epics) {
    // Initiative is an epic-level attribute (the epic's parent key). Narrow
    // out epics whose parent doesn't match before looking at their stories.
    if (filter.initiativeKey) {
      const epicInitiative = epic.initiativeKey || '(no initiative)';
      if (epicInitiative !== filter.initiativeKey) continue;
    }
    let matching = epic.stories;
    if (filter.team) {
      matching = matching.filter(s => teamForStory(s) === filter.team);
    }
    if (filter.status) {
      matching = matching.filter(s => s.status === filter.status);
    }
    if (matching.length === 0) continue;
    if (matching.length === epic.stories.length) {
      result.push(epic);
    } else {
      result.push({ ...epic, stories: matching });
    }
  }
  return result;
};

