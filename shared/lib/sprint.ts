/**
 * Derives a short sprint label from a sprint name by extracting the trailing
 * number from the name and prepending "Sprint ".
 *
 * Sprint names are expected to end with a numeric identifier, e.g.:
 *   "PROJ Sprint 24.4.3"  → "Sprint 3"
 *   "Team Alpha - S42"    → "Sprint 42"
 *   "Sprint 15"           → "Sprint 15"
 *
 * If no trailing number is found the raw sprint name is returned as-is.
 */
export const sprintLabelFromName = (sprintName: string): string => {
  const match = sprintName.match(/(\d+)\s*$/);
  return match ? `Sprint ${match[1]}` : sprintName;
};
