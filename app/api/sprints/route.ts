import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, mapToSprints } from '@/backend/jira';
import { parseDate } from '@/shared/utils/dates';

/**
 * GET /api/sprints - Fetch sprints from JIRA
 *
 * Query params:
 * - state: 'active' | 'closed' | 'future' (passed to JIRA API)
 * - boardId: number (passed to JIRA API)
 * - projectKey: string (filters sprints whose name starts with this project code)
 * - q: string (name filter - applied post-fetch, JIRA API doesn't support name search)
 *
 * Note: The JIRA Board Sprint API (/rest/agile/1.0/board/{boardId}/sprint) only supports
 * filtering by `state`. Name filtering must be done post-fetch as JIRA doesn't support it.
 */
export const GET = async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const state = searchParams.get('state') as 'active' | 'closed' | 'future' | null;
  const boardIdParam = searchParams.get('boardId');
  const boardId = boardIdParam ? parseInt(boardIdParam, 10) : undefined;
  const projectKey = searchParams.get('projectKey');
  const filterQuery = searchParams.get('q')?.toLowerCase();

  try {
    const client = getJiraClient();
    // Explicitly request all states when no filter provided
    // (JIRA board sprint API may not return closed sprints by default)
    const sprintState = state ?? 'active,closed,future';
    const sprintsResponse = await client.getSprints(sprintState, boardId);
    let sprints = mapToSprints(sprintsResponse);

    // Filter sprints by project key prefix in the sprint name.
    // Sprint names always start with the project code (e.g. "ABC Sprint 1").
    // This reliably filters out sprints from other projects that share the board,
    // including closed sprints (which originBoardId filtering incorrectly excluded).
    if (projectKey) {
      const prefix = projectKey.toUpperCase();
      sprints = sprints.filter((sprint) =>
        sprint.name.toUpperCase().startsWith(prefix)
      );
    }

    // Name filtering must be done post-fetch (JIRA Sprint API doesn't support name search)
    if (filterQuery) {
      sprints = sprints.filter((sprint) =>
        sprint.name.toLowerCase().includes(filterQuery)
      );
    }

    // Sort by start date ascending
    sprints.sort((a, b) => {
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return parseDate(a.startDate).toMillis() - parseDate(b.startDate).toMillis();
    });

    return NextResponse.json({
      sprints,
      total: sprints.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Check for board ID issues
    if (message.includes('404') || message.includes('Board')) {
      return NextResponse.json(
        {
          error: message,
          message: `❌ SPRINT FETCH FAILED: Check JIRA_BOARD_ID in .env.local - ${message}`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        error: message,
        message: `❌ SPRINT FETCH FAILED: ${message}`,
      },
      { status: 500 }
    );
  }
};
