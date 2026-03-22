import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, mapToTicketAutoEpic, EXCLUDE_MAINFRAME } from '@/backend/jira';
import type { FieldConfig } from '@/backend/jira/mappers';
import type { JiraTicket } from '@/shared/types';

/**
 * Jira built-in field for "Story point estimate" — used as fallback when the
 * primary story-points field (JIRA_FIELD_DEV_DAYS) has no value.
 */
const STORY_POINT_ESTIMATE_FIELD = 'story_point_estimate';

/**
 * Build a field config that always falls back to story_point_estimate.
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

interface AllWorkRequest {
  projectKey: string;
  piLabels: string[];
  piSprints: PiSprintAssignment[];
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

export interface AllWorkResponse {
  piData: PIDemand[];
}

/** Sentinel key for stories with no parent epic */
const NO_EPIC_KEY = '__NO_EPIC__';

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
      if (epic.key === NO_EPIC_KEY) continue;
      epicLastPI.set(epic.key, pi.label);
    }
  }
  for (const pi of piData) {
    for (const epic of pi.epics) {
      if (epic.key === NO_EPIC_KEY) continue;
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

export const POST = async (request: NextRequest) => {
  try {
    const body: AllWorkRequest = await request.json();
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

    if (!piSprints || !piSprints.some((ps) => ps.sprintIds.length > 0)) {
      return NextResponse.json(
        { error: 'Sprint assignments are required for All Work' },
        { status: 400 }
      );
    }

    const client = getJiraClient();
    const fieldConfig = buildFieldConfig(client);

    // If a board is selected, fetch all sprint IDs for that board to filter stories
    let boardSprintIds: Set<number> | undefined;
    if (boardId) {
      console.log(`[AllWork] Board ${boardId} selected — fetching board sprints for filtering`);
      const boardSprints = await client.getSprints(undefined, boardId);
      boardSprintIds = new Set(boardSprints.map((s) => s.id));
      console.log(`[AllWork] Board has ${boardSprintIds.size} sprints`);
    }

    // Phase 1: Build sprint metadata maps
    const allSprintIds = new Set<number>();
    const piSprintMap = new Map<string, Set<number>>(); // piLabel → set of sprint IDs

    for (const ps of piSprints) {
      const sprintSet = new Set(ps.sprintIds);
      piSprintMap.set(ps.piLabel, sprintSet);
      for (const id of ps.sprintIds) {
        allSprintIds.add(id);
      }
    }

    // Fetch sprint details for start dates (used for multi-sprint dedup)
    const sprintStartDateMap = new Map<number, string>(); // sprintId → ISO start date
    if (allSprintIds.size > 0) {
      console.log(`[AllWork] Fetching ${allSprintIds.size} sprint details for deduplication`);
      const sprintDetails = await client.getSprintsByIds(Array.from(allSprintIds));
      for (const sprint of sprintDetails) {
        sprintStartDateMap.set(sprint.id, sprint.startDate ?? '');
      }
    }

    // Phase 2: For each PI, query ALL stories/service tickets in the assigned sprints
    const piTicketsMap = new Map<string, JiraTicket[]>(); // piLabel → tickets

    for (const ps of piSprints) {
      if (ps.sprintIds.length === 0) continue;

      const sprintIdsList = ps.sprintIds.join(',');
      const jql = `project = ${projectKey} AND sprint in (${sprintIdsList}) AND issuetype in (Story, "Service Ticket") AND ${EXCLUDE_MAINFRAME} AND status != "Canceled" ORDER BY key ASC`;
      console.log(`[AllWork] PI "${ps.piLabel}": ${jql}`);

      const response = await client.searchAllIssues(jql, [STORY_POINT_ESTIMATE_FIELD]);
      console.log(`[AllWork] PI "${ps.piLabel}": found ${response.issues.length} issues`);

      const tickets: JiraTicket[] = [];
      for (const issue of response.issues) {
        const { ticket } = mapToTicketAutoEpic(issue, fieldConfig);

        // Skip canceled tickets (double-check)
        if (isCanceledStatus(ticket.status)) continue;

        // If board filtering is active, only include tickets in the board's sprints
        if (boardSprintIds) {
          const hasMatchingSprint = (ticket.sprintIds ?? []).some((sid) => boardSprintIds!.has(sid));
          if (!hasMatchingSprint) continue;
        }

        tickets.push(ticket);
      }

      piTicketsMap.set(ps.piLabel, tickets);
    }

    // Phase 3: Multi-sprint deduplication
    // For each ticket, determine which PI "owns" it based on the latest sprint (by start date)
    const ticketOwnerPi = new Map<string, { piLabel: string; latestDate: string }>();

    for (const [piLabel, sprintIds] of piSprintMap.entries()) {
      const tickets = piTicketsMap.get(piLabel) ?? [];

      for (const ticket of tickets) {
        // Find intersection of ticket's sprints with THIS PI's sprints
        const ticketSprints = boardSprintIds
          ? (ticket.sprintIds ?? []).filter((sid) => boardSprintIds!.has(sid))
          : (ticket.sprintIds ?? []);
        const matchingSprints = ticketSprints.filter((sid) => sprintIds.has(sid));
        if (matchingSprints.length === 0) continue;

        // Find the latest sprint start date among matching sprints
        let latestDate = '';
        for (const sid of matchingSprints) {
          const startDate = sprintStartDateMap.get(sid) ?? '';
          if (startDate > latestDate) {
            latestDate = startDate;
          }
        }

        // Check if this PI should own this ticket (latest sprint wins)
        const existing = ticketOwnerPi.get(ticket.key);
        if (!existing || latestDate > existing.latestDate) {
          ticketOwnerPi.set(ticket.key, { piLabel, latestDate });
        }
      }
    }

    console.log(`[AllWork] Sprint dedup: ${ticketOwnerPi.size} tickets assigned to PIs`);

    // Phase 4: Group tickets by epic within each PI
    // Collect all unique epic keys (excluding __NO_EPIC__) for summary/stretch lookup
    const allEpicKeys = new Set<string>();

    for (const [piLabel] of piTicketsMap.entries()) {
      const tickets = piTicketsMap.get(piLabel) ?? [];
      for (const ticket of tickets) {
        const owner = ticketOwnerPi.get(ticket.key);
        if (owner && owner.piLabel === piLabel && ticket.epicKey !== NO_EPIC_KEY) {
          allEpicKeys.add(ticket.epicKey);
        }
      }
    }

    // Batch fetch epic details (summary + stretch label)
    const epicInfoMap = new Map<string, { summary: string; isStretch: boolean }>();

    if (allEpicKeys.size > 0) {
      console.log(`[AllWork] Fetching details for ${allEpicKeys.size} unique epics`);
      const epicFetchPromises = Array.from(allEpicKeys).map(async (epicKey) => {
        try {
          const epicIssue = await client.getIssue(epicKey);
          const labels = epicIssue.fields.labels ?? [];
          const isStretch = labels.some((l: string) => l.toLowerCase() === 'stretch');
          epicInfoMap.set(epicKey, {
            summary: epicIssue.fields.summary,
            isStretch,
          });
        } catch (error) {
          console.error(`[AllWork] Failed to fetch epic ${epicKey}:`, error);
          epicInfoMap.set(epicKey, {
            summary: `${epicKey} (failed to load)`,
            isStretch: false,
          });
        }
      });
      await Promise.all(epicFetchPromises);
    }

    // Phase 5: Build PIDemand[] — group tickets by epic and sum points
    const piData: PIDemand[] = piLabels.map((label) => {
      const tickets = piTicketsMap.get(label) ?? [];

      // Group by epicKey, only counting tickets owned by this PI
      const epicGroups = new Map<string, number>(); // epicKey → totalPoints

      for (const ticket of tickets) {
        const owner = ticketOwnerPi.get(ticket.key);
        if (!owner || owner.piLabel !== label) continue;

        const currentTotal = epicGroups.get(ticket.epicKey) ?? 0;
        epicGroups.set(ticket.epicKey, currentTotal + ticket.devDays);
      }

      // Convert groups to EpicDemand[]
      const epics: EpicDemand[] = [];

      for (const [epicKey, totalPoints] of epicGroups.entries()) {
        if (totalPoints === 0) continue;

        if (epicKey === NO_EPIC_KEY) {
          epics.push({
            key: NO_EPIC_KEY,
            summary: 'No Epic',
            totalPoints,
            isStretch: false,
          });
        } else {
          const info = epicInfoMap.get(epicKey);
          epics.push({
            key: epicKey,
            summary: info?.summary ?? epicKey,
            totalPoints,
            isStretch: info?.isStretch ?? false,
          });
        }
      }

      // Sort: real epics by key, __NO_EPIC__ at end
      epics.sort((a, b) => {
        if (a.key === NO_EPIC_KEY) return 1;
        if (b.key === NO_EPIC_KEY) return -1;
        return a.key.localeCompare(b.key);
      });

      return { label, epics };
    });

    // Sort PI columns chronologically: by year then by PI number (PI1–PI4)
    piData.sort((a, b) => piSortKey(a.label) - piSortKey(b.label));

    // Post-process stretch labels
    postProcessStretch(piData);

    const response: AllWorkResponse = { piData };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('All Work data fetch failed:', error);

    return NextResponse.json(
      {
        error: message,
        message: `Data fetch failed: ${message}`,
      },
      { status: 500 }
    );
  }
};
