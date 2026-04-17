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
