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
