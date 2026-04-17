# Fusion Status Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `/fusion-status` page that loads JIRA initiatives (by key or by label), rolls up child epics + stories into aggregate Dev Days, and renders click-to-filter pie + stacked column charts over two linked grids.

**Architecture:** Thick backend / thin client — three new API endpoints perform all JIRA fetching and server-side rollup. The page holds state, drives chart interaction locally, and derives pie / bar / filter results in React with pure helpers. Mirrors the `/api/gantt/data` pattern.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, MUI 7, hand-rolled SVG charts. No new dependencies.

**Testing convention:** This repo has no unit-test framework. Verification for each task uses `yarn lint` + `yarn build` (which runs `tsc`), and `yarn dev` for manual browser verification on the `/fusion-status` route. Pure-function helpers include a runtime assertion comment that the author should read through — we are not introducing vitest/jest here.

**Design spec:** [docs/superpowers/specs/2026-04-17-fusion-status-page-design.md](../specs/2026-04-17-fusion-status-page-design.md)

---

## File Structure

### New files
```
app/fusion-status/page.tsx                              # route entry
app/fusion-status/layout.tsx                            # <title>
app/api/initiatives/[key]/route.ts                      # GET single initiative
app/api/initiatives/by-label/route.ts                   # GET initiatives by label
app/api/fusion/data/route.ts                            # GET aggregated page data
shared/types/fusion.ts                                  # FusionData/Epic/Story
frontend/components/fusion/statusColors.ts              # color map
frontend/components/fusion/rollups.ts                   # pie/bar/filter helpers
frontend/components/fusion/InitiativeControls.tsx       # two inputs
frontend/components/fusion/InitiativeChips.tsx          # loaded list
frontend/components/fusion/StatusPie.tsx                # pie chart
frontend/components/fusion/TeamStatusColumn.tsx         # stacked bars
frontend/components/fusion/EpicList.tsx                 # left grid
frontend/components/fusion/StoriesGrid.tsx              # right grid
frontend/components/fusion/index.ts                     # barrel
frontend/hooks/useFusionData.ts                         # fetch hook
```

### Modified files
```
backend/jira/client.ts          # + 4 methods, widen status field on fetch
backend/jira/mappers.ts         # + mapToInitiative
backend/jira/index.ts           # re-export new mapper
shared/types/jira.ts            # + JiraInitiative, widen JiraIssueResponse.status.statusCategory
shared/types/index.ts           # re-export JiraInitiative + fusion types
frontend/components/index.ts    # + export './fusion'
frontend/hooks/index.ts         # + export useFusionData
```

No changes to `app/page.tsx`, the GANTT pipeline, or any existing route.

---

## Task 1: Add Initiative + statusCategory to shared JIRA types

**Files:**
- Modify: `shared/types/jira.ts`
- Modify: `shared/types/index.ts`

- [ ] **Step 1: Widen `JiraIssueResponse.fields.status` to include `statusCategory`**

In `shared/types/jira.ts`, replace the inline `status: { name: string }` inside `JiraIssueResponse['fields']` with a reference to a new `JiraIssueStatus` type, AND add a `JiraInitiative` domain type.

Add these two blocks (placement: `JiraInitiative` next to `JiraEpic`; `JiraIssueStatus` next to `JiraStatusCategory`):

```ts
// Add near JiraEpic (after line 20):
export interface JiraInitiative {
  key: string;         // e.g., "INIT-100"
  summary: string;
  status: string;      // e.g., "In Progress"
  labels: string[];
}

// Add near JiraStatusCategory (around line 142):
export interface JiraIssueStatus {
  name: string;
  statusCategory?: JiraStatusCategory;
}
```

Then change `JiraIssueResponse.fields.status` from:
```ts
status: {
  name: string;
};
```
to:
```ts
status: JiraIssueStatus;
```

- [ ] **Step 2: Export new types from `shared/types/index.ts`**

In `shared/types/index.ts`, extend the JIRA types export block to include `JiraInitiative` and `JiraIssueStatus`:

```ts
export type {
  CommitType,
  JiraEpic,
  JiraTicket,
  JiraSprint,
  JiraProject,
  JiraBoard,
  JiraIssueLink,
  JiraIssueResponse,
  JiraIssueStatus,
  JiraInitiative,
  JiraSprintResponse,
  JiraSearchResponse,
  JiraProjectResponse,
  JiraBoardResponse,
  JiraStatusCategory,
  JiraBoardColumnStatus,
  JiraBoardColumn,
  JiraBoardConfigResponse,
  JiraStatusResponse,
} from './jira';
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: PASS (types compile, no lint errors).

- [ ] **Step 4: Commit**

```bash
git add shared/types/jira.ts shared/types/index.ts
git commit -m "feat(types): add JiraInitiative and widen status with statusCategory"
```

---

## Task 2: Add Fusion domain types

**Files:**
- Create: `shared/types/fusion.ts`
- Modify: `shared/types/index.ts`

- [ ] **Step 1: Create `shared/types/fusion.ts`**

```ts
/**
 * Fusion Status page domain types
 * Server-rolled aggregation over initiatives -> epics -> stories.
 */

export interface FusionStory {
  key: string;           // e.g., "OFE-501"
  summary: string;
  epicKey: string;       // parent epic key
  status: string;        // story's own status name
  assignee: string | null;
  devDays: number;       // Dev Days custom field value; 0 when missing
}

export interface FusionEpic {
  key: string;           // e.g., "OFE-123"
  summary: string;
  initiativeKey: string; // parent initiative key
  team: string;          // JIRA project key (prefix of epic key)
  status: string;        // epic's own status name
  totalPoints: number;   // sum of story devDays
  donePoints: number;    // sum of story devDays where statusCategory.key === 'done'
  stories: FusionStory[];
}

