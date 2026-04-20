/**
 * Effort Estimates page domain types.
 * Server-rolled aggregation over initiatives -> epics -> stories, bucketed by
 * T-Shirt Sizing instead of summing story points.
 */

import type { JiraInitiative } from './jira';

export type TshirtSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'None';

/**
 * MoSCoW classification derived from an issue's labels. "Unclassified" means
 * no Must-Have / Should-Have / Could-Have label was present.
 */
export type Classification = 'Must-Have' | 'Should-Have' | 'Could-Have' | 'Unclassified';

export const CLASSIFICATIONS: readonly Classification[] = [
  'Must-Have',
  'Should-Have',
  'Could-Have',
  'Unclassified',
] as const;

/**
 * Inspect an issue's labels and return the highest-priority MoSCoW
 * classification found. Labels are matched case-insensitively and tolerate
 * hyphen / underscore / no-separator variants ("MustHave", "must_have").
 */
export const classificationFromLabels = (labels: string[] | undefined): Classification => {
  if (!labels) return 'Unclassified';
  // Normalize once; check in priority order so a story with multiple labels
  // lands in the most important tier.
  const normalized = labels.map((l) => l.trim().toLowerCase().replace(/[_\s]/g, '-'));
  if (normalized.some((l) => l === 'must-have' || l === 'musthave')) return 'Must-Have';
  if (normalized.some((l) => l === 'should-have' || l === 'shouldhave')) return 'Should-Have';
  if (normalized.some((l) => l === 'could-have' || l === 'couldhave')) return 'Could-Have';
  return 'Unclassified';
};

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
  tshirt: string | null;        // raw value from the dropdown, or null
  size: TshirtSize;             // bucketed — always set
  classification: Classification; // Must / Should / Could / Unclassified
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
