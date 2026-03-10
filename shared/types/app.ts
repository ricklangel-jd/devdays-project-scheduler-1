import type { SprintCapacity } from './scheduling';

/**
 * Application state stored in URL query params
 * This enables shareable URLs
 */
export interface AppState {
  projectKey?: string;             // Selected JIRA project key
  boardId?: number;                // Selected JIRA board ID
  epicKeys: string[];              // Selected epic keys (e.g., ["PROJ-1", "PROJ-2"])
  sprintCapacities: SprintCapacity[]; // Selected sprints with their capacities
  viewStartDate?: string;          // Chart X-axis start date (ISO)
  viewEndDate?: string;            // Chart X-axis end date (ISO)
  maxDevelopers: number;           // Points per day capacity (e.g., 5 devs = 5 pts/day)
}

/**
 * Default app state
 */
export const DEFAULT_APP_STATE: AppState = {
  epicKeys: [],
  sprintCapacities: [],
  maxDevelopers: 5,
};

/**
 * Query param keys
 */
export const QUERY_PARAM_KEYS = {
  PROJECT: 'project',
  BOARD: 'board',
  EPICS: 'epics',
  SPRINTS: 'sprints',
  START_DATE: 'start',
  END_DATE: 'end',
  MAX_DEVS: 'maxDevs',
  DAILY_CAPS: 'dc',
  SPRINT_DATES: 'sprintDates',
  AUTO_ADJUST_START: 'autoAdjust',
  SIDEBAR_COLLAPSED: 'sb',
  PI_LABELS: 'piLabels',
  DEVS: 'devs',
  PI_SPRINTS: 'piSprints',
  PI_DAYS_OFF: 'piDaysOff',
  SUPPORT_PCT: 'supportPct',
  SC_SPRINTS: 'scSprints',
  SV_FUTURE_SPRINTS: 'svFutureSprints',
  TS_PI_LABELS: 'tsPiLabels',
  TS_PI_SPRINTS: 'tsPiSprints',
  PP_PI: 'ppPi',
  PP_SUPPORT_PCT: 'ppSup',
  PP_EXCLUDE_S7: 'ppNoS7',
  PP_DAYS_OFF: 'ppDaysOff',
  SM_SELECTIONS: 'smSel',
  SM_SPRINTS_BACK: 'smBack',
  SM_CAPACITIES: 'smCap',
} as const;

/**
 * Associates sprint IDs with a PI label for capacity-demand sprint filtering
 */
export interface PiSprintAssignment {
  piLabel: string;
  sprintIds: number[];
}

/**
 * Sprint date override - allows manually overriding JIRA sprint dates
 */
export interface SprintDateOverride {
  sprintId: number;
  startDate: string;  // ISO date (YYYY-MM-DD)
  endDate: string;    // ISO date (YYYY-MM-DD)
}
