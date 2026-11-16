import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // The chat's Pages Functions (functions/api/), served by
      // `npx wrangler pages dev` (port 8788) when you run it.
      "/api/chat": process.env.CHAT_URL || "http://localhost:8788",
      "/api/docs-search": process.env.CHAT_URL || "http://localhost:8788",
      // API_URL overrides it, e.g. when another API already holds port 8000.
      "/api": process.env.API_URL || "http://localhost:8000",
    },
  },
  build: {
    outDir: "dist",
    // The main app; assumptions.html, the list behind the Assumptions
    // button; and compare.html, a redirect for old Plan links (Plan now
    // opens inside the main app).
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        assumptions: resolve(__dirname, "assumptions.html"),
        compare: resolve(__dirname, "compare.html"),
      },
    },
  },
});
