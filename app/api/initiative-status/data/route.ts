import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient } from '@/backend/jira';
import type { JiraIssueResponse } from '@/backend/jira/client';

export interface EpicParent {
  key: string;
  summary: string;
}

export interface InitiativeEpic {
  key: string;
  summary: string;
  assignee: string | null;
  status: string;
  project: string;
  parent: EpicParent | null; // null when the initiative is the direct parent
  statusCategoryChangedDate: string | null;
}

export interface InitiativeStory {
  key: string;
  epicKey: string;
  summary: string;
  points: number | null;
  status: string;
  project: string;
  statusCategoryChangedDate: string | null;
}

export interface InitiativeStatusResponse {
  initiativeKey: string;
  initiativeSummary: string;
  epics: InitiativeEpic[];
  stories: InitiativeStory[];
}

const RESOLVED_STATUSES = new Set(['done', 'closed', 'resolved']);
const isResolved = (status: string) => RESOLVED_STATUSES.has(status.toLowerCase());

const mapEpicIssue = (issue: JiraIssueResponse, initiativeKey: string): InitiativeEpic => {
  const assigneeField = issue.fields.assignee as { displayName?: string } | null | undefined;
  const statusField = issue.fields.status as { name?: string } | null | undefined;
  const projectField = issue.fields.project as { name?: string } | null | undefined;
  const statusChanged = issue.fields.statuscategorychangedate as string | null | undefined;
  const parentField = issue.fields.parent as { key?: string; fields?: { summary?: string } } | null | undefined;

  const parentKey = parentField?.key ?? null;
  const parent: EpicParent | null =
    parentKey && parentKey !== initiativeKey
      ? { key: parentKey, summary: parentField?.fields?.summary ?? parentKey }
      : null;

  return {
    key: issue.key,
    summary: issue.fields.summary ?? '',
    assignee: assigneeField?.displayName ?? null,
    status: statusField?.name ?? 'Unknown',
    project: projectField?.name ?? issue.key.split('-')[0],
    parent,
    statusCategoryChangedDate: statusChanged ?? null,
  };
};

export const POST = async (request: NextRequest) => {
  try {
    const { initiativeKey }: { initiativeKey: string } = await request.json();

    if (!initiativeKey?.trim()) {
      return NextResponse.json({ error: 'initiativeKey is required' }, { status: 400 });
    }

    const client = getJiraClient();
    const key = initiativeKey.trim().toUpperCase();

    // Fetch the initiative itself to get its summary and issue links
    const initiativeIssue = await client.getIssue(key);
    const initiativeSummary = initiativeIssue.fields.summary ?? key;

    // Fetch direct child epics (non-canceled)
    const epicsJql = `parent = "${key}" AND status not in (Canceled, Cancelled) ORDER BY key ASC`;
    const epicsResponse = await client.searchAllIssues(epicsJql, ['assignee', 'statuscategorychangedate']);

    const directEpics = epicsResponse.issues.map((issue) => mapEpicIssue(issue, key));
    const seenKeys = new Set(directEpics.map((e) => e.key));

    // Collect epic keys from issue links on each direct child epic
    // issuelinks is a default field so it's already in the response
    const linkedEpicKeys = new Set<string>();
    for (const issue of epicsResponse.issues) {
      const links = (issue.fields.issuelinks as Array<{
        inwardIssue?: { key: string };
        outwardIssue?: { key: string };
      }>) ?? [];
      for (const link of links) {
        for (const linked of [link.inwardIssue, link.outwardIssue]) {
          if (linked?.key && !seenKeys.has(linked.key)) {
            linkedEpicKeys.add(linked.key);
          }
        }
      }
    }

    // Fetch linked epics (filter to Epic issuetype and non-canceled via JQL)
    let linkedEpics: InitiativeEpic[] = [];
    if (linkedEpicKeys.size > 0) {
      const linkedJql = `key in (${[...linkedEpicKeys].join(', ')}) AND issuetype = Epic AND status not in (Canceled, Cancelled) ORDER BY key ASC`;
      const linkedResponse = await client.searchAllIssues(linkedJql, ['assignee', 'statuscategorychangedate']);
      linkedEpics = linkedResponse.issues
        .filter((issue) => !seenKeys.has(issue.key))
        .map((issue) => mapEpicIssue(issue, key));
    }

    const epics = [...directEpics, ...linkedEpics];

    // Fetch stories for non-resolved epics only
    const nonResolvedEpicKeys = epics.filter((e) => !isResolved(e.status)).map((e) => e.key);

    let stories: InitiativeStory[] = [];
    if (nonResolvedEpicKeys.length > 0) {
      const fieldConfig = client.getFieldConfig();
      const epicList = nonResolvedEpicKeys.join(', ');
      const storiesJql = `parent in (${epicList}) AND status not in (Canceled, Cancelled) ORDER BY project ASC, key ASC`;
      const storiesResponse = await client.searchAllIssues(storiesJql, ['statuscategorychangedate', fieldConfig.devDays, ...(fieldConfig.sprintPointEstimate ? [fieldConfig.sprintPointEstimate] : [])]);

      stories = storiesResponse.issues.map((issue) => {
        const statusField = issue.fields.status as { name?: string } | null | undefined;
        const parentField = issue.fields.parent as { key?: string } | null | undefined;
        const projectField = issue.fields.project as { name?: string } | null | undefined;
        const statusChanged = issue.fields.statuscategorychangedate as string | null | undefined;

        const rawDevDays = issue.fields[fieldConfig.devDays];
        const devDays = typeof rawDevDays === 'number' && rawDevDays > 0 ? rawDevDays : null;
        const rawEstimate = fieldConfig.sprintPointEstimate ? issue.fields[fieldConfig.sprintPointEstimate] : undefined;
        const estimate = typeof rawEstimate === 'number' && rawEstimate > 0 ? rawEstimate : null;

        return {
          key: issue.key,
          epicKey: parentField?.key ?? '',
          summary: issue.fields.summary ?? '',
          points: devDays ?? estimate,
          status: statusField?.name ?? 'Unknown',
          project: projectField?.name ?? issue.key.split('-')[0],
          statusCategoryChangedDate: statusChanged ?? null,
        };
      });
    }

    return NextResponse.json({
      initiativeKey: key,
      initiativeSummary,
      epics,
      stories,
    } satisfies InitiativeStatusResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Initiative status fetch failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
