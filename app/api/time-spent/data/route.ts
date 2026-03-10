import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, extractEpicKey } from '@/backend/jira';
import type { FieldConfig } from '@/backend/jira/mappers';
import type { JiraIssueResponse } from '@/shared/types';

const STORY_POINT_ESTIMATE_FIELD = 'story_point_estimate';

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

interface TimeSpentRequest {
  projectKey: string;
  piSprints: PiSprintAssignment[];
  boardId?: number;
}

interface StoryInfo {
  key: string;
  summary: string;
  points: number;
}

interface EpicInfo {
  key: string;
  summary: string;
  totalPoints: number;
  stories: StoryInfo[];
}

interface InitiativeInfo {
  key: string;
  summary: string;
  totalPoints: number;
  epics: EpicInfo[];
}

interface TimeSpentResponse {
  initiatives: InitiativeInfo[];
}

const isCanceledStatus = (status: string): boolean => {
  const lower = status.toLowerCase();
  return lower === 'canceled' || lower === 'cancelled';
};

/**
 * Compute story points for Time Spent reporting.
 * HVSD (Service Desk) tickets → 0.
 * Otherwise: story points → estimated story points → 0.
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

export const POST = async (request: NextRequest) => {
  try {
    const body: TimeSpentRequest = await request.json();
    const { projectKey, piSprints, boardId } = body;

    if (!projectKey) {
      return NextResponse.json({ error: 'Project key is required' }, { status: 400 });
    }

    // Collect all unique sprint IDs from PI assignments
    const allSprintIds = Array.from(
      new Set(piSprints.flatMap((ps) => ps.sprintIds))
    );

    if (allSprintIds.length === 0) {
      return NextResponse.json({ error: 'At least one sprint must be assigned' }, { status: 400 });
    }

    const client = getJiraClient();
    const fieldConfig = buildFieldConfig(client);

    console.log(`[Time Spent] Fetching tickets for ${allSprintIds.length} sprints`);

    // Step 1: Fetch all tickets in the selected sprints
    const ticketsResponse = await client.getSprintTickets(allSprintIds);
    console.log(`[Time Spent] Found ${ticketsResponse.issues.length} tickets in sprints`);

    // Step 2: Discover unique epic keys from sprint tickets, filtered to project
    const epicKeys = new Set<string>();
    const projectPrefix = `${projectKey}-`;

    for (const issue of ticketsResponse.issues) {
      const epicKey = extractEpicKey(issue, fieldConfig);
      if (epicKey && epicKey.startsWith(projectPrefix)) {
        epicKeys.add(epicKey);
      }
    }

    console.log(`[Time Spent] Found ${epicKeys.size} unique epics in project ${projectKey}`);

    if (epicKeys.size === 0) {
      const response: TimeSpentResponse = { initiatives: [] };
      return NextResponse.json(response);
    }

    // Step 3: Fetch epic details in parallel (to get status + parent initiative key)
    const epicKeyArray = Array.from(epicKeys);
    const epicIssues = await Promise.all(
      epicKeyArray.map((key) => client.getIssue(key).catch(() => null))
    );

    // Build epic map: key → { summary, status, initiativeKey }
    const epicMap = new Map<string, {
      summary: string;
      status: string;
      initiativeKey: string | null;
    }>();

    const initiativeKeys = new Set<string>();

    for (let i = 0; i < epicKeyArray.length; i++) {
      const epic = epicIssues[i];
      if (!epic) continue;

      const status = epic.fields.status.name;
      if (isCanceledStatus(status)) continue;

      const initiativeKey = epic.fields.parent?.key ?? null;
      epicMap.set(epicKeyArray[i], {
        summary: epic.fields.summary,
        status,
        initiativeKey,
      });

      if (initiativeKey) {
        initiativeKeys.add(initiativeKey);
      }
    }

    console.log(`[Time Spent] ${epicMap.size} non-canceled epics, ${initiativeKeys.size} unique initiatives`);

    // Step 4: Fetch initiative details for names (batch in parallel)
    const initiativeNameMap = new Map<string, string>();
    if (initiativeKeys.size > 0) {
      const initiativeIssues = await Promise.all(
        Array.from(initiativeKeys).map((key) => client.getIssue(key).catch(() => null))
      );
      const initiativeKeyArray = Array.from(initiativeKeys);
      for (let i = 0; i < initiativeKeyArray.length; i++) {
        const issue = initiativeIssues[i];
        if (issue) {
          initiativeNameMap.set(initiativeKeyArray[i], issue.fields.summary);
        }
      }
    }

    // Step 5: Collect story details and sum points from sprint tickets grouped by epic
    // Only count non-canceled tickets that belong to non-canceled epics in our project
    const epicStoriesMap = new Map<string, StoryInfo[]>();
    const epicPointsMap = new Map<string, number>();
    for (const issue of ticketsResponse.issues) {
      // Skip canceled tickets
      if (isCanceledStatus(issue.fields.status.name)) continue;

      const epicKey = extractEpicKey(issue, fieldConfig);
      if (!epicKey || !epicMap.has(epicKey)) continue;

      const points = computePoints(issue, issue.key, fieldConfig);
      epicPointsMap.set(epicKey, (epicPointsMap.get(epicKey) ?? 0) + points);

      if (!epicStoriesMap.has(epicKey)) {
        epicStoriesMap.set(epicKey, []);
      }
      epicStoriesMap.get(epicKey)!.push({
        key: issue.key,
        summary: issue.fields.summary,
        points,
      });
    }

    // Step 6: Group epics by initiative
    const NO_INITIATIVE = '__NO_INITIATIVE__';
    const initiativeEpicsMap = new Map<string, EpicInfo[]>();

    for (const [epicKey, epicData] of epicMap) {
      const initKey = epicData.initiativeKey ?? NO_INITIATIVE;
      if (!initiativeEpicsMap.has(initKey)) {
        initiativeEpicsMap.set(initKey, []);
      }
      const stories = (epicStoriesMap.get(epicKey) ?? []).sort((a, b) => b.points - a.points);
      initiativeEpicsMap.get(initKey)!.push({
        key: epicKey,
        summary: epicData.summary,
        totalPoints: epicPointsMap.get(epicKey) ?? 0,
        stories,
      });
    }

    // Step 7: Build response, sorted by total points descending
    const initiatives: InitiativeInfo[] = Array.from(initiativeEpicsMap.entries())
      .map(([initKey, epics]) => {
        // Sort epics by points descending
        epics.sort((a, b) => b.totalPoints - a.totalPoints);

        const totalPoints = epics.reduce((sum, e) => sum + e.totalPoints, 0);
        const summary = initKey === NO_INITIATIVE
          ? 'No Initiative'
          : initiativeNameMap.get(initKey) ?? initKey;

        return {
          key: initKey,
          summary,
          totalPoints,
          epics,
        };
      })
      .filter((init) => init.totalPoints > 0)
      .sort((a, b) => b.totalPoints - a.totalPoints);

    console.log(`[Time Spent] Returning ${initiatives.length} initiatives`);

    const response: TimeSpentResponse = { initiatives };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Time spent data fetch failed:', error);
    return NextResponse.json(
      { error: message, message: `Data fetch failed: ${message}` },
      { status: 500 }
    );
  }
};
