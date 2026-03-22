import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, EXCLUDE_MAINFRAME, mapToTicketAutoEpic, mapToSprints } from '@/backend/jira';
import type { JiraClient } from '@/backend/jira/client';
import type { FieldConfig } from '@/backend/jira/mappers';
import type { JiraIssueResponse } from '@/shared/types';
import { deserializeCapacity, computeTotalCapacity, countNonTechLeadEngineers, computeEngineerCapacity } from '@/shared/lib/capacity';
import type { EngineerRow } from '@/shared/lib/capacity';

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
  selections: { projectKey: string; boardId: number; projectName?: string }[];
  sprintsBack: number;
}

interface EngOutputRow {
  name: string;
  capacity: number;      // per-engineer capacity with support-pct applied
  resolvedPoints: number;
}

interface SprintMetricsIssue {
  key: string;
  summary: string;
  sprintName: string;
  points: number;
  categories: string[];  // 'day1' | 'resolved' | 'lastDay' | 'scopeChange' | 'carryover' | 'serviceDesk'
}

interface SprintMetricsRow {
  projectKey: string;
  projectName: string;
  sprintName: string;
  startDate: string;
  endDate: string;
  day1Points: number;
  day1AllPointed: boolean;
  resolvedPoints: number;
  lastDayPoints: number;
  scopeChangeInPoints: number;
  scopeChangeOutPoints: number;
  carryoverPoints: number;
  carryoverAllPoints: number;
  serviceDeskHoursResolved: number;
  issues: SprintMetricsIssue[];
  jiraCapacity: number | null;
  jiraEngineerCount: number | null;
  engineerOutputs: EngOutputRow[] | null;
}

const CAPACITY_EPIC_TITLE = 'PI Capacity Planning';

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

// ── Day-1 grace-period helpers ────────────────────────────────────────

/**
 * Compute the cutoff timestamp for "day 1" inclusion.
 *
 * Sprints officially start on Wednesdays.  If the sprint was kicked off the
 * night before (Tuesday), the official start day is still Wednesday.
 * Anything added to the sprint before noon on that Wednesday is treated as
 * a day-1 story rather than a scope change.
 *
 * @param sprintStartDate - ISO datetime string from Jira, e.g. "2024-01-16T18:00:00.000-06:00"
 * @returns Date representing Wednesday 12:00 in the sprint's local timezone
 */
const computeDay1Cutoff = (sprintStartDate: string): Date => {
  // Extract the calendar date portion (YYYY-MM-DD) from the Jira datetime string.
  const datePart = sprintStartDate.slice(0, 10);

  // Reconstruct a noon-UTC reference so getUTCDay() reflects the correct calendar day
  // regardless of the sprint's local timezone offset.
  const noonUtc = new Date(`${datePart}T12:00:00Z`);
  const dow = noonUtc.getUTCDay(); // 0=Sun 1=Mon 2=Tue 3=Wed …

  // If the sprint was started on a Tuesday, the official Wednesday start is +1 day.
  let officialDatePart = datePart;
  if (dow === 2) {
    const next = new Date(noonUtc);
    next.setUTCDate(next.getUTCDate() + 1);
    officialDatePart = next.toISOString().slice(0, 10);
  }

  // Preserve the original timezone offset so the 20:00 cutoff is in local time.
  const tzMatch = sprintStartDate.match(/([+-]\d{2}:?\d{2}|Z)$/);
  const tz = tzMatch ? tzMatch[1] : '+00:00';

  return new Date(`${officialDatePart}T12:00:00${tz}`);
};

interface PuntedAnalysis {
  /** Removed before the day-1 noon cutoff — never committed work, skip entirely. */
  earlyPunted: Set<string>;
  /** Removed on the sprint's last calendar day — was committed work, count in lastDayPoints. */
  lastDayPunted: Set<string>;
}

/**
 * Analyse each punted issue's changelog to classify it as:
 *   - earlyPunted:   removed before the day-1 noon cutoff (not day-1, not lastDay)
 *   - lastDayPunted: removed on the sprint's last calendar day (counts toward lastDay)
 *   - neither:       removed mid-sprint, counted as day-1 only (existing behaviour)
 *
 * If no removal changelog entry is found the key is conservatively treated as
 * neither early nor last-day (i.e. kept as a normal day-1 item).
 */
