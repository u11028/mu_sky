import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    // The client imports ../shared, which sits outside this folder.
    fs: { allow: [".."] },
  },
});
