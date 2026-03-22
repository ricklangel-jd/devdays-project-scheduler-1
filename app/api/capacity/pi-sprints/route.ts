import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient } from '@/backend/jira';

const EPIC_TITLE = 'PI Capacity Planning';

// ── ADF helpers ───────────────────────────────────────────────────────

const toAdf = (text: string) => ({
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'codeBlock',
      attrs: { language: 'text' },
      content: [{ type: 'text', text }],
    },
  ],
});

const extractAdfText = (description: unknown): string | null => {
  if (!description || typeof description !== 'object') return null;
  const doc = description as { content?: unknown[] };
  for (const block of doc.content ?? []) {
    const b = block as { type?: string; content?: unknown[] };
    if (b.type === 'codeBlock' || b.type === 'paragraph') {
      for (const inline of b.content ?? []) {
        const n = inline as { type?: string; text?: string };
        if (n.type === 'text' && n.text) return n.text;
      }
    }
  }
  return null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Epic helpers ──────────────────────────────────────────────────────

const findEpic = async (
  client: ReturnType<typeof getJiraClient>,
  projectKey: string
): Promise<string | null> => {
  const jql = `project = "${projectKey}" AND issuetype = Epic AND summary ~ "${EPIC_TITLE}" ORDER BY created ASC`;
  const results = await client.searchIssuesWithDescription(jql);
  const match = results.issues.find(
    (i) => (i.fields.summary as string).trim() === EPIC_TITLE
  );
  return match?.key ?? null;
};

const findOrCreateEpic = async (
  client: ReturnType<typeof getJiraClient>,
  projectKey: string
): Promise<string> => {
  const existing = await findEpic(client, projectKey);
  if (existing) return existing;
  const created = await client.createIssue({
    project: { key: projectKey },
    summary: EPIC_TITLE,
    issuetype: { name: 'Epic' },
  });
  return created.key;
};

// ── PI story helpers ──────────────────────────────────────────────────

const piStoryTitle = (pi: string) => `PI ${pi}`;

const findPiStory = async (
  client: ReturnType<typeof getJiraClient>,
  projectKey: string,
  epicKey: string,
  pi: string
): Promise<string | null> => {
  const title = piStoryTitle(pi);
  // Use broad parent search and exact-match client-side to avoid JQL special-char issues
  const jql = `project = "${projectKey}" AND parent = "${epicKey}" ORDER BY created ASC`;
  const results = await client.searchIssuesWithDescription(jql);
  const match = results.issues.find(
    (i) => (i.fields.summary as string).trim().toLowerCase() === title.toLowerCase()
  );
  return match?.key ?? null;
};

const findOrCreatePiStory = async (
  client: ReturnType<typeof getJiraClient>,
  projectKey: string,
  epicKey: string,
  pi: string
): Promise<{ key: string; isNew: boolean }> => {
  const existing = await findPiStory(client, projectKey, epicKey, pi);
  if (existing) return { key: existing, isNew: false };
  const created = await client.createIssue({
    project: { key: projectKey },
    summary: piStoryTitle(pi),
    issuetype: { name: 'Story' },
    parent: { key: epicKey },
  });
  return { key: created.key, isNew: true };
};

// ── GET: load PI sprint IDs ───────────────────────────────────────────

export const GET = async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const projectKey = searchParams.get('projectKey');
    const pi = searchParams.get('pi');

    if (!projectKey || !pi) {
      return NextResponse.json({ error: 'projectKey and pi are required' }, { status: 400 });
    }

    const client = getJiraClient();
    const epicKey = await findEpic(client, projectKey);
    if (!epicKey) return NextResponse.json({ data: null });

    // Fetch all child stories and find by exact title match to avoid JQL special-char issues
    const title = piStoryTitle(pi);
    const jql = `project = "${projectKey}" AND parent = "${epicKey}" ORDER BY created ASC`;
    const results = await client.searchIssuesWithDescription(jql);
    const story = results.issues.find(
      (i) => (i.fields.summary as string).trim().toLowerCase() === title.toLowerCase()
    );
    if (!story) return NextResponse.json({ data: null });

    const text = extractAdfText(story.fields.description);
    return NextResponse.json({ data: text });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('PI sprints GET failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
};

// ── POST: save PI sprint IDs ──────────────────────────────────────────

export const POST = async (request: NextRequest) => {
  try {
    const body = await request.json() as {
      projectKey: string;
      pi: string;
      sprintIds: number[];
    };
    const { projectKey, pi, sprintIds } = body;

    if (!projectKey || !pi) {
      return NextResponse.json({ error: 'projectKey and pi are required' }, { status: 400 });
    }

    const client = getJiraClient();
    const epicKey = await findOrCreateEpic(client, projectKey);
    const { key: storyKey, isNew } = await findOrCreatePiStory(client, projectKey, epicKey, pi);

    // Wait for JIRA automation if the story was just created
    if (isNew) await sleep(4000);

    await client.updateIssue(storyKey, {
      description: toAdf((sprintIds ?? []).join(',')),
    });

    return NextResponse.json({ storyKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('PI sprints POST failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
