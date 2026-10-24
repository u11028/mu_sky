import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    // The client imports ../shared, which sits outside this folder.
    fs: { allow: [".."] },
    // Account requests go to the game server, as they do when it serves the built game itself.
    proxy: { "/api": "http://localhost:2567" },
  },
});
