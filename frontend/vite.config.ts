import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The same mapping public/_redirects gives Netlify: the circuits' versioned
// address serves the files in /zk/spp/dist/circuits.
const versionedCircuits: Plugin = {
  name: "versioned-circuits",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url) req.url = req.url.replace(/^\/zk\/circuits\/[^/]+\//, "/zk/spp/dist/circuits/");
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url) req.url = req.url.replace(/^\/zk\/circuits\/[^/]+\//, "/zk/spp/dist/circuits/");
      next();
    });
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), versionedCircuits],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      canvg: fileURLToPath(new URL("./src/lib/empty.ts", import.meta.url)),
    },
  },
  define: {
    global: "globalThis",
  },
  server: {
    port: 5175,
    host: true,
    strictPort: true,
  },
});
