import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, mapToTickets, EXCLUDE_MAINFRAME, EXCLUDE_SUPPORT } from '@/backend/jira';
import type { FieldConfig } from '@/backend/jira/mappers';
import type { JiraTicket } from '@/shared/types';
import { buildSprintDateMap, getLatestSprintId } from '@/shared/utils/sprints';
import type { SprintDateRange } from '@/shared/utils/sprints';

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
  showAllWork?: boolean;
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
  const epicsResponse = await client.searchAllIssues(jql, ['issuetype']);

  const results: { key: string; summary: string; isStretch: boolean }[] = [];

  for (const epicIssue of epicsResponse.issues) {
    const issueTypeField = epicIssue.fields['issuetype'] as { name: string } | undefined;
    const issueTypeName = issueTypeField?.name ?? 'Unknown';

    if (issueTypeName !== 'Unknown' && issueTypeName.toLowerCase() !== 'epic') {
      continue;
    }

    const epicStatus = epicIssue.fields.status.name.toLowerCase();
    if (epicStatus === 'canceled' || epicStatus === 'cancelled') {
      continue;
    }

    const labels = epicIssue.fields.labels ?? [];
    const isStretch = labels.some((l: string) => l.toLowerCase() === 'stretch');

    results.push({ key: epicIssue.key, summary: epicIssue.fields.summary, isStretch });
  }

  return results;
};

/**
 * Show-All-Work mode: find all epics that have at least one story in the
 * given sprint IDs, regardless of whether the epic has the PI label.
 * isStretch is set only when the epic also carries the PI label + Stretch label.
 */
const findAllEpicsForPIBySprints = async (
  label: string,
  projectKey: string,
  piSprintIds: Set<number>,
  client: ReturnType<typeof getJiraClient>
): Promise<{ key: string; summary: string; isStretch: boolean }[]> => {
  if (piSprintIds.size === 0) return [];

  const sprintList = Array.from(piSprintIds).join(',');
  const jql = `sprint in (${sprintList}) AND ${EXCLUDE_MAINFRAME} AND project = ${projectKey} AND issuetype not in (Epic) AND status not in (Canceled, Cancelled)`;
  const storiesResponse = await client.searchAllIssues(jql, ['parent']);

  const epicKeys = new Set<string>();
  for (const issue of storiesResponse.issues) {
    const parent = issue.fields['parent'] as { key: string } | undefined;
    if (parent?.key) epicKeys.add(parent.key);
  }

  if (epicKeys.size === 0) return [];

  const epicJql = `key in (${Array.from(epicKeys).join(',')}) AND issuetype = Epic AND status not in (Canceled, Cancelled) AND project = ${projectKey}`;
  const epicsResponse = await client.searchAllIssues(epicJql, ['labels']);

  return epicsResponse.issues.map((epic) => {
    const epicLabels: string[] = epic.fields.labels ?? [];
    const hasLabel = epicLabels.includes(label);
    const isStretch = hasLabel && epicLabels.some((l: string) => l.toLowerCase() === 'stretch');
    return { key: epic.key, summary: epic.fields.summary, isStretch };
  });
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
        const jql = `("Epic Link" = ${epic.key} OR parent = ${epic.key}) AND ${EXCLUDE_MAINFRAME} AND ${EXCLUDE_SUPPORT} ORDER BY key ASC`;
        const ticketsResponse = await client.searchAllIssues(jql, [STORY_POINT_ESTIMATE_FIELD]);
        const tickets = mapToTickets(ticketsResponse.issues, epic.key, fieldConfig);

        const filteredTickets = tickets.filter((t) => {
          if (boardSprintIds) return (t.sprintIds ?? []).some((sid) => boardSprintIds.has(sid));
          return true;
        });

        const totalPoints = filteredTickets.reduce((sum, t) => sum + (t.isMissingEstimate ? 0 : t.devDays), 0);

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
 * Sprint-filtered algorithm: count only completed stories whose resolution date
 * falls within the date range of a sprint belonging to that PI.
 */
const processWithSprints = async (
  piLabels: string[],
  projectKey: string,
  piSprints: PiSprintAssignment[],
  client: ReturnType<typeof getJiraClient>,
  sprintDateMap: Map<number, SprintDateRange>,
  boardSprintIds?: Set<number>,
  showAllWork?: boolean,
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
    const piSprintIds = piSprintMap.get(label) ?? new Set<number>();
    const epics = (showAllWork && piSprintIds.size > 0)
      ? await findAllEpicsForPIBySprints(label, projectKey, piSprintIds, client)
      : await findEpicsForPI(label, projectKey, client);
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
  // A story counts toward a PI only if it is completed and its latest sprint
  // (by start date) belongs to that PI.
  const piData: PIDemand[] = piLabels.map((label) => {
    const epics = piEpicInfo.get(label) ?? [];
    const piSprintIds = piSprintMap.get(label) ?? new Set<number>();

    const epicDemands: EpicDemand[] = epics.map((epic) => {
      const tickets = epicTicketsMap.get(epic.key) ?? [];

      const totalPoints = tickets.reduce((sum, ticket) => {
        const latestSprintId = getLatestSprintId(ticket.sprintIds ?? [], sprintDateMap);
        const inThisPi = latestSprintId !== null && piSprintIds.has(latestSprintId);
        return inThisPi ? sum + (ticket.isMissingEstimate ? 0 : ticket.devDays) : sum;
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
    const { projectKey, piLabels, piSprints, boardId, showAllWork } = body;

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

    // If a board is selected, fetch all sprint IDs and date ranges for that board
    let boardSprintIds: Set<number> | undefined;
    let sprintDateMap: Map<number, SprintDateRange> = new Map();

    if (boardId) {
      const boardSprints = await client.getSprints(undefined, boardId);
      boardSprintIds = new Set(boardSprints.map((s) => s.id));
      sprintDateMap = buildSprintDateMap(boardSprints);
    }

    // Ensure date ranges are available for any PI sprints not covered by the board fetch
    if (piSprints && piSprints.some((ps) => ps.sprintIds.length > 0)) {
      const allPiSprintIds = piSprints.flatMap((ps) => ps.sprintIds);
      const missingIds = allPiSprintIds.filter((id) => !sprintDateMap.has(id));
      if (missingIds.length > 0) {
        const fetched = await client.getSprintsByIds(missingIds);
        const fetchedMap = buildSprintDateMap(fetched);
        fetchedMap.forEach((range, id) => sprintDateMap.set(id, range));
      }
    }

    // Determine if sprint-filtered mode is active
    const hasSprintAssignments = piSprints && piSprints.some((ps) => ps.sprintIds.length > 0);

    let piData: PIDemand[];
    if (hasSprintAssignments) {
      piData = await processWithSprints(piLabels, projectKey, piSprints!, client, sprintDateMap, boardSprintIds, showAllWork);
    } else {
      piData = await processWithoutSprints(piLabels, projectKey, client, boardSprintIds);
    }

    // Sort PI columns chronologically: by year then by PI number (PI1–PI4)
    piData.sort((a, b) => piSortKey(a.label) - piSortKey(b.label));

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
