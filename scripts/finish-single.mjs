// Copies the one-file build to the project folder as Disaster-Relief-Fund.html and checks that it
// really stands alone: no script, style or font is loaded from anywhere else.
import { copyFileSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = path.join(root, "dist-single", "index.html");
const target = path.join(root, "Disaster-Relief-Fund.html");

const html = readFileSync(built, "utf8");
// Anything the page would load from elsewhere: src= or href= on any tag (either quote), CSS url()
// and @import. Links the user clicks (<a href>) and in-page references (#id) are fine.
const loads = [...html.matchAll(/<(?!a\b)[a-z]+[^>]*?\s(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
const cssUrls = [...html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
const imports = [...html.matchAll(/@import\s+(?:url\()?["']?([^"');\s]+)/g)].map((m) => m[1]);
const outside = [...loads, ...cssUrls, ...imports].filter((u) => !u.startsWith("data:") && !u.startsWith("#"));
if (outside.length) {
  console.error(`The one-file build still loads other files: ${[...new Set(outside)].slice(0, 8).join(", ")}`);
  process.exit(1);
}
copyFileSync(built, target);
console.log(`Wrote Disaster-Relief-Fund.html (${(statSync(target).size / 1024 / 1024).toFixed(2)} MB), self-contained.`);
