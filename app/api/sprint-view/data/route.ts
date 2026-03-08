import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, mapToEpic, mapToTicketAutoEpic, mapToSprints } from '@/backend/jira';
import type { JiraEpic, JiraTicket, JiraSprint, OtherTicket } from '@/shared/types';

interface SprintViewDataRequest {
  sprintIds: number[];
  boardId?: number;
}

export interface SprintViewDataResponse {
  epics: JiraEpic[];
  tickets: JiraTicket[];
  sprints: JiraSprint[];
  doneStatuses: string[];
  activeSprints: JiraSprint[];
  otherTickets: OtherTicket[];
}

export const POST = async (request: NextRequest) => {
  try {
    const body: SprintViewDataRequest = await request.json();
    const { sprintIds, boardId } = body;

    if (!sprintIds || sprintIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one sprint ID is required' },
        { status: 400 }
      );
    }

    const client = getJiraClient();
    const fieldConfig = client.getFieldConfig();

    // Fetch done statuses, active sprints, and all sprint tickets in parallel
    const [doneStatuses, activeSprintsResponse, ticketsResponse] = await Promise.all([
      client.getDoneStatuses(boardId),
      client.getSprints('active', boardId),
      client.getSprintTickets(sprintIds),
    ]);
    const activeSprints = mapToSprints(activeSprintsResponse);

    // Map tickets and discover epic keys
    const allTickets: JiraTicket[] = [];
    const epicKeysSet = new Set<string>();

    for (const issue of ticketsResponse.issues) {
      const { ticket, epicKey } = mapToTicketAutoEpic(issue, fieldConfig);
      allTickets.push(ticket);
      if (epicKey) {
        epicKeysSet.add(epicKey);
      }
    }

    // Fetch epic details in parallel
    const epics: JiraEpic[] = [];
    const epicFetches = Array.from(epicKeysSet).map(async (epicKey) => {
      try {
        const epicResponse = await client.getIssue(epicKey);
        return mapToEpic(epicResponse);
      } catch (error) {
        console.error(`Failed to fetch epic ${epicKey}:`, error);
        // Return a fallback epic so tickets aren't orphaned
        return {
          key: epicKey,
          summary: `${epicKey} (could not load)`,
          status: 'Unknown',
          commitType: 'none' as const,
        };
      }
    });

    epics.push(...await Promise.all(epicFetches));

    // Add synthetic "No Epic" group if there are orphan tickets
    const hasOrphanTickets = allTickets.some(t => t.epicKey === '__NO_EPIC__');
    if (hasOrphanTickets) {
      epics.push({
        key: '__NO_EPIC__',
        summary: 'Tickets Without Epic',
        status: 'N/A',
        commitType: 'none',
      });
    }

    // Fetch sprint details
    const sprintsResponse = await client.getSprintsByIds(sprintIds);
    const selectedSprints = mapToSprints(sprintsResponse);

    if (selectedSprints.length === 0) {
      return NextResponse.json(
        {
          error: 'No valid sprints found',
          message: 'None of the selected sprint IDs were found',
        },
        { status: 400 }
      );
    }

    const response: SprintViewDataResponse = {
      epics,
      tickets: allTickets,
      sprints: selectedSprints,
      doneStatuses,
      activeSprints,
      otherTickets: [],
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sprint view data fetch failed:', error);

    return NextResponse.json(
      {
        error: message,
        message: `Data fetch failed: ${message}`,
      },
      { status: 500 }
    );
  }
};
