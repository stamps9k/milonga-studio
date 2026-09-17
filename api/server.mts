import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dance_routes } from "./dances.mts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "../dist");
const indexHtmlPath = join(distDir, "index.html");

const app = express();
app.use(express.json());
app.use(dance_routes);

// Serve the built frontend. In production this is the whole app; in dev
// it's simply absent (Vite's own dev server handles the app and proxies
// /api requests here instead), so requests fall through to the 404/500
// handling below rather than finding anything to serve.
app.use(express.static(distDir));

// SPA fallback: any route that isn't an API route or a static asset is a
// client-side route (react-router-dom), so hand back index.html and let
// the frontend router take over -- needed for direct links and refreshes
// on routes other than "/".
app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    res.status(404).json({ success: false, error: `Not found: ${req.path}` });
    return;
  }
  res.sendFile(indexHtmlPath, (err) => {
    if (err) {
      res
        .status(500)
        .send(
          "Frontend build not found. Run `npm run build`, or use `npm run dev` for the Vite dev server.",
        );
    }
  });
});

const port = Number(process.env.API_PORT ?? 58735);
app.listen(port, () => {
  console.info(`Server listening on http://localhost:${port}`);
});
