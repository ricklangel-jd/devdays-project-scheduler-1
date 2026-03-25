import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, EXCLUDE_MAINFRAME } from '@/backend/jira';
import type { FieldConfig } from '@/backend/jira/mappers';
import type { EpicStoryRow } from '@/shared/types';

/**
 * Jira built-in field for "Story point estimate" — used as fallback when the
 * primary story-points field (JIRA_FIELD_DEV_DAYS) has no value.
 */
const STORY_POINT_ESTIMATE_FIELD = 'story_point_estimate';

/** Sentinel key for stories with no parent epic */
const NO_EPIC_KEY = '__NO_EPIC__';

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
 */
const pickLastSprint = (
  sprints: { id: number; name: string; startDate: string | null }[]
): string | null => {
  if (sprints.length === 0) return null;

  const withDates = sprints.filter((s) => s.startDate !== null);

  if (withDates.length > 0) {
    withDates.sort((a, b) => {
      const dateA = new Date(a.startDate!).getTime();
      const dateB = new Date(b.startDate!).getTime();
      return dateB - dateA;
    });
    return withDates[0].name;
  }

  return sprints[sprints.length - 1].name;
};

interface StoriesRequest {
  epicKey: string;
  sprintIds?: number[];
  projectKey?: string;
}

export const POST = async (request: NextRequest) => {
  try {
    const body: StoriesRequest = await request.json();
    const { epicKey, sprintIds, projectKey } = body;

    if (!epicKey) {
      return NextResponse.json(
        { error: 'Epic key is required' },
        { status: 400 }
      );
    }

    const client = getJiraClient();
    const fieldConfig = buildFieldConfig(client);

    // Handle __NO_EPIC__ sentinel: query stories with no epic in the given sprints
    if (epicKey === NO_EPIC_KEY) {
      if (!sprintIds || sprintIds.length === 0 || !projectKey) {
        return NextResponse.json(
          { error: 'sprintIds and projectKey are required for No Epic stories' },
          { status: 400 }
        );
      }

      const sprintIdsList = sprintIds.join(',');
      const jql = `project = ${projectKey} AND sprint in (${sprintIdsList}) AND issuetype in (Story, "Service Ticket") AND "Epic Link" is EMPTY AND ${EXCLUDE_MAINFRAME} AND status != "Canceled" ORDER BY key ASC`;

      const response = await client.searchAllIssues(jql, [STORY_POINT_ESTIMATE_FIELD]);

      // Further filter: only include items with no parent either
      const stories: EpicStoryRow[] = [];

      for (const issue of response.issues) {
        const status = issue.fields.status.name;
        const statusLower = status.toLowerCase();
        if (statusLower === 'canceled' || statusLower === 'cancelled') continue;

        // Skip issues that have a parent (subtasks of epics)
        if (issue.fields.parent?.key) continue;

        const sprintInfo = extractSprintInfo(issue.fields[fieldConfig.sprint]);
        const sprintName = pickLastSprint(sprintInfo);

        const rawDevDays = issue.fields[fieldConfig.devDays];
        const storyPoints =
          typeof rawDevDays === 'number' && rawDevDays > 0 ? rawDevDays : null;

        const rawEstimate = fieldConfig.sprintPointEstimate
          ? issue.fields[fieldConfig.sprintPointEstimate]
          : undefined;
        const storyPointEstimate =
          typeof rawEstimate === 'number' && rawEstimate > 0 ? rawEstimate : null;

        stories.push({
          key: issue.key,
          summary: issue.fields.summary,
          storyPoints,
          storyPointEstimate,
          sprintName,
          status,
        });
      }

      return NextResponse.json({ stories, epicStatus: null });
    }

    // Standard flow: fetch child stories of a real epic (same as capacity-demand)
    const jql = `("Epic Link" = ${epicKey} OR parent = ${epicKey}) AND ${EXCLUDE_MAINFRAME} AND status != "Canceled" ORDER BY key ASC`;

    const [epicIssue, response] = await Promise.all([
      client.getIssue(epicKey),
      client.searchAllIssues(jql, [STORY_POINT_ESTIMATE_FIELD]),
    ]);

    const epicStatus = epicIssue.fields.status.name;

    // Build sprint ID filter set (if provided)
    const sprintFilterSet = sprintIds && sprintIds.length > 0
      ? new Set(sprintIds)
      : null;

    const stories: EpicStoryRow[] = [];

    for (const issue of response.issues) {
      const status = issue.fields.status.name;
      const statusLower = status.toLowerCase();
      if (statusLower === 'canceled' || statusLower === 'cancelled') continue;

      const sprintInfo = extractSprintInfo(issue.fields[fieldConfig.sprint]);

      if (sprintFilterSet) {
        const hasMatchingSprint = sprintInfo.some((s) => sprintFilterSet.has(s.id));
        if (!hasMatchingSprint) continue;
      }

      const rawDevDays = issue.fields[fieldConfig.devDays];
      const storyPoints =
        typeof rawDevDays === 'number' && rawDevDays > 0 ? rawDevDays : null;

      const rawEstimate = fieldConfig.sprintPointEstimate
        ? issue.fields[fieldConfig.sprintPointEstimate]
        : undefined;
      const storyPointEstimate =
        typeof rawEstimate === 'number' && rawEstimate > 0 ? rawEstimate : null;

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

    return NextResponse.json({ stories, epicStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('All Work stories fetch failed:', error);

    return NextResponse.json(
      {
        error: message,
        message: `Stories fetch failed: ${message}`,
      },
      { status: 500 }
    );
  }
};
