# Fusion Status Page — Design

**Date:** 2026-04-17
**Status:** Approved

## Context

The existing `app/fusion-status/page.tsx` (on the `CurrentSprint` branch of the main working copy) is a mock/static prototype with hard-coded `OVERALL_STATUS`, `L2_STATUS`, and `EPIC_ROWS` data, two pie charts, and a single epic grid. This worktree was branched from `main` and does not currently contain the page, so we are building it fresh (user chose option A in brainstorming). "Remove all existing content" means none of the mock data, component structure, or L2 dropdown is retained.

The new page presents JIRA initiatives, their child epics, and the stories underneath those epics — aggregated into visual summaries (a pie and a stacked column chart) with click-to-filter interaction driving two linked grids.

## Goals

- Let a user load one or more JIRA initiatives, either by exact key or in bulk by label.
- Show aggregated Dev Days totals across all loaded initiatives in two charts:
  - Pie: total points by epic status.
  - Stacked column: total points by team, stacked by status.
- Enable click-to-filter: selecting a chart element filters the two grids below.
- Display a filter-aware epic list next to a stories grid reflecting those epics.

## Non-Goals

- Pagination / virtualization of the grids.
- Export / printable view.
- Persisting chart selection in the URL.
- Editing initiatives, epics, or stories from the page (read-only).
- Cross-page state sharing with the main GANTT page.

## Product Decisions (from brainstorming)

| # | Decision |
|---|----------|
| Q1 | Build fresh in this worktree; do not merge `CurrentSprint` first. |
| Q2 | Bulk-load path matches initiatives by **label**, not by epic relation. |
| Q3 | **Two separate inputs** side by side: "Add initiative (key)" and "Load by label." |
| Q4 | Initiative is a **JIRA issue type**; epics have `parent = INIT-xxx`. |
| Q5 | Team identity = the **JIRA project key** (prefix of the epic key). |
| Q6 | Status buckets are **status names** (Backlog, In Progress, Resolved, In Test, …); exclude epics with status `Canceled`. |
| Q7 | **Hardcoded color map** for known statuses; neutral fallback for unknowns. |
| Q8 | Chart clicks **filter grids only**; single selection across both charts; click again to clear. |
| Q9 | Epic list left, stories grid right; stories grid shows stories for **all epics currently in the epic list**. |
| Q10 | **Initiatives in URL**, chart selection ephemeral. |
| Q11 | Points field = **Dev Days** (`JIRA_FIELD_DEV_DAYS`), same as the rest of the app. |
| Q12 | "Total points" = **sum of Dev Days from child stories**, bucketed by the epic's own status. |
| Q13 | Default grid columns approved. |

## Architecture

**Pattern:** thick backend, thin client — mirrors the existing `/api/gantt/data` endpoint.

Three new API endpoints return fully-joined, pre-rolled data. The client holds state, renders, and handles chart filtering locally without refetching.

## Page Layout

```
┌─────────────────────────── Header ─────────────────────────────┐
├────────────────────────────────────────────────────────────────┤
│ [Add Initiative: INIT-__] [Add]   [Load by Label: ___] [Load] │
│ Loaded:  [INIT-101 ✕] [INIT-205 ✕] [INIT-330 ✕]               │
├────────────────────────────────────────────────────────────────┤
│ ┌─ Points by Status ─┐  ┌─ Points by Team × Status ─────────┐ │
│ │     pie (donut)     │  │    stacked columns                │ │
│ └─────────────────────┘  └───────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────┤
│ ┌─ Epic list (filter-aware) ─┐  ┌─ Stories grid ─────────────┐ │
│ │ Key|Summary|Init|Team|Status│  │Key|Summary|Epic|Status|    │ │
│ │ Total Pts | % Complete      │  │Assignee|Dev Days           │ │
│ └─────────────────────────────┘  └───────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

Three stacked bands below the header: **controls**, **charts**, **grids**. Full-height page with the grids band scrolling internally. MUI Table with sticky headers for both grids.

## Data Model

### Shared types

`shared/types/jira.ts` (add):
```ts
export interface JiraInitiative {
  key: string;
  summary: string;
  status: string;
  labels: string[];
}
```

`shared/types/fusion.ts` (new):
```ts
export interface FusionStory {
  key: string;
  summary: string;
  epicKey: string;
  status: string;
  assignee: string | null;
  devDays: number;
}

export interface FusionEpic {
  key: string;
  summary: string;
  initiativeKey: string;
  team: string;          // JIRA project key (prefix of epic key)
  status: string;        // epic's own status name
  totalPoints: number;   // Σ devDays across child stories
  donePoints: number;    // Σ devDays where child story has statusCategory === 'done'
  stories: FusionStory[];
}

