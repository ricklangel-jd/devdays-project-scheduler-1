'use client';

import { useState, useCallback, useRef } from 'react';
import type { FusionData } from '@/shared/types';

interface UseFusionDataResult {
  data: FusionData | null;
  isLoading: boolean;
  error: string | null;
  load: (initiativeKeys: string[]) => Promise<void>;
  clear: () => void;
}

export const useFusionData = (): UseFusionDataResult => {
  const [data, setData] = useState<FusionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async (initiativeKeys: string[]) => {
    if (initiativeKeys.length === 0) {
      requestSeq.current += 1;
      setData(null);
      setError(null);
      return;
    }
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setError(null);
    try {
      const url = `/api/fusion/data?initiatives=${encodeURIComponent(initiativeKeys.join(','))}`;
      const response = await fetch(url);
      const body = await response.json();
      if (seq !== requestSeq.current) return;
      if (!response.ok) {
        throw new Error(body.message || body.error || 'Failed to load Fusion data');
      }
      setData(body as FusionData);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      // Preserve previous data during a failed reload; callers can decide to
      // clear explicitly via clear() if they want an empty state on error.
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    requestSeq.current += 1;
    setData(null);
    setError(null);
  }, []);

  return { data, isLoading, error, load, clear };
};
