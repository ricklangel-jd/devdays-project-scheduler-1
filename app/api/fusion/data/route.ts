import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, mapToInitiatives } from '@/backend/jira';
import type {
  FusionData,
  FusionEpic,
  FusionEpicLink,
  FusionStory,
  JiraIssueResponse,
} from '@/shared/types';

const DONE_CATEGORY_KEY = 'done';
const CANCELED_STATUS = 'Canceled';

/**
 * Scan initiative-epic issuelinks and collect every other issue they link to.
 * The map key is the linked issue's key (which may or may not turn out to be
 * an Epic — we filter that at the JQL level when we fetch). The value tracks
 * which initiative-epic(s) pointed at it and the link type name for display.
 * Keys already in `existingKeys` are skipped so we never re-include an epic
 * that's already a direct child of one of our initiatives.
 */
const harvestLinkedEpicKeys = (
  initiativeEpics: JiraIssueResponse[],
  existingKeys: Set<string>
): Map<string, FusionEpicLink[]> => {
  const map = new Map<string, FusionEpicLink[]>();
  for (const epic of initiativeEpics) {
    const links = epic.fields.issuelinks ?? [];
    for (const link of links) {
      const other = link.outwardIssue ?? link.inwardIssue;
      if (!other) continue;
      if (existingKeys.has(other.key)) continue;
      const entry: FusionEpicLink = {
        epicKey: epic.key,
        linkType: link.type.name,
      };
      const arr = map.get(other.key) ?? [];
      arr.push(entry);
      map.set(other.key, arr);
    }
  }
  return map;
};

/**
 * Extract this issue's parent epic key, checking the Epic Link field first
 * (company-managed projects) then falling back to the `parent` relationship
 * (team-managed projects).
 */
const resolveEpicKey = (
  issue: JiraIssueResponse,
  epicLinkField: string
): string | null => {
  const linkValue = issue.fields[epicLinkField];
  if (typeof linkValue === 'string' && linkValue.length > 0) {
    return linkValue;
  }
  if (linkValue && typeof linkValue === 'object' && 'key' in linkValue) {
    const k = (linkValue as { key?: unknown }).key;
    if (typeof k === 'string') return k;
  }
  return issue.fields.parent?.key ?? null;
};

const toStory = (
  issue: JiraIssueResponse,
  epicKey: string,
  devDaysField: string
): FusionStory => {
  const raw = issue.fields[devDaysField];
  const devDays = typeof raw === 'number' && raw > 0 ? raw : 0;
  return {
    key: issue.key,
    summary: issue.fields.summary,
    epicKey,
    status: issue.fields.status.name,
    assignee: issue.fields.assignee?.displayName ?? null,
    devDays,
  };
};

const computeTeam = (epicKey: string): string => {
  const idx = epicKey.indexOf('-');
  return idx > 0 ? epicKey.slice(0, idx) : epicKey;
};

export const GET = async (request: NextRequest) => {
  const csv = request.nextUrl.searchParams.get('initiatives')?.trim();
  if (!csv) {
    return NextResponse.json(
      { error: 'Query parameter "initiatives" is required (comma-separated keys)' },
      { status: 400 }
    );
  }

  const initiativeKeys = csv
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);

  if (initiativeKeys.length === 0) {
    return NextResponse.json(
      { error: 'No valid initiative keys in "initiatives" parameter' },
      { status: 400 }
    );
  }

  try {
    const client = getJiraClient();
    const { devDays: devDaysField, epicLink: epicLinkField } = client.getFieldConfig();

    // 1. Initiatives
    const keyList = initiativeKeys
      .map(k => `"${k.replace(/["\\]/g, '')}"`)
      .join(',');
    const initiativesRaw = await client.searchAllIssues(
      `key in (${keyList}) AND issuetype = Initiative ORDER BY key ASC`
    );
    const initiatives = mapToInitiatives(initiativesRaw.issues);

    // 2. Epics (already filtered by status != Canceled)
    const initiativeEpics = await client.getEpicsForInitiatives(
      initiatives.map(i => i.key)
    );
    const initiativeEpicKeySet = new Set(initiativeEpics.map(e => e.key));

    // 2b. Expand via JIRA issue links: every other Epic an initiative-epic is
    // linked to (non-Canceled) is pulled into the same dataset so the charts,
    // grids, and rollups reflect that related work too.
    const linkedMap = harvestLinkedEpicKeys(initiativeEpics, initiativeEpicKeySet);
    let linkedEpics: JiraIssueResponse[] = [];
    if (linkedMap.size > 0) {
      const linkedKeyList = Array.from(linkedMap.keys())
        .map(k => `"${k.replace(/["\\]/g, '')}"`)
        .join(',');
      const linkedResult = await client.searchAllIssues(
        `key in (${linkedKeyList}) AND issuetype = Epic AND status != "${CANCELED_STATUS}" ORDER BY key ASC`,
        ['updated']
      );
      linkedEpics = linkedResult.issues;
    }

    const epicIssues = [...initiativeEpics, ...linkedEpics];
    const epicKeys = epicIssues.map(e => e.key);

    // 3. Stories under those epics
    const storyIssues = await client.getStoriesForEpics(epicKeys);

    // 4. Group stories by epic key, compute totals
    const epicKeySet = new Set(epicKeys);
    const storiesByEpic = new Map<string, FusionStory[]>();
    const totalsByEpic = new Map<string, { total: number; done: number }>();

    for (const issue of storyIssues) {
      const epicKey = resolveEpicKey(issue, epicLinkField);
      if (!epicKey || !epicKeySet.has(epicKey)) continue;
      if (issue.fields.status.name === CANCELED_STATUS) continue;

      const story = toStory(issue, epicKey, devDaysField);

      const arr = storiesByEpic.get(epicKey) ?? [];
      arr.push(story);
      storiesByEpic.set(epicKey, arr);

      const totals = totalsByEpic.get(epicKey) ?? { total: 0, done: 0 };
      totals.total += story.devDays;
      if (issue.fields.status.statusCategory?.key === DONE_CATEGORY_KEY) {
        totals.done += story.devDays;
      }
      totalsByEpic.set(epicKey, totals);
    }

    // 5. Build FusionEpic list, attach initiativeKey via parent
    const epics: FusionEpic[] = epicIssues.map((e) => {
      const parentKey = e.fields.parent?.key ?? '';
      const totals = totalsByEpic.get(e.key) ?? { total: 0, done: 0 };
      const linkedVia = linkedMap.get(e.key);
      const rawUpdated = e.fields.updated;
      const updatedAt = typeof rawUpdated === 'string' ? rawUpdated : null;
      return {
        key: e.key,
        summary: e.fields.summary,
        initiativeKey: parentKey,
        team: computeTeam(e.key),
        status: e.fields.status.name,
        totalPoints: totals.total,
        donePoints: totals.done,
        stories: storiesByEpic.get(e.key) ?? [],
        updatedAt,
        ...(linkedVia ? { linkedVia } : {}),
      };
    });

    const data: FusionData = { initiatives, epics };
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: message, message: `❌ FUSION DATA LOAD FAILED: ${message}` },
      { status: 500 }
    );
  }
};