export interface FusionData {
  initiatives: JiraInitiative[];
  epics: FusionEpic[];   // Canceled epics excluded server-side
}
```

### Rollup rules (computed server-side)

- `totalPoints` = sum of Dev Days on child stories (null → 0).
- `donePoints` = sum of Dev Days on child stories whose JIRA `statusCategory.key === 'done'`.
- `% complete` = `donePoints / totalPoints` (derived on the client to avoid divide-by-zero serialization).
- Epics with status name `Canceled` are **excluded** from the response entirely.

### Color map

`frontend/components/fusion/statusColors.ts` — hardcoded:

| Status name   | Color intent           |
|---------------|------------------------|
| Backlog       | grey                   |
| In Progress   | blue                   |
| In Test       | amber                  |
| Code Review   | purple                 |
| Resolved      | green                  |
| Done          | dark green             |
| (unknown)     | neutral grey + warn    |

Unknown statuses render with a neutral fill and emit a single `console.warn` so unmapped names surface for curation.

## Backend

### Endpoints

#### `GET /api/initiatives/[key]`

Validate + fetch a single initiative.
- JQL: `key = {KEY} AND issuetype = Initiative`
- Response: `JiraInitiative` (200) or 404.

#### `GET /api/initiatives/by-label?label={value}`

All initiatives matching a label.
- JQL: `issuetype = Initiative AND labels = "{value}" ORDER BY key ASC`
- Response: `JiraInitiative[]` (may be empty; empty is not an error).
- 400 if `label` query param is missing/empty.

#### `GET /api/fusion/data?initiatives={csv}`

Primary page data. Sequence:

1. **Fetch initiatives** — one JQL: `key in (K1,K2,…) AND issuetype = Initiative`.
2. **Fetch child epics** — one JQL: `parent in (K1,K2,…) AND issuetype = Epic AND status != "Canceled"`.
3. **Fetch child stories** — one JQL: `("Epic Link" in (E1,E2,…) OR parent in (E1,E2,…)) AND issuetype != Epic`.
4. **Roll up** server-side: group stories by epic (via `parent` or epic-link field), sum Dev Days, compute `donePoints` using `statusCategory.key === 'done'`.
5. **Derive team** as the project key portion of the epic key (`"OFE-123".split('-')[0]`).
6. Return `FusionData`.

Total JIRA round trips: **3**, independent of initiative/epic/story counts. Pattern matches `/api/gantt/data`.

### Error handling

- Missing/empty `initiatives` param → **400** with a user-readable message.
- JIRA API errors → **502**, passing through the upstream message (matches existing endpoint behavior).
- Initiative keys in the query string that don't resolve in JIRA are **silently omitted** from `initiatives[]`; the client can notice the mismatch by comparing its URL list against the response.

### `JiraClient` additions (`backend/jira/client.ts`)

```ts
getInitiativeByKey(key: string): Promise<JiraIssueResponse | null>
searchInitiativesByLabel(label: string): Promise<JiraIssueResponse[]>
getEpicsForInitiatives(initiativeKeys: string[]): Promise<JiraIssueResponse[]>
getStoriesForEpics(epicKeys: string[]): Promise<JiraIssueResponse[]>
```

All layer on the existing `searchIssues` / `fetch` helpers. No direct HTTP logic duplicated.

### Environment variables

No new env vars required. Page uses `JIRA_FIELD_DEV_DAYS` and `JIRA_FIELD_EPIC_LINK`, both already defined.

## Frontend

### Component tree

```
app/fusion-status/page.tsx
└─ <FusionStatusContent>
   ├─ <Header>                     (existing shared component)
   ├─ <InitiativeControls>         two inputs + Add/Load buttons
   ├─ <InitiativeChips>            loaded-list chips with ✕ remove
   ├─ <ChartsRow>
   │  ├─ <StatusPie>               points by status, clickable
   │  └─ <TeamStatusColumn>        stacked columns, clickable
   └─ <GridsRow>
      ├─ <EpicList>                left grid, honors filter
      └─ <StoriesGrid>             right grid, stories of listed epics
```

New folder `frontend/components/fusion/`. No sidebar on this page.

### State model (in `page.tsx`)

```ts
const [initiativeKeys, setInitiativeKeys] = useState<string[]>([]);    // URL-backed
const [data, setData] = useState<FusionData | null>(null);
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
const [filter, setFilter] = useState<
  { status?: string; team?: string } | null
