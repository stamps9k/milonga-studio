# Milonga Studio

A web app for planning and reviewing ballroom dance steps in 2D and 3D.

## Dances and personal saves

The application menu bar keeps the canvas clear:

- **File**: start a new dance, save it in this browser (**Save**, **Save
  As…**), import/export JSON, or manage local saves. **Save** on the toolbar
  is the quick save action; Ctrl/Cmd+S saves and Ctrl/Cmd+Shift+S opens Save
  As.
- **Open**: choose a personal local save or a pre-created server preset from
  the dropdown. Presets always open as editable working copies.
- **Dance → Dance details…**: edit the name and notes in a dialog. Clicking
  the current dance name opens the same dialog. **Apply changes** updates the
  working copy; **Cancel**, Escape and closing the dialog leave it unchanged.
- **Share**: copy a preload link or export JSON. The 2D/3D buttons switch views.

The first **Save** opens a name/notes dialog, then stores a snapshot in this
browser's IndexedDB. Further saves update that record. **Save As…** asks
for a new name and creates a separate identity, even if names match. Text is
applied only after a successful save; failures keep the dialog open for retry.
No user dance is uploaded to the server.

The menu bar shows the current dance name and save status. **File → Manage
local dances…** lets you delete saves, with a confirmation dialog; deleting a
save leaves the open editor intact. Starting a new dance, opening another
one and importing JSON ask before discarding unsaved work. Closing/reloading
a tab also warns after edits, where supported by the browser. Work is not
automatically saved. Dialogs support keyboard focus, Escape and Cancel;
short notifications report completed saves and sharing errors.

Local saves belong to this site origin, browser profile and device. They are
not synced between devices or shared with other visitors. Clearing site data,
private browsing or browser storage eviction can remove them. Use **Export**
to keep portable backups. Other tabs' saves appear on window focus or with
**Refresh local dances**; simultaneous saves to the same record use the last
completed write.

## Import, export and sharing

- **Export** downloads a complete version-1 `Dance` JSON record: name, notes,
  tempo, optional music metadata, figure definitions and floor placement.
- **Import JSON** opens that record as an editable working copy. Save it
  locally if you want to keep it. Old bare `Sequence` exports also import,
  using 60 BPM because they did not include tempo.
- **Copy share link** copies a URL that preloads a complete snapshot. It works
  without the recipient having your local save or the same catalogue figures.
  Opening the link does not save it automatically or overwrite local records.
  The link's data is visible to anyone with the URL and, as a query string,
  can appear in hosting access logs. It contains no account or local-storage
  access token.

Links use `?dance=1.<gzip-compressed-UTF-8-JSON-as-base64url>`. The leading `1`
is the link encoding version; the nested `Dance.schemaVersion` independently
versions the saved data. Native Compression Streams avoid an extra dependency.
Links over 8,000 characters ask you to export JSON instead; actual URL limits
vary between browsers, hosts and messaging apps. Browsers without Compression
Streams can still import/export JSON.

Imports, local saves and links validate the data before renderer use. Files
and decompressed links are limited to 2 MB; a dance may have up to 500 figure
occurrences, 500 steps per occurrence, 20,000 steps and 10,000 beats in total.
These are resource limits, not dance rules. Unknown future Dance versions are
rejected explicitly. Cached resolved poses are recomputed from the saved
figure poses and floor transforms. Existing authored geometry is preserved.

## Development

Use Node 22, matching CI:

```sh
npm ci
npm run db:reset
npm run api:dev
```

In a second terminal run `npm run dev`, then open
[localhost:58734](http://localhost:58734). The API runs on port 58735; Vite
proxies `/api` to it. `db:reset` deletes and reseeds the database, so stop the
API before running it on an existing database. `DB_PATH` chooses another file.
An API started without a database creates an empty schema; seed it to provide
figures and preset dances. Personal IndexedDB saves are separate from SQLite.

CI runs the following checks on pull requests, pushes to `main` and manual
workflow runs, using Node 22. Run the same checks locally before submitting:

```sh
npm run lint
npm run format:check
npx tsc --noEmit -p config/tsconfig.dev.json
npm test
npm run build
npm run audit:ci
```

The TypeScript check covers the application, API and tests; the production
build also checks the frontend with its production configuration. CI reports
all checks after a successful dependency install, even when one fails. The
existing `test` status check succeeds only when every validation passes.

The API serves the built frontend from `dist/` in production. See `Dockerfile`,
`docker-compose.yml`, and [AGENTS.md](AGENTS.md) for repository guidance.

## Automated browser checks

Playwright tests in `e2e/` exercise the built application in desktop Chromium
(1280×720) and mobile Chromium with an iPhone-sized touch viewport. They cover
sequence ordering/removal and network failures, local saves and copies,
unsaved-change dialogs, JSON import/export, share links, playback/tempo/metronome,
and responsive library/dialog/3D controls.

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

On Linux, `npx playwright install --with-deps chromium` also installs the required
system libraries. `test:e2e` builds the frontend, starts a dedicated API on port
58745 and seeds a new temporary SQLite database. It never resets the development
database or reuses an existing server; leave port 58745 free. Each test receives
fresh browser storage. Only network failure/order tests intercept figure requests;
normal workflows use the real API and IndexedDB. The app's existing CDN assets
remain in use, so these checks require access to those hosts.

For a locally installed Chromium, optionally set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`. CI installs Playwright's
matching Chromium and runs the suite as part of the existing `test` check.
Browser tests are separate from `npm test`; the development TypeScript check
includes their source and configuration.

Failures retain screenshots, traces and browser logs under `test-results/`, with
an HTML report in `playwright-report/`. Run `npx playwright show-report` to view
the report. CI uploads failure reports for seven days. These generated files are
ignored by Git, lint and formatting. Visual dance technique and subjective
movement quality still require manual review.
