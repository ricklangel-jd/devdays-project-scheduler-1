'use client';

import { useState, useCallback, useRef } from 'react';

export interface CapacityEngineer {
  name: string;
}

export interface CapacityData {
  sprintName: string;
  engineers: CapacityEngineer[];
}

interface CachedData {
  boardId: number;
  data: CapacityData;
}

interface UseCapacityDataResult {
  data: CapacityData | null;
  isLoading: boolean;
  error: string | null;
  generate: (boardId: number) => Promise<void>;
  clear: () => void;
}

export const useCapacityData = (): UseCapacityDataResult => {
  const [data, setData] = useState<CapacityData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cachedDataRef = useRef<CachedData | null>(null);

  const generate = useCallback(async (boardId: number) => {
    const cached = cachedDataRef.current;
    if (cached && cached.boardId === boardId) {
      setData(cached.data);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/capacity/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.message || responseData.error || 'Failed to fetch data');
      }

      const result: CapacityData = responseData;
      cachedDataRef.current = { boardId, data: result };
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
