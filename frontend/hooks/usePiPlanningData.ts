'use client';

import { useState, useCallback, useRef } from 'react';

export interface PiPlanningEpic {
  key: string;
  summary: string;
  status: string;
  labels: string[];
  storyPointEstimate: number | null;
  childStoryPoints: number;
}

interface EpicUpdate {
  key: string;
  storyPointEstimate: number | null;
  isStretch: boolean;
}

interface SaveResult {
  success: boolean;
  updated: number;
  removed: number;
  errors?: { key: string; action: string; error: string }[];
}

interface UsePiPlanningDataResult {
  epics: PiPlanningEpic[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveResult: SaveResult | null;
  fetchEpics: (projectKey: string) => Promise<void>;
  saveChanges: (piLabel: string, updates: EpicUpdate[], removals: string[]) => Promise<boolean>;
  clearSaveResult: () => void;
}

export const usePiPlanningData = (): UsePiPlanningDataResult => {
  const [epics, setEpics] = useState<PiPlanningEpic[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);

  // Cache to avoid refetching same project
  const cachedProjectRef = useRef<string | null>(null);

  const fetchEpics = useCallback(async (projectKey: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/pi-planning/epics?project=${encodeURIComponent(projectKey)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to fetch epics');
      }

      cachedProjectRef.current = projectKey;
      setEpics(data.epics);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setEpics([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveChanges = useCallback(async (
    piLabel: string,
    updates: EpicUpdate[],
    removals: string[]
  ): Promise<boolean> => {
    setIsSaving(true);
    setSaveResult(null);

    try {
      const response = await fetch('/api/pi-planning/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ piLabel, updates, removals }),
      });

      const data: SaveResult = await response.json();

      if (!response.ok) {
        throw new Error((data as unknown as { message?: string }).message || 'Save failed');
      }

      setSaveResult(data);

      // Re-fetch epics to reflect saved state
      if (cachedProjectRef.current) {
        await fetchEpics(cachedProjectRef.current);
      }

      return data.success;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setSaveResult({ success: false, updated: 0, removed: 0, errors: [{ key: '', action: 'save', error: message }] });
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [fetchEpics]);

  const clearSaveResult = useCallback(() => {
    setSaveResult(null);
  }, []);

  return {
    epics,
    isLoading,
    isSaving,
    error,
    saveResult,
    fetchEpics,
    saveChanges,
    clearSaveResult,
  };
};
