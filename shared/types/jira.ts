/**
 * JIRA Data Types
 * These represent data as it comes from the JIRA API
 */

/**
 * Commit type for epics - determines scheduling priority (three tiers)
 * - 'commit': Highest priority epics that are scheduled first
 * - 'stretch': Medium priority epics that fill gaps after commits
 * - 'none': Lowest priority epics that are scheduled last
 */
export type CommitType = 'commit' | 'stretch' | 'none';

export interface JiraEpic {
  key: string;           // e.g., "PROJ-123"
  summary: string;       // Epic title
  status: string;        // e.g., "In Progress"
  commitType: CommitType; // From labels: "Commit" or "Stretch" (default: none)
  priorityOverride?: number; // From labels like "Commit-1", "Stretch-2" for manual ordering
}

export interface JiraInitiative {
  key: string;         // e.g., "INIT-100"
  summary: string;
  status: string;      // e.g., "In Progress"
  labels: string[];
}

export interface JiraTicket {
  key: string;           // e.g., "PROJ-456"
  summary: string;       // Ticket title
  status: string;
  statusCategoryKey?: string; // Jira status category key: 'new' | 'indeterminate' | 'done'
  epicKey: string;       // Parent epic key
  devDays: number;       // Custom field: Story Points / Dev Days (default: 5 if missing)
  blockedBy?: string[];  // Ticket keys that block this ticket
  assignee?: string;
  assigneeAvatarUrl?: string; // Profile photo URL from JIRA
  isMissingEstimate: boolean; // True if devDays was defaulted (no estimate in JIRA)
  sprintIds?: number[];  // Sprint IDs from JIRA (ticket can be in multiple sprints)
  resolutionDate?: string | null; // ISO date string when the ticket was resolved/completed
  pinnedStartDate?: string; // ISO date string from JIRA custom field - pins ticket to exact start date
}

export interface JiraSprint {
  id: number;
  name: string;
  state: 'active' | 'closed' | 'future';
  startDate: string;     // ISO date string
  endDate: string;       // ISO date string
  originBoardId?: number;
}

/**
 * JIRA issue link structure
 */
export interface JiraIssueLink {
  id: string;
  type: {
    id: string;
    name: string;
    inward: string;   // e.g., "is blocked by"
    outward: string;  // e.g., "blocks"
  };
  inwardIssue?: {
    key: string;
    fields: {
      summary: string;
    };
  };
  outwardIssue?: {
    key: string;
    fields: {
      summary: string;
    };
  };
}

/**
 * Raw JIRA API response types
 */
export interface JiraIssueResponse {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: JiraIssueStatus;
    assignee?: {
      displayName: string;
      avatarUrls?: {
        '48x48'?: string;
        '32x32'?: string;
        '24x24'?: string;
        '16x16'?: string;
      };
    } | null;
    parent?: {
      key: string;
    };
    labels?: string[]; // JIRA labels array
    issuelinks?: JiraIssueLink[]; // Issue links for blockers
    [key: string]: unknown; // Custom fields accessed by ID
  };
}

export interface JiraSprintResponse {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  originBoardId?: number;
}

export interface JiraSearchResponse {
  issues: JiraIssueResponse[];
  total: number;
  maxResults: number;
  startAt: number;
  nextPageToken?: string;
}

export interface JiraProject {
  key: string;      // e.g., "PROJ"
  name: string;     // e.g., "Project Name"
}

export interface JiraBoard {
  id: number;
  name: string;
  type: string;     // 'scrum' | 'kanban' | 'simple'
}

export interface JiraProjectResponse {
  key: string;
  name: string;
}

export interface JiraBoardResponse {
  id: number;
  name: string;
  type: string;
}

/**
 * Board configuration types for column/status mapping
 */
export interface JiraStatusCategory {
  id: number;
  key: string;  // 'new' | 'indeterminate' | 'done'
  name: string;
}

/**
 * Issue status with optional category information
 */
export interface JiraIssueStatus {
  name: string;
  statusCategory?: JiraStatusCategory;
}

/**
 * Status as returned in board column configuration (minimal info)
 */
export interface JiraBoardColumnStatus {
  id: string;
}

export interface JiraBoardColumn {
  name: string;
  statuses: JiraBoardColumnStatus[];
}

export interface JiraBoardConfigResponse {
  columnConfig: {
    columns: JiraBoardColumn[];
  };
}

/**
 * Row data for the epic stories grid on the Capacity v Demand page
 */
export interface EpicStoryRow {
  key: string;
  summary: string;
  storyPoints: number | null;       // Raw devDays custom field value (null if missing)
  storyPointEstimate: number | null; // Raw story_point_estimate field value (null if missing)
  sprintName: string | null;         // Name of the latest sprint (by start date)
  status: string;
  assignee: string | null;
}

/**
 * Full status details from /rest/api/3/status endpoint
 */
export interface JiraStatusResponse {
  id: string;
  name: string;
  statusCategory: JiraStatusCategory;
}
