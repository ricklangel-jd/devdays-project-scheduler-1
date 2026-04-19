/**
 * Effort Estimates page domain types.
 * Server-rolled aggregation over initiatives -> epics -> stories, bucketed by
 * T-Shirt Sizing instead of summing story points.
 */

import type { JiraInitiative } from './jira';

export type TshirtSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'None';

/**
 * Ordered size list. "None" (no size, no points) sorts last so it renders at
 * the bottom of stacked bars and to the right in pie legends.
 */
export const TSHIRT_SIZES: readonly TshirtSize[] = ['XS', 'S', 'M', 'L', 'XL', 'None'] as const;

/**
 * Bucket a story into a T-Shirt size strictly from the dropdown value.
 * Stories with no value (or an unrecognized value) fall into "None" — story
 * points are never used as a fallback.
 */
export const tshirtSizeFor = (tshirtValue: string | null): TshirtSize => {
  if (!tshirtValue) return 'None';
  const normalized = tshirtValue.trim().toUpperCase();
  if (
    normalized === 'XS' ||
    normalized === 'S' ||
    normalized === 'M' ||
    normalized === 'L' ||
    normalized === 'XL'
  ) {
    return normalized;
  }
  return 'None';
};

export interface EffortStory {
  key: string;
  summary: string;
  epicKey: string;
  status: string;
  assignee: string | null;
  devDays: number;
  tshirt: string | null;   // raw value from the dropdown, or null
  size: TshirtSize;        // bucketed — always set
}

export interface EffortEpicLink {
  epicKey: string;
  linkType: string;
}

export interface EffortEpic {
  key: string;
  summary: string;
  initiativeKey: string;
  team: string;
  status: string;
  totalStories: number;
  sizeCounts: Record<TshirtSize, number>;
  stories: EffortStory[];
  linkedVia?: EffortEpicLink[];
  updatedAt: string | null;
}

export interface EffortData {
  initiatives: JiraInitiative[];
  epics: EffortEpic[];
  teamNames: Record<string, string>;
}
