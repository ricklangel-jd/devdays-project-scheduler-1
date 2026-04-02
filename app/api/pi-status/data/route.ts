import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, EXCLUDE_MAINFRAME } from '@/backend/jira';
import type { FieldConfig } from '@/backend/jira/mappers';

const STORY_POINT_ESTIMATE_FIELD = 'story_point_estimate';

const buildFieldConfig = (client: ReturnType<typeof getJiraClient>): FieldConfig => {
  const base = client.getFieldConfig();
  return {
    ...base,
    sprintPointEstimate: base.sprintPointEstimate || STORY_POINT_ESTIMATE_FIELD,
  };
};

const isCanceledStatus = (status: string): boolean => {
  const lower = status.toLowerCase();
  return lower === 'canceled' || lower === 'cancelled';
};

const isResolvedStatus = (status: string): boolean => {
  const lower = status.toLowerCase();
  return lower === 'resolved' || lower === 'done' || lower === 'closed';
};

// ── Types ────────────────────────────────────────────────────────────

export interface PiStatusStory {
  key: string;
  summary: string;
  points: number | null;
  status: string;
  sprint: string | null;
}

export interface EpicStatusData {
  key: string;
  summary: string;
  status: string;
  resolvedPercent: number;
  totalStories: number;
  resolvedStories: number;
  totalPoints: number;
  resolvedPoints: number;
  stories: PiStatusStory[]; // non-canceled, non-resolved only
  statusBreakdown: Record<string, number>; // status name → total points (for charting)
}

interface PiStatusRequest {
  projectKey: string;
  piLabel: string;
}

interface PiStatusResponse {
  committed: EpicStatusData[];
  stretch: EpicStatusData[];
}

// ── Handler ──────────────────────────────────────────────────────────

export const POST = async (request: NextRequest) => {
  try {
    const body: PiStatusRequest = await request.json();
    const { projectKey, piLabel } = body;

    if (!projectKey || !piLabel) {
      return NextResponse.json(
        { error: 'projectKey and piLabel are required' },
        { status: 400 }
      );
    }

    const client = getJiraClient();
    const fieldConfig = buildFieldConfig(client);

    // 1. Find all epics with this PI label
    const jql = `labels = "${piLabel}" AND ${EXCLUDE_MAINFRAME} AND project = ${projectKey} AND issuetype = Epic AND status != "Canceled" ORDER BY key ASC`;
    const epicsResponse = await client.searchAllIssues(jql, ['issuetype', 'labels']);

    // 2. For each epic, fetch child stories (batch of 5 to avoid rate limits)
    const epicIssues = epicsResponse.issues;
    const committed: EpicStatusData[] = [];
    const stretch: EpicStatusData[] = [];

    const BATCH_SIZE = 5;
    for (let i = 0; i < epicIssues.length; i += BATCH_SIZE) {
      const batch = epicIssues.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async (epicIssue) => {
          const epicKey = epicIssue.key;
          const epicSummary = epicIssue.fields.summary;
          const epicStatus = (epicIssue.fields.status as { name: string })?.name ?? 'Unknown';
          const labels: string[] = (epicIssue.fields.labels as string[]) ?? [];
          const isStretch = labels.some((l) => l.toLowerCase() === 'stretch');

          // Fetch child stories (sprint field is in default fields via fieldConfig)
          const fieldConfig2 = client.getFieldConfig();
          const sprintField = fieldConfig2.sprint;
          const storiesJql = `("Epic Link" = ${epicKey} OR parent = ${epicKey}) AND ${EXCLUDE_MAINFRAME} ORDER BY key ASC`;
          const storiesResponse = await client.searchAllIssues(storiesJql, [
            STORY_POINT_ESTIMATE_FIELD,
          ]);

          let totalPoints = 0;
          let resolvedPoints = 0;
          let totalNonCanceled = 0;
          let resolvedCount = 0;
          const remainingStories: PiStatusStory[] = [];
          const statusBreakdown: Record<string, number> = {};

          for (const issue of storiesResponse.issues) {
            const status = (issue.fields.status as { name: string })?.name ?? 'Unknown';

            if (isCanceledStatus(status)) continue;

            // Compute points
            const rawDevDays = issue.fields[fieldConfig.devDays];
            const devDaysPoints =
              typeof rawDevDays === 'number' && rawDevDays > 0 ? rawDevDays : null;
            const rawEstimate = fieldConfig.sprintPointEstimate
              ? issue.fields[fieldConfig.sprintPointEstimate]
              : undefined;
            const estimatePoints =
              typeof rawEstimate === 'number' && rawEstimate > 0 ? rawEstimate : null;
            const points = devDaysPoints ?? estimatePoints;
            const pts = points ?? 0;

            totalNonCanceled++;
            totalPoints += pts;

            // Accumulate points by status for charting
            statusBreakdown[status] = (statusBreakdown[status] || 0) + pts;

            if (isResolvedStatus(status)) {
              resolvedCount++;
              resolvedPoints += pts;
            } else {
              const rawSprint = sprintField ? issue.fields[sprintField] : undefined;
              const sprintName = Array.isArray(rawSprint) && rawSprint.length > 0
                ? ((rawSprint[rawSprint.length - 1] as { name?: string })?.name ?? null)
                : null;
              remainingStories.push({
                key: issue.key,
                summary: issue.fields.summary,
                points,
                status,
                sprint: sprintName,
              });
            }
          }

          const resolvedPercent =
            totalPoints > 0
              ? Math.round((resolvedPoints / totalPoints) * 100)
              : 0;

          const epicData: EpicStatusData = {
            key: epicKey,
            summary: epicSummary,
            status: epicStatus,
            resolvedPercent,
            totalStories: totalNonCanceled,
            resolvedStories: resolvedCount,
            totalPoints,
            resolvedPoints,
            stories: remainingStories,
            statusBreakdown,
          };

          return { epicData, isStretch };
        })
      );

      for (const { epicData, isStretch } of results) {
        if (isStretch) {
          stretch.push(epicData);
        } else {
          committed.push(epicData);
        }
      }
    }

    const response: PiStatusResponse = { committed, stretch };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('PI Status data fetch failed:', error);

    return NextResponse.json(
      {
        error: message,
        message: `PI Status fetch failed: ${message}`,
      },
      { status: 500 }
    );
  }
};
