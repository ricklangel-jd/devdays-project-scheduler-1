import type {
  JiraEpic,
  JiraTicket,
  JiraSprint,
  SprintCapacity,
  SprintWithCapacity,
  ScheduledTicket,
  ScheduledEpic,
  DayCapacityInfo,
  GanttData,
  SchedulingInput,
  AggregateBlock,
  AggregateTicket,
} from '@/shared/types';
import { parseDate, isWeekend } from '@/shared/utils/dates';

/**
 * Safe accessor for dailyCapacity array - returns undefined if index is out of bounds
 * instead of throwing. Callers should check the result before accessing properties.
 */
const safeDay = (dailyCapacity: DayCapacity[], index: number): DayCapacity | undefined => {
  if (index < 0 || index >= dailyCapacity.length) return undefined;
  return dailyCapacity[index];
};

/**
 * Helper to get actual date from dailyCapacity array
 * endDay is exclusive, so endDate is the day before endDay (the last actual work day)
 */
const getDateFromDayIndex = (dayIndex: number, dailyCapacity: DayCapacity[]): string => {
  if (dayIndex < 0) return dailyCapacity[0]?.date ?? '';
  if (dayIndex >= dailyCapacity.length) return dailyCapacity[dailyCapacity.length - 1]?.date ?? '';
  return dailyCapacity[dayIndex]?.date ?? '';
};

/**
 * Get the end date (last actual work day) for a ticket
 * Since endDay is exclusive (index of first day NOT worked), the actual last work day is endDay - 1
 */
const getEndDateFromDayIndex = (endDay: number, dailyCapacity: DayCapacity[]): string => {
  const lastWorkDayIndex = endDay - 1;
  return getDateFromDayIndex(lastWorkDayIndex, dailyCapacity);
};

/**
 * Get all work days in a sprint as an array of date strings.
 * Jira's endDate is inclusive - iterate through all days from start to end.
 */
const getSprintWorkDays = (sprint: JiraSprint): string[] => {
  const workDays: string[] = [];
  let current = parseDate(sprint.startDate);
  const end = parseDate(sprint.endDate);

  // Jira's endDate is inclusive - iterate through all days from start to end
  while (current <= end) {
    if (!isWeekend(current)) {
      workDays.push(current.toISODate()!);
    }
    current = current.plus({ days: 1 });
  }

  return workDays;
};

/**
 * Interface for daily capacity tracking
 */
interface DayCapacity {
  date: string;
  sprintId: number;
  originalCapacity: number; // Original capacity for this day
  remainingCapacity: number; // Remaining capacity (decremented during scheduling)
  sprintDayIndex: number; // 0-9 for a 10-day sprint
}

/**
 * Build a map of daily capacities across all sprints
 * Skips duplicate dates when sprints overlap (e.g., Sprint 1 ends on same day Sprint 2 starts)
 */
const buildDailyCapacityMap = (
  sprints: SprintWithCapacity[],
  maxDevelopers: number,
  sprintCapacities: SprintCapacity[]
): DayCapacity[] => {
  const days: DayCapacity[] = [];
  const addedDates = new Set<string>();

  for (const sprint of sprints) {
    const workDays = getSprintWorkDays(sprint);
    const sprintCapacity = sprintCapacities.find(sc => sc.sprintId === sprint.id);
    let sprintDayIndex = 0;

    for (const date of workDays) {
      // Skip if this date was already added from a previous sprint
      if (addedDates.has(date)) continue;

      const dailyOverride = sprintCapacity?.dailyCapacities?.find(dc => dc.date === date);
      const capacity = dailyOverride?.capacity ?? maxDevelopers;

      days.push({
        date,
        sprintId: sprint.id,
        originalCapacity: capacity,
        remainingCapacity: capacity,
        sprintDayIndex,
      });

      addedDates.add(date);
      sprintDayIndex++;
    }
  }

  return days;
};

/**
 * Check if a ticket status indicates it's "done"
 * If doneStatuses is provided (from board config), uses exact match against those.
 * Otherwise falls back to legacy matching: done, resolved, closed (case-insensitive)
 */
const isDoneStatus = (status: string, doneStatuses?: string[]): boolean => {
  if (doneStatuses && doneStatuses.length > 0) {
    // Use board config: exact match (case-insensitive)
    const lowerStatus = status.toLowerCase();
    return doneStatuses.some(ds => ds.toLowerCase() === lowerStatus);
  }
  // Fallback: legacy matching
  const lowerStatus = status.toLowerCase();
  return lowerStatus.includes('done') ||
         lowerStatus.includes('resolved') ||
         lowerStatus.includes('closed');
};

/**
 * Check if a ticket is in any of the selected sprints
 */
const isInSelectedSprints = (ticket: JiraTicket, selectedSprintIds: number[]): boolean => {
  if (!ticket.sprintIds || ticket.sprintIds.length === 0) return false;
  return ticket.sprintIds.some(id => selectedSprintIds.includes(id));
};

/**
 * Check if a sprint is locked (active or closed - tickets can't be moved)
 */
const isLockedSprint = (sprint: SprintWithCapacity): boolean => {
  return sprint.state === 'active' || sprint.state === 'closed';
};

/**
 * Get the locked sprint ID for a ticket (if any)
 * Returns the first active/closed sprint the ticket is assigned to
 * Also checks activeSprintIds for sprints that may not be in the selected sprints list
 */
const getLockedSprintId = (
  ticket: JiraTicket,
  sprints: SprintWithCapacity[],
  activeSprintIds: Set<number>
): number | null => {
  if (!ticket.sprintIds || ticket.sprintIds.length === 0) return null;

  // Build set of locked sprint IDs from selected sprints (active or closed)
  const lockedSprintIds = new Set(
    sprints.filter(isLockedSprint).map(s => s.id)
  );

  // First check if ticket is in any active sprint (even if not selected)
  for (const sprintId of ticket.sprintIds) {
    if (activeSprintIds.has(sprintId)) {
      return sprintId;
    }
  }

  // Then check selected sprints that are locked (closed)
  for (const sprintId of ticket.sprintIds) {
    if (lockedSprintIds.has(sprintId)) {
      return sprintId;
    }
  }

  return null;
};

/**
 * Convert a JiraTicket to an AggregateTicket for Previous/Future blocks
 */
const toAggregateTicket = (ticket: JiraTicket): AggregateTicket => ({
  key: ticket.key,
  summary: ticket.summary,
  status: ticket.status,
  devDays: ticket.devDays,
});

/**
 * Create an AggregateBlock from a list of tickets
 */
const createAggregateBlock = (
  type: 'previous' | 'future',
  tickets: JiraTicket[]
): AggregateBlock | undefined => {
  if (tickets.length === 0) return undefined;

  return {
    type,
    tickets: tickets.map(toAggregateTicket),
    totalDevDays: tickets.reduce((sum, t) => sum + t.devDays, 0),
  };
};

