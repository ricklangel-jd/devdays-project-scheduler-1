import type {
  JiraSearchResponse,
  JiraSprintResponse,
  JiraIssueResponse,
  JiraProjectResponse,
  JiraBoardResponse,
  JiraBoardConfigResponse,
  JiraStatusResponse,
} from '@/shared/types';

/**
 * Response from the Greenhopper sprint report API.
 * Used to determine which issues were added mid-sprint vs. present at sprint start.
 */
export interface SprintReportResponse {
  contents: {
    completedIssues: SprintReportIssue[];
    issuesNotCompletedInCurrentSprint: SprintReportIssue[];
    puntedIssues: SprintReportIssue[];
    issueKeysAddedDuringSprint: Record<string, boolean>;
  };
}

interface SprintReportIssue {
  key: string;
  estimateStatistic?: {
    statFieldValue?: {
      value?: number;
    };
  };
  currentEstimateStatistic?: {
    statFieldValue?: {
      value?: number;
    };
  };
}

/**
 * JQL clause to exclude issues with the "Mainframe" label.
 * Applied to all epic and story queries so Mainframe work is never shown.
 *
 * Note: Must use `NOT labels = "X"` instead of `labels != "X"` because
 * labels is a multi-value field. `labels != "X"` means "has any label
 * that is not X" (true even if Mainframe is present alongside other labels).
 * `NOT labels = "X"` means "does not have X as a label" which is correct.
 */
export const EXCLUDE_MAINFRAME = 'NOT labels = "Mainframe"';

/**
 * Configuration for JIRA API client
 * All values come from environment variables
 */
interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  fieldDevDays: string;
  fieldSprint: string;
  fieldSprintPointEstimate?: string; // Optional: manager/tech lead estimate for unpointed tickets
  fieldEpicLink: string; // Custom field ID for Epic Link (e.g., customfield_10014)
  fieldPlannedStartDate?: string; // Optional: custom field to write scheduled start date
  fieldPlannedEndDate?: string; // Optional: custom field to write scheduled end date
  fieldPinnedStartDate?: string; // Optional: custom field for pinning ticket to exact start date
  boardId: string;
}

/**
 * Get JIRA configuration from environment variables
 */
export const getJiraConfig = (): JiraConfig => {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const fieldDevDays = process.env.JIRA_FIELD_DEV_DAYS;
  const fieldSprint = process.env.JIRA_FIELD_SPRINT ?? 'customfield_10020';
  const fieldSprintPointEstimate = process.env.JIRA_FIELD_SPRINT_POINT_ESTIMATE; // Optional
  const fieldEpicLink = process.env.JIRA_FIELD_EPIC_LINK ?? 'customfield_10014';
  const fieldPlannedStartDate = process.env.JIRA_FIELD_PLANNED_START_DATE; // Optional
  const fieldPlannedEndDate = process.env.JIRA_FIELD_PLANNED_END_DATE; // Optional
  const fieldPinnedStartDate = process.env.JIRA_FIELD_PINNED_START_DATE; // Optional
  const boardId = process.env.JIRA_BOARD_ID;

  if (!baseUrl || !email || !apiToken || !fieldDevDays || !boardId) {
    throw new Error(
      'Missing required JIRA environment variables. Required: ' +
      'JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_FIELD_DEV_DAYS, JIRA_BOARD_ID'
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ''), // Remove trailing slash
    email,
    apiToken,
    fieldDevDays,
    fieldSprint,
    fieldSprintPointEstimate,
    fieldEpicLink,
    fieldPlannedStartDate,
    fieldPlannedEndDate,
    fieldPinnedStartDate,
    boardId,
  };
};

/**
 * Create authorization header for JIRA API
 */
const createAuthHeader = (email: string, apiToken: string): string => {
  const credentials = Buffer.from(`${email}:${apiToken}`).toString('base64');
  return `Basic ${credentials}`;
};

/**
 * JIRA API client for making authenticated requests
 */
export class JiraClient {
  private config: JiraConfig;
  private authHeader: string;

  constructor(config?: JiraConfig) {
    this.config = config ?? getJiraConfig();
    this.authHeader = createAuthHeader(this.config.email, this.config.apiToken);
  }

