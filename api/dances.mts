import express, { type Request, type Response } from "express";
import { db } from "./db.mts";
import {
  assembleFigure,
  assembleSequence,
  assembleDance,
} from "./assemble.mts";

const dance_routes = express.Router();

/** Parses a route param as a positive integer id, or responds 400 and
 *  returns null so the caller can bail out of the handler. */
function parseId(raw: string, res: Response): number | null {
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

// Lightweight summaries for browsing (e.g. the step/figure library) --
// the full nested Figure (with steps and poses expanded) is only worth
// paying for once a specific figure is actually selected.
dance_routes.get("/api/figures", (_req: Request, res: Response) => {
  try {
    const rows = db
      .prepare("SELECT id, name, style FROM figures ORDER BY name")
      .all();
    res.json({ success: true, message: rows });
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
