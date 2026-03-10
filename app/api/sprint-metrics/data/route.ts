import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, EXCLUDE_MAINFRAME, mapToTicketAutoEpic, mapToSprints } from '@/backend/jira';
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

// ── Request / Response types ──────────────────────────────────────────

interface SprintMetricsRequest {
  selections: { projectKey: string; boardId: number }[];
  sprintsBack: number;
}

interface SprintMetricsRow {
  projectKey: string;
  sprintName: string;
  startDate: string;
  endDate: string;
  day1Points: number;
  resolvedPoints: number;
  lastDayPoints: number;
}

interface SprintMetricsGrid {
  offset: number;   // 0 = current, -1 = previous, etc.
  label: string;
  rows: SprintMetricsRow[];
}

interface SprintMetricsResponse {
  grids: SprintMetricsGrid[];
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Check if a ticket status is canceled/cancelled (case-insensitive)
 */
const isCanceledStatus = (status: string): boolean => {
  const lower = status.toLowerCase();
  return lower === 'canceled' || lower === 'cancelled';
};

/**
 * Compute story points for metrics reporting.
 * HVSD tickets = 0. Otherwise: devDays → fallback → 0.
 */
const computePoints = (
  issue: JiraIssueResponse,
  ticketKey: string,
  fieldConfig: FieldConfig
): number => {
  if (ticketKey.startsWith('HVSD-')) return 0;

  const storyPts = issue.fields[fieldConfig.devDays];
  if (typeof storyPts === 'number' && storyPts > 0) return storyPts;

  if (fieldConfig.sprintPointEstimate) {
    const estPts = issue.fields[fieldConfig.sprintPointEstimate];
    if (typeof estPts === 'number' && estPts > 0) return estPts;
  }

  return 0;
};

// ── POST handler ──────────────────────────────────────────────────────

export const POST = async (request: NextRequest) => {
  try {
    const body: SprintMetricsRequest = await request.json();
    const { selections, sprintsBack } = body;

    if (!selections || selections.length === 0) {
      return NextResponse.json(
        { error: 'At least one project+board selection is required' },
        { status: 400 }
      );
    }

    if (typeof sprintsBack !== 'number' || sprintsBack < 0) {
      return NextResponse.json(
        { error: 'sprintsBack must be a non-negative number' },
        { status: 400 }
      );
    }

    const client = getJiraClient();
    const fieldConfig = buildFieldConfig(client);

    // Cache done statuses per board (many projects may share a board)
    const doneStatusesCache = new Map<number, string[]>();
    const getDoneStatusesCached = async (boardId: number): Promise<string[]> => {
      if (!doneStatusesCache.has(boardId)) {
        doneStatusesCache.set(boardId, await client.getDoneStatuses(boardId));
      }
      return doneStatusesCache.get(boardId)!;
    };

    // ── Per-selection: find sprints, compute metrics ──────────────────

    // Each selection yields: { offset → SprintMetricsRow }
    type SelectionResult = Map<number, SprintMetricsRow>;

    const selectionPromises = selections.map(async ({ projectKey, boardId }): Promise<SelectionResult> => {
      const result: SelectionResult = new Map();

      // 1. Fetch all active + closed sprints for this board
      const allSprints = await client.getSprints('active,closed', boardId);
      const mapped = mapToSprints(allSprints);

      // 2. Filter sprints belonging to this project (sprint name starts with project key)
      const projectSprints = mapped
        .filter((s) => s.name.startsWith(`${projectKey} `))
        .filter((s) => s.startDate)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

      if (projectSprints.length === 0) return result;

      // 3. Find the active sprint (last one with state "active") or most recent closed
      const activeSprint = projectSprints.find((s) =>
        allSprints.find((raw) => raw.id === s.id && raw.state === 'active')
      );
      const latestSprint = activeSprint ?? projectSprints[projectSprints.length - 1];

      // 4. Collect sprints: offset 0 = latest, then N closed before it
      const latestIdx = projectSprints.indexOf(latestSprint);
      const sprintsToProcess: { sprint: typeof latestSprint; offset: number }[] = [];

      // Offset 0 = current/latest sprint
      sprintsToProcess.push({ sprint: latestSprint, offset: 0 });

      // Historical sprints (offsets -1, -2, ...)
      for (let i = 1; i <= sprintsBack; i++) {
        const idx = latestIdx - i;
        if (idx < 0) break;
        sprintsToProcess.push({ sprint: projectSprints[idx], offset: -i });
      }

      // 5. Get done statuses for this board
      const doneStatuses = await getDoneStatusesCached(boardId);
      const doneStatusSet = new Set(doneStatuses.map((s) => s.toLowerCase()));

      // 6. Process each sprint in parallel
      await Promise.all(
        sprintsToProcess.map(async ({ sprint, offset }) => {
          // Fetch issues via JQL (uses app's standard point calculation)
          const jql = `sprint = ${sprint.id} AND project = "${projectKey}" AND issuetype in (Story, Task, "Service Ticket") AND ${EXCLUDE_MAINFRAME}`;
          const [issuesResponse, sprintReport] = await Promise.all([
            client.searchAllIssues(jql),
            client.getSprintReport(boardId, sprint.id),
          ]);

          const addedKeys = new Set(
            Object.keys(sprintReport.contents.issueKeysAddedDuringSprint ?? {})
          );

          let day1Points = 0;
          let resolvedPoints = 0;
          let lastDayPoints = 0;

          for (const issue of issuesResponse.issues) {
            const { ticket } = mapToTicketAutoEpic(issue, fieldConfig);

            if (isCanceledStatus(ticket.status)) continue;

            const points = computePoints(issue, ticket.key, fieldConfig);

            // Last day = all non-canceled
            lastDayPoints += points;

            // Day 1 = not added mid-sprint
            if (!addedKeys.has(ticket.key)) {
              day1Points += points;
            }

            // Resolved = in a done status
            if (doneStatusSet.has(ticket.status.toLowerCase())) {
              resolvedPoints += points;
            }
          }

          result.set(offset, {
            projectKey,
            sprintName: sprint.name,
            startDate: sprint.startDate,
            endDate: sprint.endDate ?? '',
            day1Points,
            resolvedPoints,
            lastDayPoints,
          });
        })
      );

      return result;
    });

    const selectionResults = await Promise.all(selectionPromises);

    // ── Assemble grids by offset ──────────────────────────────────────

    const offsets = [0, ...Array.from({ length: sprintsBack }, (_, i) => -(i + 1))];
    const grids: SprintMetricsGrid[] = [];

    for (const offset of offsets) {
      const rows: SprintMetricsRow[] = [];

      for (const selResult of selectionResults) {
        const row = selResult.get(offset);
        if (row) rows.push(row);
      }

      if (rows.length === 0) continue;

      const label =
        offset === 0
          ? 'Current Sprint'
          : `${Math.abs(offset)} Sprint${Math.abs(offset) > 1 ? 's' : ''} Back`;

      grids.push({ offset, label, rows });
    }

    const response: SprintMetricsResponse = { grids };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sprint metrics data fetch failed:', error);

    return NextResponse.json(
      {
        error: message,
        message: `Data fetch failed: ${message}`,
      },
      { status: 500 }
    );
  }
};
