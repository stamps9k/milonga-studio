import { getJson } from "./figures.mts";
import type { Dance, DanceSummary } from "../dance/dance.mts";
import { parseDance } from "../dance/persistence.mts";

/** Presets are read-only. Editing/saving one creates a personal snapshot. */
export function fetchDanceSummaries(): Promise<DanceSummary[]> {
  return getJson<DanceSummary[]>("/api/dances");
}
export async function fetchDance(id: string): Promise<Dance> {
  return parseDance(
    await getJson<unknown>(`/api/dances/${encodeURIComponent(id)}`),
  );
}