/**
 * Calculate worst-case duration for an epic (sum of all ticket devDays)
 */
const calculateWorstCase = (epic: JiraEpic, tickets: JiraTicket[]): number => {
  return tickets
    .filter(t => t.epicKey === epic.key)
    .reduce((sum, t) => sum + t.devDays, 0);
};

/**
 * Sort epics by priority override (if set) then by worst-case duration (longest first)
 * When two epics have the same priority override, the one with longer worst-case is scheduled first
 */
const sortEpics = (epics: JiraEpic[], worstCaseMap: Map<string, number>): JiraEpic[] => {
  return [...epics].sort((a, b) => {
    // Primary: priorityOverride (lower = higher priority)
    // Epics with override come before those without
    if (a.priorityOverride !== undefined && b.priorityOverride === undefined) return -1;
    if (a.priorityOverride === undefined && b.priorityOverride !== undefined) return 1;

    // If both have overrides, compare them (but fall through to secondary if equal)
    if (a.priorityOverride !== undefined && b.priorityOverride !== undefined) {
      const priorityDiff = a.priorityOverride - b.priorityOverride;
      if (priorityDiff !== 0) return priorityDiff;
    }

    // Secondary: worst-case duration (longest first)
    const aWorst = worstCaseMap.get(a.key) ?? 0;
    const bWorst = worstCaseMap.get(b.key) ?? 0;
    return bWorst - aWorst;
  });
};

/**
 * Ticket with topological level and critical path weight for scheduling
 */
interface TicketWithLevel extends JiraTicket {
  level: number;           // Topological level (0 = no dependencies)
  downstreamWeight: number; // Total dev days of all tickets blocked by this one (critical path)
}

/**
 * Calculate downstream weight for each ticket (total dev days of all dependent tickets)
 * Uses memoized DFS to compute the critical path weight
 */
const calculateDownstreamWeights = (
  epicTickets: JiraTicket[],
  dependents: Map<string, string[]>, // ticketKey -> tickets that depend on it
  ticketMap: Map<string, JiraTicket>
): Map<string, number> => {
  const weights = new Map<string, number>();

  const calculateWeight = (ticketKey: string): number => {
    if (weights.has(ticketKey)) {
      return weights.get(ticketKey)!;
    }

    const ticket = ticketMap.get(ticketKey);
    if (!ticket) return 0;

    // Sum of this ticket's dev days + all downstream tickets' weights
    let weight = ticket.devDays;
    for (const dependentKey of dependents.get(ticketKey) ?? []) {
      weight += calculateWeight(dependentKey);
    }

    weights.set(ticketKey, weight);
    return weight;
  };

  for (const ticket of epicTickets) {
    calculateWeight(ticket.key);
  }

  return weights;
};

/**
 * Topologically sort tickets within an epic based on blocker relationships
 * Prioritizes tickets with higher downstream weight (critical path)
 * Uses Kahn's algorithm for topological sort
 */
const getEpicTicketsTopological = (epicKey: string, allTickets: JiraTicket[]): TicketWithLevel[] => {
  const epicTickets = allTickets.filter(t => t.epicKey === epicKey);
  const epicTicketKeys = new Set(epicTickets.map(t => t.key));

  // Build in-degree map and adjacency list (only for tickets within this epic)
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // blockerKey -> [ticketsThatDependOnIt]

  for (const ticket of epicTickets) {
    inDegree.set(ticket.key, 0);
    dependents.set(ticket.key, []);
  }

  // Count in-degrees (only from blockers within the same epic)
  for (const ticket of epicTickets) {
    const blockedBy = ticket.blockedBy ?? [];
    for (const blockerKey of blockedBy) {
      if (epicTicketKeys.has(blockerKey)) {
        inDegree.set(ticket.key, (inDegree.get(ticket.key) ?? 0) + 1);
        const deps = dependents.get(blockerKey) ?? [];
        deps.push(ticket.key);
        dependents.set(blockerKey, deps);
      }
    }
  }

  const ticketMap = new Map(epicTickets.map(t => [t.key, t]));

  // Calculate downstream weights for critical path prioritization
  const downstreamWeights = calculateDownstreamWeights(epicTickets, dependents, ticketMap);

  // Kahn's algorithm with level tracking
  const result: TicketWithLevel[] = [];

  // Initialize queue with tickets that have no dependencies (in-degree 0)
  let currentLevel: string[] = [];
  for (const ticket of epicTickets) {
    if (inDegree.get(ticket.key) === 0) {
      currentLevel.push(ticket.key);
    }
  }

  // Sort by downstream weight (higher = more critical = first)
  currentLevel.sort((a, b) => {
    const weightA = downstreamWeights.get(a) ?? 0;
    const weightB = downstreamWeights.get(b) ?? 0;
    return weightB - weightA; // Descending order
  });

  let level = 0;
  while (currentLevel.length > 0) {
    const nextLevel: string[] = [];

    for (const ticketKey of currentLevel) {
      const ticket = ticketMap.get(ticketKey)!;
      const weight = downstreamWeights.get(ticketKey) ?? 0;
      result.push({ ...ticket, level, downstreamWeight: weight });

      // Process dependents
      for (const dependentKey of dependents.get(ticketKey) ?? []) {
        const newInDegree = (inDegree.get(dependentKey) ?? 1) - 1;
        inDegree.set(dependentKey, newInDegree);

        if (newInDegree === 0) {
          nextLevel.push(dependentKey);
        }
      }
    }

    // Sort next level by downstream weight (higher = more critical = first)
    nextLevel.sort((a, b) => {
      const weightA = downstreamWeights.get(a) ?? 0;
      const weightB = downstreamWeights.get(b) ?? 0;
      return weightB - weightA;
    });

    currentLevel = nextLevel;
    level++;
  }

  // Check for cycles (tickets not processed = cycle detected)
  if (result.length !== epicTickets.length) {
    const processedKeys = new Set(result.map(t => t.key));
    const unprocessed = epicTickets.filter(t => !processedKeys.has(t.key));
    console.warn(`Cycle detected in epic ${epicKey}. Unprocessed tickets: ${unprocessed.map(t => t.key).join(', ')}`);

    // Add unprocessed tickets at the end with high level (fallback)
    for (const ticket of unprocessed) {
      result.push({ ...ticket, level: 999, downstreamWeight: 0 });
    }
  }

  return result;
};

/**
 * Convert a date string to an exact day index in the dailyCapacity array
 * Returns null if the date is not found (weekend, gap, or beyond sprints)
 */
