import type { PiSprintAssignment } from '@/shared/types';

/**
 * Stable string key for a set of PI sprint assignments.
 * Used as a useMemo / useEffect dependency to detect meaningful changes
 * without triggering on new array references.
 */
export const serializePiSprints = (assignments: PiSprintAssignment[]): string =>
  assignments
    .filter((a) => a.sprintIds.length > 0)
    .map((a) => `${a.piLabel}:${a.sprintIds.join('.')}`)
    .join(',');