export interface FusionData {
  initiatives: {
    key: string;
    summary: string;
    status: string;
    labels: string[];
  }[];
  epics: FusionEpic[];   // epics with status == "Canceled" excluded server-side
}
```

- [ ] **Step 2: Re-export from `shared/types/index.ts`**

Append to `shared/types/index.ts`:
```ts
// Fusion types
export type { FusionStory, FusionEpic, FusionData } from './fusion';
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add shared/types/fusion.ts shared/types/index.ts
git commit -m "feat(types): add Fusion domain types for status page"
```

---

## Task 3: Add JiraClient methods for initiatives + epics + stories

**Files:**
- Modify: `backend/jira/client.ts`

- [ ] **Step 1: Add four new methods to `JiraClient`**

Inside the `JiraClient` class in `backend/jira/client.ts`, after `searchEpics`, add:

```ts
  /**
   * Get a single initiative by key. Returns null if not found.
   */
  getInitiativeByKey = async (key: string): Promise<JiraIssueResponse | null> => {
    const sanitized = key.replace(/"/g, '');
    const jql = `key = "${sanitized}" AND issuetype = Initiative`;
    const response = await this.searchIssues(jql);
    return response.issues[0] ?? null;
  };

  /**
   * Search initiatives by label. Exact match on the label value.
   */
  searchInitiativesByLabel = async (label: string): Promise<JiraIssueResponse[]> => {
    const sanitized = label.replace(/"/g, '');
    const jql = `issuetype = Initiative AND labels = "${sanitized}" ORDER BY key ASC`;
    const response = await this.searchIssues(jql);
    return response.issues;
  };

  /**
   * Get all non-canceled child epics for the given initiative keys (one JQL).
   */
  getEpicsForInitiatives = async (initiativeKeys: string[]): Promise<JiraIssueResponse[]> => {
    if (initiativeKeys.length === 0) return [];
    const keyList = initiativeKeys.map(k => `"${k.replace(/"/g, '')}"`).join(',');
    const jql =
      `parent in (${keyList}) AND issuetype = Epic AND status != "Canceled" ORDER BY key ASC`;
    const response = await this.searchIssues(jql);
    return response.issues;
  };

  /**
   * Get all non-epic issues under the given epic keys (one JQL).
   * Matches either team-managed (parent = epic) or company-managed ("Epic Link" = epic).
   */
  getStoriesForEpics = async (epicKeys: string[]): Promise<JiraIssueResponse[]> => {
    if (epicKeys.length === 0) return [];
    const keyList = epicKeys.map(k => `"${k.replace(/"/g, '')}"`).join(',');
    const jql =
      `("Epic Link" in (${keyList}) OR parent in (${keyList})) AND issuetype != Epic ORDER BY key ASC`;
    const response = await this.searchIssues(jql);
    return response.issues;
  };
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/jira/client.ts
git commit -m "feat(jira): add initiative / epic / story fetch methods for Fusion page"
```

---

## Task 4: Add `mapToInitiative` mapper

**Files:**
- Modify: `backend/jira/mappers.ts`
- Modify: `backend/jira/index.ts`

- [ ] **Step 1: Add mapper to `backend/jira/mappers.ts`**

Add the import `JiraInitiative` to the existing type imports at the top of the file (within the big `import type { ... } from '@/shared/types'` block), then append this function near `mapToEpic`:

```ts
/**
 * Map a JIRA issue response to a JiraInitiative
 */
export const mapToInitiative = (issue: JiraIssueResponse): JiraInitiative => ({
  key: issue.key,
  summary: issue.fields.summary,
  status: issue.fields.status.name,
  labels: issue.fields.labels ?? [],
});

/**
 * Map multiple initiative issues
 */
export const mapToInitiatives = (issues: JiraIssueResponse[]): JiraInitiative[] =>
  issues.map(mapToInitiative);
```

- [ ] **Step 2: Check whether `backend/jira/index.ts` already re-exports from `./mappers`**

Run: `cat backend/jira/index.ts`

If it uses `export * from './mappers'` or similar, no change needed. Otherwise, add:
```ts
export { mapToInitiative, mapToInitiatives } from './mappers';
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/jira/mappers.ts backend/jira/index.ts
git commit -m "feat(jira): add mapToInitiative mapper"
```

---

## Task 5: `GET /api/initiatives/[key]` endpoint

**Files:**
- Create: `app/api/initiatives/[key]/route.ts`

- [ ] **Step 1: Create the route handler**

```ts
import { NextResponse } from 'next/server';
import { getJiraClient, mapToInitiative } from '@/backend/jira';

export const GET = async (
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) => {
  const { key } = await params;

  if (!key) {
    return NextResponse.json(
      { error: 'Missing initiative key' },
      { status: 400 }
    );
  }

  try {
    const client = getJiraClient();
    const issue = await client.getInitiativeByKey(key);
    if (!issue) {
      return NextResponse.json(
        { error: `Initiative ${key} not found` },
        { status: 404 }
      );
    }
    return NextResponse.json(mapToInitiative(issue));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: message, message: `❌ INITIATIVE LOOKUP FAILED: ${message}` },
      { status: 500 }
    );
  }
};
```

Note: Next.js 15+ requires dynamic route params to be awaited; that's reflected in the `params: Promise<...>` signature above.

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Run: `yarn dev`
In another shell:
```bash
curl -s "http://localhost:3000/api/initiatives/INIT-0" | head
```
Expected: either JSON with `key`, `summary`, `status`, `labels`, OR `{"error": "Initiative INIT-0 not found"}` (404). A 500 here means JIRA creds / JQL issue — debug before continuing.

- [ ] **Step 4: Commit**

```bash
git add "app/api/initiatives/[key]/route.ts"
git commit -m "feat(api): add /api/initiatives/[key] endpoint"
```

---

## Task 6: `GET /api/initiatives/by-label` endpoint

**Files:**
- Create: `app/api/initiatives/by-label/route.ts`

- [ ] **Step 1: Create the route handler**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, mapToInitiatives } from '@/backend/jira';

export const GET = async (request: NextRequest) => {
  const label = request.nextUrl.searchParams.get('label')?.trim();

  if (!label) {
    return NextResponse.json(
      { error: 'Query parameter "label" is required' },
      { status: 400 }
    );
  }

  try {
    const client = getJiraClient();
    const issues = await client.searchInitiativesByLabel(label);
    return NextResponse.json({
      results: mapToInitiatives(issues),
      total: issues.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: message, message: `❌ INITIATIVE LABEL SEARCH FAILED: ${message}` },
      { status: 500 }
    );
  }
};
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Run: `yarn dev` (if not already running).
```bash
curl -s "http://localhost:3000/api/initiatives/by-label?label=some-label" | head
```
Expected: JSON shape `{ "results": [...], "total": N }`. Empty `results` is a valid response (not an error).

- [ ] **Step 4: Commit**

```bash
git add app/api/initiatives/by-label/route.ts
git commit -m "feat(api): add /api/initiatives/by-label endpoint"
```

---

## Task 7: `GET /api/fusion/data` endpoint with server-side rollup

**Files:**
- Create: `app/api/fusion/data/route.ts`

- [ ] **Step 1: Create the route handler**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient, mapToInitiatives } from '@/backend/jira';
import type {
  FusionData,
  FusionEpic,
  FusionStory,
  JiraIssueResponse,
} from '@/shared/types';

const DONE_CATEGORY_KEY = 'done';

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
      .map(k => `"${k.replace(/"/g, '')}"`)
      .join(',');
    const initiativesRaw = await client.searchIssues(
      `key in (${keyList}) AND issuetype = Initiative ORDER BY key ASC`
    );
    const initiatives = mapToInitiatives(initiativesRaw.issues);

    // 2. Epics (already filtered by status != Canceled)
    const epicIssues = await client.getEpicsForInitiatives(
      initiatives.map(i => i.key)
    );
    const epicKeys = epicIssues.map(e => e.key);

    // 3. Stories under those epics
    const storyIssues = await client.getStoriesForEpics(epicKeys);

    // 4. Group stories by epic key, compute totals
    const storiesByEpic = new Map<string, FusionStory[]>();
    const totalsByEpic = new Map<string, { total: number; done: number }>();

    for (const issue of storyIssues) {
      const epicKey = resolveEpicKey(issue, epicLinkField);
      if (!epicKey || !epicKeys.includes(epicKey)) continue;

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
      return {
        key: e.key,
        summary: e.fields.summary,
        initiativeKey: parentKey,
        team: computeTeam(e.key),
        status: e.fields.status.name,
        totalPoints: totals.total,
        donePoints: totals.done,
        stories: storiesByEpic.get(e.key) ?? [],
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
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

With `yarn dev` running:
```bash
curl -s "http://localhost:3000/api/fusion/data?initiatives=INIT-100" | head -c 500
```
Expected: JSON with `initiatives` and `epics` arrays. Epics should have `totalPoints`, `donePoints`, `team`, `stories`. Sanity-check that `totalPoints` for one epic equals the sum of `devDays` across its `stories`. A 400 on empty param is fine, a 502/500 on valid JIRA creds is not — fix before moving on.

- [ ] **Step 4: Commit**

```bash
git add app/api/fusion/data/route.ts
git commit -m "feat(api): add /api/fusion/data aggregation endpoint"
```

---

## Task 8: Status color map

**Files:**
- Create: `frontend/components/fusion/statusColors.ts`

- [ ] **Step 1: Create the color map**

```ts
/**
 * Hardcoded color map for known JIRA status names used on the Fusion Status
 * page. Unknown statuses fall back to UNKNOWN_COLOR and emit a one-time
 * console.warn so we can curate this list over time.
 */

const warned = new Set<string>();

export const STATUS_COLORS: Record<string, string> = {
  'Backlog': '#9e9e9e',
  'Selected for Development': '#7e57c2',
  'In Progress': '#1976d2',
  'In Test': '#f59f00',
  'Code Review': '#8e24aa',
  'Ready for Release': '#00796b',
  'Resolved': '#2e7d32',
  'Done': '#1b5e20',
};

export const UNKNOWN_COLOR = '#bdbdbd';

export const colorForStatus = (status: string): string => {
  const hit = STATUS_COLORS[status];
  if (hit) return hit;
  if (!warned.has(status)) {
    warned.add(status);
    console.warn(`[Fusion] no color mapped for status "${status}" — using fallback`);
  }
  return UNKNOWN_COLOR;
};
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/fusion/statusColors.ts
git commit -m "feat(fusion): add status color map"
```

---

## Task 9: Rollup helpers (pie / bar / filter)

**Files:**
- Create: `frontend/components/fusion/rollups.ts`

- [ ] **Step 1: Create pure helpers**

```ts
import type { FusionEpic } from '@/shared/types';

export interface ChartFilter {
  status?: string;
  team?: string;
}

export interface PieSlice {
  status: string;
  points: number;
}

export interface TeamStack {
  team: string;
  total: number;
  byStatus: Record<string, number>;
}

/**
 * Roll up total points grouped by epic status.
 * Epics with totalPoints of 0 are still counted under their status so zero
 * segments do not silently disappear from the filter controls.
 */
export const rollupByStatus = (epics: FusionEpic[] | undefined): PieSlice[] => {
  if (!epics || epics.length === 0) return [];
  const bucket = new Map<string, number>();
  for (const epic of epics) {
    bucket.set(epic.status, (bucket.get(epic.status) ?? 0) + epic.totalPoints);
  }
  return Array.from(bucket.entries())
    .map(([status, points]) => ({ status, points }))
    .sort((a, b) => b.points - a.points || a.status.localeCompare(b.status));
};

/**
 * Roll up total points grouped by team, stacked by status.
 */
export const rollupByTeamAndStatus = (
  epics: FusionEpic[] | undefined
): TeamStack[] => {
  if (!epics || epics.length === 0) return [];
  const stacks = new Map<string, TeamStack>();
  for (const epic of epics) {
    const stack = stacks.get(epic.team) ?? {
      team: epic.team,
      total: 0,
      byStatus: {},
    };
    stack.total += epic.totalPoints;
    stack.byStatus[epic.status] =
      (stack.byStatus[epic.status] ?? 0) + epic.totalPoints;
    stacks.set(epic.team, stack);
  }
  return Array.from(stacks.values()).sort((a, b) => b.total - a.total);
};

/**
 * Apply the current chart filter to the epic list.
 * - filter = null: return all epics.
 * - filter.status set: keep epics whose status matches.
 * - filter.team set: keep epics whose team matches.
 * - both set: keep epics matching BOTH.
 */
export const applyFilter = (
  epics: FusionEpic[] | undefined,
  filter: ChartFilter | null
): FusionEpic[] => {
  if (!epics) return [];
  if (!filter) return epics;
  return epics.filter(e => {
    if (filter.status && e.status !== filter.status) return false;
    if (filter.team && e.team !== filter.team) return false;
    return true;
  });
};
```

- [ ] **Step 2: Inline runtime sanity check**

Running unit tests is out of scope for this repo. Instead, at the bottom of the same file add a commented assertion block the author can temporarily uncomment while editing to verify behavior. It stays as a comment in the committed code.

Append to `frontend/components/fusion/rollups.ts`:

```ts
/* Sanity-check examples (uncomment to run in a scratch file):
 *
 * import type { FusionEpic } from '@/shared/types';
 * const epics: FusionEpic[] = [
 *   { key: 'A-1', summary: '', initiativeKey: 'I', team: 'A',
 *     status: 'In Progress', totalPoints: 10, donePoints: 3, stories: [] },
 *   { key: 'A-2', summary: '', initiativeKey: 'I', team: 'A',
 *     status: 'Backlog', totalPoints: 5, donePoints: 0, stories: [] },
 *   { key: 'B-1', summary: '', initiativeKey: 'I', team: 'B',
 *     status: 'In Progress', totalPoints: 7, donePoints: 0, stories: [] },
 * ];
 * console.assert(rollupByStatus(epics).find(s => s.status === 'In Progress')?.points === 17);
 * console.assert(rollupByTeamAndStatus(epics).find(t => t.team === 'A')?.total === 15);
 * console.assert(applyFilter(epics, { team: 'A', status: 'Backlog' }).length === 1);
 */
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/fusion/rollups.ts
git commit -m "feat(fusion): add rollup + filter pure helpers"
```

---

## Task 10: `useFusionData` hook

**Files:**
- Create: `frontend/hooks/useFusionData.ts`
- Modify: `frontend/hooks/index.ts`

- [ ] **Step 1: Create hook**

```ts
'use client';

import { useState, useCallback } from 'react';
import type { FusionData } from '@/shared/types';

interface UseFusionDataResult {
  data: FusionData | null;
  isLoading: boolean;
  error: string | null;
  load: (initiativeKeys: string[]) => Promise<void>;
  clear: () => void;
}

export const useFusionData = (): UseFusionDataResult => {
  const [data, setData] = useState<FusionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initiativeKeys: string[]) => {
    if (initiativeKeys.length === 0) {
      setData(null);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const url = `/api/fusion/data?initiatives=${encodeURIComponent(initiativeKeys.join(','))}`;
      const response = await fetch(url);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.message || body.error || 'Failed to load Fusion data');
      }
      setData(body as FusionData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      // Preserve previous data during a failed reload; callers can decide to
      // clear explicitly via clear() if they want an empty state on error.
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { data, isLoading, error, load, clear };
};
```

- [ ] **Step 2: Re-export from `frontend/hooks/index.ts`**

Append:
```ts
export { useFusionData } from './useFusionData';
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/hooks/useFusionData.ts frontend/hooks/index.ts
git commit -m "feat(fusion): add useFusionData hook"
```

---

## Task 11: `InitiativeControls` component (two inputs)

**Files:**
- Create: `frontend/components/fusion/InitiativeControls.tsx`

- [ ] **Step 1: Create component**

```tsx
'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import type { JiraInitiative } from '@/shared/types';

interface InitiativeControlsProps {
  existingKeys: string[];
  onAdd: (init: JiraInitiative) => void;
  onBulkAdd: (inits: JiraInitiative[]) => void;
}

const InitiativeControls = ({
  existingKeys,
  onAdd,
  onBulkAdd,
}: InitiativeControlsProps) => {
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMessage, setKeyMessage] = useState<{ level: 'error' | 'info'; text: string } | null>(null);

  const [labelInput, setLabelInput] = useState('');
  const [labelBusy, setLabelBusy] = useState(false);
  const [labelMessage, setLabelMessage] = useState<{ level: 'error' | 'info'; text: string } | null>(null);

  const handleAdd = async () => {
    const key = keyInput.trim();
    if (!key) return;
    if (existingKeys.includes(key)) {
      setKeyMessage({ level: 'info', text: `${key} is already added` });
      return;
    }
    setKeyBusy(true);
    setKeyMessage(null);
    try {
      const response = await fetch(`/api/initiatives/${encodeURIComponent(key)}`);
      if (response.status === 404) {
        setKeyMessage({ level: 'error', text: `Initiative ${key} not found` });
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setKeyMessage({
          level: 'error',
          text: body.message ?? body.error ?? `Lookup failed (${response.status})`,
        });
        return;
      }
      const init = (await response.json()) as JiraInitiative;
      onAdd(init);
      setKeyInput('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setKeyMessage({ level: 'error', text: message });
    } finally {
      setKeyBusy(false);
    }
  };

  const handleLoadByLabel = async () => {
    const label = labelInput.trim();
    if (!label) return;
    setLabelBusy(true);
    setLabelMessage(null);
    try {
      const response = await fetch(
        `/api/initiatives/by-label?label=${encodeURIComponent(label)}`
      );
      const body = await response.json();
      if (!response.ok) {
        setLabelMessage({
          level: 'error',
          text: body.message ?? body.error ?? `Search failed (${response.status})`,
        });
        return;
      }
      const results = (body.results ?? []) as JiraInitiative[];
      const fresh = results.filter(i => !existingKeys.includes(i.key));
      if (fresh.length === 0) {
        setLabelMessage({
          level: 'info',
          text:
            results.length === 0
              ? `No initiatives found for label "${label}"`
              : 'All matching initiatives are already loaded',
        });
        return;
      }
      onBulkAdd(fresh);
      setLabelInput('');
      setLabelMessage({
        level: 'info',
        text: `Added ${fresh.length} initiative${fresh.length === 1 ? '' : 's'}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setLabelMessage({ level: 'error', text: message });
    } finally {
      setLabelBusy(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 280 }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label="Add initiative (key)"
            placeholder="INIT-123"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
            disabled={keyBusy}
            fullWidth
          />
          <Button
            variant="contained"
            onClick={handleAdd}
            disabled={keyBusy || keyInput.trim().length === 0}
          >
            Add
          </Button>
        </Box>
        {keyMessage && (
          <Alert severity={keyMessage.level === 'error' ? 'error' : 'info'} sx={{ py: 0 }}>
            {keyMessage.text}
          </Alert>
        )}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 280 }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label="Load by label"
            placeholder="fusion-q2"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLoadByLabel();
            }}
            disabled={labelBusy}
            fullWidth
          />
          <Button
            variant="contained"
            onClick={handleLoadByLabel}
            disabled={labelBusy || labelInput.trim().length === 0}
          >
            Load
          </Button>
        </Box>
        {labelMessage && (
          <Alert severity={labelMessage.level === 'error' ? 'error' : 'info'} sx={{ py: 0 }}>
            {labelMessage.text}
          </Alert>
        )}
      </Box>
    </Box>
  );
};