const getDayIndexForDate = (dateStr: string, dailyCapacity: DayCapacity[]): number | null => {
  const targetDate = parseDate(dateStr).toISODate()!;
  for (let i = 0; i < dailyCapacity.length; i++) {
    if (dailyCapacity[i].date === targetDate) {
      return i;
    }
  }
  return null;
};

/**
 * Find the first day of the next sprint after the given day index
 */
const findNextSprintStart = (
  currentDayIndex: number,
  dailyCapacity: DayCapacity[]
): number => {
  const currentSprint = dailyCapacity[currentDayIndex]?.sprintId;
  if (currentSprint === undefined) return dailyCapacity.length;

  for (let i = currentDayIndex + 1; i < dailyCapacity.length; i++) {
    if (dailyCapacity[i].sprintId !== currentSprint) {
      return i;
    }
  }

  return dailyCapacity.length; // No more sprints
};

/**
 * Verify that all days from startDay to endDay-1 (inclusive) are in the same sprint
 */
const ticketCrossesSprintBoundary = (
  startDay: number,
  endDay: number,
  dailyCapacity: DayCapacity[]
): boolean => {
  if (startDay >= dailyCapacity.length) return true;

  const startSprintId = dailyCapacity[startDay].sprintId;
  // endDay is exclusive, so check up to endDay - 1
  for (let d = startDay; d < endDay && d < dailyCapacity.length; d++) {
    if (dailyCapacity[d].sprintId !== startSprintId) {
      return true;
    }
  }
  return false;
};

/**
 * Get the last day index of a sprint
 */
const getSprintEndDayIndex = (
  startDayIndex: number,
  dailyCapacity: DayCapacity[]
): number => {
  const sprintId = dailyCapacity[startDayIndex]?.sprintId;
  if (sprintId === undefined) return startDayIndex;

  for (let i = startDayIndex; i < dailyCapacity.length; i++) {
    if (dailyCapacity[i].sprintId !== sprintId) {
      return i - 1;
    }
  }

  return dailyCapacity.length - 1;
};

/**
 * Find a valid slot for a ticket that fits entirely within one sprint
 * Returns the starting day index, or -1 if no valid slot found
 */
const findSlotWithinSprint = (
  earliestStart: number,
  ticketDevDays: number,
  dailyCapacity: DayCapacity[]
): number => {
  let currentDayIndex = earliestStart;

  while (currentDayIndex < dailyCapacity.length) {
    const sprintEndIndex = getSprintEndDayIndex(currentDayIndex, dailyCapacity);
    const remainingDaysInSprint = sprintEndIndex - currentDayIndex + 1;

    // Check if ticket fits in remaining sprint days
    if (ticketDevDays <= remainingDaysInSprint) {
      const proposedEndDay = currentDayIndex + ticketDevDays;
      const lastOccupiedDay = proposedEndDay - 1;

      // Verify the last occupied day is still in the same sprint as the start
      if (lastOccupiedDay < dailyCapacity.length &&
          dailyCapacity[lastOccupiedDay].sprintId === dailyCapacity[currentDayIndex].sprintId) {
        return currentDayIndex;
      }
    }

    // Move to the start of next sprint
    currentDayIndex = findNextSprintStart(currentDayIndex, dailyCapacity);
  }

  return -1; // No valid slot found
};

/**
 * Get the day index range for a specific sprint
 */
const getSprintDayRange = (
  sprintId: number,
  dailyCapacity: DayCapacity[]
): { startIndex: number; endIndex: number } | null => {
  let startIndex = -1;
  let endIndex = -1;

  for (let i = 0; i < dailyCapacity.length; i++) {
    if (dailyCapacity[i].sprintId === sprintId) {
      if (startIndex === -1) startIndex = i;
      endIndex = i;
    }
  }

  if (startIndex === -1) return null;
  return { startIndex, endIndex };
};

/**
 * Find a slot within a specific sprint for a locked ticket
 * Returns the starting day index, or -1 if no valid slot found in that sprint
 */
const findSlotInSpecificSprint = (
  sprintId: number,
  earliestStart: number,
  ticketDevDays: number,
  dailyCapacity: DayCapacity[]
): number => {
  const sprintRange = getSprintDayRange(sprintId, dailyCapacity);
  if (!sprintRange) return -1;

  // Start from the later of: sprint start or earliest start (due to dependencies)
  let currentDayIndex = Math.max(sprintRange.startIndex, earliestStart);

  // Can only search within this sprint
  while (currentDayIndex <= sprintRange.endIndex) {
    const remainingDaysInSprint = sprintRange.endIndex - currentDayIndex + 1;

    // Check if ticket fits in remaining sprint days
    if (ticketDevDays <= remainingDaysInSprint) {
      // Check if all days have capacity
      let allHaveCapacity = true;
      for (let d = currentDayIndex; d < currentDayIndex + ticketDevDays; d++) {
        if (d >= dailyCapacity.length || dailyCapacity[d].remainingCapacity <= 0) {
          allHaveCapacity = false;
          break;
        }
      }

      if (allHaveCapacity) {
        return currentDayIndex;
      }
    }

    currentDayIndex++;
  }

  return -1; // No valid slot found in this sprint
};

/**
 * Find first day index of future sprints (after all active/closed sprints)
 */
const getFirstFutureSprintDayIndex = (
  sprints: SprintWithCapacity[],
  dailyCapacity: DayCapacity[]
): number => {
  const futureSprintIds = new Set(
    sprints.filter(s => s.state === 'future').map(s => s.id)
  );

  for (let i = 0; i < dailyCapacity.length; i++) {
    if (futureSprintIds.has(dailyCapacity[i].sprintId)) {
      return i;
    }
  }

  return dailyCapacity.length; // No future sprints
};

/**
 * Result of slotting an epic's tickets
 */
interface SlotEpicResult {
  scheduled: ScheduledTicket[];
  unslotted: JiraTicket[];
}

/**
 * Slot an epic's tickets using topological sort with parallel execution
 * Each ticket starts as soon as its specific blockers complete
 * Returns the scheduled tickets and any unslotted tickets (for Future block)
 */
