import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, mapToTickets, EXCLUDE_MAINFRAME } from '@/backend/jira';
import type { FieldConfig } from '@/backend/jira/mappers';
import type { JiraTicket } from '@/shared/types';

/**
 * Jira built-in field for "Story point estimate" — used as fallback when the
 * primary story-points field (JIRA_FIELD_DEV_DAYS) has no value.
 */
const STORY_POINT_ESTIMATE_FIELD = 'story_point_estimate';

/**
 * Build a field config that always falls back to story_point_estimate.
 * If JIRA_FIELD_SPRINT_POINT_ESTIMATE is already configured, keep it;
 * otherwise inject the Jira built-in field.
 */
const buildFieldConfig = (client: ReturnType<typeof getJiraClient>): FieldConfig => {
  const base = client.getFieldConfig();
  return {
    ...base,
    sprintPointEstimate: base.sprintPointEstimate || STORY_POINT_ESTIMATE_FIELD,
  };
};

interface PiSprintAssignment {
  piLabel: string;
  sprintIds: number[];
}

interface CapacityDemandRequest {
  projectKey: string;
  piLabels: string[];
  piSprints?: PiSprintAssignment[];
  boardId?: number;
}

interface EpicDemand {
  key: string;
  summary: string;
  totalPoints: number;
  isStretch: boolean;
}

interface PIDemand {
  label: string;
  epics: EpicDemand[];
}

export interface CapacityDemandResponse {
  piData: PIDemand[];
}

/**
 * Parse PI labels to a chronological sort key: PIx_YYYY → year * 4 + quarter
 */
const piSortKey = (label: string): number => {
  const match = label.match(/^PI(\d)_(\d{4})$/);
  if (!match) return 0;
  return parseInt(match[2], 10) * 4 + parseInt(match[1], 10);
};

/**
 * Post-process stretch labels: if an epic appears in multiple PIs and has
 * the Stretch label, only treat it as stretch in the chronologically LAST PI.
 */
const postProcessStretch = (piData: PIDemand[]): void => {
  const epicLastPI = new Map<string, string>();
  const sortedPIs = [...piData].sort((a, b) => piSortKey(a.label) - piSortKey(b.label));
  for (const pi of sortedPIs) {
    for (const epic of pi.epics) {
      epicLastPI.set(epic.key, pi.label);
    }
  }
  for (const pi of piData) {
    for (const epic of pi.epics) {
      if (epic.isStretch && epicLastPI.get(epic.key) !== pi.label) {
        epic.isStretch = false;
      }
    }
  }
};

/**
 * Check if a ticket status is canceled/cancelled (case-insensitive)
 */
const isCanceledStatus = (status: string): boolean => {
  const lower = status.toLowerCase();
  return lower === 'canceled' || lower === 'cancelled';
};

/**
 * Shared logic: find epics for a PI label, returning their keys, summaries, and stretch flags.
 */
const findEpicsForPI = async (
  label: string,
  projectKey: string,
  client: ReturnType<typeof getJiraClient>
): Promise<{ key: string; summary: string; isStretch: boolean }[]> => {
  const jql = `labels = "${label}" AND ${EXCLUDE_MAINFRAME} AND project = ${projectKey} AND status != "Canceled" ORDER BY key ASC`;
  console.log(`[Capacity/Demand] Searching: ${jql}`);
  const epicsResponse = await client.searchAllIssues(jql, ['issuetype']);
  console.log(`[Capacity/Demand] Label "${label}": found ${epicsResponse.issues.length} issues`);

  const results: { key: string; summary: string; isStretch: boolean }[] = [];

  for (const epicIssue of epicsResponse.issues) {
    const issueTypeField = epicIssue.fields['issuetype'] as { name: string } | undefined;
    const issueTypeName = issueTypeField?.name ?? 'Unknown';

    console.log(`[Capacity/Demand]   Found: ${epicIssue.key} (type: ${issueTypeName}) - ${epicIssue.fields.summary}, labels: ${(epicIssue.fields.labels ?? []).join(', ')}`);

    if (issueTypeName !== 'Unknown' && issueTypeName.toLowerCase() !== 'epic') {
      console.log(`[Capacity/Demand]   Skipping ${epicIssue.key}: not an Epic (type: ${issueTypeName})`);
      continue;
    }

    const epicStatus = epicIssue.fields.status.name.toLowerCase();
    if (epicStatus === 'canceled' || epicStatus === 'cancelled') {
      console.log(`[Capacity/Demand]   Skipping ${epicIssue.key}: status is ${epicIssue.fields.status.name}`);
      continue;
    }

    const labels = epicIssue.fields.labels ?? [];
    const isStretch = labels.some((l: string) => l.toLowerCase() === 'stretch');

    results.push({ key: epicIssue.key, summary: epicIssue.fields.summary, isStretch });
  }

  return results;
};