  /**
   * Make an authenticated request to the JIRA API
   */
  private fetch = async <T>(endpoint: string, options: RequestInit = {}): Promise<T> => {
    const url = `${this.config.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`JIRA API error (${response.status}): ${errorText}`);
    }

    // Handle 204 No Content (e.g., from PUT requests)
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  };

  /**
   * Search for issues using JQL (uses new /search/jql POST endpoint)
   * Accepts optional nextPageToken for cursor-based pagination.
   */
  searchIssues = async (jql: string, fields: string[] = [], nextPageToken?: string): Promise<JiraSearchResponse> => {
    const defaultFields = [
      'summary',
      'status',
      'assignee',
      'parent',
      'labels',
      'issuelinks',
      this.config.fieldDevDays,
      this.config.fieldSprint,
      this.config.fieldEpicLink,
      ...(this.config.fieldSprintPointEstimate ? [this.config.fieldSprintPointEstimate] : []),
      ...(this.config.fieldPinnedStartDate ? [this.config.fieldPinnedStartDate] : []),
    ];

    const allFields = [...new Set([...defaultFields, ...fields])];

    const body: Record<string, unknown> = {
      jql,
      fields: allFields,
      maxResults: 100,
    };
    if (nextPageToken) {
      body.nextPageToken = nextPageToken;
    }

    return this.fetch<JiraSearchResponse>('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  };

  /**
   * Search for all issues matching JQL, auto-paginating through results
   * Uses cursor-based pagination via nextPageToken.
   */
  searchAllIssues = async (jql: string, fields: string[] = []): Promise<JiraSearchResponse> => {
    const allIssues: JiraIssueResponse[] = [];
    let nextPageToken: string | undefined;

    while (true) {
      const response = await this.searchIssues(jql, fields, nextPageToken);
      allIssues.push(...response.issues);

      if (!response.nextPageToken || response.issues.length === 0) {
        break;
      }

      nextPageToken = response.nextPageToken;
    }

    return {
      issues: allIssues,
      total: allIssues.length,
      maxResults: allIssues.length,
      startAt: 0,
    };
  };

  /**
   * Get all tickets in the specified sprints
   */
  getSprintTickets = async (sprintIds: number[]): Promise<JiraSearchResponse> => {
    const sprintList = sprintIds.join(', ');
    const jql = `sprint in (${sprintList}) ORDER BY key ASC`;
    return this.searchAllIssues(jql);
  };

  /**
   * Get a single issue by key
   */
  getIssue = async (issueKey: string): Promise<JiraIssueResponse> => {
    const fields = [
      'summary',
      'status',
      'assignee',
      'parent',
      'labels',
      'issuelinks',
      this.config.fieldDevDays,
      this.config.fieldSprint,
      ...(this.config.fieldSprintPointEstimate ? [this.config.fieldSprintPointEstimate] : []),
    ].join(',');

    return this.fetch<JiraIssueResponse>(`/rest/api/3/issue/${issueKey}?fields=${fields}`);
  };

  /**
   * Search for epics by partial key or summary
   */
  searchEpics = async (query: string): Promise<JiraSearchResponse> => {
    const jql = `issuetype = Epic AND ${EXCLUDE_MAINFRAME} AND (key ~ "${query}" OR summary ~ "${query}") ORDER BY key ASC`;
    return this.searchIssues(jql);
  };

  /**
   * Get all issues (stories/tasks) under an epic
   */
  getEpicIssues = async (epicKey: string): Promise<JiraSearchResponse> => {
    const jql = `("Epic Link" = ${epicKey} OR parent = ${epicKey}) AND ${EXCLUDE_MAINFRAME} ORDER BY key ASC`;
    return this.searchIssues(jql);
  };

  /**
   * Get sprints from a board (uses provided boardId or falls back to configured board)
   * Auto-paginates to fetch all sprints (JIRA limits to 50 per request).
   *
   * JIRA API supports only these filters:
   * - state: active | closed | future (can be comma-separated for multiple)
   *
   * JIRA does NOT support: name search, date range filtering
   * Those must be done post-fetch by the caller.
   */
  getSprints = async (state?: string, boardId?: number): Promise<JiraSprintResponse[]> => {
    const targetBoardId = boardId ?? this.config.boardId;
    const allSprints: JiraSprintResponse[] = [];
    let startAt = 0;
    const maxResults = 50;

    while (true) {
      const params = new URLSearchParams();
      if (state) {
        params.set('state', state);
      }
      params.set('startAt', String(startAt));
      params.set('maxResults', String(maxResults));

      const endpoint = `/rest/agile/1.0/board/${targetBoardId}/sprint?${params}`;
      const response = await this.fetch<{
        values: JiraSprintResponse[];
        isLast: boolean;
        startAt: number;
        maxResults: number;
      }>(endpoint);

      allSprints.push(...response.values);

      if (response.isLast || response.values.length === 0) {
        break;
      }

      startAt += response.values.length;
    }

    return allSprints;
  };

  /**
   * Get all accessible projects
   */
  getProjects = async (): Promise<JiraProjectResponse[]> => {
    return this.fetch<JiraProjectResponse[]>('/rest/api/3/project');
  };

  /**
   * Search projects by key or name
   */
  searchProjects = async (query: string): Promise<JiraProjectResponse[]> => {
    const allProjects = await this.getProjects();
    const lowerQuery = query.toLowerCase();
    return allProjects.filter(
      (p) =>
        p.key.toLowerCase().includes(lowerQuery) ||
        p.name.toLowerCase().includes(lowerQuery)
    );
  };

  /**
   * Get boards for a specific project
   */
  getBoardsForProject = async (projectKey: string): Promise<JiraBoardResponse[]> => {
    const params = new URLSearchParams();
    params.set('projectKeyOrId', projectKey);

    const endpoint = `/rest/agile/1.0/board?${params}`;
    const response = await this.fetch<{ values: JiraBoardResponse[] }>(endpoint);
    return response.values;
  };

  /**
   * Get board configuration including column/status mappings
   */
  getBoardConfiguration = async (boardId?: number): Promise<JiraBoardConfigResponse> => {
    const targetBoardId = boardId ?? this.config.boardId;
    return this.fetch<JiraBoardConfigResponse>(`/rest/agile/1.0/board/${targetBoardId}/configuration`);
  };

  /**
   * Get a single status by ID with full details including statusCategory
   */
  getStatusById = async (statusId: string): Promise<JiraStatusResponse> => {
    return this.fetch<JiraStatusResponse>(`/rest/api/3/status/${statusId}`);
  };

  /**
   * Get all "done" status names for a board based on its column configuration
   * Fetches board config to get status IDs, then fetches each status detail in parallel
   * Returns status names where statusCategory.key === 'done'
   */
  getDoneStatuses = async (boardId?: number): Promise<string[]> => {
    const config = await this.getBoardConfiguration(boardId);

    // Collect unique status IDs from the board columns
    const boardStatusIds = new Set<string>();
    for (const column of config.columnConfig.columns) {
      for (const status of column.statuses) {
        boardStatusIds.add(status.id);
      }
    }

    // Fetch status details in parallel for just the board's statuses
    const statusDetails = await Promise.all(
      Array.from(boardStatusIds).map(async (id) => {
        try {
          return await this.getStatusById(id);
        } catch (error) {
          console.error(`Failed to fetch status ${id}:`, error);
          return null;
        }
      })
    );

    // Filter to statuses with statusCategory.key === 'done'
    return statusDetails
      .filter((s): s is JiraStatusResponse => s !== null && s.statusCategory.key === 'done')
      .map(s => s.name);
  };

  /**
   * Get a single sprint by ID
   */
  getSprintById = async (sprintId: number): Promise<JiraSprintResponse> => {
    return this.fetch<JiraSprintResponse>(`/rest/agile/1.0/sprint/${sprintId}`);
  };

  /**
   * Get multiple sprints by their IDs
   */
  getSprintsByIds = async (sprintIds: number[]): Promise<JiraSprintResponse[]> => {
    const results = await Promise.all(
      sprintIds.map(async (id) => {
        try {
          return await this.getSprintById(id);
        } catch (error) {
          console.error(`Failed to fetch sprint ${id}:`, error);
          return null;
        }
      })
    );
    return results.filter((s): s is JiraSprintResponse => s !== null);
  };

  /**
   * Validate connection to JIRA
   */
  validateConnection = async (): Promise<{ valid: boolean; email?: string; error?: string }> => {
    try {
      const response = await this.fetch<{ emailAddress: string }>('/rest/api/3/myself');
      return { valid: true, email: response.emailAddress };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };

  /**
   * Get the sprint report from Greenhopper API.
   * Returns which issues were added mid-sprint (issueKeysAddedDuringSprint)
   * and categorized issue lists (completed, not completed, punted).
   */
  getSprintReport = async (boardId: number, sprintId: number): Promise<SprintReportResponse> => {
    return this.fetch<SprintReportResponse>(
      `/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${boardId}&sprintId=${sprintId}`
    );
  };

  /**
   * Get the custom field IDs for reference
   */
  getFieldConfig = () => ({
    devDays: this.config.fieldDevDays,
    sprint: this.config.fieldSprint,
    sprintPointEstimate: this.config.fieldSprintPointEstimate,
    epicLink: this.config.fieldEpicLink,
    plannedStartDate: this.config.fieldPlannedStartDate,
    plannedEndDate: this.config.fieldPlannedEndDate,
    pinnedStartDate: this.config.fieldPinnedStartDate,
  });

  /**
   * Update an issue's sprint and optional planned dates
   */
  updateIssue = async (
    issueKey: string,
    fields: Record<string, unknown>
  ): Promise<void> => {
    await this.fetch(`/rest/api/3/issue/${issueKey}`, {
      method: 'PUT',
      body: JSON.stringify({ fields }),
    });
  };

  /**
   * Update an issue using both `fields` and `update` operations in a single PUT.
   * Use this when you need add/remove operations (e.g., labels) alongside field updates.
   * - `fields` overwrites the entire field value
   * - `update` supports add/remove for multi-value fields like labels
   */
  updateIssueAdvanced = async (
    issueKey: string,
    fields?: Record<string, unknown>,
    update?: Record<string, Array<Record<string, unknown>>>
  ): Promise<void> => {
    const body: Record<string, unknown> = {};
    if (fields) body.fields = fields;
    if (update) body.update = update;

    await this.fetch(`/rest/api/3/issue/${issueKey}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  };

