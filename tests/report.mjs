// For GitHub: turns the failing tests in a `node --test` run's output into annotations, which show
// on the commit and the checks page (the full log needs admin rights to read).
import { readFileSync } from "node:fs";

const lines = readFileSync(process.argv[2], "utf8").split("\n");
const start = lines.findIndex((line) => line.includes("failing tests:"));
if (start >= 0) {
  let name = "";
  for (const line of lines.slice(start + 1)) {
    const failed = /^\s*✖ (.+?) \(\d/.exec(line);
    if (failed) {
      name = failed[1];
    } else if (name && /Error|assert|expected|actual/i.test(line)) {
      console.log(`::error title=Test failed: ${name}::${line.trim().slice(0, 300)}`);
      name = "";
    }
  }
}
