import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, mapToSprints, mapToTicketAutoEpic } from '@/backend/jira';

interface CapacityRequest {
  boardId: number;
}

export interface CapacityEngineer {
  name: string;
}

export interface CapacityResponse {
  sprintName: string;
  engineers: CapacityEngineer[];
}

export const POST = async (request: NextRequest) => {
  try {
    const body: CapacityRequest = await request.json();
    const { boardId } = body;

    if (!boardId) {
      return NextResponse.json({ error: 'Board ID is required' }, { status: 400 });
    }

    const client = getJiraClient();
    const fieldConfig = client.getFieldConfig();

    // Find the active sprint for this board
    const activeSprintsRaw = await client.getSprints('active', boardId);
    const activeSprints = mapToSprints(activeSprintsRaw);

    if (activeSprints.length === 0) {
      return NextResponse.json({ sprintName: '', engineers: [] });
    }

    const activeSprint = activeSprints[0];

    // Get all stories in the active sprint
    const ticketsResponse = await client.getSprintTickets([activeSprint.id]);

    // Collect unique assignees, sorted alphabetically, excluding unassigned
    const seen = new Set<string>();
    for (const issue of ticketsResponse.issues) {
      const { ticket } = mapToTicketAutoEpic(issue, fieldConfig);
      if (ticket.assignee) seen.add(ticket.assignee);
    }

    const engineers: CapacityEngineer[] = Array.from(seen)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name }));

    const response: CapacityResponse = {
      sprintName: activeSprint.name,
      engineers,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Capacity data fetch failed:', error);
    return NextResponse.json(
      { error: message, message: `Data fetch failed: ${message}` },
      { status: 500 }
    );
  }
};
