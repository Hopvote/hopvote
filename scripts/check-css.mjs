// Fails the build when a stylesheet has unbalanced braces: once bundled, one open block swallows every rule after it.
import { readFileSync, readdirSync } from "node:fs";

let failed = false;
for (const file of readdirSync("src").filter((f) => f.endsWith(".css"))) {
  const text = readFileSync(`src/${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  text.split("\n").forEach((line, i) => {
    depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
    if (depth < 0) {
      console.error(`src/${file}:${i + 1} closes a block that was never opened`);
      failed = true;
      depth = 0;
    }
  });
  if (depth > 0) {
    console.error(`src/${file}: ${depth} block(s) left open`);
    failed = true;
  }
}
if (failed) process.exit(1);
