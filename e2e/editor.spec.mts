import { readFile } from "node:fs/promises";
import {
  test,
  expect,
  openEditor,
  library,
  addFigure,
  menu,
  save,
  deferred,
  figureButton,
} from "./fixtures.mts";
import type { Figure, FigureSummary } from "../src/libs/dance/step.mts";

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test("rapid selections preserve click order, duplicates and pending loading", async ({
  page,
  request,
}) => {
  const { message: summaries } = (await (
    await request.get("/api/figures")
  ).json()) as { message: FigureSummary[] };
  const names = ["Walking Step and Collect", "Side Step and Collect"];
  const figures = await Promise.all(
    names.map(async (name) => {
      const id = summaries.find((item) => item.name === name)!.id;
      return (
        (await (await request.get(`/api/figures/${id}`)).json()) as {
          message: Figure;
        }
      ).message;
    }),
  );
  const gates = [deferred(), deferred(), deferred()];
  const requests: string[] = [];
  // The catalogue prefetches details. Finish those real requests before
  // intercepting only subsequent user additions.
  await library(page, "Collect");
  await expect(page.locator(".figure-library .style-toggle")).not.toHaveCount(
    0,
  );
  // A first completed add also makes the sequence's fit indicators available.
  await addFigure(page, names[0]);
  const panel = await library(page, "Collect");
  await page.route(/\/api\/figures\/\d+$/, async (route) => {
    const index = requests.length;
    requests.push(route.request().url().split("/").at(-1)!);
    await gates[index].promise;
    const selected = figures.find((figure) =>
      route.request().url().endsWith(`/${figure.id}`),
    )!;
    await route.fulfill({ json: { success: true, message: selected } });
  });
  for (const name of [names[0], names[1], names[0]]) {
    await figureButton(panel, name).click();
  }
  await expect.poll(() => requests).toEqual([figures[0].id]);
  // Make B ready before A. A concurrent implementation would append B first.
  gates[1].resolve();
  gates[0].resolve();
  await expect(page.locator(".seq-item")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".sequence-strip")).toContainText("Adding…");
  gates[2].resolve();
  await expect(page.locator(".seq-item")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".seq-chip")).toHaveText([
    names[0],
    names[0],
    names[1],
    names[0],
  ]);
  await expect
    .poll(() => requests)
    .toEqual([figures[0].id, figures[1].id, figures[0].id]);
  await page.unroute(/\/api\/figures\/\d+$/);
});

test("failed additions recover and removals during a fetch are respected", async ({
  page,
}) => {
  await addFigure(page);
  const panel = await library(page, "Side Step and Collect");
  await page.route(/\/api\/figures\/\d+$/, (route) =>
    route.fulfill({
      status: 503,
      json: { success: false, error: "Figure temporarily unavailable" },
    }),
  );
  await figureButton(panel, "Side Step and Collect").click();
  await expect(page.locator(".sequence-panel")).toContainText(
    "Figure temporarily unavailable",
  );
  await expect(page.locator(".seq-item")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  await page.unroute(/\/api\/figures\/\d+$/);
  const gate = deferred();
  const started = deferred();
  await page.route(/\/api\/figures\/\d+$/, async (route) => {
    started.resolve();
    await gate.promise;
    await route.continue();
  });
  await figureButton(panel, "Side Step and Collect").click();
  await started.promise;
  // Use the full-sequence dialog: it exposes removal on desktop and touch.
  await page.getByRole("button", { name: "View full sequence" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: "Remove Walking Step and Collect from the sequence",
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.locator(".seq-item")).toHaveCount(0);
  gate.resolve();
  await expect(page.locator(".seq-chip")).toHaveText(["Side Step and Collect"]);
  await expect(page.locator(".sequence-panel")).not.toContainText(
    "Figure temporarily unavailable",
  );
});

test("local saves survive reload, reopen independently and support save a copy", async ({
  page,
}) => {
  await addFigure(page);
  await save(page, "Original practice");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".seq-item")).toHaveCount(0);
  await menu(page, "Open", /^Original practice/);
  await expect(page.locator(".seq-item")).toHaveCount(1);
  await menu(page, "File", "Save a copy…");
  await page
    .getByRole("dialog")
    .getByLabel("Dance name", { exact: true })
    .fill("Practice copy");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save a copy", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await addFigure(page, "Side Step and Collect");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await menu(page, "Open", /^Original practice/);
  await expect(page.locator(".seq-item")).toHaveCount(1);
  await menu(page, "Open", /^Practice copy/);
  await expect(page.locator(".seq-item")).toHaveCount(2);
  await menu(page, "File", "Manage local dances…");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete Practice copy", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete local save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toContainText("Practice copy");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await expect(page.locator(".seq-item")).toHaveCount(2);
});

test("unsaved changes can cancel or confirm replacing the editor", async ({
  page,
}) => {
  await addFigure(page);
  await menu(page, "File", "New dance");
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Discard unsaved changes?");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".seq-item")).toHaveCount(1);
  await menu(page, "File", "New dance");
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page.locator(".seq-item")).toHaveCount(0);
  await expect(page.getByTitle("Play", { exact: true })).toBeDisabled();
});