const slotEpicLinear = (
  epic: JiraEpic,
  tickets: JiraTicket[],
  dailyCapacity: DayCapacity[],
  startDayIndex: number
): SlotEpicResult => {
  const scheduledTickets: ScheduledTicket[] = [];
  const unslottedTickets: JiraTicket[] = [];
  const epicTickets = getEpicTicketsTopological(epic.key, tickets);
  const epicTicketKeys = new Set(epicTickets.map(t => t.key));

  // Track end days for each scheduled ticket (for dependency resolution)
  const ticketEndDays = new Map<string, number>();
  // Track which tickets couldn't be scheduled (their dependents also can't be scheduled)
  const unslottedKeys = new Set<string>();

  // Process tickets in topological order (dependencies always come first)
  for (const ticket of epicTickets) {
    // Check if any blocker is unslotted - if so, this ticket is also unslotted
    const blockedBy = ticket.blockedBy ?? [];
    const hasUnslottedBlocker = blockedBy.some(key => unslottedKeys.has(key));

    if (hasUnslottedBlocker) {
      unslottedTickets.push(ticket);
      unslottedKeys.add(ticket.key);
      continue;
    }

    // Calculate earliest start based on blockers
    let earliestStart = startDayIndex;
    for (const blockerKey of blockedBy) {
      if (epicTicketKeys.has(blockerKey)) {
        const blockerEndDay = ticketEndDays.get(blockerKey);
        if (blockerEndDay !== undefined && blockerEndDay > earliestStart) {
          earliestStart = blockerEndDay;
        }
      }
    }

    // Find a valid slot within a single sprint
    const slotStartDay = findSlotWithinSprint(earliestStart, ticket.devDays, dailyCapacity);

    if (slotStartDay < 0) {
      // No valid slot found - add to unslotted
      unslottedTickets.push(ticket);
      unslottedKeys.add(ticket.key);
      continue;
    }

    const startDay = slotStartDay;
    const endDay = startDay + ticket.devDays;
    const lastOccupiedDay = endDay - 1;
    const sprintId = dailyCapacity[startDay].sprintId;
    const lastDaySprintId = dailyCapacity[lastOccupiedDay]?.sprintId;

    // Verify no sprint crossing
    if (sprintId !== lastDaySprintId) {
      console.error(`SPRINT CROSSING: ${ticket.key}`, {
        devDays: ticket.devDays,
        startDay,
        endDay,
        lastOccupiedDay,
        startDate: dailyCapacity[startDay]?.date,
        endDate: dailyCapacity[lastOccupiedDay]?.date,
        startSprintId: sprintId,
        endSprintId: lastDaySprintId,
      });
      throw new Error(`SPRINT CROSSING: ${ticket.key} (${ticket.devDays}d) starts in sprint ${sprintId} on ${dailyCapacity[startDay]?.date} but ends in sprint ${lastDaySprintId} on ${dailyCapacity[lastOccupiedDay]?.date}`);
    }

    // Consume capacity for this ticket
    for (let d = startDay; d < endDay && d < dailyCapacity.length; d++) {
      dailyCapacity[d].remainingCapacity -= 1;
    }

    // Track this ticket's end day for dependent tickets
    ticketEndDays.set(ticket.key, endDay);

    scheduledTickets.push({
      ...ticket,
      startDay,
      endDay,
      startDate: getDateFromDayIndex(startDay, dailyCapacity),
      endDate: getEndDateFromDayIndex(endDay, dailyCapacity),
      sprintId,
      parallelGroup: ticket.level,
      criticalPathWeight: ticket.downstreamWeight,
      isOnCriticalPath: false, // Will be calculated after all tickets are scheduled
    });
  }

  return { scheduled: scheduledTickets, unslotted: unslottedTickets };
};

/**
 * Find the next available slot with capacity for a ticket
 * Returns the day index where the ticket can start
 */
const findNextAvailableSlot = (
  startFrom: number,
  ticketDevDays: number,
  dailyCapacity: DayCapacity[]
): number => {
  let dayIndex = startFrom;

  while (dayIndex < dailyCapacity.length) {
    // Check if there's capacity and the ticket fits in the sprint
    if (dailyCapacity[dayIndex].remainingCapacity > 0) {
      const sprintEndIndex = getSprintEndDayIndex(dayIndex, dailyCapacity);
      const remainingDaysInSprint = sprintEndIndex - dayIndex + 1;
      const proposedEndDay = dayIndex + ticketDevDays;
      const lastOccupiedDay = proposedEndDay - 1;

      // Verify ticket fits in sprint AND last occupied day is in same sprint
      if (ticketDevDays <= remainingDaysInSprint &&
          lastOccupiedDay < dailyCapacity.length &&
          dailyCapacity[lastOccupiedDay].sprintId === dailyCapacity[dayIndex].sprintId) {
        // Check if all days have capacity
        let allHaveCapacity = true;
        for (let d = dayIndex; d < proposedEndDay && d < dailyCapacity.length; d++) {
          if (dailyCapacity[d].remainingCapacity <= 0) {
            allHaveCapacity = false;
            break;
          }
        }

        if (allHaveCapacity) {
          return dayIndex;
        }
      }
    }

    dayIndex++;
  }

  return dailyCapacity.length; // No slot found
};

/**
 * Partition epic tickets into:
 * - previous: Done tickets not in selected sprints
 * - locked: Tickets in active/closed sprints (must stay in their sprint)
 * - free: Tickets that can be freely scheduled in future sprints
 */
interface PartitionedTickets {
  previous: JiraTicket[];
  locked: { ticket: JiraTicket; sprintId: number }[];
  free: JiraTicket[];
}

const partitionEpicTickets = (
  epicKey: string,
  allTickets: JiraTicket[],
  selectedSprintIds: number[],
  sprints: SprintWithCapacity[],
  doneStatuses: string[] | undefined,
  activeSprintIds: Set<number>
): PartitionedTickets => {
  const epicTickets = allTickets.filter(t => t.epicKey === epicKey);
  const previous: JiraTicket[] = [];
  const locked: { ticket: JiraTicket; sprintId: number }[] = [];
  const free: JiraTicket[] = [];

  // Build set of selected sprint IDs for quick lookup
  const selectedSprintIdSet = new Set(selectedSprintIds);

  for (const ticket of epicTickets) {
    const isDone = isDoneStatus(ticket.status, doneStatuses);
    const inSelectedSprint = isInSelectedSprints(ticket, selectedSprintIds);

    // Previous block: Done tickets NOT in selected sprints (includes unassigned Done tickets)
    if (isDone && !inSelectedSprint) {
      previous.push(ticket);
      continue;
    }

    // Check if ticket is in an active sprint that is NOT selected
    // These should go to Previous (they're being worked on but we're not displaying that sprint)
    const ticketActiveSprintId = ticket.sprintIds?.find(id => activeSprintIds.has(id));
    if (ticketActiveSprintId !== undefined && !selectedSprintIdSet.has(ticketActiveSprintId)) {
      previous.push(ticket);
      continue;
    }

    // Check if ticket is locked to an active/closed sprint that IS selected
    const lockedSprintId = getLockedSprintId(ticket, sprints, activeSprintIds);
    if (lockedSprintId !== null && selectedSprintIdSet.has(lockedSprintId)) {
      locked.push({ ticket, sprintId: lockedSprintId });
    } else if (lockedSprintId !== null) {
      // Locked to a sprint that's not selected (closed sprint not selected) -> Previous
      previous.push(ticket);
    } else {
      // Free to schedule in future sprints
      free.push(ticket);
    }
  }

  return { previous, locked, free };
};