const analyzePuntedIssues = async (
  puntedKeys: Set<string>,
  sprintId: number,
  cutoff: Date,
  sprintEndDatePart: string,  // "YYYY-MM-DD" of sprint end date
  client: JiraClient,
): Promise<PuntedAnalysis> => {
  const earlyPunted = new Set<string>();
  const lastDayPunted = new Set<string>();

  if (puntedKeys.size === 0) return { earlyPunted, lastDayPunted };

  await Promise.all([...puntedKeys].map(async (key) => {
    try {
      const changelog = await client.getIssueChangelog(key);

      for (const entry of changelog) {
        for (const item of entry.items) {
          if (item.field !== 'Sprint') continue;

          const fromIds = (item.from ?? '').split(',').map((s) => s.trim()).filter(Boolean);
          const toIds   = (item.to   ?? '').split(',').map((s) => s.trim()).filter(Boolean);

          // This entry removed the sprint (present in 'from' but not in 'to')
          if (fromIds.includes(String(sprintId)) && !toIds.includes(String(sprintId))) {
            const removedAt = new Date(entry.created);
            const removedDatePart = entry.created.slice(0, 10);

            if (removedAt <= cutoff) {
              earlyPunted.add(key);
              console.log(`[day1] early-punted   ${key}  removedAt=${entry.created}  cutoff=${cutoff.toISOString()} — NOT counting as day1`);
            } else if (removedDatePart === sprintEndDatePart) {
              lastDayPunted.add(key);
              console.log(`[day1] lastday-punted ${key}  removedAt=${entry.created}  sprintEnd=${sprintEndDatePart} — counting as lastDay`);
            } else {
              console.log(`[day1] mid-punted     ${key}  removedAt=${entry.created} — counting as day1 only`);
            }
            return;
          }
        }
      }

      // No removal entry found — conservatively keep as normal day-1
      console.log(`[day1] no-removal-changelog  ${key}  (keeping as day1)`);
    } catch (err) {
      console.warn(`[day1] changelog fetch failed for punted ${key}:`, err);
    }
  }));

  return { earlyPunted, lastDayPunted };
};

/**
 * Given the set of keys Jira marked as "added during sprint", return the subset
 * that were actually added before the day-1 cutoff (i.e. should be treated as
 * day-1 stories, not scope changes).
 *
 * Uses the issue changelog to find exactly when each issue was moved into the sprint.
 * If the changelog entry cannot be found the key is conservatively kept as scope change.
 */
