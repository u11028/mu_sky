import { defineConfig } from "vite";

export default defineConfig({
  // When this copy of the game was built, sent along with error reports.
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")) },
  server: {
    port: 5173,
    // The client imports ../shared, which sits outside this folder.
    fs: { allow: [".."] },
    // Account requests go to the game server, as they do when it serves the built game itself.
    proxy: { "/api": "http://localhost:2567" },
  },
});
