import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient } from '@/backend/jira';

interface EpicUpdate {
  key: string;
  storyPointEstimate: number | null;
  isStretch: boolean;
  isPlannedStretch: boolean;
  priority: string | null;
}

interface SaveRequest {
  piLabel: string;
  updates: EpicUpdate[];
  removals: string[]; // Epic keys to remove the PI label from
}

/**
 * POST /api/pi-planning/save
 *
 * Saves PI planning data back to Jira:
 * - For each checked epic: sets story_point_estimate, adds PI label, adds/removes Stretch label
 * - For each unchecked epic that originally had the PI label: removes the PI label
 */
export const POST = async (request: NextRequest) => {
  try {
    const body: SaveRequest = await request.json();
    const { piLabel, updates, removals } = body;

    if (!piLabel) {
      return NextResponse.json(
        { error: 'PI label is required' },
        { status: 400 }
      );
    }

    const client = getJiraClient();
    const results: { key: string; action: string; error?: string }[] = [];

    // Process updates (checked epics)
    const updatePromises = updates.map(async (epic) => {
      try {
        const fields: Record<string, unknown> = {};
        if (epic.storyPointEstimate !== null) {
          fields.customfield_10016 = epic.storyPointEstimate;
        }
        if (epic.priority) {
          // Map display names back to Jira's internal values
          const jiraPriority = epic.priority === 'Highest' ? 'Emergency'
            : epic.priority === 'Lowest' ? 'Undetermined'
            : epic.priority;
          fields.priority = { name: jiraPriority };
        }

        const labelOps: Array<Record<string, unknown>> = [{ add: piLabel }];
        for (const [flag, name] of [[epic.isStretch, 'Stretch'], [epic.isPlannedStretch, 'StretchPlan']] as [boolean, string][]) {
          labelOps.push(flag ? { add: name } : { remove: name });
        }

        await client.updateIssueAdvanced(
          epic.key,
          Object.keys(fields).length > 0 ? fields : undefined,
          { labels: labelOps }
        );

        return { key: epic.key, action: 'updated' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to update epic ${epic.key}:`, error);
        return { key: epic.key, action: 'update_failed', error: message };
      }
    });

    // Process removals (unchecked epics that originally had the PI label)
    const removalPromises = removals.map(async (epicKey) => {
      try {
        await client.updateIssueAdvanced(
          epicKey,
          undefined,
          { labels: [{ remove: piLabel }] }
        );

        return { key: epicKey, action: 'removed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to remove PI label from ${epicKey}:`, error);
        return { key: epicKey, action: 'removal_failed', error: message };
      }
    });

    // Execute all in parallel
    const allResults = await Promise.allSettled([...updatePromises, ...removalPromises]);
    for (const result of allResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }

    const errors = results.filter((r) => r.error);
    const updated = results.filter((r) => r.action === 'updated').length;
    const removed = results.filter((r) => r.action === 'removed').length;

    return NextResponse.json({
      success: errors.length === 0,
      updated,
      removed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('PI Planning save failed:', error);

    return NextResponse.json(
      {
        error: message,
        message: `Save failed: ${message}`,
      },
      { status: 500 }
    );
  }
};
