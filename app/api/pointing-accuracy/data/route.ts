import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient } from '@/backend/jira';
import type { FieldConfig } from '@/backend/jira/mappers';
import type { JiraIssueResponse } from '@/shared/types';

export interface PointingAccuracyRow {
  key: string;
  summary: string;
  points: number;
  hoursLogged: number;   // timespent seconds → hours, rounded to 1 decimal
  devDaysLogged: number; // hoursLogged / 5, rounded to 2 decimals
  issueType: string;
}

export interface PointingAccuracyResponse {
  sprintName: string;
  rows: PointingAccuracyRow[];
}

const computePoints = (issue: JiraIssueResponse, fieldConfig: FieldConfig): number => {
  const pts = issue.fields[fieldConfig.devDays];
  if (typeof pts === 'number' && pts > 0) return pts;
  if (fieldConfig.sprintPointEstimate) {
    const est = issue.fields[fieldConfig.sprintPointEstimate];
    if (typeof est === 'number' && est > 0) return est;
  }
  return 0;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sprintIdParam = searchParams.get('sprintId');
  const boardIdParam = searchParams.get('boardId');

  if (!sprintIdParam || !boardIdParam) {
    return NextResponse.json({ error: 'Missing required params: sprintId, boardId' }, { status: 400 });
  }

  const sprintId = parseInt(sprintIdParam, 10);
  const boardId = parseInt(boardIdParam, 10);
  if (isNaN(sprintId) || isNaN(boardId)) {
    return NextResponse.json({ error: 'Invalid sprintId or boardId' }, { status: 400 });
  }

  try {
    const client = getJiraClient();
    const fieldConfig = client.getFieldConfig();

    // Fetch sprint details for the name
    const sprint = await client.getSprintById(sprintId);

    // Fetch all non-Epic, non-Service-Request issues in the sprint, including timespent
    const jql = `sprint = ${sprintId} AND issuetype not in (Epic, "Service Request", "[System] Service request", "[System] Incident") ORDER BY issuetype ASC, key ASC`;
    const response = await client.searchAllIssues(jql, ['timespent', 'issuetype']);

    const rows: PointingAccuracyRow[] = response.issues.map((issue) => {
      const points = computePoints(issue, fieldConfig);
      const timespentSeconds = typeof issue.fields['timespent'] === 'number' ? issue.fields['timespent'] : 0;
      const hoursLogged = Math.round((timespentSeconds / 3600) * 10) / 10;
      const devDaysLogged = Math.round((hoursLogged / 5) * 100) / 100;
      const issueType = (issue.fields['issuetype'] as { name?: string } | undefined)?.name ?? '';

      return {
        key: issue.key,
        summary: (issue.fields['summary'] as string | undefined) ?? '',
        points,
        hoursLogged,
        devDaysLogged,
        issueType,
      };
    });

    const result: PointingAccuracyResponse = {
      sprintName: sprint.name,
      rows,
    };

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
