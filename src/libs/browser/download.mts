/**
 * Triggers a browser download of `data` as a pretty-printed JSON file
 * named `filename` -- a Blob plus a synthetic anchor click, the
 * standard client-side download pattern. No backend involved.
 */
export function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Deferred rather than immediate -- revoking synchronously can race
  // the browser actually reading the blob URL to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
