'use client';

import { useState, useCallback, useRef } from 'react';
import type { PiSprintAssignment } from '@/shared/types';

export interface EpicDemand {
  key: string;
  summary: string;
  totalPoints: number;
  isStretch: boolean;
}

export interface PIDemand {
  label: string;
  epics: EpicDemand[];
}

export interface CapacityDemandData {
  piData: PIDemand[];
}

/**
 * Serialize piSprints to a stable string for cache comparison.
 */
const serializePiSprints = (piSprints: PiSprintAssignment[]): string =>
  piSprints
    .filter((ps) => ps.sprintIds.length > 0)
    .map((ps) => `${ps.piLabel}:${[...ps.sprintIds].sort((a, b) => a - b).join('.')}`)
    .sort()
    .join(',');

interface CachedData {
  projectKey: string;
  piLabels: string[];
  piSprintsKey: string;
  data: CapacityDemandData;
}

interface UseCapacityDemandDataResult {
  data: CapacityDemandData | null;
  isLoading: boolean;
  error: string | null;
  generate: (projectKey: string, piLabels: string[], piSprints?: PiSprintAssignment[]) => Promise<void>;
  clear: () => void;
}

export const useCapacityDemandData = (): UseCapacityDemandDataResult => {
  const [data, setData] = useState<CapacityDemandData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cachedDataRef = useRef<CachedData | null>(null);

  const generate = useCallback(async (
    projectKey: string,
    piLabels: string[],
    piSprints?: PiSprintAssignment[]
  ) => {
    const piSprintsKey = serializePiSprints(piSprints ?? []);

    // Check cache - skip fetch if inputs haven't changed
    const cached = cachedDataRef.current;
    if (
      cached &&
      cached.projectKey === projectKey &&
      cached.piLabels.join(',') === piLabels.join(',') &&
      cached.piSprintsKey === piSprintsKey
    ) {
      setData(cached.data);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/capacity-demand/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey,
          piLabels,
          piSprints: piSprints ?? [],
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.message || responseData.error || 'Failed to fetch data');
      }

      const result: CapacityDemandData = { piData: responseData.piData };

      cachedDataRef.current = { projectKey, piLabels, piSprintsKey, data: result };
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
