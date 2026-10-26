// After `vite build`: a gzipped copy beside every 3D model in dist, made once here so the server
// can hand it straight to browsers instead of compressing on each request (see server/src/index.ts).
// The host compresses the page's code itself, but not models.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
let before = 0;
let after = 0;

function walk(folder) {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else if (name.endsWith(".glb")) {
      const data = readFileSync(path);
      const packed = gzipSync(data, { level: 9 });
      writeFileSync(`${path}.gz`, packed);
      before += data.length;
      after += packed.length;
    }
  }
}

walk(dist);
console.log(`Models gzipped: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