>(null);                                                                // ephemeral
```

**URL param:** `?initiatives=INIT-1,INIT-2` — read on mount, written on add/remove. Chart selection deliberately stays in component state (per Q10.B); refresh clears it.

**Fetch effect:** whenever `initiativeKeys` changes non-trivially (same comma-joined string as the gantt page's pattern), fetch `/api/fusion/data?initiatives=…`. Empty list → clear `data`, no fetch.

### Derived values (client-side, memoized)

```ts
const pieData         = rollupByStatus(data?.epics)              // Σ points per status
const barData         = rollupByTeamAndStatus(data?.epics)       // {team → {status → points}}
const filteredEpics   = applyFilter(data?.epics, filter)         // intersect status + team
const filteredStories = filteredEpics.flatMap(e => e.stories)
```

### Charts

Hand-rolled SVG (same approach as the existing mock). No new charting dependency.

- **`StatusPie`** — donut. `onSliceClick(status)` toggles `filter.status`. Selected slice drawn with thicker stroke and a slight outward radial offset; non-selected slices dim. Legend below.
- **`TeamStatusColumn`** — grouped bars: one column per team, stacked by status. Click handlers:
  - Segment click → `filter = {team, status}`.
  - Column x-axis label click → `filter = {team}` only.
  - Clicking the same selection again → clears to `null`.

**Single-selection rule (Q8.A):** clicking anywhere in the pie clears any stack selection and vice versa. At most one active filter across both charts at a time.

### Inputs

- **Add initiative** — text field + Add button.
  - On submit → `GET /api/initiatives/[key]`.
  - 200: push key into `initiativeKeys` (dedup).
  - 404: inline error beside the field.
  - Already loaded: inline "already added."
- **Load by label** — text field + Load button.
  - On submit → `GET /api/initiatives/by-label?label=…`.
  - Appends all returned keys (dedup). Does **not** clear existing initiatives.
  - Zero results: inline "no initiatives found for label '{value}'."

### Chips

Each loaded initiative renders as an MUI `<Chip>` showing `KEY — short summary` with an ✕ delete handler that removes the key from `initiativeKeys` (and from the URL).

### Empty / loading states

- **No initiatives loaded** → everything below the chips row shows "Add an initiative to get started."
- **Initiatives loaded but 0 epics** → charts hidden; grids show "No non-canceled epics found for these initiatives."
- **Filter selected but 0 matches** → grids show "No epics match this selection — click again to clear filter."
- **Loading** → skeleton on charts + spinner over grids; existing data is **not** unmounted during re-fetch to avoid flicker.

## Files

### New

```
app/fusion-status/page.tsx
app/fusion-status/layout.tsx
app/api/initiatives/[key]/route.ts
app/api/initiatives/by-label/route.ts
app/api/fusion/data/route.ts

shared/types/fusion.ts

frontend/components/fusion/InitiativeControls.tsx
frontend/components/fusion/InitiativeChips.tsx
frontend/components/fusion/StatusPie.tsx
frontend/components/fusion/TeamStatusColumn.tsx
frontend/components/fusion/EpicList.tsx
frontend/components/fusion/StoriesGrid.tsx
frontend/components/fusion/statusColors.ts
frontend/components/fusion/rollups.ts
frontend/components/fusion/index.ts

frontend/hooks/useFusionData.ts
```

### Modified

```
backend/jira/client.ts          add 4 methods (initiative by key, by label, epics, stories)
shared/types/jira.ts            add JiraInitiative
shared/types/index.ts           re-export fusion types
frontend/components/index.ts    re-export fusion components
frontend/hooks/index.ts         re-export useFusionData
```

No changes to `app/page.tsx`, sidebar components, `backend/jira/mappers.ts` (new mapping stays local to fusion), or any existing API route.

## Risks & Assumptions

1. **Team granularity via project key.** If two teams share a JIRA project, the stacked column groups them into one column. Accepted per Q5.B; can be revisited if it becomes a pain point.
2. **Color map will miss statuses on first contact** with some projects. Fallback is neutral grey + `console.warn` so unmapped names surface and can be added.
3. **Initiative issue-type name = "Initiative".** Confirm against the live JIRA instance before merge; if it's actually `Theme` / `Program`, the JQL literal needs updating (one string).
4. **Dev Days are tracked on stories, not epics.** Stories with null Dev Days understate the epic's `totalPoints`. Explicitly accepted (Q12.B).
5. **Stacked column hit-testing** is fine for expected ~5–15 teams × ~5 statuses. If team count exploded past ~30 a scrollable/paginated chart would be needed — not designed for today.

## Testing

- Unit-test the rollup helpers (`rollupByStatus`, `rollupByTeamAndStatus`, `applyFilter`) with synthetic epic data — pure functions, easy to cover.
- Unit-test `JiraClient` additions by stubbing the `fetch` method and asserting JQL strings.
- Manual verification in the browser against real JIRA data: load one initiative, verify totals match the sum of Dev Days on children; click a pie slice and confirm the epic list filters; click again and confirm it clears.
- Type-checking (`tsc --noEmit`) and lint both pass.

## Open Questions (non-blocking)

- Exact initiative issue-type name in this JIRA instance (see Risk 3).
- Initial color-map entries beyond the six listed above — additions are additive and low-risk.
