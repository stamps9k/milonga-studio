/**
 * Rebuilds the database from scratch: deletes it, recreates the tables
 * from db/schema.sql, then fills it with the sample data from
 * db/seed.mts.
 *
 *   npm run db:reset
 *
 * DB_PATH chooses which database file, the same as for the API and the
 * seed script (default: db/milonga.sqlite). Because Docker Compose
 * bind-mounts the repo's db/ folder into the container, running this in
 * the repo resets the container's database too.
 *
 * Stop the API (or the container) first. On macOS and Linux a running
 * server keeps reading the deleted file through its open handle and
 * won't see the new database until it restarts; on Windows the file
 * can't be deleted while the server has it open.
 *
 * Why delete the file instead of emptying the tables: the schema only
 * reaches a database when it's created (api/db.mts applies schema.sql
 * to a new file only), so starting from a new file is the one way to be
 * sure the tables and triggers match the current schema.sql.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, rmSync } from "node:fs";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? join(__dirname, "milonga.sqlite");
const schemaPath = join(__dirname, "schema.sql");

// SQLite can leave side files next to the database (a rollback journal,
// or -wal/-shm files in WAL mode). A stale one left beside a new
// database could be replayed into it, so remove them along with it.
for (const path of [
  dbPath,
  `${dbPath}-journal`,
  `${dbPath}-wal`,
  `${dbPath}-shm`,
]) {
  try {
    rmSync(path, { force: true });
  } catch (error) {
    throw new Error(
      `Couldn't delete ${path}. Stop the API or container using the database and try again.`,
      { cause: error },
    );
  }
}

const db = new Database(dbPath);
db.exec(readFileSync(schemaPath, "utf8"));
db.close();
console.info(`Recreated ${dbPath} from ${schemaPath}`);

// db/seed.mts runs as soon as it's imported and reads DB_PATH at that
// point, so make sure it seeds the file just created even when DB_PATH
// wasn't set.
process.env.DB_PATH = dbPath;
await import("./seed.mts");
