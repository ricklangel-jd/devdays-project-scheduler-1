import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient } from '@/backend/jira';

/**
 * POST /api/pi-planning/apply-stretch
 *
 * Adds the "Stretch" label to each of the supplied epic keys.
 * Called when the user clicks "Apply Stretch Labels" in the sidebar to
 * promote epics that already carry the StretchPlan label into full Stretch.
 */
export const POST = async (request: NextRequest) => {
  try {
    const { keys }: { keys: string[] } = await request.json();

    if (!keys || keys.length === 0) {
      return NextResponse.json({ success: true, updated: 0, failed: 0 });
    }

    const client = getJiraClient();
    const results = await Promise.allSettled(
      keys.map((key) =>
        client.updateIssueAdvanced(key, undefined, { labels: [{ add: 'Stretch' }] })
      )
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    const updated = keys.length - failed;

    return NextResponse.json({ success: failed === 0, updated, failed });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Apply stretch labels failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
