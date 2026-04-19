import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, EXCLUDE_MAINFRAME, WORK_ITEM_ISSUE_TYPES, mapToInitiatives } from '@/backend/jira';
import type { JiraIssueResponse, JiraInitiative } from '@/shared/types';

export interface EstimatesNeededStory {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  tshirtSize: string | null;
  devDays: number | null;
  isMissingTshirt: boolean;
}

export interface EstimatesNeededEpic {
  epicKey: string;
  epicSummary: string;
  epicStatus: string;
  initiativeKey: string | null;
  totalStories: number;
  missingTshirtCount: number;
  stories: EstimatesNeededStory[];
}

export interface EstimatesNeededResponse {
  initiatives: JiraInitiative[];
  epics: EstimatesNeededEpic[];
  tshirtFieldConfigured: boolean;
}

const CANCELED_STATUS = 'Canceled';
const CANCELED_VARIANT = 'Cancelled';

const extractTshirtValue = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof raw === 'object') {
    // JIRA dropdown option shape: { value, id, ... } or { name, ... }
    const obj = raw as { value?: unknown; name?: unknown };
    if (typeof obj.value === 'string' && obj.value.trim().length > 0) return obj.value.trim();
    if (typeof obj.name === 'string' && obj.name.trim().length > 0) return obj.name.trim();
  }
  return null;
};

const resolveEpicKey = (
  issue: JiraIssueResponse,
  epicLinkField: string
): string | null => {
  const linkValue = issue.fields[epicLinkField];
  if (typeof linkValue === 'string' && linkValue.length > 0) return linkValue;
  if (linkValue && typeof linkValue === 'object' && 'key' in linkValue) {
    const k = (linkValue as { key?: unknown }).key;
    if (typeof k === 'string') return k;
  }
  return issue.fields.parent?.key ?? null;
};

export const GET = async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const projectKey = searchParams.get('projectKey')?.trim();
    const initiativesParam = searchParams.get('initiatives')?.trim();

    if (!projectKey) {
      return NextResponse.json({ error: 'projectKey is required' }, { status: 400 });
    }
    if (!initiativesParam) {
      return NextResponse.json(
        { error: 'initiatives is required (comma-separated keys)' },
        { status: 400 }
      );
    }

    const initiativeKeys = initiativesParam
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (initiativeKeys.length === 0) {
      return NextResponse.json(
        { error: 'No valid initiative keys in "initiatives"' },
        { status: 400 }
      );
    }

    const client = getJiraClient();
    const fieldConfig = client.getFieldConfig();
    const tshirtField = fieldConfig.tshirtSizing;

    if (!tshirtField) {
      return NextResponse.json(
        {
          error:
            'JIRA_FIELD_TSHIRT_SIZING is not configured. Set it in .env.local to use this page.',
        },
        { status: 500 }
      );
    }

    const sanitize = (s: string) => s.replace(/["\\]/g, '');
    const initKeyList = initiativeKeys.map((k) => `"${sanitize(k)}"`).join(',');

    // 1. Resolve initiatives so we can return their summaries.
    const initiativesRaw = await client.searchAllIssues(
      `key in (${initKeyList}) AND issuetype = Initiative ORDER BY key ASC`
    );
    const initiatives = mapToInitiatives(initiativesRaw.issues);

    // 2. Epics that are direct children of the given initiatives (any project,
    //    any status — epic's own status/project doesn't matter; we scope via
    //    its stories). Still apply EXCLUDE_MAINFRAME for consistency.
    const epicJql =
      `parent in (${initKeyList}) ` +
      `AND issuetype = Epic ` +
      `AND statusCategory != Done ` +
      `AND status NOT IN ("${CANCELED_STATUS}", "${CANCELED_VARIANT}") ` +
      `AND ${EXCLUDE_MAINFRAME} ORDER BY key ASC`;

    const epicsResponse = await client.searchAllIssues(epicJql);
    const epics = epicsResponse.issues;

    if (epics.length === 0) {
      return NextResponse.json({
        initiatives,
        epics: [],
        tshirtFieldConfigured: true,
      } satisfies EstimatesNeededResponse);
    }

    // 3. Stories in the selected project whose parent/epic-link points at one
    //    of those epics. T-shirt field requested.
    const epicKeys = epics.map((e) => e.key);
    const epicKeyList = epicKeys.map((k) => `"${sanitize(k)}"`).join(',');
    const storyJql =
      `project = "${sanitize(projectKey)}" ` +
      `AND ("Epic Link" in (${epicKeyList}) OR parent in (${epicKeyList})) ` +
      `AND issuetype in (${WORK_ITEM_ISSUE_TYPES}) ` +
      `AND statusCategory != Done ` +
      `AND status NOT IN ("${CANCELED_STATUS}", "${CANCELED_VARIANT}") ` +
      `AND ${EXCLUDE_MAINFRAME} ORDER BY key ASC`;
    const storiesResponse = await client.searchAllIssues(storyJql, [tshirtField]);

    // 4. Group stories by epic key
    const epicByKey = new Map(epics.map((e) => [e.key, e]));
    const storiesByEpic = new Map<string, EstimatesNeededStory[]>();
    for (const issue of storiesResponse.issues) {
      const epicKey = resolveEpicKey(issue, fieldConfig.epicLink);
      if (!epicKey || !epicByKey.has(epicKey)) continue;

      const tshirtSize = extractTshirtValue(issue.fields[tshirtField]);
      const devDaysRaw = issue.fields[fieldConfig.devDays];
      const devDays = typeof devDaysRaw === 'number' && devDaysRaw > 0 ? devDaysRaw : null;

      const story: EstimatesNeededStory = {
        key: issue.key,
        summary: (issue.fields.summary as string) ?? '',
        status: issue.fields.status?.name ?? 'Unknown',
        assignee: issue.fields.assignee?.displayName,
        tshirtSize,
        devDays,
        isMissingTshirt: tshirtSize === null,
      };

      const arr = storiesByEpic.get(epicKey) ?? [];
      arr.push(story);
      storiesByEpic.set(epicKey, arr);
    }

    // 5. Build epic summaries. Include only epics that have at least one
    //    in-project story missing T-shirt sizing.
    const result: EstimatesNeededEpic[] = [];
    for (const [epicKey, stories] of storiesByEpic.entries()) {
      const missingCount = stories.filter((s) => s.isMissingTshirt).length;
      if (missingCount === 0) continue;
      const epic = epicByKey.get(epicKey);
      if (!epic) continue;

      result.push({
        epicKey: epic.key,
        epicSummary: (epic.fields.summary as string) ?? '',
        epicStatus: epic.fields.status?.name ?? 'Unknown',
        initiativeKey: epic.fields.parent?.key ?? null,
        totalStories: stories.length,
        missingTshirtCount: missingCount,
        stories,
      });
    }

    result.sort((a, b) => a.epicKey.localeCompare(b.epicKey));

    const response: EstimatesNeededResponse = {
      initiatives,
      epics: result,
      tshirtFieldConfigured: true,
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
