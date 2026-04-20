import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, mapToInitiatives } from '@/backend/jira';
import {
  TSHIRT_SIZES,
  tshirtSizeFor,
  classificationFromLabels,
} from '@/shared/types';
import type {
  EffortData,
  EffortEpic,
  EffortEpicLink,
  EffortStory,
  JiraIssueResponse,
  TshirtSize,
} from '@/shared/types';

const CANCELED_STATUS = 'Canceled';
const DONE_CATEGORY_KEY = 'done';

/**
 * True when the issue is in a terminal (resolved / done / closed) state and
 * should be excluded from effort rollups. Prefers the statusCategory when
 * present; falls back to a hard-coded name list so unusual JIRA setups still
 * get a reasonable answer.
 */
const isResolvedIssue = (status: { name?: string; statusCategory?: { key?: string } } | undefined): boolean => {
  if (!status) return false;
  if (status.statusCategory?.key === DONE_CATEGORY_KEY) return true;
  const name = status.name?.toLowerCase() ?? '';
  return name === 'resolved' || name === 'done' || name === 'closed';
};

/** Same linked-epic harvesting as the Fusion API so the datasets match. */
const harvestLinkedEpicKeys = (
  initiativeEpics: JiraIssueResponse[],
  existingKeys: Set<string>
): Map<string, EffortEpicLink[]> => {
  const map = new Map<string, EffortEpicLink[]>();
  for (const epic of initiativeEpics) {
    const links = epic.fields.issuelinks ?? [];
    for (const link of links) {
      const other = link.outwardIssue ?? link.inwardIssue;
      if (!other) continue;
      if (existingKeys.has(other.key)) continue;
      const entry: EffortEpicLink = {
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

/** Pull the raw T-shirt dropdown value out of its JIRA-shaped field. */
const extractTshirtValue = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof raw === 'object') {
    const obj = raw as { value?: unknown; name?: unknown };
    if (typeof obj.value === 'string' && obj.value.trim().length > 0) return obj.value.trim();
    if (typeof obj.name === 'string' && obj.name.trim().length > 0) return obj.name.trim();
  }
  return null;
};

const toStory = (
  issue: JiraIssueResponse,
  epicKey: string,
  devDaysField: string,
  tshirtField: string | undefined
): EffortStory => {
  const rawPts = issue.fields[devDaysField];
  const devDays = typeof rawPts === 'number' && rawPts > 0 ? rawPts : 0;
  const tshirt = tshirtField ? extractTshirtValue(issue.fields[tshirtField]) : null;
  const size = tshirtSizeFor(tshirt);
  const classification = classificationFromLabels(issue.fields.labels);
  return {
    key: issue.key,
    summary: issue.fields.summary,
    epicKey,
    status: issue.fields.status.name,
    assignee: issue.fields.assignee?.displayName ?? null,
    devDays,
    tshirt,
    size,
    classification,
  };
};

const computeTeam = (epicKey: string): string => {
  const idx = epicKey.indexOf('-');
  return idx > 0 ? epicKey.slice(0, idx) : epicKey;
};

const emptySizeCounts = (): Record<TshirtSize, number> => {
  const out = {} as Record<TshirtSize, number>;
  for (const s of TSHIRT_SIZES) out[s] = 0;
  return out;
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
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (initiativeKeys.length === 0) {
    return NextResponse.json(
      { error: 'No valid initiative keys in "initiatives" parameter' },
      { status: 400 }
    );
  }

  try {
    const client = getJiraClient();
    const {
      devDays: devDaysField,
      epicLink: epicLinkField,
      tshirtSizing: tshirtField,
    } = client.getFieldConfig();

    // 1. Initiatives (for summary display)
    const keyList = initiativeKeys
      .map((k) => `"${k.replace(/["\\]/g, '')}"`)
      .join(',');
    const initiativesRaw = await client.searchAllIssues(
      `key in (${keyList}) AND issuetype = Initiative ORDER BY key ASC`
    );
    const initiatives = mapToInitiatives(initiativesRaw.issues);

    // 2. Epics directly under initiatives (status != Canceled)
    const initiativeEpics = await client.getEpicsForInitiatives(
      initiatives.map((i) => i.key)
    );
    const initiativeEpicKeySet = new Set(initiativeEpics.map((e) => e.key));

    // 2b. Linked epics (same logic as Fusion).
    const linkedMap = harvestLinkedEpicKeys(initiativeEpics, initiativeEpicKeySet);
    let linkedEpics: JiraIssueResponse[] = [];
    if (linkedMap.size > 0) {
      const linkedKeyList = Array.from(linkedMap.keys())
        .map((k) => `"${k.replace(/["\\]/g, '')}"`)
        .join(',');
      const linkedResult = await client.searchAllIssues(
        `key in (${linkedKeyList}) AND issuetype = Epic AND status != "${CANCELED_STATUS}" ORDER BY key ASC`,
        ['updated']
      );
      linkedEpics = linkedResult.issues;
    }

    const epicIssues = [...initiativeEpics, ...linkedEpics];
    const epicKeys = epicIssues.map((e) => e.key);
    const epicKeySet = new Set(epicKeys);

    // 3. Stories under those epics (T-shirt field requested explicitly in
    //    case getStoriesForEpics doesn't include it by default).
    const storyIssues = await client.getStoriesForEpics(epicKeys);

    // 4. Group stories by epic key; ignore canceled and resolved/done stories —
    //    sizing rollups should only reflect remaining work.
    const storiesByEpic = new Map<string, EffortStory[]>();
    for (const issue of storyIssues) {
      const epicKey = resolveEpicKey(issue, epicLinkField);
      if (!epicKey || !epicKeySet.has(epicKey)) continue;
      if (issue.fields.status.name === CANCELED_STATUS) continue;
      if (isResolvedIssue(issue.fields.status)) continue;

      const story = toStory(issue, epicKey, devDaysField, tshirtField);
      const arr = storiesByEpic.get(epicKey) ?? [];
      arr.push(story);
      storiesByEpic.set(epicKey, arr);
    }

    // 5. Build EffortEpic records with per-size counts.
    const epics: EffortEpic[] = epicIssues.map((e) => {
      const parentKey = e.fields.parent?.key ?? '';
      const stories = storiesByEpic.get(e.key) ?? [];
      const sizeCounts = emptySizeCounts();
      for (const s of stories) sizeCounts[s.size] += 1;
      const linkedVia = linkedMap.get(e.key);
      const rawUpdated = e.fields.updated;
      const updatedAt = typeof rawUpdated === 'string' ? rawUpdated : null;
      return {
        key: e.key,
        summary: e.fields.summary,
        initiativeKey: parentKey,
        team: computeTeam(e.key),
        status: e.fields.status.name,
        totalStories: stories.length,
        sizeCounts,
        stories,
        updatedAt,
        ...(linkedVia ? { linkedVia } : {}),
      };
    });

    // 6. Team names — same approach as Fusion.
    const teamCodes = new Set<string>();
    for (const epic of epics) {
      for (const story of epic.stories) {
        const idx = story.key.indexOf('-');
        const code = idx > 0 ? story.key.slice(0, idx) : story.key;
        teamCodes.add(code);
      }
    }
    const teamNames: Record<string, string> = {};
    if (teamCodes.size > 0) {
      try {
        const projects = await client.getProjects();
        for (const p of projects) {
          if (teamCodes.has(p.key)) teamNames[p.key] = p.name;
        }
      } catch {
        // Non-fatal
      }
    }

    const data: EffortData = { initiatives, epics, teamNames };
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: message, message: `❌ EFFORT ESTIMATES LOAD FAILED: ${message}` },
      { status: 500 }
    );
  }
};
