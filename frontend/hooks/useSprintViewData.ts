'use client';

import { useState, useCallback, useRef } from 'react';
import type { GanttData, SprintCapacity, JiraEpic, JiraTicket, JiraSprint, SprintDateOverride } from '@/shared/types';
import { scheduleTickets } from '@/shared/scheduler';
import { applySprintDateOverrides, autoAdjustSprintDates } from '@/shared/utils/sprints';

interface CachedData {
  epics: JiraEpic[];
  tickets: JiraTicket[];
  sprints: JiraSprint[];
  doneStatuses: string[];
  activeSprints: JiraSprint[];
  sprintIds: number[];
  boardId?: number;
}

interface GenerateOptions {
  sprintDateOverrides?: SprintDateOverride[];
  autoAdjustStartDate?: boolean;
  boardId?: number;
}

interface UseSprintViewDataResult {
  ganttData: GanttData | null;
  isLoading: boolean;
  error: string | null;
  generate: (sprintCapacities: SprintCapacity[], options?: GenerateOptions) => Promise<void>;
  clear: () => void;
  clearCache: () => void;
}

export const useSprintViewData = (): UseSprintViewDataResult => {
  const [ganttData, setGanttData] = useState<GanttData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cachedDataRef = useRef<CachedData | null>(null);

  const generate = useCallback(async (
    sprintCapacities: SprintCapacity[],
    options: GenerateOptions = {}
  ) => {
    const { sprintDateOverrides = [], autoAdjustStartDate = true, boardId } = options;
    setIsLoading(true);
    setError(null);

    try {
      const sprintIds = sprintCapacities.map(sc => sc.sprintId);

      // Check if we need to refetch data
      const cached = cachedDataRef.current;
      const needsFetch = !cached ||
        cached.sprintIds.join(',') !== sprintIds.join(',') ||
        cached.boardId !== boardId;

      let epics: JiraEpic[];
      let tickets: JiraTicket[];
      let sprints: JiraSprint[];
      let doneStatuses: string[];
      let activeSprints: JiraSprint[];

      if (needsFetch) {
        const response = await fetch('/api/sprint-view/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sprintIds, boardId }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || data.error || 'Failed to fetch data');
        }

        epics = data.epics;
        tickets = data.tickets;
        sprints = data.sprints;
        doneStatuses = data.doneStatuses;
        activeSprints = data.activeSprints;

        cachedDataRef.current = { epics, tickets, sprints, doneStatuses, activeSprints, sprintIds, boardId };
      } else {
        epics = cached.epics;
        tickets = cached.tickets;
        sprints = cached.sprints;
        doneStatuses = cached.doneStatuses;
        activeSprints = cached.activeSprints;
      }

      // Apply auto-adjust and sprint date overrides before scheduling
      let effectiveSprints = autoAdjustStartDate ? autoAdjustSprintDates(sprints) : sprints;
      effectiveSprints = applySprintDateOverrides(effectiveSprints, sprintDateOverrides);

      // Run scheduling algorithm client-side (ignoreCapacity skips capacity constraints)
      const result = scheduleTickets({
        epics,
        tickets,
        sprints: effectiveSprints,
        sprintCapacities,
        maxDevelopers: 1, // Not used when ignoreCapacity is true
        doneStatuses,
        activeSprints,
        ignoreCapacity: true,
      });

      setGanttData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setGanttData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setGanttData(null);
    setError(null);
    cachedDataRef.current = null;
  }, []);

  const clearCache = useCallback(() => {
    cachedDataRef.current = null;
  }, []);

  return { ganttData, isLoading, error, generate, clear, clearCache };
};
