// Builds the hosted-preview copy: one file, memory routing, simulation only, written without the
// <html>, <head> and <body> wrapper, which the host adds. Output: dist-artifact/artifact.html
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
execFileSync(process.execPath, [vite, "build", "--mode", "artifact"], { cwd: root, stdio: "inherit" });

const html = readFileSync(path.join(root, "dist-artifact", "index.html"), "utf8");
const head = /<head>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
const body = /<body>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? "";
const cleanedHead = head
  .replace(/<meta charset="[^"]*"\s*\/?>/i, "")
  .replace(/<meta name="viewport"[^>]*>/i, "")
  .trim();
// The title goes first, so the host finds it in the first 8 KB.
const title = /<title>[\s\S]*?<\/title>/i.exec(cleanedHead)?.[0] ?? "<title>Disaster Relief Fund</title>";
const out = `${title}\n${cleanedHead.replace(title, "")}\n${body.trim()}\n`;
if (out.includes("�")) throw new Error("The build contains U+FFFD, which the publisher rejects");
writeFileSync(path.join(root, "dist-artifact", "artifact.html"), out);
console.log(`Wrote dist-artifact/artifact.html (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
