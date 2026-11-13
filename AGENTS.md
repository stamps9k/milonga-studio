# Milonga Studio development guidance

These instructions apply throughout this repository. Folders may contain
their own `AGENTS.md` with more specific guidance; when working in such a
folder, follow both, with the nearer file taking precedence where they differ.

## Project map

Milonga Studio is a ballroom/tango step planner: a user chains dance figures
into a sequence and scrubs or plays it back as an overhead diagram, with a 3D
view planned. It is a TypeScript (ESM, `.mts`/`.tsx`) app with a React + Vite
frontend and a small Express + SQLite API.

- `src/libs/dance/` is the core domain model and simulation: the types
  (`DanceStep` -> `Figure` -> `Sequence` -> `Dance`, with `Pose` as the
  resolved snapshot), the fold that turns steps into poses over time, and the
  floor transforms that place and chain figures. The rest of the app consumes
  it. Read `src/libs/dance/AGENTS.md` before changing anything there.
- `src/components/`, `src/hooks/` and `src/apps/` are the React UI. Hooks own
  state and playback (`usePlayback` drives the requestAnimationFrame clock,
  `useSequenceBuilder` places figures with `fitTransform`); components render.
  `Canvas2D` draws an SVG from `fold.mts` output; `Canvas3D` is a placeholder
  for the future 3D renderer.
- `src/libs/api/` is the frontend's API client; `src/libs/browser/` holds
  browser-only helpers.
- `api/` is the Express server. `api/assemble.mts` is the single place that
  turns normalized database rows back into the nested domain types; the
  frontend never sees table structure.
- `db/schema.sql` is the source of truth for the database and mirrors the
  types in `src/libs/dance/`. `db/seed.mts` loads sample figures and
  sequences. Generated `db/*.sqlite` files are not committed.
- `test/` holds `node:test` suites that mirror `src/` paths (for example
  `test/dance/fold.test.mts` covers `src/libs/dance/fold.mts`).
- `config/` holds the Vite, TypeScript, ESLint and Prettier configuration.

Keep the layering intact. Dance geometry, timing and placement logic belongs
in `src/libs/dance/` as plain functions over plain data, not in components or
hooks. Renderers (2D now, 3D later) should only read data produced by the
dance model, so both views can share one source of truth. Do not add drawing-
or renderer-specific fields to the domain types.

## Running the project

- `npm ci` installs dependencies (Node 22, matching CI).
- `npm run dev` starts the Vite dev server; `npm run api:dev` starts the API
  on port 58735 (override with `API_PORT`). Vite proxies `/api` to the API, so
  local development needs both running.
- `npm run db:reset` deletes the database, recreates it from
  `db/schema.sql` and seeds it with `db/seed.mts` (`DB_PATH` overrides the
  location). Stop the API first. Run it after any change to the schema or
  the seed, since an existing database never picks those up by itself. The
  API also creates an empty database from the schema if none exists, and
  `npx tsx db/seed.mts` refuses to seed a database that already has data.
- `npm run build` type-checks and builds the frontend into `dist/`, which the
  API serves in production (see `Dockerfile` and `docker-compose.yml`).

## Data model and schema changes

- A change to a type in `src/libs/dance/` that is persisted needs matching
  changes to `db/schema.sql`, `api/assemble.mts` and, where relevant,
  `db/seed.mts`. If one of these is deliberately left unchanged, say why in
  the PR.
- `Dance.schemaVersion` exists so saved or shared dances can be migrated.
  Breaking changes to the saved shape should bump it and describe the
  migration impact.
- The schema relies on `PRAGMA foreign_keys = ON` for every connection; keep
  that in any new connection code.

## Scope and judgement

- Keep each change focused on its task. Do not refactor, reformat or rename
  unrelated code in the same PR; propose it separately instead.
- When a dance rule, figure definition or technique detail is uncertain, ask
  the owner rather than inventing one. If work has to proceed, implement the
  smallest reasonable assumption and label it as provisional in code comments
  and in the PR.
- Ask before adding a dependency. New dependencies must be compatible with
  the project's AGPL-3.0-or-later licence and justified in the PR.

## Explain the code and the reasoning

- Explain changes in enough detail that the repository owner can understand
  exactly what the code does, what changed, and why the change is needed.
- Describe the affected behavior and how the implementation produces it. For
  behavior changes, include a concrete before-and-after example when helpful.
- Document non-obvious algorithms, data transformations, assumptions, units,
  coordinate conventions, and dance-model decisions close to the relevant code.
  Explain both the mechanism and the reason for choosing it.
- Use the existing codebase as a rough guide to the level of explanation. In
  particular, the dance model and simulation modules include detailed comments
  about their behavior and modeling assumptions. Keep those comments accurate
  when changing the implementation.
- State uncertainties and limitations explicitly. Distinguish confirmed dance
  rules from provisional modeling choices, and explain material tradeoffs.
- Keep explanations concrete and relevant; comments should add understanding
  beyond restating individual statements in the code.

## Naming and formatting

- Follow the project's ESLint configuration in `config/eslint.config.mjs` and
  Prettier configuration in `config/.prettierrc`.
- Use `npm run lint` and `npm run format:check` to check those conventions.
- Follow nearby code for naming, file organization, and conventions that the
  tools do not enforce. Prefer descriptive names consistent with the existing
  domain types and terminology.

## Tests, hooks and CI

- Tests use Node's built-in `node:test` runner via `tsx`. Put new suites at
  `test/<area>/<module>.test.mts`. The `npm test` glob is expanded by `sh`,
  which treats `**` as `*`, so suites nested more than one folder below
  `test/` are not picked up.
- A Husky pre-commit hook runs lint-staged (ESLint and Prettier on staged
  files), the full test suite, and `audit-ci` when `package.json`,
  `package-lock.json` or `audit-ci.jsonc` are staged. Do not bypass it with
  `--no-verify`. If it fails, fix the cause. Any `audit-ci.jsonc` exception
  needs a written reason in the file and in the PR.
- Stage `package-lock.json` together with any `package.json` change; the
  hook rejects the commit otherwise.
- CI (`.github/workflows/test.yml`) currently runs only `npm test`. Lint,
  formatting and build checks are not enforced by CI yet, so run them locally
  and report the results.

## Pull requests and handoff

- Use the GitHub connector connection named `stamps9k-agent` for repository
  writes and pull requests. Verify the authenticated account; do not use the
  owner's main `stamps9k` account.
- Work on a task branch and open a pull request for the owner's review. Leave
  merging and repository ruleset configuration to the owner unless requested.
- Write the PR title and description around the final change, following
  `.github/pull_request_template.md`. Explain the problem, the resulting
  behavior, the implementation, and why that approach was chosen. Identify
  affected files or modules when that helps review.
- Ensure the git commit messages also clearly document the problem, the change
  and why the approach was taken. This should be done in a similar manner to the
  PR guidelines.
- Describe validation performed and its results, including relevant tests and
  any remaining risks or limitations. Do not claim checks passed unless verified.
- Run the existing test suite with `npm test` for code changes, along with
  applicable lint, formatting, and build checks. Add or update meaningful tests
  when behavior changes warrant them. Documentation-only changes need formatting
  validation; do not add tests that only mirror documentation or implementation.
- Confirm the PR's required GitHub Actions checks pass before handing it over
  as ready for review. If a check fails or cannot run, report the specific
  blocker and keep the PR marked as not ready.
