import { TSHIRT_SIZES, type EffortEpic, type EffortStory, type TshirtSize } from '@/shared/types';

export interface EffortFilter {
  size?: TshirtSize;
  team?: string;
  initiativeKey?: string;
}

export interface EffortPieSlice {
  size: TshirtSize;
  count: number;
}

export interface EffortTeamStack {
  team: string;
  total: number;
  bySize: Record<TshirtSize, number>;
}

export interface EffortInitiativeStack {
  initiativeKey: string;
  total: number;
  bySize: Record<TshirtSize, number>;
}

const teamForStory = (story: EffortStory): string => {
  const idx = story.key.indexOf('-');
  return idx > 0 ? story.key.slice(0, idx) : story.key;
};

const emptyBySize = (): Record<TshirtSize, number> => {
  const out = {} as Record<TshirtSize, number>;
  for (const s of TSHIRT_SIZES) out[s] = 0;
  return out;
};

/**
 * Count stories in each T-shirt size bucket across all epics.
 * Zero-count buckets are dropped so the pie doesn't render empty wedges.
 */
export const rollupBySize = (epics: EffortEpic[] | undefined): EffortPieSlice[] => {
  if (!epics || epics.length === 0) return [];
  const counts = emptyBySize();
  for (const epic of epics) {
    for (const story of epic.stories) {
      counts[story.size] += 1;
    }
  }
  return TSHIRT_SIZES.filter((s) => counts[s] > 0).map((size) => ({ size, count: counts[size] }));
};

/**
 * Stacked story counts per team (derived from each story's project key),
 * split by T-shirt size. Matches the Fusion "Team × Status" chart shape.
 */
export const rollupByTeamAndSize = (epics: EffortEpic[] | undefined): EffortTeamStack[] => {
  if (!epics || epics.length === 0) return [];
  const stacks = new Map<string, EffortTeamStack>();
  for (const epic of epics) {
    for (const story of epic.stories) {
      const team = teamForStory(story);
      const stack = stacks.get(team) ?? {
        team,
        total: 0,
        bySize: emptyBySize(),
      };
      stack.total += 1;
      stack.bySize[story.size] += 1;
      stacks.set(team, stack);
    }
  }
  return Array.from(stacks.values()).sort((a, b) => b.total - a.total);
};

/**
 * Stacked story counts per epic-parent initiative, split by T-shirt size.
 */
export const rollupByInitiativeAndSize = (
  epics: EffortEpic[] | undefined
): EffortInitiativeStack[] => {
  if (!epics || epics.length === 0) return [];
  const stacks = new Map<string, EffortInitiativeStack>();
  for (const epic of epics) {
    const initiativeKey = epic.initiativeKey || '(no initiative)';
    for (const story of epic.stories) {
      const stack = stacks.get(initiativeKey) ?? {
        initiativeKey,
        total: 0,
        bySize: emptyBySize(),
      };
      stack.total += 1;
      stack.bySize[story.size] += 1;
      stacks.set(initiativeKey, stack);
    }
  }
  return Array.from(stacks.values()).sort((a, b) => b.total - a.total);
};

/**
 * Apply a chart click filter to the epic list. Narrows stories within each
 * epic by size/team, and epics by parent initiative; drops epics left with
 * no surviving stories so downstream rollups stay consistent.
 */
export const applyEffortFilter = (
  epics: EffortEpic[] | undefined,
  filter: EffortFilter | null
): EffortEpic[] => {
  if (!epics) return [];
  if (!filter) return epics;
  const result: EffortEpic[] = [];
  for (const epic of epics) {
    if (filter.initiativeKey) {
      const epicInitiative = epic.initiativeKey || '(no initiative)';
      if (epicInitiative !== filter.initiativeKey) continue;
    }
    let matching = epic.stories;
    if (filter.team) {
      matching = matching.filter((s) => teamForStory(s) === filter.team);
    }
    if (filter.size) {
      matching = matching.filter((s) => s.size === filter.size);
    }
    if (matching.length === 0) continue;
    if (matching.length === epic.stories.length) {
      result.push(epic);
    } else {
      // Recompute size counts so the epic grid reflects the filter.
      const counts = emptyBySize();
      for (const s of matching) counts[s.size] += 1;
      result.push({
        ...epic,
        stories: matching,
        totalStories: matching.length,
        sizeCounts: counts,
      });
    }
  }
  return result;
};
