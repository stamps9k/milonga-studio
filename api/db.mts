import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? join(__dirname, "../db/milonga.sqlite");
const schemaPath = join(__dirname, "../db/schema.sql");

const isNewDatabase = !existsSync(dbPath);

export const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

// A fresh container -- or a first run on a new machine -- may only have
// the schema file, not a built database. Initialize it automatically so
// deployment doesn't need a manual step.
if (isNewDatabase) {
  db.exec(readFileSync(schemaPath, "utf8"));
  console.info(`Initialized new database at ${dbPath}`);
}
