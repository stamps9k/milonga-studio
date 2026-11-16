import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FigureError,
  defineFigure,
  parseFigureDefinition,
} from "../../src/libs/dance/authoring.mts";
import type { AuthoredFigure } from "../../src/libs/dance/authoring.mts";

/**
 * Loads every figure file (`*.json`) in a directory -- by default this
 * one, db/figures/ -- so adding, editing or removing a figure is just a
 * matter of adding, editing or removing its file: no code changes, and
 * `npm run db:reset` picks it up.
 *
 * Each file is parsed, checked for shape (parseFigureDefinition: unknown
 * fields, wrong types, misspelt directions) and then turned into model
 * data and checked as dancing (defineFigure: weighted-foot steps,
 * timing, expectEnd). Problems from every file are collected and
 * reported together, each prefixed with its file name, so one run shows
 * everything that needs fixing.
 *
 * Figures are returned in file-name order, which makes the result stable
 * whatever order the file system lists them in. Two files with the same
 * figure name are an error, because the seed's sequences pick figures by
 * name.
 */
export function loadFigures(
  directory: string = dirname(fileURLToPath(import.meta.url)),
): AuthoredFigure[] {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .sort();

  const figures: AuthoredFigure[] = [];
  const problems: string[] = [];
  const fileByName = new Map<string, string>();

  for (const file of files) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(join(directory, file), "utf8"));
    } catch (error) {
      problems.push(
        `${file}: isn't valid JSON (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }

    try {
      const figure = defineFigure(parseFigureDefinition(json, file));
      const existing = fileByName.get(figure.name);
      if (existing !== undefined) {
        problems.push(
          `${file}: the name "${figure.name}" is already used by ${existing}`,
        );
        continue;
      }
      fileByName.set(figure.name, file);
      figures.push(figure);
    } catch (error) {
      if (!(error instanceof FigureError)) throw error;
      // parseFigureDefinition's messages already start with the file
      // name; defineFigure's start with the figure's name.
      problems.push(
        error.message.startsWith(file)
          ? error.message
          : `${file}: ${error.message}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new FigureError(
      `Some figure files in ${directory} have problems:\n${problems.join("\n")}`,
    );
  }
  return figures;
}
