import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, EXCLUDE_MAINFRAME } from '@/backend/jira';
import type { FieldConfig } from '@/backend/jira/mappers';

const STORY_POINT_ESTIMATE_FIELD = 'customfield_10016';

const buildFieldConfig = (client: ReturnType<typeof getJiraClient>): FieldConfig => {
  const base = client.getFieldConfig();
  return {
    ...base,
    sprintPointEstimate: base.sprintPointEstimate || STORY_POINT_ESTIMATE_FIELD,
  };
};

export interface PiPlanningEpic {
  key: string;
  summary: string;
  status: string;
  labels: string[];
  storyPointEstimate: number | null;
  childStoryPoints: number;
}

/**
 * GET /api/pi-planning/epics?project=PROJ
 *
 * Fetches all non-canceled, non-done epics for a project, along with
 * the sum of child story points for each epic.
 */
export const GET = async (request: NextRequest) => {
  const projectKey = request.nextUrl.searchParams.get('project');

  if (!projectKey) {
    return NextResponse.json(
      { error: 'Project key is required' },
      { status: 400 }
    );
  }

  try {
    const client = getJiraClient();
    const fieldConfig = buildFieldConfig(client);

    // Fetch all non-done, non-canceled epics for the project
    const epicJql = `issuetype = Epic AND project = ${projectKey} AND statusCategory != Done AND status != "Canceled" AND ${EXCLUDE_MAINFRAME} ORDER BY key ASC`;
    const epicsResponse = await client.searchAllIssues(epicJql, [STORY_POINT_ESTIMATE_FIELD]);

    // Fetch all non-done, non-canceled child stories/tasks in one query
    const childJql = `issuetype in (Story, Task, "Service Ticket") AND project = ${projectKey} AND statusCategory != Done AND status != "Canceled" AND ${EXCLUDE_MAINFRAME} AND "Epic Link" is not EMPTY ORDER BY key ASC`;
    const childrenResponse = await client.searchAllIssues(childJql, [STORY_POINT_ESTIMATE_FIELD]);

    // Aggregate child story points per epic
    const childPointsByEpic = new Map<string, number>();
    for (const child of childrenResponse.issues) {
      // Determine epic key from parent or epic link
      const parentKey = child.fields.parent?.key ?? null;
      const epicLinkField = child.fields[fieldConfig.epicLink] as string | { key?: string } | null | undefined;
      let epicKey = parentKey;
      if (!epicKey && epicLinkField) {
        if (typeof epicLinkField === 'string') {
          epicKey = epicLinkField;
        } else if (typeof epicLinkField === 'object' && 'key' in epicLinkField && typeof epicLinkField.key === 'string') {
          epicKey = epicLinkField.key;
        }
      }
      if (!epicKey) continue;

      // Extract dev days (story points)
      const devDaysValue = child.fields[fieldConfig.devDays];
      let points: number;
      if (typeof devDaysValue === 'number' && devDaysValue > 0) {
        points = devDaysValue;
      } else if (fieldConfig.sprintPointEstimate) {
        const fallback = child.fields[fieldConfig.sprintPointEstimate];
        points = typeof fallback === 'number' && fallback > 0 ? fallback : 0;
      } else {
        points = 0;
      }

      childPointsByEpic.set(epicKey, (childPointsByEpic.get(epicKey) ?? 0) + points);
    }

    // Build the response
    const epics: PiPlanningEpic[] = epicsResponse.issues.map((issue) => {
      const storyPointEstimateValue = issue.fields[STORY_POINT_ESTIMATE_FIELD];
      const storyPointEstimate =
        typeof storyPointEstimateValue === 'number' ? storyPointEstimateValue : null;

      return {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        labels: issue.fields.labels ?? [],
        storyPointEstimate,
        childStoryPoints: childPointsByEpic.get(issue.key) ?? 0,
      };
    });

    return NextResponse.json({ epics });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('PI Planning epics fetch failed:', error);

    return NextResponse.json(
      {
        error: message,
        message: `Failed to fetch epics: ${message}`,
      },
      { status: 500 }
    );
  }
};