  /**
   * Create a new JIRA issue
   */
  createIssue = async (fields: Record<string, unknown>): Promise<{ key: string; id: string }> => {
    return this.fetch<{ key: string; id: string }>('/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  };

  /**
   * Get a single issue including its description field
   */
  getIssueWithDescription = async (issueKey: string): Promise<JiraIssueResponse> => {
    return this.fetch<JiraIssueResponse>(
      `/rest/api/3/issue/${issueKey}?fields=summary,status,description,parent,issuetype`
    );
  };

  /**
   * Search issues by JQL returning summary + description
   */
  searchIssuesWithDescription = async (jql: string): Promise<JiraSearchResponse> => {
    return this.fetch<JiraSearchResponse>('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({
        jql,
        fields: ['summary', 'description', 'issuetype', 'parent', 'status'],
        maxResults: 200,
      }),
    });
  };

  /**
   * Get tickets in a sprint that are NOT linked to any of the specified epics
   */
  getSprintTicketsExcludingEpics = async (sprintId: number, epicKeys: string[]): Promise<JiraSearchResponse> => {
    let jql = `sprint = ${sprintId} AND ${EXCLUDE_MAINFRAME}`;

    if (epicKeys.length > 0) {
      // Build exclusion clause for epic links and parent relationships
      const epicList = epicKeys.join(', ');
      jql += ` AND NOT ("Epic Link" in (${epicList}) OR parent in (${epicList}))`;
    }

    jql += ' ORDER BY key ASC';
    return this.searchIssues(jql);
  };
}

/**
 * Singleton instance for use in API routes
 */
let clientInstance: JiraClient | null = null;

export const getJiraClient = (): JiraClient => {
  if (!clientInstance) {
    clientInstance = new JiraClient();
  }
  return clientInstance;
};