const getGracePeriodKeys = async (
  addedKeys: Set<string>,
  sprintId: number,
  cutoff: Date,
  client: JiraClient,
): Promise<Set<string>> => {
  if (addedKeys.size === 0) return new Set();

  const graceKeys = new Set<string>();

  await Promise.all([...addedKeys].map(async (key) => {
    try {
      const changelog = await client.getIssueChangelog(key);

      // Find the changelog entry where this sprint was first added to the issue.
      // item.to contains comma-separated sprint IDs; item.from is the previous value.
      for (const entry of changelog) {
        for (const item of entry.items) {
          if (item.field !== 'Sprint') continue;

          const toIds = (item.to ?? '').split(',').map((s) => s.trim()).filter(Boolean);
          const fromIds = (item.from ?? '').split(',').map((s) => s.trim()).filter(Boolean);

          // This entry added the sprint (present in 'to' but not in 'from')
          if (toIds.includes(String(sprintId)) && !fromIds.includes(String(sprintId))) {
            const addedAt = new Date(entry.created);
            if (addedAt <= cutoff) {
              graceKeys.add(key);
              console.log(`[day1] grace-period ${key}  addedAt=${entry.created}  cutoff=${cutoff.toISOString()}`);
            } else {
              console.log(`[day1] scope-change  ${key}  addedAt=${entry.created}  cutoff=${cutoff.toISOString()}`);
            }
            return; // found the relevant entry — stop scanning
          }
        }
      }

      // No matching changelog entry found — treat conservatively as scope change
      console.log(`[day1] no-changelog  ${key}  (keeping as scope-change)`);
    } catch (err) {
      console.warn(`[day1] changelog fetch failed for ${key}:`, err);
    }
  }));

  return graceKeys;
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

    // Cache PI Capacity Planning epic key per project
    const capacityEpicCache = new Map<string, string | null>();
    const getCapacityEpicKey = async (projectKey: string): Promise<string | null> => {
      if (capacityEpicCache.has(projectKey)) return capacityEpicCache.get(projectKey)!;
      const jql = `project = "${projectKey}" AND issuetype = Epic AND summary ~ "${CAPACITY_EPIC_TITLE}" ORDER BY created ASC`;
      const results = await client.searchIssuesWithDescription(jql);
      const match = results.issues.find(
        (i) => (i.fields.summary as string).trim() === CAPACITY_EPIC_TITLE
      );
      const epicKey = match?.key ?? null;
      capacityEpicCache.set(projectKey, epicKey);
      return epicKey;
    };

    // Look up the capacity story for a sprint and return capacity data or null.
    // Never throws — errors are caught and treated as "no capacity data".
    const getSprintCapacity = async (
      projectKey: string,
      sprintId: number,
      sprintName: string
    ): Promise<{ totalCapacity: number; engineerCount: number; engineerRows: EngineerRow[]; supportPct: number } | null> => {
      try {
      const epicKey = await getCapacityEpicKey(projectKey);
      if (!epicKey) return null;

      // Search all children of the epic without a summary filter — the ~ operator
      // breaks on sprint names containing hyphens or version numbers.
      const storyTitle = `${sprintId}-${sprintName}`;
      const jql = `parent = "${epicKey}" ORDER BY created ASC`;
      const results = await client.searchIssuesWithDescription(jql);
      const story = results.issues.find(
        (i) => (i.fields.summary as string).trim().toLowerCase() === storyTitle.toLowerCase()
      );
      if (!story) return null;
      const description = story.fields.description;
      if (!description || typeof description !== 'object') return null;

      // Extract text from ADF codeBlock
      const doc = description as { content?: unknown[] };
      let text: string | null = null;
      for (const block of doc.content ?? []) {
        const b = block as { type?: string; content?: unknown[] };
        if (b.type === 'codeBlock' || b.type === 'paragraph') {
          for (const inline of b.content ?? []) {
            const n = inline as { type?: string; text?: string };
            if (n.type === 'text' && n.text) { text = n.text; break; }
          }
        }
        if (text) break;
      }
      if (!text) return null;

      const payload = deserializeCapacity(text);
      if (!payload) return null;

      return {
        totalCapacity: computeTotalCapacity(payload.rows, payload.supportPct),
        engineerCount: countNonTechLeadEngineers(payload.rows),
        engineerRows: payload.rows.filter((r) => !r.isTechLead),
        supportPct: payload.supportPct,
      };
      } catch (err) {
        console.warn(`[capacity] Failed to load capacity for ${projectKey}:`, err);
        return null;
      }
    };

    // ── Per-selection: find sprints, compute metrics ──────────────────
    // Process selections sequentially and sprints sequentially to avoid
    // Jira rate limits (each sprint still runs its 2-3 API calls in parallel).

    // Each selection yields: { offset → SprintMetricsRow }
    type SelectionResult = Map<number, SprintMetricsRow>;

    const selectionResults: SelectionResult[] = [];

    for (const { projectKey, boardId, projectName } of selections) {
      const result: SelectionResult = new Map();

      // 1. Fetch all sprints for this board (active, closed, AND future) so that stories
      //    moved to upcoming sprints are correctly excluded from past-sprint metrics.
      const allSprints = await client.getSprints('active,closed,future', boardId);
      const mapped = mapToSprints(allSprints);

      // 2. All project sprints sorted by start date (includes future — used for attribution)
      const allProjectSprints = mapped
        .filter((s) => s.name.startsWith(`${projectKey} `))
        .filter((s) => s.startDate)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

      // Build sprintId → startDate lookup (includes future sprints)
      const sprintStartDateMap = new Map<number, string>();
      for (const s of allProjectSprints) sprintStartDateMap.set(s.id, s.startDate);

      // Returns true only when currentSprintId has the latest start date among all
      // sprints the issue belongs to.  Stories that moved to a later sprint are
      // attributed solely to that later sprint, preventing double-counting.
      const isLastSprint = (sprintIds: number[] | undefined, currentSprintId: number): boolean => {
        if (!sprintIds || sprintIds.length === 0) return false;
        const known = sprintIds.filter((id) => sprintStartDateMap.has(id));
        if (known.length === 0) return false;
        let latestId = known[0];
        let latestDate = sprintStartDateMap.get(latestId)!;
        for (const id of known) {
          const d = sprintStartDateMap.get(id)!;
          if (d > latestDate) { latestDate = d; latestId = id; }
        }
        return latestId === currentSprintId;
      };

      // 3. Only active/closed project sprints are processed for metrics
      const projectSprints = allProjectSprints.filter((s) => {
        const raw = allSprints.find((r) => r.id === s.id);
        return raw?.state === 'active' || raw?.state === 'closed';
      });

      if (projectSprints.length === 0) {
        selectionResults.push(result);
        continue;
      }

      // 3. Find the active sprint (last one with state "active") or most recent closed
      const activeSprint = projectSprints.find((s) =>
        allSprints.find((raw) => raw.id === s.id && raw.state === 'active')
      );
      const latestSprint = activeSprint ?? projectSprints[projectSprints.length - 1];

      // 4. Collect sprints: offset 0 = latest, then N closed before it
      const latestIdx = projectSprints.indexOf(latestSprint);
      const sprintsToProcess: { sprint: typeof latestSprint; offset: number; nextSprintId: number | null }[] = [];

      // Offset 0 = current/latest sprint
      sprintsToProcess.push({
        sprint: latestSprint,
        offset: 0,
        // Active sprint has no next sprint yet → carryover will be 0
        nextSprintId: latestIdx < projectSprints.length - 1 ? projectSprints[latestIdx + 1].id : null,
      });

      // Historical sprints (offsets -1, -2, ...)
      for (let i = 1; i <= sprintsBack; i++) {
        const idx = latestIdx - i;
        if (idx < 0) break;
        sprintsToProcess.push({
          sprint: projectSprints[idx],
          offset: -i,
          // Next sprint always exists for historical entries (idx < latestIdx)
          nextSprintId: projectSprints[idx + 1].id,
        });
      }

      // 5. Get done statuses for this board
      const doneStatuses = await getDoneStatusesCached(boardId);
      const doneStatusSet = new Set(doneStatuses.map((s) => s.toLowerCase()));

      // 6. Process each sprint sequentially (API calls within a sprint still parallel)
      for (const { sprint, offset, nextSprintId } of sprintsToProcess) {
        // Fetch issues via JQL (uses app's standard point calculation)
        const jql = `sprint = ${sprint.id} AND project = "${projectKey}" AND issuetype in (Story, Task) AND ${EXCLUDE_MAINFRAME}`;

        // carryover is computed after sprint report + punted analysis using issuesNotCompleted

        // Fetch service desk/Splunk resolved tickets with time spent
        const serviceDeskJql = `sprint = ${sprint.id} AND project = "Hy-Vee Service Desk" AND issuetype in ("[System] Incident", "[System] Problem", "[System] Service request") AND ${EXCLUDE_MAINFRAME}`;

        const serviceDeskPromise = client.searchAllIssues(serviceDeskJql, ['timespent', 'status', 'summary']);

        console.log(`[sprintReport] ${sprint.name} — calling getSprintReport(boardId=${boardId}, sprintId=${sprint.id})`);
        const sprintReport = await client.getSprintReport(boardId, sprint.id);
        console.log(`[sprintReport] ${sprint.name} — completedIssues(${(sprintReport.contents.completedIssues ?? []).length}): [${(sprintReport.contents.completedIssues ?? []).map((i) => i.key).join(', ')}]`);
        console.log(`[sprintReport] ${sprint.name} — issuesNotCompleted(${(sprintReport.contents.issuesNotCompletedInCurrentSprint ?? []).length}): [${(sprintReport.contents.issuesNotCompletedInCurrentSprint ?? []).map((i) => i.key).join(', ')}]`);
        console.log(`[sprintReport] ${sprint.name} — puntedIssues(${(sprintReport.contents.puntedIssues ?? []).length}): [${(sprintReport.contents.puntedIssues ?? []).map((i) => i.key).join(', ')}]`);
        console.log(`[sprintReport] ${sprint.name} — issueKeysAddedDuringSprint(${Object.keys(sprintReport.contents.issueKeysAddedDuringSprint ?? {}).length}): [${Object.keys(sprintReport.contents.issueKeysAddedDuringSprint ?? {}).join(', ')}]`);

        const [issuesResponse, serviceDeskResponse, sprintCapacity] = await Promise.all([
          client.searchAllIssues(jql),
          serviceDeskPromise,
          getSprintCapacity(projectKey, sprint.id, sprint.name),
        ]);

        const rawAddedKeys = new Set(
          Object.keys(sprintReport.contents.issueKeysAddedDuringSprint ?? {})
        );

        // Apply grace-period: stories Jira flagged as "added during sprint" but that
        // were actually added before 8 PM on the official Wednesday start day are
        // treated as day-1 stories rather than scope changes.
        const day1Cutoff = computeDay1Cutoff(sprint.startDate);
        console.log(`[day1] ${sprint.name} — day1Cutoff=${day1Cutoff.toISOString()}  (startDate=${sprint.startDate})`);

        const graceKeys = await getGracePeriodKeys(rawAddedKeys, sprint.id, day1Cutoff, client);

        // lateAddedKeys = truly mid-sprint additions (scope changes)
        const addedKeys = new Set([...rawAddedKeys].filter((k) => !graceKeys.has(k)));

        // Day 1 keys = issues present at sprint start across all three sprint report lists,
        // minus true scope-change additions.
        const sprintReportAllKeys = new Set([
          ...(sprintReport.contents.completedIssues ?? []).map((i) => i.key),
          ...(sprintReport.contents.issuesNotCompletedInCurrentSprint ?? []).map((i) => i.key),
          ...(sprintReport.contents.puntedIssues ?? []).map((i) => i.key),
        ]);
        const day1Keys = new Set([...sprintReportAllKeys].filter((k) => !addedKeys.has(k)));

        // estimateStatistic = the story's point value at sprint start (before any mid-sprint changes)
        // typeName lets us exclude Service Tickets from the "all pointed" check
        const sprintStartEstimateMap = new Map<string, number>();
        const sprintReportServiceTicketKeys = new Set<string>();
        for (const issue of [
          ...(sprintReport.contents.completedIssues ?? []),
          ...(sprintReport.contents.issuesNotCompletedInCurrentSprint ?? []),
          ...(sprintReport.contents.puntedIssues ?? []),
        ]) {
          sprintStartEstimateMap.set(issue.key, issue.estimateStatistic?.statFieldValue?.value ?? 0);
          if (issue.typeName?.toLowerCase() === 'service ticket') {
            sprintReportServiceTicketKeys.add(issue.key);
          }
        }
        const day1PointableKeys = [...day1Keys].filter((k) => !sprintReportServiceTicketKeys.has(k));
        const day1UnpointedKeys = new Set(
          day1PointableKeys.filter((k) => (sprintStartEstimateMap.get(k) ?? 0) === 0)
        );
        const day1AllPointed = day1PointableKeys.length > 0 && day1UnpointedKeys.size === 0;

        // Punted day-1 issues were removed from the sprint during it — they don't appear
        // in the sprint = X JQL results, so fetch their full data separately.
        const jqlKeySet = new Set(issuesResponse.issues.map((i) => i.key));
        const puntedDay1Keys = [...day1Keys].filter((k) => !jqlKeySet.has(k));

        let puntedIssues: (typeof issuesResponse.issues[number])[] = [];
        if (puntedDay1Keys.length > 0) {
          const puntedJql = `issuekey in (${puntedDay1Keys.join(',')})`;
          console.log(`[day1] ${sprint.name} — fetching ${puntedDay1Keys.length} punted day1 issues  JQL: ${puntedJql}`);
          puntedIssues = (await client.searchAllIssues(puntedJql)).issues;
        }

        // Analyse punted issues: early (skip entirely), last-day (add to lastDay), or mid-sprint (day1 only)
        const puntedKeys = new Set(puntedIssues.map((i) => {
          const { ticket } = mapToTicketAutoEpic(i, fieldConfig);
          return ticket.key;
        }));
        const sprintEndDatePart = (sprint.endDate ?? '').slice(0, 10);
        const { earlyPunted: earlyPuntedKeys, lastDayPunted: lastDayPuntedKeys } =
          await analyzePuntedIssues(puntedKeys, sprint.id, day1Cutoff, sprintEndDatePart, client);

        console.log(`[day1] ${sprint.name} — JQL: ${jql}`);
        console.log(`[day1] ${sprint.name} — ${issuesResponse.issues.length} end-of-sprint issues, ${puntedIssues.length} punted day1 issues, ${addedKeys.size} added mid-sprint: [${Array.from(addedKeys).join(', ')}]`);
        console.log(`[day1] ${sprint.name} — day1Keys (${day1Keys.size}): [${Array.from(day1Keys).join(', ')}]`);

        // Per-engineer output map: key = lowercase display name.
        // Seeded from capacity data when available; falls back to assignee names
        // from resolved issues so the tab still shows data without a capacity story.
        const engineerOutputMap = new Map<string, EngOutputRow>();
        const hasCapacityData = sprintCapacity !== null && sprintCapacity.engineerRows.length > 0;
        if (hasCapacityData && sprintCapacity) {
          const supportMult = 1 - sprintCapacity.supportPct / 100;
          for (const r of sprintCapacity.engineerRows) {
            const rawCap = computeEngineerCapacity(r);
            const capacity = Math.round(rawCap * supportMult * 10) / 10;
            engineerOutputMap.set(r.name.toLowerCase(), { name: r.name, capacity, resolvedPoints: 0 });
          }
        }

        let day1Points = 0;
        let resolvedPoints = 0;
        let lastDayPoints = 0;
        let scopeChangeInPoints = 0;
        let scopeChangeOutPoints = 0;
        const issues: SprintMetricsIssue[] = [];

        // ── End-of-sprint issues (lastDay, resolved, scopeChange, and day1 overlap) ──
        for (const issue of issuesResponse.issues) {
          const { ticket } = mapToTicketAutoEpic(issue, fieldConfig);

          if (isCanceledStatus(ticket.status)) {
            console.log(`[day1]   SKIP canceled  ${ticket.key}`);
            continue;
          }

          const isDay1Issue = day1Keys.has(ticket.key);
          const isLast = isLastSprint(ticket.sprintIds, sprint.id);

          const isScopeChange = !isDay1Issue && addedKeys.has(ticket.key);

          // Skip entirely if not relevant to this sprint at all
          if (!isDay1Issue && !isLast && !isScopeChange) {
            const known = (ticket.sprintIds ?? []).filter((id) => sprintStartDateMap.has(id));
            const lastId = known.length > 0
              ? known.reduce((best, id) => (sprintStartDateMap.get(id)! > sprintStartDateMap.get(best)! ? id : best), known[0])
              : null;
            console.log(`[day1]   SKIP not-last  ${ticket.key}  lastSprint=${lastId}  sprints=[${known.join(',')}]`);
            continue;
          }

          const points = computePoints(issue, ticket.key, fieldConfig);
          const categories: string[] = [];

          // Day 1: count regardless of whether this is the issue's last sprint.
          if (isDay1Issue) {
            day1Points += points;
            categories.push('day1');
            if (day1UnpointedKeys.has(ticket.key)) categories.push('day1Unpointed');
            console.log(`[day1]   day1        ${ticket.key}  pts=${points}  runningTotal=${day1Points}`);
          }

          // Scope change: added after Wednesday noon — count regardless of which sprint it landed in.
          if (isScopeChange) {
            scopeChangeInPoints += points;
            categories.push('scopeChange');
            console.log(`[day1]   scopeChange(in) ${ticket.key}  pts=${points}`);
          }

          // lastDay / resolved only apply when this is the issue's last sprint
          if (isLast) {
            categories.push('lastDay');
            lastDayPoints += points;

            if (doneStatusSet.has(ticket.status.toLowerCase())) {
              resolvedPoints += points;
              categories.push('resolved');
              if (ticket.assignee) {
                const key = ticket.assignee.toLowerCase();
                const engRow = engineerOutputMap.get(key);
                if (engRow) {
                  engRow.resolvedPoints += points;
                } else if (!hasCapacityData) {
                  // No capacity story — seed the map from resolved assignees
                  engineerOutputMap.set(key, { name: ticket.assignee, capacity: 0, resolvedPoints: points });
                }
              }
            }
          }

          issues.push({ key: ticket.key, summary: ticket.summary, sprintName: sprint.name, points, categories });
        }

        // ── Punted day-1 issues (present at sprint start, removed during sprint) ──
        // Punted issues are by definition day-1 stories; the isLastSprint check is
        // intentionally omitted here because the story leaving this sprint is exactly
        // what makes it a punted/carryover day-1 item.
        // Exception: if the story was removed before the 8 PM day-1 cutoff it was
        // never really committed work and should not be counted.
        for (const issue of puntedIssues) {
          const { ticket } = mapToTicketAutoEpic(issue, fieldConfig);

          if (isCanceledStatus(ticket.status)) {
            console.log(`[day1]   SKIP punted-canceled  ${ticket.key}`);
            continue;
          }
          if (earlyPuntedKeys.has(ticket.key)) {
            // already logged inside getPuntedBeforeCutoffKeys
            continue;
          }

          const points = computePoints(issue, ticket.key, fieldConfig);
          day1Points += points;
          const puntedCategories: string[] = ['day1'];
          if (day1UnpointedKeys.has(ticket.key)) puntedCategories.push('day1Unpointed');
          if (lastDayPuntedKeys.has(ticket.key)) {
            lastDayPoints += points;
            puntedCategories.push('lastDay');
            console.log(`[day1]   day1+lastDay(punted) ${ticket.key}  pts=${points}  runningTotal=${day1Points}`);
          } else {
            // Committed day-1 work removed mid-sprint = scope out
            scopeChangeOutPoints += points;
            puntedCategories.push('scopeChangeOut');
            console.log(`[day1]   day1+scopeOut(punted) ${ticket.key}  pts=${points}  runningTotal=${day1Points}`);
          }
          issues.push({ key: ticket.key, summary: ticket.summary, sprintName: sprint.name, points, categories: puntedCategories });
        }

        console.log(`[day1] ${sprint.name} — TOTAL day1=${day1Points}  scopeIn=${scopeChangeInPoints}  scopeOut=${scopeChangeOutPoints}  lastDay=${lastDayPoints}  resolved=${resolvedPoints}`);

        // Carryover = all stories not completed at sprint end:
        //   • issuesNotCompletedInCurrentSprint from the sprint report (in sprint at close, not done)
        //   • stories moved out on the last calendar day (lastDayPuntedKeys)
        // Only compute for closed sprints (nextSprintId serves as the proxy).
        let carryoverPoints = 0;
        let carryoverAllPoints = 0;
        if (nextSprintId !== null) {
          // Build a lookup from all already-fetched issue data
          const fetchedIssueMap = new Map<string, (typeof issuesResponse.issues)[0]>();
          for (const i of issuesResponse.issues) fetchedIssueMap.set(i.key, i);
          for (const i of puntedIssues) fetchedIssueMap.set(i.key, i);

          const carryoverCandidateKeys = new Set<string>([
            ...(sprintReport.contents.issuesNotCompletedInCurrentSprint ?? []).map((i) => i.key),
            ...lastDayPuntedKeys,
          ]);

          // Fetch any candidate keys not already in our data set
          const unfetchedKeys = [...carryoverCandidateKeys].filter((k) => !fetchedIssueMap.has(k));
          if (unfetchedKeys.length > 0) {
            const suppJql = `issuekey in (${unfetchedKeys.join(',')})`;
            console.log(`[carryover] ${sprint.name} — supplemental fetch for ${unfetchedKeys.length} keys  JQL: ${suppJql}`);
            const suppResponse = await client.searchAllIssues(suppJql);
            for (const i of suppResponse.issues) fetchedIssueMap.set(i.key, i);
          }

          console.log(`[carryover] ${sprint.name} — ${carryoverCandidateKeys.size} candidates: [${[...carryoverCandidateKeys].join(', ')}]`);

          for (const key of carryoverCandidateKeys) {
            const issue = fetchedIssueMap.get(key);
            if (!issue) continue;
            const { ticket } = mapToTicketAutoEpic(issue, fieldConfig);
            if (isCanceledStatus(ticket.status)) continue;

            const pts = computePoints(issue, ticket.key, fieldConfig);
            const isBlocked = ticket.status.toLowerCase() === 'blocked';

            // Carryover (All) includes blocked; Carryover excludes blocked
            carryoverAllPoints += pts;
            if (!isBlocked) carryoverPoints += pts;

            const carryoverCategories: string[] = [isBlocked ? 'carryoverAll' : 'carryover'];
            // lastDayPunted stories already had lastDayPoints incremented in the punted loop
            if (!lastDayPuntedKeys.has(key)) {
              lastDayPoints += pts;
              carryoverCategories.push('lastDay');
            }

            issues.push({ key, summary: ticket.summary, sprintName: sprint.name, points: pts, categories: carryoverCategories });
          }
        }

        // Service desk hours resolved = sum timespent (seconds → hours) for resolved SD tickets
        let serviceDeskSecondsResolved = 0;
        for (const issue of serviceDeskResponse.issues) {
          const status = (issue.fields.status as { name: string })?.name ?? '';
          if (isCanceledStatus(status)) continue;
          if (!doneStatusSet.has(status.toLowerCase())) continue;
          const timespent = issue.fields['timespent'];
          if (typeof timespent === 'number' && timespent > 0) {
            serviceDeskSecondsResolved += timespent;
            const hours = Math.round((timespent / 3600) * 10) / 10;
            const sdSummary = (issue.fields['summary'] as string) ?? issue.key;
            issues.push({
              key: issue.key,
              summary: sdSummary,
              sprintName: sprint.name,
              points: hours,
              categories: ['serviceDesk'],
            });
          }
        }
        const serviceDeskHoursResolved = Math.round((serviceDeskSecondsResolved / 3600) * 10) / 10;

        const engineerOutputs: EngOutputRow[] | null =
          engineerOutputMap.size > 0
            ? [...engineerOutputMap.values()].sort((a, b) => a.name.localeCompare(b.name))
            : null;

        result.set(offset, {
          projectKey,
          projectName: projectName ?? projectKey,
          sprintName: sprint.name,
          startDate: sprint.startDate,
          endDate: sprint.endDate ?? '',
          day1Points,
          day1AllPointed,
          resolvedPoints,
          lastDayPoints,
          scopeChangeInPoints,
          scopeChangeOutPoints,
          carryoverPoints,
          carryoverAllPoints,
          serviceDeskHoursResolved,
          issues,
          jiraCapacity: sprintCapacity?.totalCapacity ?? null,
          jiraEngineerCount: sprintCapacity?.engineerCount ?? null,
          engineerOutputs,
        });
      }

      selectionResults.push(result);
    }

    // ── Assemble grids by offset ──────────────────────────────────────
    // Every selected project gets a row in every grid, even if it has no
    // sprint data at that offset (zeros are used as placeholders).

    const offsets = [0, ...Array.from({ length: sprintsBack }, (_, i) => -(i + 1))];
    const grids: SprintMetricsGrid[] = [];

    for (const offset of offsets) {
      const rows: SprintMetricsRow[] = [];

      for (let i = 0; i < selectionResults.length; i++) {
        const selResult = selectionResults[i];
        const row = selResult.get(offset);
        if (row) {
          rows.push(row);
        } else {
          // Placeholder row with zeros for projects missing data at this offset
          const sel = selections[i];
          rows.push({
            projectKey: sel.projectKey,
            projectName: sel.projectName ?? sel.projectKey,
            sprintName: '—',
            startDate: '',
            endDate: '',
            day1Points: 0,
            day1AllPointed: false,
            resolvedPoints: 0,
            lastDayPoints: 0,
            scopeChangeInPoints: 0,
            scopeChangeOutPoints: 0,
            carryoverPoints: 0,
            carryoverAllPoints: 0,
            serviceDeskHoursResolved: 0,
            issues: [],
            jiraCapacity: null,
            jiraEngineerCount: null,
            engineerOutputs: null,
          });
        }
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
