import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, mapToTicketAutoEpic, mapToSprints } from '@/backend/jira';
import type { FieldConfig } from '@/backend/jira/mappers';
import type { JiraIssueResponse } from '@/shared/types';

/**
 * Jira built-in field for "Story point estimate" -- used as fallback
 */
const STORY_POINT_ESTIMATE_FIELD = 'story_point_estimate';

const buildFieldConfig = (client: ReturnType<typeof getJiraClient>): FieldConfig => {
  const base = client.getFieldConfig();
  return {
    ...base,
    sprintPointEstimate: base.sprintPointEstimate || STORY_POINT_ESTIMATE_FIELD,
  };
};

interface SprintCheckRequest {
  sprintIds: number[];
  boardId: number;
}

interface SprintInfo {
  id: number;
  name: string;
  startDate: string;
}

interface EngineerSprintPoints {
  engineer: string;
  sprintId: number;
  totalPoints: number;
}

interface CurrentSprintEngineer {
  engineer: string;
  totalPoints: number;
  percentage: number;
}

interface TicketDetail {
  key: string;
  summary: string;
  storyPoints: number;
  status: string;
  engineer: string;
  sprintId: number;
  sprintName: string;
}

interface SprintCheckResponse {
  sprints: SprintInfo[];
  engineers: string[];
  sprintData: EngineerSprintPoints[];
  tickets: TicketDetail[];
  currentSprint: {
    id: number;
    name: string;
    engineers: CurrentSprintEngineer[];
    totalPoints: number;
  } | null;
}

/**
 * Check if a ticket status is canceled/cancelled (case-insensitive)
 */
const isCanceledStatus = (status: string): boolean => {
  const lower = status.toLowerCase();
  return lower === 'canceled' || lower === 'cancelled';
};

/**
 * Compute story points for Sprint Check reporting.
 * HVSD (Service Desk) tickets always count as 0 — they have no story points.
 * Otherwise: story points → estimated story points → 0.
 * (The scheduler defaults unpointed tickets to 5 for planning, but that
 *  inflates Sprint Check reports.)
 */
const computeSprintCheckPoints = (
  issue: JiraIssueResponse,
  ticketKey: string,
  fieldConfig: FieldConfig
): number => {
  if (ticketKey.startsWith('HVSD-')) return 0;

  // Primary story points field
  const storyPts = issue.fields[fieldConfig.devDays];
  if (typeof storyPts === 'number' && storyPts > 0) return storyPts;

  // Fallback: estimated story points (sprint point estimate)
  if (fieldConfig.sprintPointEstimate) {
    const estPts = issue.fields[fieldConfig.sprintPointEstimate];
    if (typeof estPts === 'number' && estPts > 0) return estPts;
  }

  return 0;
};