export default InitiativeControls;
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/fusion/InitiativeControls.tsx
git commit -m "feat(fusion): add InitiativeControls with add/load inputs"
```

---

## Task 12: `InitiativeChips` component

**Files:**
- Create: `frontend/components/fusion/InitiativeChips.tsx`

- [ ] **Step 1: Create component**

```tsx
'use client';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import type { JiraInitiative } from '@/shared/types';

interface InitiativeChipsProps {
  initiatives: JiraInitiative[];
  onRemove: (key: string) => void;
}

const truncate = (s: string, max = 40) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

const InitiativeChips = ({ initiatives, onRemove }: InitiativeChipsProps) => {
  if (initiatives.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Typography variant="caption" color="text.secondary">
        Loaded initiatives:
      </Typography>
      {initiatives.map((i) => (
        <Chip
          key={i.key}
          label={`${i.key} — ${truncate(i.summary)}`}
          onDelete={() => onRemove(i.key)}
          size="small"
          variant="outlined"
        />
      ))}
    </Box>
  );
};

export default InitiativeChips;
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/fusion/InitiativeChips.tsx
git commit -m "feat(fusion): add InitiativeChips component"
```

---

## Task 13: `StatusPie` chart

**Files:**
- Create: `frontend/components/fusion/StatusPie.tsx`

- [ ] **Step 1: Create component**

```tsx
'use client';

