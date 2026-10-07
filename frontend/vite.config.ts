import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