/**
 * Standard algorithm: sum all child tickets per epic.
 * When boardSprintIds is provided, only count tickets in those sprints.
 * Used when piSprints is not provided — no per-PI sprint filtering.
 */
const processWithoutSprints = async (
  piLabels: string[],
  projectKey: string,
  client: ReturnType<typeof getJiraClient>,
  boardSprintIds?: Set<number>
): Promise<PIDemand[]> => {
  const fieldConfig = buildFieldConfig(client);

  const piDataPromises = piLabels.map(async (label): Promise<PIDemand> => {
    const epics = await findEpicsForPI(label, projectKey, client);
    const epicDemands: EpicDemand[] = [];

    for (const epic of epics) {
      try {
        const jql = `("Epic Link" = ${epic.key} OR parent = ${epic.key}) AND ${EXCLUDE_MAINFRAME} ORDER BY key ASC`;
        const ticketsResponse = await client.searchAllIssues(jql, [STORY_POINT_ESTIMATE_FIELD]);
        const tickets = mapToTickets(ticketsResponse.issues, epic.key, fieldConfig);

        const filteredTickets = boardSprintIds
          ? tickets.filter((t) => (t.sprintIds ?? []).some((sid) => boardSprintIds.has(sid)))
          : tickets;

        const totalPoints = filteredTickets.reduce((sum, t) => sum + t.devDays, 0);

        epicDemands.push({
          key: epic.key,
          summary: epic.summary,
          totalPoints,
          isStretch: epic.isStretch,
        });
      } catch (error) {
        console.error(`Failed to fetch tickets for epic ${epic.key}:`, error);
        epicDemands.push({
          key: epic.key,
          summary: `${epic.summary} (failed to load tickets)`,
          totalPoints: 0,
          isStretch: epic.isStretch,
        });
      }
    }

    return { label, epics: epicDemands };
  });

  return Promise.all(piDataPromises);
};

/**
 * Sprint-filtered algorithm: only count non-canceled stories assigned to
 * a sprint within that PI. A story in sprints for multiple PIs counts in each.
 * When boardSprintIds is provided, additionally filter to only board sprints.
 */
