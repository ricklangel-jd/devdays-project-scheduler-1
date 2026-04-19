'use client';

import { useCallback, useRef, useState } from 'react';
import type { EffortData } from '@/shared/types';

interface UseEffortDataResult {
  data: EffortData | null;
  isLoading: boolean;
  error: string | null;
  load: (initiativeKeys: string[]) => Promise<void>;
  clear: () => void;
}

export const useEffortData = (): UseEffortDataResult => {
  const [data, setData] = useState<EffortData | null>(null);
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
      const url = `/api/effort-estimates/data?initiatives=${encodeURIComponent(initiativeKeys.join(','))}`;
      const response = await fetch(url);
      const body = await response.json();
      if (seq !== requestSeq.current) return;
      if (!response.ok) {
        throw new Error(body.message || body.error || 'Failed to load Effort Estimates data');
      }
      setData(body as EffortData);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
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
