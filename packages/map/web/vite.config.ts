import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the dependency graph viewer. Output goes to `../web-dist` so the
 * map's HTTP server (DEFAULT_STATIC_DIR) can serve it directly. `root` is this
 * `web/` folder, which contains index.html and src/.
 */
export default defineConfig({
  root: here,
  base: "./",
  build: {
    outDir: path.resolve(here, "..", "web-dist"),
    emptyOutDir: true,
  },
});
