import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient } from '@/backend/jira';

const EPIC_TITLE = 'PI Capacity Planning';

// ── Jira Atlassian Document Format helpers ────────────────────────────

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

// ── Find epic (never creates) ─────────────────────────────────────────

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

// ── Find or create epic (only called on save) ─────────────────────────

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

// ── Find sprint story ─────────────────────────────────────────────────

const findSprintStory = async (
  client: ReturnType<typeof getJiraClient>,
  projectKey: string,
  epicKey: string,
  sprintId: number,
  sprintName: string
): Promise<string | null> => {
  const storyTitle = `${sprintId}-${sprintName}`;
  const jql = `project = "${projectKey}" AND parent = "${epicKey}" AND summary ~ "${storyTitle}" ORDER BY created ASC`;
  const results = await client.searchIssuesWithDescription(jql);
  const match = results.issues.find(
    (i) => (i.fields.summary as string).trim().toLowerCase() === storyTitle.toLowerCase()
  );
  return match?.key ?? null;
};

// ── Find or create sprint story (only called on save) ─────────────────

const findOrCreateSprintStory = async (
  client: ReturnType<typeof getJiraClient>,
  projectKey: string,
  epicKey: string,
  sprintId: number,
  sprintName: string
): Promise<{ key: string; isNew: boolean }> => {
  const existing = await findSprintStory(client, projectKey, epicKey, sprintId, sprintName);
  if (existing) return { key: existing, isNew: false };

  const storyTitle = `${sprintId}-${sprintName}`;
  const created = await client.createIssue({
    project: { key: projectKey },
    summary: storyTitle,
    issuetype: { name: 'Story' },
    parent: { key: epicKey },
  });
  return { key: created.key, isNew: true };
};

// ── GET: load saved capacity data — never creates anything ────────────

export const GET = async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const projectKey = searchParams.get('projectKey');
    const sprintId = searchParams.get('sprintId');
    const sprintName = searchParams.get('sprintName');

    if (!projectKey || !sprintId || !sprintName) {
      return NextResponse.json({ error: 'projectKey, sprintId, and sprintName are required' }, { status: 400 });
    }

    const client = getJiraClient();
    const epicKey = await findEpic(client, projectKey);
    if (!epicKey) return NextResponse.json({ data: null });

    const storyTitle = `${sprintId}-${sprintName}`;
    const jql = `project = "${projectKey}" AND parent = "${epicKey}" AND summary ~ "${storyTitle}"`;
    const results = await client.searchIssuesWithDescription(jql);
    const story = results.issues.find(
      (i) => (i.fields.summary as string).trim().toLowerCase() === storyTitle.toLowerCase()
    );

    if (!story) return NextResponse.json({ data: null });

    const text = extractAdfText(story.fields.description);
    return NextResponse.json({ data: text, storyKey: story.key });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Capacity storage GET failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
};

// ── POST: save capacity data — creates epic/story if needed ──────────

export const POST = async (request: NextRequest) => {
  try {
    const body = await request.json() as {
      projectKey: string;
      sprintId: number;
      sprintName: string;
      data: string;
    };
    const { projectKey, sprintId, sprintName, data } = body;

    if (!projectKey || !sprintId || !sprintName) {
      return NextResponse.json({ error: 'projectKey, sprintId, and sprintName are required' }, { status: 400 });
    }

    const client = getJiraClient();
    const epicKey = await findOrCreateEpic(client, projectKey);
    const { key: storyKey, isNew } = await findOrCreateSprintStory(client, projectKey, epicKey, sprintId, sprintName);

    // If the story was just created, wait for JIRA's automated template process to finish
    if (isNew) await sleep(4000);

    await client.updateIssue(storyKey, {
      description: toAdf(data ?? ''),
    });

    return NextResponse.json({ storyKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Capacity storage POST failed:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
