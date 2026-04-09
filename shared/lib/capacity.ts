/**
 * Shared capacity serialization/deserialization logic.
 * Used by both the Capacity page UI and the Sprint Metrics API route.
 */

export const DEFAULT_CAPACITY_DAYS = 10; // work days per sprint per engineer
export const DEFAULT_CAPACITY_PCT = 100; // default capacity percentage per engineer

export interface EngineerRow {
  name: string;
  isTechLead: boolean;
  daysOut: number;
  capacityPct: number;
  notes?: string;
  ignore?: boolean;
}

export interface CapacityPayload {
  rows: EngineerRow[];
  supportPct: number;
}

/** Points contributed by a single engineer for the sprint. Tech leads and ignored engineers contribute 0. */
export const computeEngineerCapacity = (row: EngineerRow): number => {
  if (row.isTechLead || row.ignore) return 0;
  return Math.round(Math.max(0, DEFAULT_CAPACITY_DAYS - row.daysOut) * (row.capacityPct / 100) * 10) / 10;
};

/** Total sprint capacity across all engineers, minus the support time percentage. */
export const computeTotalCapacity = (rows: EngineerRow[], supportPct: number): number => {
  const raw = rows.reduce((sum, r) => sum + computeEngineerCapacity(r), 0);
  return Math.round(raw * (1 - supportPct / 100) * 10) / 10;
};

/** Number of active (non-tech-lead, non-ignored) engineers. */
export const countNonTechLeadEngineers = (rows: EngineerRow[]): number =>
  rows.filter((r) => !r.isTechLead && !r.ignore).length;

// ── Serialization ────────────────────────────────────────────────────
// Format: "supportPct;Name:isTechLead:daysOut:capacityPct:notes:ignore|..."
// Names and notes are URI-encoded to handle spaces/special chars.
// The ignore field was added later; existing records without it default to false.

export const serializeCapacity = (rows: EngineerRow[], supportPct: number): string => {
  const engineerPart = rows
    .map((r) => `${encodeURIComponent(r.name)}:${r.isTechLead ? 1 : 0}:${r.daysOut}:${r.capacityPct}:${encodeURIComponent(r.notes ?? '')}:${r.ignore ? 1 : 0}`)
    .join('|');
  return `${supportPct};${engineerPart}`;
};

export const deserializeCapacity = (raw: string): CapacityPayload | null => {
  try {
    const semicolon = raw.indexOf(';');
    const supportPct = semicolon !== -1 ? parseInt(raw.slice(0, semicolon), 10) : 10;
    const engineerPart = semicolon !== -1 ? raw.slice(semicolon + 1) : raw;
    const rows = engineerPart.split('|').map((entry) => {
      const [namePart, tlPart, doPart, pctPart, notesPart, ignorePart] = entry.split(':');
      const name = decodeURIComponent(namePart);
      const isTechLead = tlPart === '1';
      const daysOut = parseFloat(doPart);
      const capacityPct = pctPart !== undefined ? parseInt(pctPart, 10) : 100;
      if (!name || isNaN(daysOut) || isNaN(capacityPct)) return null;
      const notes = notesPart ? decodeURIComponent(notesPart) : undefined;
      const ignore = ignorePart === '1';
      return { name, isTechLead, daysOut, capacityPct, notes, ignore };
    });
    if (rows.some((r) => r === null) || isNaN(supportPct)) return null;
    return { rows: rows as EngineerRow[], supportPct };
  } catch {
    return null;
  }
};
