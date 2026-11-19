import type { Request, Response } from "express";

export type ApiEntity = "figure" | "sequence" | "dance";

/** Distinguishes a missing row from SQL/assembly failures without matching
 * error-message text. Entity/id also identify missing nested references. */
export class RecordNotFoundError extends Error {
  constructor(
    public readonly entity: ApiEntity,
    public readonly id: number,
  ) {
    super(`No ${entity} with id ${id}`);
    this.name = "RecordNotFoundError";
  }
}

/** Only a missing requested record is a 404. A missing figure inside an
 * existing sequence (or sequence inside a dance) is broken stored data, so it
 * stays a 500. Internal details go to server logs, never the JSON response. */
export function sendApiError(
  req: Request,
  res: Response,
  error: unknown,
  requested?: { entity: ApiEntity; id: number },
): void {
  if (
    error instanceof RecordNotFoundError &&
    error.entity === requested?.entity &&
    error.id === requested.id
  ) {
    res.status(404).json({ success: false, error: error.message });
    return;
  }
  console.error(`API ${req.method} ${req.path} failed`, error);
  res.status(500).json({ success: false, error: "Internal server error." });
}
