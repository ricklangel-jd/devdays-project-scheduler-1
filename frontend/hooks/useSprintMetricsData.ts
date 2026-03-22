'use client';

import { useState, useCallback, useRef } from 'react';

// ── Types mirroring API response ──────────────────────────────────────

export interface EngOutputRow {
  name: string;
  capacity: number;
  resolvedPoints: number;
}

export interface SprintMetricsIssue {
  key: string;
  summary: string;
  sprintName: string;
  points: number;
  categories: string[];
}

export interface SprintMetricsRow {
  projectKey: string;
  projectName: string;
  sprintName: string;
  startDate: string;
  endDate: string;
  day1Points: number;
  day1AllPointed: boolean;
  resolvedPoints: number;
  lastDayPoints: number;
  scopeChangeInPoints: number;
  scopeChangeOutPoints: number;
  carryoverPoints: number;
  carryoverAllPoints: number;
  serviceDeskHoursResolved: number;
  issues: SprintMetricsIssue[];
  jiraCapacity: number | null;
  jiraEngineerCount: number | null;
  engineerOutputs: EngOutputRow[] | null;
}

export interface SprintMetricsGrid {
  offset: number;
  label: string;
  rows: SprintMetricsRow[];
}

export interface SprintMetricsData {
  grids: SprintMetricsGrid[];
}

interface CachedData {
  cacheKey: string;
  data: SprintMetricsData;
}

export interface Selection {
  projectKey: string;
  boardId: number;
  projectName: string;
}

interface UseSprintMetricsDataResult {
  data: SprintMetricsData | null;
  isLoading: boolean;
  error: string | null;
  generate: (selections: Selection[], sprintsBack: number) => Promise<void>;
  clear: () => void;
}

export const useSprintMetricsData = (): UseSprintMetricsDataResult => {
  const [data, setData] = useState<SprintMetricsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cachedDataRef = useRef<CachedData | null>(null);

  const generate = useCallback(async (selections: Selection[], sprintsBack: number) => {
    // Build a deterministic cache key
    const cacheKey = JSON.stringify({
      selections: selections
        .map((s) => `${s.projectKey}:${s.boardId}`)
        .sort()
        .join(','),
      sprintsBack,
    });

    // Check cache
    const cached = cachedDataRef.current;
    if (cached && cached.cacheKey === cacheKey) {
      setData(cached.data);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/sprint-metrics/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections, sprintsBack }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.message || responseData.error || 'Failed to fetch data');
      }

      const result: SprintMetricsData = responseData;

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