import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colorForStatus } from './statusColors';
import type { PieSlice } from './rollups';

interface StatusPieProps {
  slices: PieSlice[];
  selectedStatus: string | null;
  onSelect: (status: string) => void;
}

interface SvgSlice {
  status: string;
  color: string;
  pct: number;
  pathD: string;
  midAngle: number;
  offsetX: number;
  offsetY: number;
}

const R = 100;
const CX = 130;
const CY = 130;
const LABEL_R = 70;
const EXPLODE = 8;

const buildSvgSlices = (
  slices: PieSlice[],
  selectedStatus: string | null
): { svgSlices: SvgSlice[]; total: number } => {
  const total = slices.reduce((s, v) => s + v.points, 0);
  if (total === 0) return { svgSlices: [], total: 0 };

  const out: SvgSlice[] = [];
  let cursor = -Math.PI / 2;
  for (const slice of slices) {
    if (slice.points === 0) continue;
    const angle = (slice.points / total) * 2 * Math.PI;
    const start = cursor;
    const end = cursor + angle;
    const mid = cursor + angle / 2;

    const selected = selectedStatus === slice.status;
    const ox = selected ? Math.cos(mid) * EXPLODE : 0;
    const oy = selected ? Math.sin(mid) * EXPLODE : 0;

    const x1 = CX + ox + R * Math.cos(start);
    const y1 = CY + oy + R * Math.sin(start);
    const x2 = CX + ox + R * Math.cos(end);
    const y2 = CY + oy + R * Math.sin(end);
    const large = angle > Math.PI ? 1 : 0;

    out.push({
      status: slice.status,
      color: colorForStatus(slice.status),
      pct: Math.round((slice.points / total) * 100),
      pathD: `M ${CX + ox} ${CY + oy} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`,
      midAngle: mid,
      offsetX: ox,
      offsetY: oy,
    });
    cursor = end;
  }
  return { svgSlices: out, total };
};

