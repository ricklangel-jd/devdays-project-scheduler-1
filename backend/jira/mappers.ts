import type {
  CommitType,
  JiraEpic,
  JiraInitiative,
  JiraTicket,
  JiraSprint,
  JiraProject,
  JiraBoard,
  JiraIssueResponse,
  JiraSprintResponse,
  JiraProjectResponse,
  JiraBoardResponse,
  JiraIssueLink,
  OtherTicket,
} from '@/shared/types';

/**
 * Field configuration for mapping custom fields
 */
export interface FieldConfig {
  devDays: string;
  sprint: string;
  sprintPointEstimate?: string; // Optional: manager/tech lead estimate for unpointed tickets
  epicLink: string;
  plannedStartDate?: string; // Optional: custom field to write scheduled start date
  plannedEndDate?: string; // Optional: custom field to write scheduled end date
  pinnedStartDate?: string; // Optional: custom field for pinning ticket to exact start date
}

/**
 * Parse commit type and priority override from labels
 * Supports: "Commit", "Commit-1", "Stretch", "Stretch-2", etc.
 */
const parseCommitLabel = (labels: string[] = []): { commitType: CommitType; priorityOverride?: number } => {
  for (const label of labels) {
    const lowerLabel = label.toLowerCase();

    // Check for "Commit-N" pattern
    const commitMatch = lowerLabel.match(/^commit-?(\d+)?$/);
    if (commitMatch) {
      return {
        commitType: 'commit',
        priorityOverride: commitMatch[1] ? parseInt(commitMatch[1], 10) : undefined,
      };
    }

    // Check for "Stretch-N" pattern
    const stretchMatch = lowerLabel.match(/^stretch-?(\d+)?$/);
    if (stretchMatch) {
      return {
        commitType: 'stretch',
        priorityOverride: stretchMatch[1] ? parseInt(stretchMatch[1], 10) : undefined,
      };
    }
  }

  // Default to 'none' if no commit/stretch label found (lowest priority tier)
  return { commitType: 'none' };
};

/**
 * Map a JIRA issue response to a JiraEpic
 */
export const mapToEpic = (issue: JiraIssueResponse): JiraEpic => {
  const { commitType, priorityOverride } = parseCommitLabel(issue.fields.labels);

  return {
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    commitType,
    priorityOverride,
  };
};

/**
 * Default story points when no estimate is provided
 */
const DEFAULT_DEV_DAYS = 5;

/**
 * Extract blocker relationships from issue links
 * Returns an array of ticket keys that block this ticket
 */
const extractBlockedBy = (issuelinks: JiraIssueLink[] = []): string[] => {
  const blockedBy: string[] = [];

  for (const link of issuelinks) {
    // Check if this is a "Blocks" type link where another issue blocks this one
    // When inwardIssue exists with "Blocks" type, it means inwardIssue blocks this ticket
    if (link.type.name === 'Blocks' && link.inwardIssue) {
      blockedBy.push(link.inwardIssue.key);
    }
  }

  return blockedBy;
};

/**
 * Extract sprint IDs from JIRA sprint field
 * The sprint field can be an array of sprint objects with id property
 */
const extractSprintIds = (sprintField: unknown): number[] => {
  if (!sprintField) return [];

  // JIRA returns sprints as an array of objects with id property
  if (Array.isArray(sprintField)) {
    return sprintField
      .filter((s): s is { id: number } => s && typeof s === 'object' && typeof s.id === 'number')
      .map((s) => s.id);
  }

  return [];
};

/**
 * Map a JIRA issue response to a JiraTicket
 */
export const mapToTicket = (
  issue: JiraIssueResponse,
  epicKey: string,
  fieldConfig: FieldConfig
): JiraTicket => {
  const devDaysValue = issue.fields[fieldConfig.devDays];

  // Check if team estimate is present (null, undefined, 0, or non-number means missing)
  const hasEstimate = typeof devDaysValue === 'number' && devDaysValue > 0;

  // If no team estimate, check for manager/tech lead sprint point estimate as fallback
  let devDays: number;
  if (hasEstimate) {
    devDays = devDaysValue;
  } else if (fieldConfig.sprintPointEstimate) {
    const sprintPointValue = issue.fields[fieldConfig.sprintPointEstimate];
    devDays = typeof sprintPointValue === 'number' && sprintPointValue > 0
      ? sprintPointValue
      : DEFAULT_DEV_DAYS;
  } else {
    devDays = DEFAULT_DEV_DAYS;
  }

  // Extract blocker relationships from issue links
  const blockedBy = extractBlockedBy(issue.fields.issuelinks);

  // Extract pinned start date from custom field
  const pinnedStartDateValue = fieldConfig.pinnedStartDate
    ? issue.fields[fieldConfig.pinnedStartDate]
    : undefined;
  const pinnedStartDate = typeof pinnedStartDateValue === 'string' ? pinnedStartDateValue : undefined;

  // Extract sprint IDs from sprint field
  const sprintField = issue.fields[fieldConfig.sprint];
  const sprintIds = extractSprintIds(sprintField);

  const resolutionDateValue = issue.fields['resolutiondate'];
  const resolutionDate = typeof resolutionDateValue === 'string' ? resolutionDateValue : null;

  return {
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    statusCategoryKey: issue.fields.status.statusCategory?.key,
    epicKey,
    devDays,
    blockedBy,
    assignee: issue.fields.assignee?.displayName,
    assigneeAvatarUrl: issue.fields.assignee?.avatarUrls?.['24x24'],
    isMissingEstimate: !hasEstimate,
    sprintIds,
    resolutionDate,
    pinnedStartDate,
  };
};

