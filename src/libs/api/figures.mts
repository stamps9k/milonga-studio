import type { Figure, FigureSummary } from "../dance/step.mts";

interface ApiResponse<T> {
  success: boolean;
  message?: T;
  error?: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok || !body.success) {
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (body.message === undefined) {
    throw new Error(`Response from ${url} had no message payload`);
  }
  return body.message;
}

/** Lightweight catalog rows for browsing -- see GET /api/figures in
 *  api/dances.mts. Never the full nested figure. */
export function fetchFigureSummaries(): Promise<FigureSummary[]> {
  return getJson<FigureSummary[]>("/api/figures");
}

/** Full nested figure (steps + start/end poses) -- fetched once a
 *  specific figure is actually needed, e.g. to add it to a sequence. */
export function fetchFigure(figureId: string): Promise<Figure> {
  return getJson<Figure>(`/api/figures/${encodeURIComponent(figureId)}`);
}
