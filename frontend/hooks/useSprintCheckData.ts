'use client';

import { useState, useCallback, useRef } from 'react';

interface SprintInfo {
  id: number;
  name: string;
  startDate: string;
}

interface EngineerSprintPoints {
  engineer: string;
  sprintId: number;
  totalPoints: number;
}

interface CurrentSprintEngineer {
  engineer: string;
  totalPoints: number;
  percentage: number;
}

export interface TicketDetail {
  key: string;
  summary: string;
  storyPoints: number;
  status: string;
  engineer: string;
  sprintId: number;
  sprintName: string;
}

export interface SprintCheckData {
  sprints: SprintInfo[];
  engineers: string[];
  sprintData: EngineerSprintPoints[];
  tickets: TicketDetail[];
  currentSprint: {
    id: number;
    name: string;
    engineers: CurrentSprintEngineer[];
    totalPoints: number;
  } | null;
}

interface CachedData {
  sprintIdsKey: string;
  boardId: number;
  data: SprintCheckData;
}

interface UseSprintCheckDataResult {
  data: SprintCheckData | null;
  isLoading: boolean;
  error: string | null;
  generate: (sprintIds: number[], boardId: number) => Promise<void>;
  clear: () => void;
}

export const useSprintCheckData = (): UseSprintCheckDataResult => {
  const [data, setData] = useState<SprintCheckData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cachedDataRef = useRef<CachedData | null>(null);

  const generate = useCallback(async (sprintIds: number[], boardId: number) => {
    const sprintIdsKey = [...sprintIds].sort((a, b) => a - b).join(',');

    // Check cache
    const cached = cachedDataRef.current;
    if (
      cached &&
      cached.sprintIdsKey === sprintIdsKey &&
      cached.boardId === boardId
    ) {
      setData(cached.data);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/sprint-check/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprintIds, boardId }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.message || responseData.error || 'Failed to fetch data');
      }

      const result: SprintCheckData = responseData;

      cachedDataRef.current = { sprintIdsKey, boardId, data: result };
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