const StatusPie = ({ slices, selectedStatus, onSelect }: StatusPieProps) => {
  const { svgSlices, total } = useMemo(
    () => buildSvgSlices(slices, selectedStatus),
    [slices, selectedStatus]
  );

  if (total === 0) {
    return (
      <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 6 }}>
        <Typography variant="body2">No points to chart</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5, textAlign: 'center' }}>
        Points by Status
      </Typography>
      <svg width={260} height={260} style={{ display: 'block' }}>
        {svgSlices.map((s) => {
          const dim = selectedStatus !== null && selectedStatus !== s.status;
          return (
            <g
              key={s.status}
              onClick={() => onSelect(s.status)}
              style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }}
            >
              <path
                d={s.pathD}
                fill={s.color}
                stroke="white"
                strokeWidth={selectedStatus === s.status ? 3 : 2}
              />
              {s.pct >= 8 && (
                <text
                  x={CX + s.offsetX + LABEL_R * Math.cos(s.midAngle)}
                  y={CY + s.offsetY + LABEL_R * Math.sin(s.midAngle) + 4}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight="bold"
                  fill="white"
                  style={{ pointerEvents: 'none' }}
                >
                  {s.pct}%
                </text>
              )}
            </g>
          );
        })}
        <circle cx={CX} cy={CY} r={R * 0.42} fill="white" />
        <text x={CX} y={CY - 6} textAnchor="middle" fontSize={11} fill="#555">
          total
        </text>
        <text
          x={CX}
          y={CY + 12}
          textAnchor="middle"
          fontSize={18}
          fontWeight="bold"
          fill="#333"
        >
          {total}
        </text>
      </svg>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
        {slices.map((s) => (
          <Box
            key={s.status}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              cursor: 'pointer',
              opacity:
                selectedStatus !== null && selectedStatus !== s.status ? 0.5 : 1,
            }}
            onClick={() => onSelect(s.status)}
          >
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: '2px',
                bgcolor: colorForStatus(s.status),
                flexShrink: 0,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {s.status}
            </Typography>
            <Typography variant="caption" fontWeight={600} sx={{ ml: 'auto' }}>
              {s.points}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default StatusPie;
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/fusion/StatusPie.tsx
git commit -m "feat(fusion): add StatusPie clickable donut chart"
```

---

## Task 14: `TeamStatusColumn` chart

**Files:**
- Create: `frontend/components/fusion/TeamStatusColumn.tsx`

- [ ] **Step 1: Create component**

```tsx
'use client';

import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colorForStatus } from './statusColors';
import type { TeamStack } from './rollups';

interface TeamStatusColumnProps {
  stacks: TeamStack[];
  selected: { team?: string; status?: string } | null;
  onSelectSegment: (team: string, status: string) => void;
  onSelectTeam: (team: string) => void;
}

const CHART_HEIGHT = 220;
const COL_WIDTH = 48;
const COL_GAP = 16;
const TOP_PAD = 20;
const BOTTOM_PAD = 40;
const LEFT_PAD = 40;