export const POST = async (request: NextRequest) => {
  try {
    const body: SprintCheckRequest = await request.json();
    const { sprintIds, boardId } = body;

    if (!sprintIds || sprintIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one sprint ID is required' },
        { status: 400 }
      );
    }

    if (!boardId) {
      return NextResponse.json(
        { error: 'Board ID is required' },
        { status: 400 }
      );
    }

    const client = getJiraClient();
    const fieldConfig = buildFieldConfig(client);

    // Fetch sprint details and tickets in parallel
    const [sprintDetails, ticketsResponse, activeSprintsRaw] = await Promise.all([
      client.getSprintsByIds(sprintIds),
      client.getSprintTickets(sprintIds),
      client.getSprints('active', boardId),
    ]);

    console.log(`[Sprint Check] Fetched ${sprintDetails.length} sprints, ${ticketsResponse.issues.length} tickets`);

    // Map and sort sprints by startDate ascending
    const sprints = mapToSprints(sprintDetails)
      .filter((s) => s.startDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    const selectedSprintIdSet = new Set(sprintIds);

    // Build sprint name lookup
    const sprintNameMap = new Map<number, string>();
    for (const s of sprints) {
      sprintNameMap.set(s.id, s.name);
    }

    // Map tickets and aggregate per-sprint per-engineer
    // Map: sprintId -> engineer -> totalPoints
    const aggregation = new Map<number, Map<string, number>>();
    for (const sid of sprintIds) {
      aggregation.set(sid, new Map());
    }

    const allEngineers = new Set<string>();
    const tickets: TicketDetail[] = [];

    for (const issue of ticketsResponse.issues) {
      const { ticket } = mapToTicketAutoEpic(issue, fieldConfig);

      if (isCanceledStatus(ticket.status)) continue;

      const engineer = ticket.assignee ?? 'Unassigned';
      allEngineers.add(engineer);

      const points = computeSprintCheckPoints(issue, ticket.key, fieldConfig);

      // Attribute to each selected sprint the ticket belongs to
      const ticketSprints = (ticket.sprintIds ?? []).filter((sid) => selectedSprintIdSet.has(sid));
      for (const sid of ticketSprints) {
        const sprintMap = aggregation.get(sid)!;
        sprintMap.set(engineer, (sprintMap.get(engineer) ?? 0) + points);

        tickets.push({
          key: ticket.key,
          summary: ticket.summary,
          storyPoints: points,
          status: ticket.status,
          engineer,
          sprintId: sid,
          sprintName: sprintNameMap.get(sid) ?? `Sprint ${sid}`,
        });
      }
    }

    // Build flat sprintData array
    const sprintData: EngineerSprintPoints[] = [];
    for (const [sprintId, engineerMap] of aggregation) {
      for (const [engineer, totalPoints] of engineerMap) {
        sprintData.push({ engineer, sprintId, totalPoints });
      }
    }

    // Sorted engineers alphabetically (Unassigned last)
    const engineers = Array.from(allEngineers).sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });

    // Current sprint detection
    let currentSprint: SprintCheckResponse['currentSprint'] = null;
    const activeSprints = mapToSprints(activeSprintsRaw);

    if (activeSprints.length > 0) {
      const active = activeSprints[0];
      console.log(`[Sprint Check] Active sprint: ${active.name} (${active.id})`);

      // Check if active sprint data is already in our aggregation
      const isInSelected = selectedSprintIdSet.has(active.id);

      let currentEngineerMap: Map<string, number>;

      if (isInSelected) {
        currentEngineerMap = aggregation.get(active.id) ?? new Map();
      } else {
        // Fetch current sprint tickets separately
        console.log(`[Sprint Check] Active sprint not in selection, fetching separately`);
        const currentTicketsResponse = await client.getSprintTickets([active.id]);
        currentEngineerMap = new Map();

        for (const issue of currentTicketsResponse.issues) {
          const { ticket } = mapToTicketAutoEpic(issue, fieldConfig);
          if (isCanceledStatus(ticket.status)) continue;

          const engineer = ticket.assignee ?? 'Unassigned';
          const pts = computeSprintCheckPoints(issue, ticket.key, fieldConfig);
          currentEngineerMap.set(engineer, (currentEngineerMap.get(engineer) ?? 0) + pts);
        }
      }

      const totalPoints = Array.from(currentEngineerMap.values()).reduce((sum, pts) => sum + pts, 0);

      const currentEngineers: CurrentSprintEngineer[] = Array.from(currentEngineerMap.entries())
        .map(([engineer, pts]) => ({
          engineer,
          totalPoints: pts,
          percentage: totalPoints > 0 ? Math.round((pts / totalPoints) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.totalPoints - a.totalPoints);

      currentSprint = {
        id: active.id,
        name: active.name,
        engineers: currentEngineers,
        totalPoints,
      };
    }

    const response: SprintCheckResponse = {
      sprints: sprints.map((s) => ({ id: s.id, name: s.name, startDate: s.startDate })),
      engineers,
      sprintData,
      tickets,
      currentSprint,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sprint check data fetch failed:', error);

    return NextResponse.json(
      {
        error: message,
        message: `Data fetch failed: ${message}`,
      },
      { status: 500 }
    );
  }
};