/**
 * Main scheduling algorithm
 * Slots tickets into sprints while respecting capacity and sprint boundaries
 */
export const scheduleTickets = (input: SchedulingInput): GanttData => {
  const { epics, tickets, sprints, sprintCapacities, selectedSprintIds, doneStatuses, activeSprints, ignoreCapacity } = input;

  // When ignoreCapacity is true (Sprint View), use very large capacity so scheduling
  // is not constrained by capacity - tickets are simply placed in their sprints.
  const effectiveMaxDevelopers = ignoreCapacity ? 9999 : input.maxDevelopers;

  // Build set of active sprint IDs (includes all active sprints, even if not selected)
  const activeSprintIds = new Set<number>(activeSprints?.map(s => s.id) ?? []);

  // Validate: Check for tickets > 10 points
  const oversizedTickets = tickets.filter(t => t.devDays > 10);
  if (oversizedTickets.length > 0) {
    throw new Error(
      `Stories exceed 10 points (max for a sprint): ${oversizedTickets.map(t => `${t.key} (${t.devDays}pts)`).join(', ')}`
    );
  }

  // Create sprints with capacity
  const sprintsWithCapacity: SprintWithCapacity[] = sprints
    .filter(s => sprintCapacities.some(sc => sc.sprintId === s.id))
    .map(sprint => {
      const capacity = sprintCapacities.find(sc => sc.sprintId === sprint.id);
      return {
        ...sprint,
        devDaysCapacity: ignoreCapacity ? 9999 : (capacity?.devDaysCapacity ?? effectiveMaxDevelopers),
        remainingCapacity: ignoreCapacity ? 9999 : (capacity?.devDaysCapacity ?? effectiveMaxDevelopers),
      };
    })
    .filter(s => s.startDate && s.endDate)
    .sort((a, b) => parseDate(a.startDate).toMillis() - parseDate(b.startDate).toMillis());

  if (sprintsWithCapacity.length === 0) {
    throw new Error('No valid sprints with capacity found');
  }

  // Compute selected sprint IDs (use provided or fall back to sprints with capacity)
  const effectiveSelectedSprintIds = selectedSprintIds ?? sprintsWithCapacity.map(s => s.id);

  // Project start date is first sprint start
  const projectStartDate = parseDate(sprintsWithCapacity[0].startDate);

  // Build daily capacity map (use effectiveMaxDevelopers so ignoreCapacity gets large values)
  const dailyCapacity = buildDailyCapacityMap(sprintsWithCapacity, effectiveMaxDevelopers, ignoreCapacity
    ? sprintCapacities.map(sc => ({ ...sc, devDaysCapacity: 9999 }))
    : sprintCapacities
  );

  if (dailyCapacity.length === 0) {
    throw new Error(
      `No work days found in selected sprints. Sprints: ${sprintsWithCapacity.map(s => `${s.name} (${s.startDate} - ${s.endDate})`).join(', ')}`
    );
  }

  // Debug: Log sprint boundaries
  console.log('=== SPRINT BOUNDARIES ===');
  for (const sprint of sprintsWithCapacity) {
    const sprintDays = dailyCapacity.filter(d => d.sprintId === sprint.id);
    console.log(`Sprint ${sprint.id} (${sprint.name}):`, {
      jiraStart: sprint.startDate,
      jiraEnd: sprint.endDate,
      computedFirst: sprintDays[0]?.date,
      computedLast: sprintDays[sprintDays.length - 1]?.date,
      totalDays: sprintDays.length,
    });
  }

  // Calculate worst-case duration for each epic
  const worstCaseMap = new Map<string, number>();
  for (const epic of epics) {
    worstCaseMap.set(epic.key, calculateWorstCase(epic, tickets));
  }

  // Separate epics by commit type (three tiers)
  const commitEpics = epics.filter(e => e.commitType === 'commit');
  const stretchEpics = epics.filter(e => e.commitType === 'stretch');
  const noneEpics = epics.filter(e => e.commitType === 'none');

  // Sort each group by priority override then worst-case duration
  const sortedCommits = sortEpics(commitEpics, worstCaseMap);
  const sortedStretch = sortEpics(stretchEpics, worstCaseMap);
  const sortedNone = sortEpics(noneEpics, worstCaseMap);

  // Track all scheduled tickets and blocks per epic
  const allScheduledTickets: ScheduledTicket[] = [];
  const epicPreviousBlocks = new Map<string, AggregateBlock | undefined>();
  const epicFutureBlocks = new Map<string, AggregateBlock | undefined>();
  const epicUnslottedTickets = new Map<string, JiraTicket[]>();

  // Initialize unslotted tracking for all epics
  for (const epic of epics) {
    epicUnslottedTickets.set(epic.key, []);
  }

  // ============================================================
  // PHASE 1: Partition all tickets and collect locked/free tickets
  // ============================================================
  const allLockedTickets: { ticket: JiraTicket; sprintId: number; epicKey: string }[] = [];
  const allFreeTickets: { ticket: JiraTicket; epicKey: string }[] = [];

  for (const epic of epics) {
    const { previous, locked, free } = partitionEpicTickets(
      epic.key,
      tickets,
      effectiveSelectedSprintIds,
      sprintsWithCapacity,
      doneStatuses,
      activeSprintIds
    );

    // Store previous block
    epicPreviousBlocks.set(epic.key, createAggregateBlock('previous', previous));

    // Collect locked tickets with their sprint assignment
    for (const { ticket, sprintId } of locked) {
      allLockedTickets.push({ ticket, sprintId, epicKey: epic.key });
    }

    // Collect free tickets
    for (const ticket of free) {
      allFreeTickets.push({ ticket, epicKey: epic.key });
    }
  }

  // Global tracking of ticket end days (for cross-epic dependency resolution)
  const globalTicketEndDays = new Map<string, number>();

  // ============================================================
  // PHASE 2: Schedule locked tickets in their assigned sprints
  // Group by sprint and schedule within each sprint
  // ============================================================
  console.log('=== SCHEDULING LOCKED TICKETS ===');
  console.log(`Total locked tickets: ${allLockedTickets.length}`);

  // Group locked tickets by sprint
  const ticketsByLockedSprint = new Map<number, { ticket: JiraTicket; epicKey: string }[]>();
  for (const { ticket, sprintId, epicKey } of allLockedTickets) {
    if (!ticketsByLockedSprint.has(sprintId)) {
      ticketsByLockedSprint.set(sprintId, []);
    }
    ticketsByLockedSprint.get(sprintId)!.push({ ticket, epicKey });
  }

  // Sort sprints by start date to schedule in order
  const lockedSprintIds = Array.from(ticketsByLockedSprint.keys()).sort((a, b) => {
    const sprintA = sprintsWithCapacity.find(s => s.id === a);
    const sprintB = sprintsWithCapacity.find(s => s.id === b);
    if (!sprintA || !sprintB) return 0;
    return parseDate(sprintA.startDate).toMillis() - parseDate(sprintB.startDate).toMillis();
  });

  // Schedule locked tickets for each sprint
  for (const sprintId of lockedSprintIds) {
    const sprintTickets = ticketsByLockedSprint.get(sprintId) ?? [];
    const sprint = sprintsWithCapacity.find(s => s.id === sprintId);
    console.log(`Sprint ${sprintId} (${sprint?.name}): ${sprintTickets.length} locked tickets`);

    // Get sprint day range
    const sprintRange = getSprintDayRange(sprintId, dailyCapacity);
    if (!sprintRange) {
      console.warn(`No day range found for sprint ${sprintId}, tickets will be unslotted`);
      for (const { ticket, epicKey } of sprintTickets) {
        epicUnslottedTickets.get(epicKey)!.push(ticket);
      }
      continue;
    }

    // Sort tickets by dependencies (simple topological sort within the sprint)
    const ticketKeys = new Set(sprintTickets.map(t => t.ticket.key));
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const { ticket } of sprintTickets) {
      inDegree.set(ticket.key, 0);
      dependents.set(ticket.key, []);
    }

    for (const { ticket } of sprintTickets) {
      for (const blockerKey of ticket.blockedBy ?? []) {
        if (ticketKeys.has(blockerKey)) {
          inDegree.set(ticket.key, (inDegree.get(ticket.key) ?? 0) + 1);
          dependents.get(blockerKey)!.push(ticket.key);
        }
      }
    }

    // Kahn's algorithm for topological sort
    const sorted: { ticket: JiraTicket; epicKey: string }[] = [];
    const queue = sprintTickets.filter(t => (inDegree.get(t.ticket.key) ?? 0) === 0);

    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      for (const depKey of dependents.get(current.ticket.key) ?? []) {
        const newDegree = (inDegree.get(depKey) ?? 1) - 1;
        inDegree.set(depKey, newDegree);
        if (newDegree === 0) {
          const depTicket = sprintTickets.find(t => t.ticket.key === depKey);
          if (depTicket) queue.push(depTicket);
        }
      }
    }

    // Add any remaining tickets (cycle detected)
    for (const t of sprintTickets) {
      if (!sorted.includes(t)) {
        sorted.push(t);
      }
    }

    // Schedule each ticket in this sprint
    for (const { ticket, epicKey } of sorted) {
      // Calculate earliest start based on blockers
      let earliestStart = sprintRange.startIndex;
      for (const blockerKey of ticket.blockedBy ?? []) {
        const blockerEndDay = globalTicketEndDays.get(blockerKey);
        if (blockerEndDay !== undefined && blockerEndDay > earliestStart) {
          earliestStart = blockerEndDay;
        }
      }

      // Find slot within this specific sprint
      let startDayIndex = findSlotInSpecificSprint(
        sprintId,
        earliestStart,
        ticket.devDays,
        dailyCapacity
      );

      let hasConstraintViolation = false;

      if (startDayIndex < 0) {
        // Can't fit in assigned sprint - place at end of sprint with constraint violation
        console.warn(`Ticket ${ticket.key} can't fit in sprint ${sprintId}, placing at sprint end with constraint violation`);
        hasConstraintViolation = true;

        // Calculate position: end on last day of sprint
        // startDay = lastDayOfSprint - devDays + 1 (but clamped to sprint start)
        const lastSprintDay = sprintRange.endIndex;
        startDayIndex = Math.max(sprintRange.startIndex, lastSprintDay - ticket.devDays + 1);
      }

      const endDay = startDayIndex + ticket.devDays;

      // Consume capacity (even for constraint violations - they still take up visual space)
      // Note: This may result in negative capacity which is intentional for violations
      for (let d = startDayIndex; d < endDay && d < dailyCapacity.length; d++) {
        dailyCapacity[d].remainingCapacity -= 1;
      }

      // Track end day globally
      globalTicketEndDays.set(ticket.key, endDay);

      allScheduledTickets.push({
        ...ticket,
        startDay: startDayIndex,
        endDay,
        startDate: getDateFromDayIndex(startDayIndex, dailyCapacity),
        endDate: getEndDateFromDayIndex(endDay, dailyCapacity),
        sprintId,
        parallelGroup: 0, // Will be recalculated later
        criticalPathWeight: ticket.devDays,
        isOnCriticalPath: false,
        hasConstraintViolation,
        isLocked: true,
      });
    }
  }

  // ============================================================
  // PHASE 3: Schedule free tickets in future sprints only
  // Each ticket is slotted at the earliest available day based on capacity
  // Priority order: commits > stretches > none, then by priority override
  // ============================================================
  console.log('=== SCHEDULING FREE TICKETS ===');
  console.log(`Total free tickets: ${allFreeTickets.length}`);

  // Get the first day index of future sprints
  const firstFutureDay = getFirstFutureSprintDayIndex(sprintsWithCapacity, dailyCapacity);
  console.log(`First future sprint day index: ${firstFutureDay}`);

  // Build epic lookup for priority info
  const epicLookup = new Map(epics.map(e => [e.key, e]));

  // Assign priority score to each ticket based on its epic's tier and priority override
  // Lower score = higher priority
  interface PrioritizedTicket {
    ticket: JiraTicket;
    epicKey: string;
    tierScore: number;       // 0=commit, 1=stretch, 2=none
    priorityOverride?: number;
    epicWorstCase: number;
  }

  const prioritizedTickets: PrioritizedTicket[] = allFreeTickets.map(({ ticket, epicKey }) => {
    const epic = epicLookup.get(epicKey);
    const tierScore = epic?.commitType === 'commit' ? 0 : epic?.commitType === 'stretch' ? 1 : 2;
    return {
      ticket,
      epicKey,
      tierScore,
      priorityOverride: epic?.priorityOverride,
      epicWorstCase: worstCaseMap.get(epicKey) ?? 0,
    };
  });

  // Sort all tickets by priority (but dependencies will be handled during scheduling)
  prioritizedTickets.sort((a, b) => {
    // Primary: tier (commit=0, stretch=1, none=2)
    if (a.tierScore !== b.tierScore) return a.tierScore - b.tierScore;

    // Secondary: priority override (lower = higher priority, undefined comes after defined)
    if (a.priorityOverride !== undefined && b.priorityOverride === undefined) return -1;
    if (a.priorityOverride === undefined && b.priorityOverride !== undefined) return 1;
    if (a.priorityOverride !== undefined && b.priorityOverride !== undefined) {
      const diff = a.priorityOverride - b.priorityOverride;
      if (diff !== 0) return diff;
    }

    // Tertiary: epic worst case (longer first)
    return b.epicWorstCase - a.epicWorstCase;
  });

  // Track which tickets are scheduled and which are pending
  const scheduledTicketKeys = new Set<string>();
  const unslottedTicketKeys = new Set<string>();
  const pendingTickets = new Set(prioritizedTickets.map(pt => pt.ticket.key));

  // Helper to check if a ticket's dependencies are satisfied
  const areDependenciesSatisfied = (ticket: JiraTicket): boolean => {
    const blockedBy = ticket.blockedBy ?? [];
    for (const blockerKey of blockedBy) {
      // Blocker must be either already scheduled or not in our pending set (external dependency)
      if (pendingTickets.has(blockerKey) && !scheduledTicketKeys.has(blockerKey)) {
        return false;
      }
      // If blocker is unslotted, this ticket can't be scheduled
      if (unslottedTicketKeys.has(blockerKey)) {
        return false;
      }
    }
    return true;
  };

  // Helper to get earliest start day based on blocker end times
  const getEarliestStartDay = (ticket: JiraTicket): number => {
    let earliest = firstFutureDay;
    for (const blockerKey of ticket.blockedBy ?? []) {
      const blockerEndDay = globalTicketEndDays.get(blockerKey);
      if (blockerEndDay !== undefined && blockerEndDay > earliest) {
        earliest = blockerEndDay;
      }
    }
    return earliest;
  };

  // Schedule tickets iteratively - keep processing until no more can be scheduled
  let madeProgress = true;
  while (madeProgress && pendingTickets.size > 0) {
    madeProgress = false;

    // Process tickets in priority order
    for (const pt of prioritizedTickets) {
      const { ticket, epicKey } = pt;

      // Skip if already processed
      if (scheduledTicketKeys.has(ticket.key) || unslottedTicketKeys.has(ticket.key)) {
        continue;
      }

      // Check dependencies
      if (!areDependenciesSatisfied(ticket)) {
        continue;
      }

      // Get topological info for this ticket (used by both pinned and normal paths)
      const epicFreeTickets = allFreeTickets.filter(ft => ft.epicKey === epicKey).map(ft => ft.ticket);
      const topoTicket = getEpicTicketsTopological(epicKey, epicFreeTickets).find(t => t.key === ticket.key);

      // ---- Pinned Start Date Handling ----
      if (ticket.pinnedStartDate) {
        const pinnedDayIndex = getDayIndexForDate(ticket.pinnedStartDate, dailyCapacity);
        const pinnedDateStr = parseDate(ticket.pinnedStartDate).toISODate()!;

        if (pinnedDayIndex === null) {
          // Date not found in dailyCapacity — check if it's beyond all sprints (→ unslotted)
          const lastDate = dailyCapacity.length > 0 ? dailyCapacity[dailyCapacity.length - 1].date : '';
          if (lastDate && pinnedDateStr > lastDate) {
            // Beyond all selected sprints → Future block (not an error)
            unslottedTicketKeys.add(ticket.key);
            pendingTickets.delete(ticket.key);
            epicUnslottedTickets.get(epicKey)!.push(ticket);
            madeProgress = true;
            continue;
          }
          throw new Error(
            `Ticket ${ticket.key} has pinned start date ${pinnedDateStr} which is not a work day in any selected sprint`
          );
        }

        // Verify the pinned day is in a future sprint
        const pinnedSprint = sprintsWithCapacity.find(s => s.id === dailyCapacity[pinnedDayIndex].sprintId);
        if (pinnedSprint && pinnedSprint.state !== 'future') {
          throw new Error(
            `Ticket ${ticket.key} has pinned start date ${pinnedDateStr} which falls in ${pinnedSprint.state} sprint ${pinnedSprint.name}, not a future sprint`
          );
        }

        // Check capacity on the pinned start date
        if (dailyCapacity[pinnedDayIndex].remainingCapacity <= 0) {
          throw new Error(
            `Ticket ${ticket.key} has pinned start date ${pinnedDateStr} but there is zero capacity on that day`
          );
        }

        // Check blocker conflicts
        for (const blockerKey of ticket.blockedBy ?? []) {
          const blockerEndDay = globalTicketEndDays.get(blockerKey);
          if (blockerEndDay !== undefined && blockerEndDay > pinnedDayIndex) {
            const blockerEndDate = getEndDateFromDayIndex(blockerEndDay, dailyCapacity);
            throw new Error(
              `Ticket ${ticket.key} has pinned start date ${pinnedDateStr} but is blocked by ${blockerKey} which doesn't finish until ${blockerEndDate}`
            );
          }
        }

        const pinnedEndDay = pinnedDayIndex + ticket.devDays;

        // Check sprint crossing
        if (ticketCrossesSprintBoundary(pinnedDayIndex, pinnedEndDay, dailyCapacity)) {
          throw new Error(
            `Ticket ${ticket.key} (${ticket.devDays}d) starts on pinned start date ${pinnedDateStr} but would cross into the next sprint`
          );
        }

        // Check capacity for ALL days in range
        for (let d = pinnedDayIndex; d < pinnedEndDay && d < dailyCapacity.length; d++) {
          if (dailyCapacity[d].remainingCapacity <= 0) {
            throw new Error(
              `Ticket ${ticket.key} has pinned start date ${pinnedDateStr} but day ${dailyCapacity[d].date} has no remaining capacity`
            );
          }
        }

        // Schedule at pinned position
        const pinnedSprintId = dailyCapacity[pinnedDayIndex].sprintId;
        for (let d = pinnedDayIndex; d < pinnedEndDay && d < dailyCapacity.length; d++) {
          dailyCapacity[d].remainingCapacity -= 1;
        }

        globalTicketEndDays.set(ticket.key, pinnedEndDay);

        allScheduledTickets.push({
          ...ticket,
          startDay: pinnedDayIndex,
          endDay: pinnedEndDay,
          startDate: getDateFromDayIndex(pinnedDayIndex, dailyCapacity),
          endDate: getEndDateFromDayIndex(pinnedEndDay, dailyCapacity),
          sprintId: pinnedSprintId,
          parallelGroup: topoTicket?.level ?? 0,
          criticalPathWeight: topoTicket?.downstreamWeight ?? ticket.devDays,
          isOnCriticalPath: false,
          isLocked: true,
        });

        scheduledTicketKeys.add(ticket.key);
        pendingTickets.delete(ticket.key);
        madeProgress = true;
        continue;
      }

      // ---- Normal (non-pinned) scheduling ----
      // Find earliest available slot
      const earliestStart = getEarliestStartDay(ticket);
      const slotStart = findNextAvailableSlot(earliestStart, ticket.devDays, dailyCapacity);

      if (slotStart >= dailyCapacity.length || slotStart < firstFutureDay) {
        // No valid slot - mark as unslotted
        unslottedTicketKeys.add(ticket.key);
        pendingTickets.delete(ticket.key);
        epicUnslottedTickets.get(epicKey)!.push(ticket);
        madeProgress = true;
        continue;
      }

      const endDay = slotStart + ticket.devDays;
      const sprintId = dailyCapacity[slotStart].sprintId;

      // Verify it's actually in a future sprint
      const sprint = sprintsWithCapacity.find(s => s.id === sprintId);
      if (sprint && sprint.state !== 'future') {
        unslottedTicketKeys.add(ticket.key);
        pendingTickets.delete(ticket.key);
        epicUnslottedTickets.get(epicKey)!.push(ticket);
        madeProgress = true;
        continue;
      }

      // Consume capacity
      for (let d = slotStart; d < endDay && d < dailyCapacity.length; d++) {
        dailyCapacity[d].remainingCapacity -= 1;
      }

      // Track end day globally
      globalTicketEndDays.set(ticket.key, endDay);

      allScheduledTickets.push({
        ...ticket,
        startDay: slotStart,
        endDay,
        startDate: getDateFromDayIndex(slotStart, dailyCapacity),
        endDate: getEndDateFromDayIndex(endDay, dailyCapacity),
        sprintId,
        parallelGroup: topoTicket?.level ?? 0,
        criticalPathWeight: topoTicket?.downstreamWeight ?? ticket.devDays,
        isOnCriticalPath: false,
      });

      scheduledTicketKeys.add(ticket.key);
      pendingTickets.delete(ticket.key);
      madeProgress = true;
    }
  }

  // Any remaining pending tickets couldn't be scheduled (circular deps or other issues)
  for (const pt of prioritizedTickets) {
    if (pendingTickets.has(pt.ticket.key)) {
      epicUnslottedTickets.get(pt.epicKey)!.push(pt.ticket);
    }
  }

  // ============================================================
  // PHASE 4: Build future blocks from unslotted tickets
  // ============================================================
  for (const epic of epics) {
    const unslotted = epicUnslottedTickets.get(epic.key) ?? [];
    epicFutureBlocks.set(epic.key, createAggregateBlock('future', unslotted));
  }

  // Calculate total dev days
  const totalDevDays = allScheduledTickets.reduce((sum, t) => sum + t.devDays, 0);

  // Build scheduled epics
  const scheduledEpics: ScheduledEpic[] = epics.map(epic => {
    const epicTickets = allScheduledTickets.filter(t => t.epicKey === epic.key);

    // Sort tickets by topological level, then by critical path weight (descending)
    epicTickets.sort((a, b) => {
      if (a.parallelGroup !== b.parallelGroup) {
        return a.parallelGroup - b.parallelGroup;
      }
      return b.criticalPathWeight - a.criticalPathWeight;
    });

    // Mark tickets on the critical path for this epic
    if (epicTickets.length > 0) {
      const ticketMap = new Map(epicTickets.map(t => [t.key, t]));

      // Build dependents map (ticket -> tickets it blocks)
      const dependents = new Map<string, string[]>();
      for (const ticket of epicTickets) {
        const blockedBy = ticket.blockedBy ?? [];
        for (const blockerKey of blockedBy) {
          if (ticketMap.has(blockerKey)) {
            if (!dependents.has(blockerKey)) {
              dependents.set(blockerKey, []);
            }
            dependents.get(blockerKey)!.push(ticket.key);
          }
        }
      }

      // Find ticket with highest weight at level 0 (first in sorted list)
      const level0Tickets = epicTickets.filter(t => t.parallelGroup === 0);
      if (level0Tickets.length > 0) {
        const criticalPathKeys = new Set<string>();
        let current = level0Tickets[0]; // Highest weight at level 0
        criticalPathKeys.add(current.key);

        // Trace through dependents, always following highest weight
        while (true) {
          const deps = dependents.get(current.key) ?? [];
          if (deps.length === 0) break;

          let nextTicket: typeof current | null = null;
          let maxWeight = -1;
          for (const depKey of deps) {
            const dep = ticketMap.get(depKey);
            if (dep && dep.criticalPathWeight > maxWeight) {
              maxWeight = dep.criticalPathWeight;
              nextTicket = dep;
            }
          }

          if (!nextTicket) break;
          criticalPathKeys.add(nextTicket.key);
          current = nextTicket;
        }

        // Mark critical path tickets
        for (const ticket of epicTickets) {
          if (criticalPathKeys.has(ticket.key)) {
            ticket.isOnCriticalPath = true;
          }
        }
      }
    }

    const epicTotalDevDays = epicTickets.reduce((sum, t) => sum + t.devDays, 0);
    const epicStartDay = epicTickets.length > 0 ? Math.min(...epicTickets.map(t => t.startDay)) : 0;
    const epicEndDay = epicTickets.length > 0 ? Math.max(...epicTickets.map(t => t.endDay)) : 0;

    return {
      ...epic,
      tickets: epicTickets,
      totalDevDays: epicTotalDevDays,
      startDay: epicStartDay,
      endDay: epicEndDay,
      startDate: getDateFromDayIndex(epicStartDay, dailyCapacity),
      endDate: getEndDateFromDayIndex(epicEndDay, dailyCapacity),
      previousBlock: epicPreviousBlocks.get(epic.key),
      futureBlock: epicFutureBlocks.get(epic.key),
    };
  });

  // Sort epics by worst case duration (longest first)
  scheduledEpics.sort((a, b) => b.totalDevDays - a.totalDevDays);

  // Build daily capacity info for UI display
  const dailyCapacityInfo: DayCapacityInfo[] = dailyCapacity.map((day, index) => ({
    date: day.date,
    dayIndex: index,
    sprintId: day.sprintId,
    totalCapacity: day.originalCapacity,
    remainingCapacity: day.remainingCapacity,
    usedCapacity: day.originalCapacity - day.remainingCapacity,
  }));

  // Calculate project end date from actual dates
  const maxEndDay = Math.max(...allScheduledTickets.map(t => t.endDay), 0);
  const projectEndDateStr = getEndDateFromDayIndex(maxEndDay, dailyCapacity);

  return {
    epics: scheduledEpics,
    sprints: sprintsWithCapacity,
    dailyCapacities: dailyCapacityInfo,
    projectStartDate: projectStartDate.toISODate()!,
    projectEndDate: projectEndDateStr || projectStartDate.toISODate()!,
    totalDevDays,
    totalDays: maxEndDay,
  };
};
