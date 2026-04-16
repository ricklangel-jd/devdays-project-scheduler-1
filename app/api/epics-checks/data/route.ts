import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, EXCLUDE_MAINFRAME, WORK_ITEM_ISSUE_TYPES, mapToTicketAutoEpic } from '@/backend/jira';

interface StoryInfo {
  key: string;
  summary: string;
  status: string;
}

interface EpicCheckItem {
  epicKey: string;
  epicSummary: string;
  epicStatus: string;
  stories: StoryInfo[];
}

export interface EpicsChecksResponse {
  notStartedWithActiveStories: EpicCheckItem[];
  inProgressWithOnlyBacklog: EpicCheckItem[];
}

const isInProgressStatus = (s: string): boolean =>
  s.toLowerCase() === 'in progress';

const isBacklogStatus = (s: string): boolean =>
  s.toLowerCase() === 'backlog';

const isResolvedStatus = (s: string): boolean =>
  ['resolved', 'done', 'closed'].includes(s.toLowerCase());

const isCanceledStatus = (s: string): boolean =>
  ['canceled', 'cancelled'].includes(s.toLowerCase());

export const GET = async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const projectKey = searchParams.get('projectKey');

    if (!projectKey) {
      return NextResponse.json({ error: 'projectKey is required' }, { status: 400 });
    }

    const client = getJiraClient();
    const fieldConfig = client.getFieldConfig();

    // Fetch all epics (all statuses — we apply rules in code)
    const epicJql = `issuetype = Epic AND project = ${projectKey} AND ${EXCLUDE_MAINFRAME} ORDER BY key ASC`;

    // Fetch all non-canceled work items (Story, Task, Bug, Spike) for the project
    const storyJql = `issuetype in (${WORK_ITEM_ISSUE_TYPES}) AND project = ${projectKey} AND status not in ("Canceled", "Cancelled") AND ${EXCLUDE_MAINFRAME} ORDER BY key ASC`;

    const [epicsResponse, storiesResponse] = await Promise.all([
      client.searchAllIssues(epicJql, []),
      client.searchAllIssues(storyJql, []),
    ]);

    // Group stories by their epic key
    const storiesByEpic = new Map<string, StoryInfo[]>();

    for (const issue of storiesResponse.issues) {
      const { epicKey } = mapToTicketAutoEpic(issue, fieldConfig);
      if (!epicKey || epicKey === '__NO_EPIC__') continue;

      if (!storiesByEpic.has(epicKey)) {
        storiesByEpic.set(epicKey, []);
      }
      storiesByEpic.get(epicKey)!.push({
        key: issue.key,
        summary: (issue.fields.summary as string) ?? '',
        status: (issue.fields.status as { name: string })?.name ?? 'Unknown',
      });
    }

    const notStartedWithActiveStories: EpicCheckItem[] = [];
    const inProgressWithOnlyBacklog: EpicCheckItem[] = [];

    for (const epicIssue of epicsResponse.issues) {
      const epicStatus = (epicIssue.fields.status as { name: string })?.name ?? 'Unknown';
      const allStories = storiesByEpic.get(epicIssue.key) ?? [];

      if (allStories.length === 0) continue;

      // Grid 1: Epic is NOT in progress, but has work-item stories that are active
      // (i.e. not in backlog, resolved/done, or canceled) — standard types only
      if (!isInProgressStatus(epicStatus) && !isResolvedStatus(epicStatus) && !isCanceledStatus(epicStatus)) {
        const activeStories = allStories.filter(
          (s) =>
            !isBacklogStatus(s.status) &&
            !isResolvedStatus(s.status) &&
            !isCanceledStatus(s.status)
        );
        if (activeStories.length > 0) {
          notStartedWithActiveStories.push({
            epicKey: epicIssue.key,
            epicSummary: (epicIssue.fields.summary as string) ?? '',
            epicStatus,
            stories: activeStories,
          });
        }
      }

      // Grid 2: Epic is "In Progress" or "Resolved/Done", but every story is still in backlog
      if (isInProgressStatus(epicStatus) || isResolvedStatus(epicStatus)) {
        const allBacklog = allStories.every((s) => isBacklogStatus(s.status));
        if (allBacklog) {
          inProgressWithOnlyBacklog.push({
            epicKey: epicIssue.key,
            epicSummary: (epicIssue.fields.summary as string) ?? '',
            epicStatus,
            stories: allStories,
          });
        }
      }
    }

    const response: EpicsChecksResponse = {
      notStartedWithActiveStories,
      inProgressWithOnlyBacklog,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
