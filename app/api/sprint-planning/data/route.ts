import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, EXCLUDE_MAINFRAME, mapToSprints } from '@/backend/jira';
import type { FieldConfig } from '@/backend/jira/mappers';
import type { JiraIssueResponse } from '@/shared/types';

const STORY_POINT_ESTIMATE_FIELD = 'story_point_estimate';

const buildFieldConfig = (client: ReturnType<typeof getJiraClient>): FieldConfig => {
  const base = client.getFieldConfig();
  return {
    ...base,
    sprintPointEstimate: base.sprintPointEstimate || STORY_POINT_ESTIMATE_FIELD,
  };
};

interface SprintPlanningRequest {
  sprintId: number;
  boardId: number;
}

export interface ParentGroup {
  parentKey: string;
  parentSummary: string;
  points: number;
  percent: number;
}

export type ReadinessLabel = 'Ready-For-Sprint' | 'Needs-Refinement';

export interface StoryRow {
  key: string;
  summary: string;
  points: number;
  status: string;
  readiness: ReadinessLabel;
  parentKey: string;
}

export interface SprintPlanningResponse {
  sprintName: string;
  totalPoints: number;
  completedPoints: number;
  remainingPoints: number;
  parents: ParentGroup[];
  stories: StoryRow[];
}

const computePoints = (
  issue: JiraIssueResponse,
  fieldConfig: FieldConfig
): number => {
  const storyPts = issue.fields[fieldConfig.devDays];
  if (typeof storyPts === 'number' && storyPts > 0) return storyPts;

  if (fieldConfig.sprintPointEstimate) {
    const estPts = issue.fields[fieldConfig.sprintPointEstimate];
    if (typeof estPts === 'number' && estPts > 0) return estPts;
  }

  return 0;
};

export const POST = async (request: NextRequest) => {
  try {
    const body: SprintPlanningRequest = await request.json();
    const { sprintId, boardId } = body;

    if (!sprintId) {
      return NextResponse.json({ error: 'Sprint ID is required' }, { status: 400 });
    }

    if (!boardId) {
      return NextResponse.json({ error: 'Board ID is required' }, { status: 400 });
    }

    const client = getJiraClient();
    const fieldConfig = buildFieldConfig(client);

    const jql = `sprint = ${sprintId} AND ${EXCLUDE_MAINFRAME}`;
    const [sprintDetails, ticketsResponse] = await Promise.all([
      client.getSprintsByIds([sprintId]),
      client.searchAllIssues(jql),
    ]);

    const sprints = mapToSprints(sprintDetails);
    const sprintName = sprints[0]?.name ?? `Sprint ${sprintId}`;

    const isCompletedStatus = (s: string) => {
      const l = s.toLowerCase();
      return l === 'resolved' || l === 'done' || l === 'closed';
    };

    // Group stories by parent and collect individual story rows
    const parentMap = new Map<string, { summary: string; points: number }>();
    const stories: StoryRow[] = [];
    let completedPoints = 0;
    let remainingPoints = 0;

    for (const issue of ticketsResponse.issues) {
      const status = issue.fields.status.name.toLowerCase();
      if (status === 'canceled' || status === 'cancelled') continue;

      const points = computePoints(issue, fieldConfig);

      // Extract parent key and summary
      // The JIRA API returns parent as { key, fields: { summary } }
      const rawParent = issue.fields.parent as
        | { key: string; fields?: { summary?: string } }
        | undefined
        | null;

      let parentKey: string;
      let parentSummary: string;

      if (rawParent?.key) {
        parentKey = rawParent.key;
        parentSummary = rawParent.fields?.summary ?? rawParent.key;
      } else {
        // Try epic link custom field
        const epicLinkField = issue.fields[fieldConfig.epicLink] as
          | string
          | { key?: string; fields?: { summary?: string } }
          | null
          | undefined;

        if (typeof epicLinkField === 'string' && epicLinkField) {
          parentKey = epicLinkField;
          parentSummary = epicLinkField;
        } else if (
          epicLinkField &&
          typeof epicLinkField === 'object' &&
          'key' in epicLinkField &&
          typeof epicLinkField.key === 'string'
        ) {
          parentKey = epicLinkField.key;
          parentSummary = epicLinkField.fields?.summary ?? epicLinkField.key;
        } else {
          parentKey = '(No Parent)';
          parentSummary = '(No Parent)';
        }
      }

      const existing = parentMap.get(parentKey);
      if (existing) {
        existing.points += points;
      } else {
        parentMap.set(parentKey, { summary: parentSummary, points });
      }

      // Determine readiness: label takes precedence, then fall back to whether story points exist
      const labels: string[] = Array.isArray(issue.fields.labels) ? issue.fields.labels as string[] : [];
      const hasReady = labels.some((l) => l === 'Ready-For-Sprint');
      const hasNeeds = labels.some((l) => l === 'Needs-Refinement');
      const readiness: ReadinessLabel = hasNeeds ? 'Needs-Refinement'
        : (hasReady || points > 0) ? 'Ready-For-Sprint'
        : 'Needs-Refinement';

      if (isCompletedStatus(issue.fields.status.name)) {
        completedPoints += points;
      } else {
        remainingPoints += points;
      }

      stories.push({
        key: issue.key,
        summary: issue.fields.summary,
        points,
        status: issue.fields.status.name,
        readiness,
        parentKey,
      });
    }

    stories.sort((a, b) => a.key.localeCompare(b.key));

    const totalPoints = Array.from(parentMap.values()).reduce((sum, p) => sum + p.points, 0);

    const parents: ParentGroup[] = Array.from(parentMap.entries())
      .map(([parentKey, { summary, points }]) => ({
        parentKey,
        parentSummary: summary,
        points,
        percent: totalPoints > 0 ? Math.round((points / totalPoints) * 1000) / 10 : 0,
      }))
      .sort((a, b) => a.parentSummary.localeCompare(b.parentSummary));

    const response: SprintPlanningResponse = {
      sprintName,
      totalPoints,
      completedPoints,
      remainingPoints,
      parents,
      stories,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sprint planning data fetch failed:', error);
    return NextResponse.json(
      { error: message, message: `Data fetch failed: ${message}` },
      { status: 500 }
    );
  }
};
