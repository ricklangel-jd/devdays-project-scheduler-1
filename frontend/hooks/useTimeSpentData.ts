'use client';

import { useState, useCallback, useRef } from 'react';
import type { PiSprintAssignment } from '@/shared/types';

export interface StoryInfo {
  key: string;
  summary: string;
  points: number;
}

export interface EpicInfo {
  key: string;
  summary: string;
  totalPoints: number;
  stories: StoryInfo[];
}

export interface InitiativeInfo {
  key: string;
  summary: string;
  totalPoints: number;
  epics: EpicInfo[];
}

export interface TimeSpentData {
  initiatives: InitiativeInfo[];
}

interface CachedData {
  cacheKey: string;
  data: TimeSpentData;
}

interface UseTimeSpentDataResult {
  data: TimeSpentData | null;
  isLoading: boolean;
  error: string | null;
  generate: (projectKey: string, piSprints: PiSprintAssignment[], boardId?: number) => Promise<void>;
  clear: () => void;
}

const buildCacheKey = (projectKey: string, piSprints: PiSprintAssignment[], boardId?: number): string => {
  const sprintsKey = piSprints
    .filter((ps) => ps.sprintIds.length > 0)
    .map((ps) => `${ps.piLabel}:${[...ps.sprintIds].sort((a, b) => a - b).join('.')}`)
    .sort()
    .join(',');
  return `${projectKey}|${sprintsKey}|${boardId ?? ''}`;
};

export const useTimeSpentData = (): UseTimeSpentDataResult => {
  const [data, setData] = useState<TimeSpentData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cachedDataRef = useRef<CachedData | null>(null);

  const generate = useCallback(async (
    projectKey: string,
    piSprints: PiSprintAssignment[],
    boardId?: number
  ) => {
    const cacheKey = buildCacheKey(projectKey, piSprints, boardId);

    const cached = cachedDataRef.current;
    if (cached && cached.cacheKey === cacheKey) {
      setData(cached.data);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/time-spent/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey, piSprints, boardId }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.message || responseData.error || 'Failed to fetch data');
      }

      const result: TimeSpentData = responseData;
      cachedDataRef.current = { cacheKey, data: result };
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setData(null);
    setError(null);
    cachedDataRef.current = null;
  }, []);

  return { data, isLoading, error, generate, clear };
};