/**
 * Map a JIRA sprint response to a JiraSprint
 */
export const mapToSprint = (sprint: JiraSprintResponse): JiraSprint => ({
  id: sprint.id,
  name: sprint.name,
  state: sprint.state as 'active' | 'closed' | 'future',
  startDate: sprint.startDate ?? '',
  endDate: sprint.endDate ?? '',
  originBoardId: sprint.originBoardId,
});

/**
 * Map multiple issues to epics
 */
export const mapToEpics = (issues: JiraIssueResponse[]): JiraEpic[] =>
  issues.map(mapToEpic);

/**
 * Map multiple issues to tickets
 */
export const mapToTickets = (
  issues: JiraIssueResponse[],
  epicKey: string,
  fieldConfig: FieldConfig
): JiraTicket[] =>
  issues.map((issue) => mapToTicket(issue, epicKey, fieldConfig));

/**
 * Map multiple sprints
 */
export const mapToSprints = (sprints: JiraSprintResponse[]): JiraSprint[] =>
  sprints.map(mapToSprint);

/**
 * Map a JIRA project response to a JiraProject
 */
export const mapToProject = (project: JiraProjectResponse): JiraProject => ({
  key: project.key,
  name: project.name,
});

/**
 * Map multiple projects
 */
export const mapToProjects = (projects: JiraProjectResponse[]): JiraProject[] =>
  projects.map(mapToProject);

/**
 * Map a JIRA board response to a JiraBoard
 */
export const mapToBoard = (board: JiraBoardResponse): JiraBoard => ({
  id: board.id,
  name: board.name,
  type: board.type,
});

/**
 * Map multiple boards
 */
export const mapToBoards = (boards: JiraBoardResponse[]): JiraBoard[] =>
  boards.map(mapToBoard);

/**
 * Extract epic key from a JIRA issue response
 * Checks parent field first, then epic link custom field
 */
export const extractEpicKey = (
  issue: JiraIssueResponse,
  fieldConfig: FieldConfig
): string | null => {
  const epicLinkField = issue.fields[fieldConfig.epicLink] as string | { key?: string } | null | undefined;
  let epicKey: string | null = issue.fields.parent?.key ?? null;
  if (!epicKey && epicLinkField) {
    if (typeof epicLinkField === 'string') {
      epicKey = epicLinkField;
    } else if (typeof epicLinkField === 'object' && 'key' in epicLinkField && typeof epicLinkField.key === 'string') {
      epicKey = epicLinkField.key;
    }
  }
  return epicKey;
};

/**
 * Map a JIRA issue to a JiraTicket, auto-discovering the epic key
 * Returns the ticket and the discovered epic key (null if no epic)
 */
export const mapToTicketAutoEpic = (
  issue: JiraIssueResponse,
  fieldConfig: FieldConfig
): { ticket: JiraTicket; epicKey: string | null } => {
  const epicKey = extractEpicKey(issue, fieldConfig);
  const ticket = mapToTicket(issue, epicKey ?? '__NO_EPIC__', fieldConfig);
  return { ticket, epicKey };
};

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

/**
 * Map a JIRA issue to an OtherTicket (not in selected epics)
 */
export const mapToOtherTicket = (
  issue: JiraIssueResponse,
  sprintId: number,
  sprintName: string,
  fieldConfig: FieldConfig
): OtherTicket => {
  const devDaysValue = issue.fields[fieldConfig.devDays];
  const hasEstimate = typeof devDaysValue === 'number' && devDaysValue > 0;

  const epicKey = extractEpicKey(issue, fieldConfig);

  return {
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name ?? 'Unknown',
    devDays: hasEstimate ? devDaysValue : DEFAULT_DEV_DAYS,
    sprintId,
    sprintName,
    epicKey,
    epicSummary: null,  // Will be populated by API if epic exists
    isMissingEstimate: !hasEstimate,
  };
};
