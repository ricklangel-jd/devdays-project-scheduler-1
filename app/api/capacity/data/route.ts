import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, mapToSprints, mapToTicketAutoEpic } from '@/backend/jira';

interface CapacityRequest {
  boardId: number;
  sprintId?: number; // if provided, fetch engineers for this specific sprint instead of the active one
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
    const { boardId, sprintId } = body;

    if (!boardId) {
      return NextResponse.json({ error: 'Board ID is required' }, { status: 400 });
    }

    const client = getJiraClient();
    const fieldConfig = client.getFieldConfig();

    let targetSprintId: number;
    let targetSprintName: string;

    if (sprintId) {
      // Fetch the specific sprint by ID
      const allSprintsRaw = await client.getSprints('active,closed,future', boardId);
      const allSprints = mapToSprints(allSprintsRaw);
      const match = allSprints.find((s) => s.id === sprintId);
      if (!match) {
        return NextResponse.json({ sprintName: '', engineers: [] });
      }
      targetSprintId = match.id;
      targetSprintName = match.name;
    } else {
      // Fall back to the active sprint (original behaviour)
      const activeSprintsRaw = await client.getSprints('active', boardId);
      const activeSprints = mapToSprints(activeSprintsRaw);
      if (activeSprints.length === 0) {
        return NextResponse.json({ sprintName: '', engineers: [] });
      }
      targetSprintId = activeSprints[0].id;
      targetSprintName = activeSprints[0].name;
    }

    // Get all stories in the target sprint
    const ticketsResponse = await client.getSprintTickets([targetSprintId]);

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
      sprintName: targetSprintName,
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
