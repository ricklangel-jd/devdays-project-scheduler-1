import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, EXCLUDE_MAINFRAME } from '@/backend/jira';
import type { FieldConfig } from '@/backend/jira/mappers';
import type { EpicStoryRow } from '@/shared/types';

/**
 * Jira built-in field for "Story point estimate" — used as fallback when the
 * primary story-points field (JIRA_FIELD_DEV_DAYS) has no value.
 */
const STORY_POINT_ESTIMATE_FIELD = 'story_point_estimate';

/**
 * Build a field config that always falls back to story_point_estimate.
 */
const buildFieldConfig = (client: ReturnType<typeof getJiraClient>): FieldConfig => {
  const base = client.getFieldConfig();
  return {
    ...base,
    sprintPointEstimate: base.sprintPointEstimate || STORY_POINT_ESTIMATE_FIELD,
  };
};

/**
 * Extract sprint info from raw JIRA sprint field.
 * The sprint field is an array of objects with { id, name, startDate?, ... }.
 */
const extractSprintInfo = (
  sprintField: unknown
): { id: number; name: string; startDate: string | null }[] => {
  if (!sprintField || !Array.isArray(sprintField)) return [];
  return sprintField
    .filter(
      (s): s is { id: number; name: string; startDate?: string } =>
        s &&
        typeof s === 'object' &&
        typeof s.id === 'number' &&
        typeof s.name === 'string'
    )
    .map((s) => ({
      id: s.id,
      name: s.name,
      startDate: typeof s.startDate === 'string' ? s.startDate : null,
    }));
};

/**
 * Pick the last sprint from a list of sprints, determined by the latest start date.
 * Falls back to the last element if no start dates are available.
 */
const pickLastSprint = (
  sprints: { id: number; name: string; startDate: string | null }[]
): string | null => {
  if (sprints.length === 0) return null;

  // Filter sprints that have a start date
  const withDates = sprints.filter((s) => s.startDate !== null);

  if (withDates.length > 0) {
    // Sort by start date descending, pick first
    withDates.sort((a, b) => {
      const dateA = new Date(a.startDate!).getTime();
      const dateB = new Date(b.startDate!).getTime();
      return dateB - dateA;
    });
    return withDates[0].name;
  }

  // No start dates available — use the last element in the array
  return sprints[sprints.length - 1].name;
};

interface StoriesRequest {
  epicKey: string;
  sprintIds?: number[];
}

export const POST = async (request: NextRequest) => {
  try {
    const body: StoriesRequest = await request.json();
    const { epicKey, sprintIds } = body;

    if (!epicKey) {
      return NextResponse.json(
        { error: 'Epic key is required' },
        { status: 400 }
      );
    }

    const client = getJiraClient();
    const fieldConfig = buildFieldConfig(client);

    // Fetch epic status and child stories in parallel
    const jql = `("Epic Link" = ${epicKey} OR parent = ${epicKey}) AND ${EXCLUDE_MAINFRAME} AND status != "Canceled" ORDER BY key ASC`;
    console.log(`[Stories] Fetching stories for ${epicKey}: ${jql}`);

    const [epicIssue, response] = await Promise.all([
      client.getIssue(epicKey),
      client.searchAllIssues(jql, [STORY_POINT_ESTIMATE_FIELD]),
    ]);

    const epicStatus = epicIssue.fields.status.name;
    console.log(`[Stories] Found ${response.issues.length} stories for ${epicKey} (epic status: ${epicStatus})`);

    // Build sprint ID filter set (if provided)
    const sprintFilterSet = sprintIds && sprintIds.length > 0
      ? new Set(sprintIds)
      : null;

    const stories: EpicStoryRow[] = [];

    for (const issue of response.issues) {
      // Skip canceled/cancelled stories (double-check in code since JQL may not catch all)
      const status = issue.fields.status.name;
      const statusLower = status.toLowerCase();
      if (statusLower === 'canceled' || statusLower === 'cancelled') continue;

      // Extract sprint info from raw field
      const sprintInfo = extractSprintInfo(issue.fields[fieldConfig.sprint]);

      // If sprint filter is active, only include tickets that have at least one matching sprint
      if (sprintFilterSet) {
        const hasMatchingSprint = sprintInfo.some((s) => sprintFilterSet.has(s.id));
        if (!hasMatchingSprint) continue;
      }

      // Extract raw story points (the primary devDays field)
      const rawDevDays = issue.fields[fieldConfig.devDays];
      const storyPoints =
        typeof rawDevDays === 'number' && rawDevDays > 0 ? rawDevDays : null;

      // Extract raw story point estimate (the fallback field)
      const rawEstimate = fieldConfig.sprintPointEstimate
        ? issue.fields[fieldConfig.sprintPointEstimate]
        : undefined;
      const storyPointEstimate =
        typeof rawEstimate === 'number' && rawEstimate > 0 ? rawEstimate : null;

      // Pick the last sprint by start date
      const sprintName = pickLastSprint(sprintInfo);

      stories.push({
        key: issue.key,
        summary: issue.fields.summary,
        storyPoints,
        storyPointEstimate,
        sprintName,
        status,
      });
    }

    console.log(
      `[Stories] Returning ${stories.length} stories for ${epicKey}${sprintFilterSet ? ` (filtered by ${sprintFilterSet.size} sprints)` : ''}`
    );

    return NextResponse.json({ stories, epicStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Stories fetch failed:', error);

    return NextResponse.json(
      {
        error: message,
        message: `Stories fetch failed: ${message}`,
      },
      { status: 500 }
    );
  }
};
