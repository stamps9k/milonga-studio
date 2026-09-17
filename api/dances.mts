import express, { type Request, type Response } from "express";
import { db } from "./db.mts";
import {
  assembleFigure,
  assembleSequence,
  assembleDance,
} from "./assemble.mts";
import type { FigureSummary } from "../src/libs/dance/step.mts";

const dance_routes = express.Router();

/** Parses a route param as a positive integer id, or responds 400 and
 *  returns null so the caller can bail out of the handler. Express 5
 *  types route params as `string | string[]` (wildcard patterns like
 *  `{*splat}` can produce arrays), even though a plain `:id` segment
 *  like these routes use is always a single string at runtime -- an
 *  array here would mean something unexpected reached this route, so
 *  it's treated as an invalid id rather than asserted away. */
function parseId(raw: string | string[], res: Response): number | null {
  if (Array.isArray(raw)) {
    res
      .status(400)
      .json({ success: false, error: `Invalid id: ${raw.join(",")}` });
    return null;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: `Invalid id: ${raw}` });
    return null;
  }
  return id;
}

// ---------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------

interface FigureSummaryRow {
  id: number;
  name: string;
  style: string;
}

// Lightweight summaries for browsing (e.g. the step/figure library) --
// the full nested Figure (with steps and poses expanded) is only worth
// paying for once a specific figure is actually selected.
dance_routes.get("/api/figures", (_req: Request, res: Response) => {
  try {
    const rows = db
      .prepare("SELECT id, name, style FROM figures ORDER BY name")
      .all() as FigureSummaryRow[];
    // Ids are stringified here to match Figure.id's convention elsewhere
    // (see assembleFigure) -- callers shouldn't see numeric ids from one
    // endpoint and string ids from another.
    const figures: FigureSummary[] = rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      style: row.style,
    }));
    res.json({ success: true, message: figures });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

dance_routes.get("/api/figures/:id", (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    res.json({ success: true, message: assembleFigure(id) });
  } catch (err) {
    res.status(404).json({ success: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------

dance_routes.get("/api/sequences/:id", (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    res.json({ success: true, message: assembleSequence(id) });
  } catch (err) {
    res.status(404).json({ success: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------
// Dances
// ---------------------------------------------------------------------

dance_routes.get("/api/dances", (_req: Request, res: Response) => {
  try {
    const rows = db
      .prepare(
        "SELECT id, name, tempo, updated_at AS updatedAt FROM dances ORDER BY updated_at DESC",
      )
      .all();
    res.json({ success: true, message: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

dance_routes.get("/api/dances/:id", (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    res.json({ success: true, message: assembleDance(id) });
  } catch (err) {
    res.status(404).json({ success: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------

dance_routes.get("/api/hello", (_req: Request, res: Response) => {
  res.json({ success: true, message: "hello" });
});

export { dance_routes };
