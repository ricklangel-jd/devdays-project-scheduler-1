import { DateTime } from 'luxon';
import type { JiraSprint, SprintDateOverride } from '../types';
import { TIMEZONE } from './dates';

/**
 * Minimal date range for a sprint — used in maps keyed by sprint ID.
 */
export interface SprintDateRange {
  startDate: string;
  endDate: string;
}

/**
 * Build a Map from sprint ID → date range.
 * Accepts any array of objects with id, startDate, endDate.
 * Entries whose startDate or endDate is missing are omitted.
 */
export const buildSprintDateMap = (
  sprints: { id: number; startDate?: string; endDate?: string }[]
): Map<number, SprintDateRange> => {
  const map = new Map<number, SprintDateRange>();
  for (const sprint of sprints) {
    if (sprint.startDate && sprint.endDate) {
      map.set(sprint.id, { startDate: sprint.startDate, endDate: sprint.endDate });
    }
  }
  return map;
};

/**
 * Given a list of sprint IDs and a date map, return the ID of the sprint
 * with the latest start date. Returns null if no sprint has date info.
 * Use this to determine which PI or sprint a story "belongs to".
 */
export const getLatestSprintId = (
  sprintIds: number[],
  sprintDateMap: Map<number, SprintDateRange>
): number | null => {
  let latestId: number | null = null;
  let latestStartMs = -Infinity;
  for (const sprintId of sprintIds) {
    const sprint = sprintDateMap.get(sprintId);
    if (!sprint) continue;
    const startMs = new Date(sprint.startDate).getTime();
    if (startMs > latestStartMs) {
      latestStartMs = startMs;
      latestId = sprintId;
    }
  }
  return latestId;
};

/** Hour threshold (5PM) after which sprint start date should be adjusted to next day */
const START_DATE_HOUR_THRESHOLD = 17;
/** Hour threshold (8AM) before which sprint end date should be adjusted to previous workday */
const END_DATE_HOUR_THRESHOLD = 8;

/**
 * Apply sprint date overrides to an array of sprints.
 * Returns a new array with overridden dates applied.
 */
export const applySprintDateOverrides = (
  sprints: JiraSprint[],
  overrides: SprintDateOverride[]
): JiraSprint[] => {
  if (overrides.length === 0) return sprints;

  const overrideMap = new Map(overrides.map((o) => [o.sprintId, o]));

  return sprints.map((sprint) => {
    const override = overrideMap.get(sprint.id);
    if (override) {
      return {
        ...sprint,
        startDate: override.startDate,
        endDate: override.endDate,
      };
    }
    return sprint;
  });
};

/**
 * Check if a sprint has date overrides applied.
 */
export const hasSprintDateOverride = (
  sprintId: number,
  overrides: SprintDateOverride[]
): boolean => {
  return overrides.some((o) => o.sprintId === sprintId);
};

/**
 * Get the override for a specific sprint, if any.
 */
export const getSprintDateOverride = (
  sprintId: number,
  overrides: SprintDateOverride[]
): SprintDateOverride | undefined => {
  return overrides.find((o) => o.sprintId === sprintId);
};

/**
 * Get the previous workday (skipping weekends).
 */
const getPreviousWorkday = (dt: DateTime): DateTime => {
  let result = dt.minus({ days: 1 });
  // Skip weekends (Saturday = 6, Sunday = 7 in Luxon)
  while (result.weekday >= 6) {
    result = result.minus({ days: 1 });
  }
  return result;
};

/**
 * Auto-adjust sprint dates based on time of day in the configured timezone:
 * - Start dates after 5PM are moved to the next day
 * - End dates before 8AM are moved to the previous workday
 */
export const autoAdjustSprintDates = (sprints: JiraSprint[]): JiraSprint[] => {
  return sprints.map((sprint) => {
    let adjustedStartDate = sprint.startDate;
    let adjustedEndDate = sprint.endDate;

    // Adjust start date if after 5PM
    if (sprint.startDate) {
      const startDateTime = DateTime.fromISO(sprint.startDate).setZone(TIMEZONE);
      if (startDateTime.hour >= START_DATE_HOUR_THRESHOLD) {
        adjustedStartDate = startDateTime.plus({ days: 1 }).toFormat('yyyy-MM-dd');
      }
    }

    // Adjust end date if before 8AM
    if (sprint.endDate) {
      const endDateTime = DateTime.fromISO(sprint.endDate).setZone(TIMEZONE);
      if (endDateTime.hour < END_DATE_HOUR_THRESHOLD) {
        adjustedEndDate = getPreviousWorkday(endDateTime).toFormat('yyyy-MM-dd');
      }
    }

    if (adjustedStartDate !== sprint.startDate || adjustedEndDate !== sprint.endDate) {
      return {
        ...sprint,
        startDate: adjustedStartDate,
        endDate: adjustedEndDate,
      };
    }

    return sprint;
  });
};

/**
 * @deprecated Use autoAdjustSprintDates instead
 */
export const autoAdjustSprintStartDates = autoAdjustSprintDates;
