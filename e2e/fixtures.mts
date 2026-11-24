import {
  test as base,
  expect,
  type Page,
  type Locator,
} from "@playwright/test";

// Playwright gives every test a fresh context, including IndexedDB/clipboard
// permissions. Surface React/runtime failures even if the final assertion passes.
export const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      const consoleMessages: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) =>
        consoleMessages.push(`${message.type()}: ${message.text()}`),
      );
      await use(errors);
      if (testInfo.status !== testInfo.expectedStatus || errors.length) {
        await testInfo.attach("browser-log", {
          body: consoleMessages.concat(errors).join("\n"),
          contentType: "text/plain",
        });
      }
      expect(errors, "browser runtime errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function openEditor(page: Page) {
  const loaded = new Set<string>();
  page.on("requestfinished", (request) => {
    if (/\/api\/figures\/\d+$/.test(request.url())) loaded.add(request.url());
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  // CDN Bootstrap owns menus and dialogs. Wait for its bundle, not a fixed delay.
  await page.waitForFunction(() => Boolean(window.bootstrap?.Modal));
  const { message: figures } = await (
    await page.request.get("/api/figures")
  ).json();
  await expect.poll(() => loaded.size).toBe(figures.length);
}

export async function menu(page: Page, name: string, item: string | RegExp) {
  await page
    .locator(".app-toolbar")
    .getByRole("button", { name, exact: true })
    .click();
  await page
    .locator(".dropdown-menu.show")
    .getByRole("button", { name: item, exact: true })
    .click();
}

export async function library(page: Page, search: string) {
  const toggle = page.getByRole("button", { name: "Show figure library" });
  if (await toggle.isVisible()) await toggle.click();
  const panel = page.locator(".figure-library");
  const hide = panel.getByRole("switch", {
    name: "Hide figures that don’t follow on",
  });
  if (await hide.isVisible()) await hide.uncheck();
  await panel.getByPlaceholder("Search figures or dances…").fill(search);
  return panel;
}

/** Join warnings contribute to the accessible name; match the named figure
 * with its optional warning without depending on style classes or catalogue ids. */
export function figureButton(panel: Locator, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return panel.getByRole("button", {
    name: new RegExp(`^${escaped}(?: Doesn’t follow on cleanly)?$`),
  });
}

export async function addFigure(page: Page, name = "Walking Step and Collect") {
  const count = await page.locator(".seq-item").count();
  const panel = await library(page, name);
  await figureButton(panel, name).click();
  await expect(page.locator(".seq-item")).toHaveCount(count + 1);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
}

export async function save(page: Page, name: string) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Dance name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".dance-document")).toContainText(name);
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
