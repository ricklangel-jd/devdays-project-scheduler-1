'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { EpicStoryRow } from '@/shared/types';

interface CachedStories {
  epicKey: string;
  sprintIdsKey: string;
  stories: EpicStoryRow[];
  epicStatus: string | null;
}

interface UseEpicStoriesDataResult {
  stories: EpicStoryRow[];
  epicStatus: string | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Serialize sprint IDs to a stable string for cache comparison.
 */
const serializeSprintIds = (sprintIds?: number[]): string => {
  if (!sprintIds || sprintIds.length === 0) return '';
  return [...sprintIds].sort((a, b) => a - b).join(',');
};

interface UseEpicStoriesOptions {
  /** API endpoint for fetching stories (default: /api/capacity-demand/stories) */
  apiUrl?: string;
  /** Project key — required when fetching __NO_EPIC__ stories */
  projectKey?: string;
}

/**
 * Hook that fetches individual stories for a selected epic.
 * Optionally filters by sprint IDs (for bar-click selections).
 * Caches last result to avoid re-fetching on re-select.
 */
export const useEpicStoriesData = (
  epicKey: string | null,
  sprintIds?: number[],
  options?: UseEpicStoriesOptions
): UseEpicStoriesDataResult => {
  const apiUrl = options?.apiUrl ?? '/api/capacity-demand/stories';
  const projectKey = options?.projectKey;
  const [stories, setStories] = useState<EpicStoryRow[]>([]);
  const [epicStatus, setEpicStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheRef = useRef<CachedStories | null>(null);

  // Stable serialized key for sprint IDs
  const sprintIdsKey = serializeSprintIds(sprintIds);

  // Abort controller ref for cancelling in-flight requests
  const abortRef = useRef<AbortController | null>(null);

  const fetchStories = useCallback(async (key: string, filterSprintIds?: number[]) => {
    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const sprintKey = serializeSprintIds(filterSprintIds);

    // Check cache
    const cached = cacheRef.current;
    if (cached && cached.epicKey === key && cached.sprintIdsKey === sprintKey) {
      setStories(cached.stories);
      setEpicStatus(cached.epicStatus);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const body: { epicKey: string; sprintIds?: number[]; projectKey?: string } = { epicKey: key };
      if (filterSprintIds && filterSprintIds.length > 0) {
        body.sprintIds = filterSprintIds;
      }
      if (projectKey) {
        body.projectKey = projectKey;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to fetch stories');
      }

      const result: EpicStoryRow[] = data.stories ?? [];
      const status: string | null = data.epicStatus ?? null;

      // Cache the result
      cacheRef.current = { epicKey: key, sprintIdsKey: sprintKey, stories: result, epicStatus: status };
      setStories(result);
      setEpicStatus(status);
    } catch (err) {
      // Don't set error if request was aborted
      if (err instanceof DOMException && err.name === 'AbortError') return;

      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setStories([]);
      setEpicStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl, projectKey]);

  useEffect(() => {
    if (!epicKey) {
      setStories([]);
      setEpicStatus(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    fetchStories(epicKey, sprintIds);
  }, [epicKey, sprintIdsKey, fetchStories, sprintIds]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  return { stories, epicStatus, isLoading, error };
};