const processWithSprints = async (
  piLabels: string[],
  projectKey: string,
  piSprints: PiSprintAssignment[],
  client: ReturnType<typeof getJiraClient>,
  boardSprintIds?: Set<number>
): Promise<PIDemand[]> => {
  const fieldConfig = buildFieldConfig(client);

  // Phase 1: Build sprint metadata maps
  const piSprintMap = new Map<string, Set<number>>(); // piLabel → set of sprint IDs

  for (const ps of piSprints) {
    piSprintMap.set(ps.piLabel, new Set(ps.sprintIds));
  }

  // Phase 2: Find epics per PI and fetch all child tickets
  const piEpicInfo = new Map<string, { key: string; summary: string; isStretch: boolean }[]>();
  const allEpicKeys = new Set<string>();

  for (const label of piLabels) {
    const epics = await findEpicsForPI(label, projectKey, client);
    piEpicInfo.set(label, epics);
    for (const e of epics) {
      allEpicKeys.add(e.key);
    }
  }

  // Fetch child tickets for each unique epic (parallel)
  const epicTicketsMap = new Map<string, JiraTicket[]>();

  const ticketFetchPromises = Array.from(allEpicKeys).map(async (epicKey) => {
    try {
      const jql = `("Epic Link" = ${epicKey} OR parent = ${epicKey}) AND ${EXCLUDE_MAINFRAME} ORDER BY key ASC`;
      const response = await client.searchAllIssues(jql, [STORY_POINT_ESTIMATE_FIELD]);
      const tickets = mapToTickets(response.issues, epicKey, fieldConfig);
      epicTicketsMap.set(epicKey, tickets);
    } catch (error) {
      console.error(`Failed to fetch tickets for epic ${epicKey}:`, error);
      epicTicketsMap.set(epicKey, []);
    }
  });

  await Promise.all(ticketFetchPromises);

  // Phase 3: Sum points per PI per epic.
  // A ticket counts toward a PI if it is in at least one of that PI's sprints.
  const piData: PIDemand[] = piLabels.map((label) => {
    const epics = piEpicInfo.get(label) ?? [];
    const piSprintIds = piSprintMap.get(label) ?? new Set<number>();

    const epicDemands: EpicDemand[] = epics.map((epic) => {
      const tickets = epicTicketsMap.get(epic.key) ?? [];

      const totalPoints = tickets.reduce((sum, ticket) => {
        if (isCanceledStatus(ticket.status)) return sum;

        const ticketSprints = boardSprintIds
          ? (ticket.sprintIds ?? []).filter((sid) => boardSprintIds.has(sid))
          : (ticket.sprintIds ?? []);

        // Count this ticket only if it's in a sprint assigned to this PI
        const inThisPi = ticketSprints.some((sid) => piSprintIds.has(sid));
        return inThisPi ? sum + ticket.devDays : sum;
      }, 0);

      return {
        key: epic.key,
        summary: epic.summary,
        totalPoints,
        isStretch: epic.isStretch,
      };
    });

    return { label, epics: epicDemands };
  });

  return piData;
};

export const POST = async (request: NextRequest) => {
  try {
    const body: CapacityDemandRequest = await request.json();
    const { projectKey, piLabels, piSprints, boardId } = body;

    if (!projectKey) {
      return NextResponse.json(
        { error: 'Project key is required' },
        { status: 400 }
      );
    }

    if (!piLabels || piLabels.length === 0) {
      return NextResponse.json(
        { error: 'At least one PI label is required' },
        { status: 400 }
      );
    }

    const client = getJiraClient();

    // If a board is selected, fetch all sprint IDs for that board to filter stories
    let boardSprintIds: Set<number> | undefined;
    if (boardId) {
      console.log(`[Capacity/Demand] Board ${boardId} selected — fetching board sprints for filtering`);
      const boardSprints = await client.getSprints(undefined, boardId);
      boardSprintIds = new Set(boardSprints.map((s) => s.id));
      console.log(`[Capacity/Demand] Board has ${boardSprintIds.size} sprints`);
    }

    // Determine if sprint-filtered mode is active
    const hasSprintAssignments = piSprints && piSprints.some((ps) => ps.sprintIds.length > 0);

    let piData: PIDemand[];
    if (hasSprintAssignments) {
      console.log('[Capacity/Demand] Sprint-filtered mode active');
      piData = await processWithSprints(piLabels, projectKey, piSprints!, client, boardSprintIds);
    } else {
      console.log('[Capacity/Demand] Standard mode (no sprint filtering)');
      piData = await processWithoutSprints(piLabels, projectKey, client, boardSprintIds);
    }

    // Post-process stretch labels (applies to both modes)
    postProcessStretch(piData);

    // When board filtering is active, remove epics with 0 total points
    // (their stories are not in any sprint on the selected board)
    if (boardSprintIds) {
      for (const pi of piData) {
        pi.epics = pi.epics.filter((e) => e.totalPoints > 0);
      }
    }

    const response: CapacityDemandResponse = { piData };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Capacity demand data fetch failed:', error);

    return NextResponse.json(
      {
        error: message,
        message: `Data fetch failed: ${message}`,
      },
      { status: 500 }
    );
  }
};
