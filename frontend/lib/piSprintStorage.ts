import type { PiSprintAssignment } from '@/shared/types';

const STORAGE_KEY_PREFIX = 'piSprintMappings:board:';

interface StoredPiSprintMappings {
  boardId: number;
  updatedAt: string;
  assignments: PiSprintAssignment[];
}

/**
 * Save PI-to-sprint assignments to localStorage for a board.
 */
export function savePiSprintMappings(boardId: number, assignments: PiSprintAssignment[]): void {
  try {
    const data: StoredPiSprintMappings = {
      boardId,
      updatedAt: new Date().toISOString(),
      assignments: assignments.filter((a) => a.sprintIds.length > 0),
    };
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${boardId}`, JSON.stringify(data));
  } catch {
    // localStorage may be full or unavailable — silently ignore
  }
}

/**
 * Load saved PI-to-sprint assignments from localStorage for a board,
 * filtered to only the requested PI labels.
 * Returns null if nothing is stored.
 */
export function loadPiSprintMappings(boardId: number, piLabels: string[]): PiSprintAssignment[] | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${boardId}`);
    if (!raw) return null;

    const data: StoredPiSprintMappings = JSON.parse(raw);
    if (!data.assignments || !Array.isArray(data.assignments)) return null;

    const labelSet = new Set(piLabels);
    const filtered = data.assignments.filter(
      (a) => labelSet.has(a.piLabel) && a.sprintIds.length > 0,
    );

    return filtered.length > 0 ? filtered : null;
  } catch {
    return null;
  }
}

/**
 * Validate stored sprint IDs against the actual set of valid sprint IDs,
 * removing any stale/deleted sprint references.
 */
export function validateAssignments(
  assignments: PiSprintAssignment[],
  validSprintIds: Set<number>,
): PiSprintAssignment[] {
  return assignments
    .map((a) => ({
      piLabel: a.piLabel,
      sprintIds: a.sprintIds.filter((id) => validSprintIds.has(id)),
    }))
    .filter((a) => a.sprintIds.length > 0);
}
