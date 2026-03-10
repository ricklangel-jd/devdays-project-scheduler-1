import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, EXCLUDE_MAINFRAME } from '@/backend/jira';

/**
 * GET /api/pi-planning/engineers?project=PROJ&boardId=123
 *
 * Fetches unique assignees from the current (active) sprint for
 * the given project and board. Used to seed the engineer capacity grid.
 *
 * - boardId is optional; falls back to JIRA_BOARD_ID env var.
 * - Finds the active sprint whose name starts with the project prefix.
 * - Returns a sorted list of unique engineer display names.
 */
export const GET = async (request: NextRequest) => {
  const projectKey = request.nextUrl.searchParams.get('project');
  const boardIdParam = request.nextUrl.searchParams.get('boardId');
  const boardId = boardIdParam ? parseInt(boardIdParam, 10) : undefined;

  if (!projectKey) {
    return NextResponse.json(
      { error: 'Project key is required' },
      { status: 400 }
    );
  }

  try {
    const client = getJiraClient();

    // Fetch active sprints for the board
    const allActiveSprints = await client.getSprints('active', boardId);

    // Filter to sprints whose name starts with the project key prefix
    const prefix = projectKey.toUpperCase();
    const projectSprints = allActiveSprints.filter((s) =>
      s.name.toUpperCase().startsWith(prefix)
    );

    if (projectSprints.length === 0) {
      // No active sprint found — return empty list
      return NextResponse.json({ engineers: [] });
    }

    // Use the first active sprint
    const currentSprint = projectSprints[0];

    // Fetch all stories/tasks in the current sprint for this project
    const jql = `sprint = ${currentSprint.id} AND project = ${projectKey} AND issuetype in (Story, Task, "Service Ticket") AND ${EXCLUDE_MAINFRAME}`;
    const response = await client.searchAllIssues(jql, []);

    // Extract unique assignee display names
    const assigneeSet = new Set<string>();
    for (const issue of response.issues) {
      const assignee = issue.fields.assignee;
      if (assignee?.displayName) {
        assigneeSet.add(assignee.displayName);
      }
    }

    // Sort alphabetically
    const engineers = [...assigneeSet].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    return NextResponse.json({ engineers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('PI Planning engineers fetch failed:', error);

    return NextResponse.json(
      {
        error: message,
        message: `Failed to fetch engineers: ${message}`,
      },
      { status: 500 }
    );
  }
};
