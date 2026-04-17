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