const TeamStatusColumn = ({
  stacks,
  selected,
  onSelectSegment,
  onSelectTeam,
}: TeamStatusColumnProps) => {
  const { maxTotal, allStatuses } = useMemo(() => {
    let max = 0;
    const statuses = new Set<string>();
    for (const s of stacks) {
      if (s.total > max) max = s.total;
      for (const k of Object.keys(s.byStatus)) statuses.add(k);
    }
    return {
      maxTotal: max,
      allStatuses: Array.from(statuses).sort((a, b) => a.localeCompare(b)),
    };
  }, [stacks]);

  if (stacks.length === 0 || maxTotal === 0) {
    return (
      <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 6 }}>
        <Typography variant="body2">No points to chart</Typography>
      </Box>
    );
  }

  const chartWidth = LEFT_PAD + stacks.length * (COL_WIDTH + COL_GAP);
  const innerHeight = CHART_HEIGHT - TOP_PAD - BOTTOM_PAD;

  const segmentDim = (team: string, status: string) => {
    if (!selected) return false;
    if (selected.team && selected.status) {
      return !(selected.team === team && selected.status === status);
    }
    if (selected.team) return selected.team !== team;
    if (selected.status) return selected.status !== status;
    return false;
  };

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5, textAlign: 'center' }}>
        Points by Team × Status
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <svg width={chartWidth} height={CHART_HEIGHT} style={{ display: 'block' }}>
          {/* Y-axis baseline */}
          <line
            x1={LEFT_PAD}
            y1={TOP_PAD + innerHeight}
            x2={chartWidth}
            y2={TOP_PAD + innerHeight}
            stroke="#ccc"
          />
          {/* Max label */}
          <text x={LEFT_PAD - 6} y={TOP_PAD + 4} fontSize={10} fill="#666" textAnchor="end">
            {maxTotal}
          </text>
          <text
            x={LEFT_PAD - 6}
            y={TOP_PAD + innerHeight + 4}
            fontSize={10}
            fill="#666"
            textAnchor="end"
          >
            0
          </text>

          {stacks.map((stack, colIdx) => {
            const xLeft = LEFT_PAD + colIdx * (COL_WIDTH + COL_GAP);
            // Build segments ordered by allStatuses for stable stacking
            let cursorY = TOP_PAD + innerHeight;
            const segments = allStatuses
              .filter(st => (stack.byStatus[st] ?? 0) > 0)
              .map(status => {
                const value = stack.byStatus[status];
                const h = (value / maxTotal) * innerHeight;
                cursorY -= h;
                return { status, value, y: cursorY, h };
              });

            return (
              <g key={stack.team}>
                {segments.map(seg => {
                  const dim = segmentDim(stack.team, seg.status);
                  return (
                    <rect
                      key={seg.status}
                      x={xLeft}
                      y={seg.y}
                      width={COL_WIDTH}
                      height={seg.h}
                      fill={colorForStatus(seg.status)}
                      stroke="white"
                      strokeWidth={1}
                      opacity={dim ? 0.35 : 1}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onSelectSegment(stack.team, seg.status)}
                    >
                      <title>{`${stack.team} · ${seg.status}: ${seg.value}`}</title>
                    </rect>
                  );
                })}
                {/* team label — clickable */}
                <text
                  x={xLeft + COL_WIDTH / 2}
                  y={TOP_PAD + innerHeight + 14}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={selected?.team === stack.team ? 700 : 400}
                  fill="#333"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelectTeam(stack.team)}
                >
                  {stack.team}
                </text>
                <text
                  x={xLeft + COL_WIDTH / 2}
                  y={TOP_PAD + innerHeight + 28}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#666"
                >
                  {stack.total}
                </text>
              </g>
            );
          })}
        </svg>
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1 }}>
        {allStatuses.map(status => (
          <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '2px',
                bgcolor: colorForStatus(status),
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {status}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default TeamStatusColumn;
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/fusion/TeamStatusColumn.tsx
git commit -m "feat(fusion): add TeamStatusColumn stacked chart"
```

---

## Task 15: `EpicList` grid

**Files:**
- Create: `frontend/components/fusion/EpicList.tsx`

- [ ] **Step 1: Create component**

```tsx
'use client';

import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import type { FusionEpic } from '@/shared/types';

interface EpicListProps {
  epics: FusionEpic[];
  jiraBaseUrl: string | undefined;
}

const pctColor = (pct: number) => {
  if (pct >= 80) return 'success';
  if (pct >= 40) return 'primary';
  return 'warning';
};

const EpicList = ({ epics, jiraBaseUrl }: EpicListProps) => {
  if (epics.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No epics to display.
        </Typography>
      </Paper>
    );
  }

  const colSx = { fontSize: '0.8rem', py: 0.75, px: 1.5 };
  const headerSx = {
    ...colSx,
    fontWeight: 700,
    bgcolor: 'grey.100',
    whiteSpace: 'nowrap' as const,
  };

  return (
    <TableContainer component={Paper} elevation={1} sx={{ maxHeight: '100%' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={headerSx}>Epic</TableCell>
            <TableCell sx={headerSx}>Summary</TableCell>
            <TableCell sx={headerSx}>Initiative</TableCell>
            <TableCell sx={headerSx}>Team</TableCell>
            <TableCell sx={headerSx}>Status</TableCell>
            <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Total Points</TableCell>
            <TableCell sx={{ ...headerSx, minWidth: 180 }}>% Complete</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {epics.map((e) => {
            const pct = e.totalPoints === 0 ? 0 : Math.round((e.donePoints / e.totalPoints) * 100);
            const keyCell = jiraBaseUrl ? (
              <Link href={`${jiraBaseUrl}/browse/${e.key}`} target="_blank" rel="noopener">
                {e.key}
              </Link>
            ) : (
              e.key
            );
            return (
              <TableRow key={e.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                <TableCell sx={colSx}>{keyCell}</TableCell>
                <TableCell sx={colSx}>{e.summary}</TableCell>
                <TableCell sx={colSx}>{e.initiativeKey}</TableCell>
                <TableCell sx={colSx}>{e.team}</TableCell>
                <TableCell sx={colSx}>{e.status}</TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right' }}>{e.totalPoints}</TableCell>
                <TableCell sx={colSx}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ flex: 1 }}>
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        color={pctColor(pct)}
                        sx={{ height: 8, borderRadius: 4 }}
                      />
                    </Box>
                    <Typography
                      variant="caption"
                      fontWeight={600}
                      sx={{ minWidth: 36, textAlign: 'right' }}
                    >
                      {pct}%
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default EpicList;
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/fusion/EpicList.tsx
git commit -m "feat(fusion): add EpicList grid"
```

---

## Task 16: `StoriesGrid`

**Files:**
- Create: `frontend/components/fusion/StoriesGrid.tsx`

- [ ] **Step 1: Create component**

```tsx
'use client';

import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import type { FusionStory } from '@/shared/types';

interface StoriesGridProps {
  stories: FusionStory[];
  jiraBaseUrl: string | undefined;
}

const StoriesGrid = ({ stories, jiraBaseUrl }: StoriesGridProps) => {
  if (stories.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No stories to display.
        </Typography>
      </Paper>
    );
  }

  const colSx = { fontSize: '0.8rem', py: 0.75, px: 1.5 };
  const headerSx = {
    ...colSx,
    fontWeight: 700,
    bgcolor: 'grey.100',
    whiteSpace: 'nowrap' as const,
  };

  return (
    <TableContainer component={Paper} elevation={1} sx={{ maxHeight: '100%' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={headerSx}>Story</TableCell>
            <TableCell sx={headerSx}>Summary</TableCell>
            <TableCell sx={headerSx}>Epic</TableCell>
            <TableCell sx={headerSx}>Status</TableCell>
            <TableCell sx={headerSx}>Assignee</TableCell>
            <TableCell sx={{ ...headerSx, textAlign: 'right' }}>Dev Days</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {stories.map((s) => {
            const keyCell = jiraBaseUrl ? (
              <Link href={`${jiraBaseUrl}/browse/${s.key}`} target="_blank" rel="noopener">
                {s.key}
              </Link>
            ) : (
              s.key
            );
            return (
              <TableRow key={s.key} hover sx={{ '&:nth-of-type(even)': { bgcolor: 'grey.50' } }}>
                <TableCell sx={colSx}>{keyCell}</TableCell>
                <TableCell sx={colSx}>{s.summary}</TableCell>
                <TableCell sx={colSx}>{s.epicKey}</TableCell>
                <TableCell sx={colSx}>{s.status}</TableCell>
                <TableCell sx={colSx}>{s.assignee ?? '—'}</TableCell>
                <TableCell sx={{ ...colSx, textAlign: 'right' }}>{s.devDays}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default StoriesGrid;
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/fusion/StoriesGrid.tsx
git commit -m "feat(fusion): add StoriesGrid"
```

---

## Task 17: Fusion barrel export + top-level components export

**Files:**
- Create: `frontend/components/fusion/index.ts`
- Modify: `frontend/components/index.ts`

- [ ] **Step 1: Create the fusion barrel**

```ts
export { default as InitiativeControls } from './InitiativeControls';
export { default as InitiativeChips } from './InitiativeChips';
export { default as StatusPie } from './StatusPie';
export { default as TeamStatusColumn } from './TeamStatusColumn';
export { default as EpicList } from './EpicList';
export { default as StoriesGrid } from './StoriesGrid';
export { colorForStatus, STATUS_COLORS } from './statusColors';
export {
  rollupByStatus,
  rollupByTeamAndStatus,
  applyFilter,
} from './rollups';
export type { ChartFilter, PieSlice, TeamStack } from './rollups';
```

- [ ] **Step 2: Add `export * from './fusion'` to `frontend/components/index.ts`**

Append:
```ts
export * from './fusion';
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/fusion/index.ts frontend/components/index.ts
git commit -m "feat(fusion): wire up barrel exports"
```

---

## Task 18: Fusion Status layout (metadata)

**Files:**
- Create: `app/fusion-status/layout.tsx`

- [ ] **Step 1: Create layout**

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Fusion Status',
};

const FusionStatusLayout = ({ children }: { children: React.ReactNode }) => {
  return children;
};

export default FusionStatusLayout;
```

- [ ] **Step 2: Commit (no build needed — component only referenced once page exists)**

```bash
git add app/fusion-status/layout.tsx
git commit -m "feat(fusion-status): add layout with page metadata"
```

---

## Task 19: Fusion Status page composition

**Files:**
- Create: `app/fusion-status/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Header,
  InitiativeControls,
  InitiativeChips,
  StatusPie,
  TeamStatusColumn,
  EpicList,
  StoriesGrid,
  rollupByStatus,
  rollupByTeamAndStatus,
  applyFilter,
} from '@/frontend/components';
import type { ChartFilter } from '@/frontend/components';
import { useFusionData } from '@/frontend/hooks';
import type { JiraInitiative } from '@/shared/types';

const jiraBaseUrl = process.env.NEXT_PUBLIC_JIRA_BASE_URL?.replace(/\/$/, '');

const readKeysFromUrl = (search: URLSearchParams): string[] => {
  const raw = search.get('initiatives') ?? '';
  return raw
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);
};

interface ConnectionStatus {
  connected: boolean;
  email?: string;
}

const FusionStatusContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
  });
  const [initiativeKeys, setInitiativeKeys] = useState<string[]>(() =>
    readKeysFromUrl(new URLSearchParams(searchParams.toString()))
  );
  const [filter, setFilter] = useState<ChartFilter | null>(null);
  const { data, isLoading, error, load, clear } = useFusionData();

  // Connection status (same pattern as app/page.tsx)
  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/auth/validate');
        const body = await response.json();
        setConnectionStatus({ connected: body.valid, email: body.email });
      } catch {
        setConnectionStatus({ connected: false });
      }
    })();
  }, []);

  // Keep URL param in sync with initiativeKeys
  useEffect(() => {
    const current = searchParams.get('initiatives') ?? '';
    const next = initiativeKeys.join(',');
    if (current === next) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next.length === 0) params.delete('initiatives');
    else params.set('initiatives', next);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }, [initiativeKeys, router, searchParams]);

  // Fetch whenever initiativeKeys changes
  useEffect(() => {
    if (initiativeKeys.length === 0) {
      clear();
      return;
    }
    load(initiativeKeys);
  }, [initiativeKeys, load, clear]);

  // Reset filter when data reloads from a different initiative set
  useEffect(() => {
    setFilter(null);
  }, [initiativeKeys]);

  const addInitiative = useCallback((init: JiraInitiative) => {
    setInitiativeKeys(prev => (prev.includes(init.key) ? prev : [...prev, init.key]));
  }, []);

  const bulkAddInitiatives = useCallback((inits: JiraInitiative[]) => {
    setInitiativeKeys(prev => {
      const seen = new Set(prev);
      const additions = inits.map(i => i.key).filter(k => !seen.has(k));
      return additions.length === 0 ? prev : [...prev, ...additions];
    });
  }, []);

  const removeInitiative = useCallback((key: string) => {
    setInitiativeKeys(prev => prev.filter(k => k !== key));
  }, []);

  const handlePieSelect = useCallback((status: string) => {
    setFilter(prev =>
      prev?.status === status && !prev.team ? null : { status }
    );
  }, []);

  const handleSegmentSelect = useCallback((team: string, status: string) => {
    setFilter(prev =>
      prev?.team === team && prev?.status === status ? null : { team, status }
    );
  }, []);

  const handleTeamSelect = useCallback((team: string) => {
    setFilter(prev =>
      prev?.team === team && !prev.status ? null : { team }
    );
  }, []);

  const displayedInitiatives = useMemo(() => {
    // Show whatever the server returned; if load failed and `data` is null
    // but keys exist, render placeholders so the user can still remove them.
    if (data) return data.initiatives;
    return initiativeKeys.map<JiraInitiative>(key => ({
      key,
      summary: '(loading…)',
      status: '',
      labels: [],
    }));
  }, [data, initiativeKeys]);

  const pieData = useMemo(() => rollupByStatus(data?.epics), [data?.epics]);
  const barData = useMemo(() => rollupByTeamAndStatus(data?.epics), [data?.epics]);
  const filteredEpics = useMemo(() => applyFilter(data?.epics, filter), [data?.epics, filter]);
  const filteredStories = useMemo(
    () => filteredEpics.flatMap(e => e.stories),
    [filteredEpics]
  );

  const hasInitiatives = initiativeKeys.length > 0;
  const hasEpics = (data?.epics.length ?? 0) > 0;
  const chartsHidden = !hasEpics;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header connectionStatus={connectionStatus} />

      <Box sx={{ flex: 1, overflow: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* Controls */}
        <InitiativeControls
          existingKeys={initiativeKeys}
          onAdd={addInitiative}
          onBulkAdd={bulkAddInitiatives}
        />
        <InitiativeChips
          initiatives={displayedInitiatives}
          onRemove={removeInitiative}
        />

        {error && <Alert severity="error">{error}</Alert>}

        {!hasInitiatives ? (
          <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 8 }}>
            <Typography variant="h6" gutterBottom>
              No initiatives loaded
            </Typography>
            <Typography variant="body2">
              Add an initiative by key, or load a batch by label, to get started.
            </Typography>
          </Box>
        ) : (
          <>
            {/* Charts row */}
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {isLoading && !hasEpics ? (
                <>
                  <Skeleton variant="rectangular" width={280} height={280} />
                  <Skeleton variant="rectangular" width={380} height={280} />
                </>
              ) : chartsHidden ? (
                <Alert severity="info" sx={{ flex: 1 }}>
                  No non-canceled epics found for these initiatives.
                </Alert>
              ) : (
                <>
                  <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, minWidth: 260 }}>
                    <StatusPie
                      slices={pieData}
                      selectedStatus={filter?.team ? null : filter?.status ?? null}
                      onSelect={handlePieSelect}
                    />
                  </Box>
                  <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, flex: 1, minWidth: 380 }}>
                    <TeamStatusColumn
                      stacks={barData}
                      selected={filter}
                      onSelectSegment={handleSegmentSelect}
                      onSelectTeam={handleTeamSelect}
                    />
                  </Box>
                </>
              )}
            </Box>

            {/* Grids row */}
            {hasEpics && (
              <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 400 }}>
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Epics{filter ? ' (filtered)' : ''}
                  </Typography>
                  {filteredEpics.length === 0 ? (
                    <Alert severity="info">
                      No epics match this selection — click the selected chart element again to clear the filter.
                    </Alert>
                  ) : (
                    <EpicList epics={filteredEpics} jiraBaseUrl={jiraBaseUrl} />
                  )}
                </Box>
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Stories
                  </Typography>
                  <StoriesGrid stories={filteredStories} jiraBaseUrl={jiraBaseUrl} />
                </Box>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
};

const FusionStatus = () => (
  <Suspense
    fallback={
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    }
  >
    <FusionStatusContent />
  </Suspense>
);

export default FusionStatus;
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: PASS (types compile, no lint errors).

- [ ] **Step 3: Commit**

```bash
git add app/fusion-status/page.tsx
git commit -m "feat(fusion-status): compose page with charts, grids, and initiative controls"
```

---

## Task 20: End-to-end manual verification

**Files:** none (runtime verification only)

- [ ] **Step 1: Run the dev server**

```bash
yarn dev
```

- [ ] **Step 2: Exercise the golden path**

Navigate to `http://localhost:3000/fusion-status`. Verify:

1. **Empty state** — page loads; "No initiatives loaded" message renders; controls visible.
2. **Add by key (success)** — enter a valid initiative key → clicks Add → chip appears; charts + grids appear; JIRA data matches expectations.
3. **Add by key (not found)** — enter `INIT-99999999` → inline "Initiative INIT-99999999 not found" error; no chip added.
4. **Add by key (duplicate)** — re-add an already-loaded key → inline "already added" info; no duplicate chip.
5. **Load by label** — enter a known label → all matching initiatives appear as chips; charts re-aggregate.
6. **URL persistence** — refresh the page → initiatives re-load from URL; chart selection resets (expected per spec).
7. **Pie click** — clicking a slice filters the epic grid to that status; stories grid reflects. Click again → clears.
8. **Stack segment click** — clicking a segment filters to that team+status; pie dims accordingly. Click same segment → clears.
9. **Team label click** — clicking a team label on the column filters to that team only.
10. **Remove initiative** — click ✕ on a chip → removed from URL; charts/grids update.
11. **Empty filter match** — pick a selection that yields 0 epics (if possible) → "No epics match" alert; click to clear.

- [ ] **Step 3: Inspect console for unmapped status warnings**

If `console.warn: [Fusion] no color mapped for status "X"` appears, record the status names. Either:
- Add the missing status(es) to `STATUS_COLORS` in `frontend/components/fusion/statusColors.ts`, commit, or
- Defer as a follow-up (fallback color is acceptable).

- [ ] **Step 4: Final build + lint gate**

```bash
yarn lint
yarn build
```
Both must pass.

- [ ] **Step 5: Final commit if any cleanup was made**

```bash
git status
# if dirty:
git add -A
git commit -m "chore(fusion): post-verification cleanup"
```

---

## Self-Review Notes

Ran the self-review checklist against the spec:

**Spec coverage:**
- Q1 (build fresh) → Task 19 creates the page; we do not merge `CurrentSprint`.
- Q2 (label-based bulk load) → Task 6 endpoint + Task 11 input.
- Q3 (two side-by-side inputs) → Task 11 lays them out side by side.
- Q4 (Initiative as issuetype; `parent = INIT-x`) → Task 3 (`getEpicsForInitiatives`) and Task 7 both rely on this.
- Q5 (team = project key prefix) → Task 7 `computeTeam` helper.
- Q6 (status names; exclude Canceled) → Task 3 (`getEpicsForInitiatives` JQL `status != "Canceled"`).
- Q7 (hardcoded color map, fallback + warn) → Task 8.
- Q8 (single selection, click again clears) → Task 19 selection handlers (`handlePieSelect`, `handleSegmentSelect`, `handleTeamSelect`).
- Q9 (epic list left, stories grid right, stories = all epics in list) → Task 19 grids row; `filteredStories = filteredEpics.flatMap(e => e.stories)`.
- Q10 (initiatives in URL, selection ephemeral) → Task 19 URL sync effect; `filter` lives in component state, not URL.
- Q11 (Dev Days field) → Task 7 uses `client.getFieldConfig().devDays`.
- Q12 (total = Σ story Dev Days; bucket by epic's own status) → Task 7 rollup builds `totalsByEpic`; epic uses `e.fields.status.name`.
- Q13 (grid columns as listed) → Tasks 15 and 16 match.

**Placeholder scan:** No TBD / TODO / "similar to" references. Every code-changing step has the full code.

**Type consistency:**
- `FusionData` / `FusionEpic` / `FusionStory` defined in Task 2; every reference in Tasks 7, 10, 15, 16, 19 matches the field set (`key`, `summary`, `initiativeKey`, `team`, `status`, `totalPoints`, `donePoints`, `stories`).
- `ChartFilter` defined in Task 9; used in Task 19 via `@/frontend/components` barrel. Barrel export re-declared in Task 17 — names match.
- `StatusPie.selectedStatus` (Task 13) vs Task 19 `handlePieSelect` — both use `string | null`. ✓
- `TeamStatusColumn.selected` (Task 14) shape `{ team?: string; status?: string } | null` — matches `ChartFilter` shape. ✓
- `useFusionData` return (Task 10) — `{ data, isLoading, error, load, clear }` — consumed in Task 19 as same names. ✓
- Color map exports (Task 8) `STATUS_COLORS`, `colorForStatus` — re-exported in Task 17. ✓

No gaps found.
