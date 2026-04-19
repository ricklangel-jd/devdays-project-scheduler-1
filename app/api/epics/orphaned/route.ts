import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, EXCLUDE_MAINFRAME } from '@/backend/jira';

export interface OrphanedEpic {
  key: string;
  summary: string;
  status: string;
  projectKey: string;
}

export interface OrphanedEpicsResponse {
  epics: OrphanedEpic[];
}

export const GET = async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const projectKeysParam = searchParams.get('projectKeys');

    if (!projectKeysParam) {
      return NextResponse.json({ error: 'projectKeys is required' }, { status: 400 });
    }

    const projectKeys = projectKeysParam
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (projectKeys.length === 0) {
      return NextResponse.json({ epics: [] } satisfies OrphanedEpicsResponse);
    }

    const client = getJiraClient();

    const keyList = projectKeys
      .map((k) => `"${k.replace(/["\\]/g, '')}"`)
      .join(',');

    const jql =
      `project in (${keyList}) AND issuetype = Epic AND parent is EMPTY ` +
      `AND created >= "2024-01-01" ` +
      `AND status NOT IN ("Canceled", "Cancelled") ` +
      `AND ${EXCLUDE_MAINFRAME} ORDER BY key ASC`;

    const response = await client.searchAllIssues(jql);

    const epics: OrphanedEpic[] = response.issues.map((issue) => {
      const key = issue.key;
      const projectKey = key.includes('-') ? key.split('-')[0] : '';
      return {
        key,
        summary: issue.fields.summary ?? '',
        status: issue.fields.status?.name ?? 'Unknown',
        projectKey,
      };
    });

    return NextResponse.json({ epics } satisfies OrphanedEpicsResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