test("JSON download round-trips and invalid imports preserve the editor", async ({
  page,
}) => {
  await addFigure(page);
  await save(page, "Portable practice");
  const downloaded = page.waitForEvent("download");
  await menu(page, "Share", "Export JSON");
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("portable-practice.json");
  const bytes = await readFile((await download.path())!);
  const snapshot = JSON.parse(bytes.toString());
  expect(snapshot.name).toBe("Portable practice");
  expect(snapshot.sequence.entries).toHaveLength(1);
  await menu(page, "File", "New dance");
  await page.getByLabel("Import dance JSON").setInputFiles({
    name: "practice.json",
    mimeType: "application/json",
    buffer: bytes,
  });
  await expect(page.locator(".dance-document")).toContainText(
    "Portable practice",
  );
  await expect(page.locator(".seq-item")).toHaveCount(1);
  await page.getByLabel("Import dance JSON").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":999}'),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".dance-document")).toContainText(
    "Portable practice",
  );
  await expect(page.locator(".seq-item")).toHaveCount(1);
});

test("share links preload a working copy and malformed links recover", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await addFigure(page);
  await menu(page, "Share", "Copy share link");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("?dance=1.");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const recipient = await context.newPage();
  await recipient.goto(link, { waitUntil: "domcontentloaded" });
  await expect(recipient.locator(".seq-chip")).toHaveText([
    "Walking Step and Collect",
  ]);
  await expect(recipient.locator(".dance-document")).toContainText(
    "Working copy",
  );
  await recipient
    .locator(".app-toolbar")
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await expect(recipient.locator(".dropdown-menu.show")).toContainText(
    "No local saves yet",
  );
  await recipient.goto("/?dance=1.invalid", { waitUntil: "domcontentloaded" });
  await expect(recipient.getByRole("alert")).toContainText(
    "You can open a preset",
  );
  await expect(recipient.locator(".seq-item")).toHaveCount(0);
  await recipient.close();
});

test("playback, seek, tempo and metronome controls remain usable", async ({
  page,
}) => {
  await addFigure(page);
  await page.getByTitle("Play", { exact: true }).click();
  await expect(page.getByTitle("Pause", { exact: true })).toBeVisible();
  await expect(page.locator(".timeline-time")).not.toContainText("0.0 /");
  await page.getByTitle("Pause", { exact: true }).click();
  const scrubber = page.locator(".form-range");
  await scrubber.fill("0.5");
  await expect(page.locator(".timeline-time")).toContainText("0.5 /");
  const bpm = page.getByLabel("Tempo in beats per minute");
  await bpm.fill("80");
  await bpm.press("Enter");
  await page.getByTitle("1 BPM faster").click();
  await expect(bpm).toHaveValue("81");
  await page.getByRole("switch", { name: "Metronome", exact: true }).check();
  await page.getByLabel("Metronome clicks").selectOption("half beat");
  await expect(page.getByLabel("Metronome clicks")).toHaveValue("half beat");
  await expect(
    page.getByRole("switch", { name: "Metronome", exact: true }),
  ).toBeChecked();
  await page.getByRole("switch", { name: "Metronome", exact: true }).uncheck();
});

test("responsive library, long sequences, dialogs and 3D controls fit the screen", async ({
  page,
  isMobile,
}) => {
  const toggle = page.getByRole("button", { name: "Show figure library" });
  if (isMobile) {
    await expect(toggle).toBeVisible();
    await toggle.click();
  }
  const groups = page.locator(".style-toggle");
  await expect(groups.first()).toBeVisible();
  await expect(page.locator('.style-toggle[aria-expanded="true"]')).toHaveCount(
    0,
  );
  for (let index = 0; index < 8; index++) await addFigure(page);
  await expect
    .poll(() =>
      page
        .locator(".sequence-strip")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    )
    .toBe(true);
  if (isMobile)
    await page.getByRole("button", { name: "Hide figure library" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  const tempo = await page.locator(".tempo-controls").boundingBox();
  if (!isMobile) expect(tempo!.y + tempo!.height).toBeLessThanOrEqual(720);
  await page.getByRole("button", { name: "View full sequence" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("li")).toHaveCount(8);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByTitle("Edit dance name and notes").click();
  await page
    .getByRole("dialog")
    .getByLabel("Dance name", { exact: true })
    .fill("Responsive practice");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Apply changes" })
    .click();
  await expect(page.locator(".dance-document")).toContainText(
    "Responsive practice",
  );
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Camera", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Camera", exact: true })
    .getByRole("button", { name: "Above", exact: true })
    .click();
  await expect(page.locator("#view3d canvas")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

test("server presets open as working copies and do not change after editing", async ({
  page,
  request,
}) => {
  const { message: presets } = (await (
    await request.get("/api/dances")
  ).json()) as { message: { id: string; name: string }[] };
  expect(presets.length).toBeGreaterThan(0);
  const preset = presets[0];
  const before = await (await request.get(`/api/dances/${preset.id}`)).json();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") &&
      !["GET", "HEAD"].includes(request.method())
    )
      writes.push(request.method());
  });
  await menu(page, "Open", preset.name);
  await expect(page.locator(".dance-document")).toContainText("Working copy");
  await expect(page.locator(".seq-item")).toHaveCount(
    before.message.sequence.entries.length,
  );
  await page.getByTitle("Edit dance name and notes").click();
  await page
    .getByRole("dialog")
    .getByLabel("Dance name", { exact: true })
    .fill("My preset copy");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Apply changes" })
    .click();
  await save(page, "My preset copy");
  expect(await (await request.get(`/api/dances/${preset.id}`)).json()).toEqual(
    before,
  );
  expect(writes).toEqual([]);
});
