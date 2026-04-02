'use client';

import { useState, useCallback, useRef } from 'react';

export interface ParentGroup {
  parentKey: string;
  parentSummary: string;
  points: number;
  percent: number;
}

export type ReadinessLabel = 'Ready-For-Sprint' | 'Needs-Refinement';

export interface StoryRow {
  key: string;
  summary: string;
  points: number;
  status: string;
  readiness: ReadinessLabel;
  parentKey: string;
}

export interface SprintPlanningData {
  sprintName: string;
  totalPoints: number;
  completedPoints: number;
  remainingPoints: number;
  parents: ParentGroup[];
  stories: StoryRow[];
}

interface CachedData {
  sprintId: number;
  boardId: number;
  data: SprintPlanningData;
}

interface UseSprintPlanningDataResult {
  data: SprintPlanningData | null;
  isLoading: boolean;
  error: string | null;
  generate: (sprintId: number, boardId: number) => Promise<void>;
  clear: () => void;
}

export const useSprintPlanningData = (): UseSprintPlanningDataResult => {
  const [data, setData] = useState<SprintPlanningData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cachedDataRef = useRef<CachedData | null>(null);

  const generate = useCallback(async (sprintId: number, boardId: number) => {
    const cached = cachedDataRef.current;
    if (cached && cached.sprintId === sprintId && cached.boardId === boardId) {
      setData(cached.data);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/sprint-planning/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprintId, boardId }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.message || responseData.error || 'Failed to fetch data');
      }

      const result: SprintPlanningData = responseData;
      cachedDataRef.current = { sprintId, boardId, data: result };
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
