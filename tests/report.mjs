// For GitHub: turns the failing tests in a `node --test` run's output into annotations, which show
// on the commit and the checks page (the full log needs admin rights to read). Each failure gets
// its name and the first lines of what went wrong, whatever kind of failure it was.
import { readFileSync } from "node:fs";

const lines = readFileSync(process.argv[2], "utf8").split("\n");
const start = lines.findIndex((line) => line.includes("failing tests:"));
let reported = 0;
for (let i = Math.max(0, start); start >= 0 && i < lines.length; i++) {
  const failed = /^\s*✖ (.+?) \(\d/.exec(lines[i]);
  if (!failed) {
    continue;
  }
  const details = lines
    .slice(i + 1, i + 8)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("at ") && !/^✖/.test(line))
    .slice(0, 3)
    .join(" / ");
  console.log(`::error title=Test failed: ${failed[1].slice(0, 120)}::${details.slice(0, 400) || "(no message)"}`);
  reported++;
}
if (reported === 0) {
  // No list of failures: the run itself broke. Its last lines say how.
  console.log(`::error title=Test run failed::${lines.filter(Boolean).slice(-6).join(" / ").slice(0, 600)}`);
}
