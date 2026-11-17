import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const config_dir = path.dirname(fileURLToPath(import.meta.url));
const repo_root = path.resolve(config_dir, "..");

export default defineConfig({
  root: repo_root,
  server: {
    host: true,
    port: 58734,
    proxy: {
      "/api": {
        target: "http://localhost:58735",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    outDir: path.resolve(repo_root, "dist"),
    // The 3D view's chunk (Three.js, about 600 kB) is loaded only when the
    // 3D view is first opened, so its size doesn't slow the page down.
    // Raised from the default 500 kB so the build doesn't warn about it.
    chunkSizeWarningLimit: 700,
  },
});
