// Serves the built app (dist/) at http://127.0.0.1 and opens it in the default browser.
// Uses only Node's own modules, so it works right after downloading the folder: no npm install.
//
//   npm start                     or   node scripts/serve.mjs
//   npm start -- --port 8080      a fixed port (the next free one is used if it is taken)
//   npm start -- --no-open        do not open a browser
//
// Serving over http (not opening the file directly) lets MetaMask connect for the Sepolia mode.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const HOST = "127.0.0.1"; // printed and opened as 127.0.0.1 too: "localhost" can resolve to another app on ::1

function parsePort(args) {
  const eq = args.find((a) => a.startsWith("--port="));
  const i = args.indexOf("--port");
  const raw = eq ? eq.slice("--port=".length) : i >= 0 ? args[i + 1] : undefined;
  if (raw === undefined) return 4173;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`--port needs a whole number from 1 to 65535, not "${raw}".`);
    process.exit(1);
  }
  return port;
}

const args = process.argv.slice(2);
const wantedPort = parsePort(args);
const open = !args.includes("--no-open");

if (!existsSync(path.join(dist, "index.html"))) {
  console.error("dist/index.html is missing. Build it first with:  npm install  then  npm run build");
  console.error("Or open Disaster-Relief-Fund.html directly: it needs no server.");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)));
    if (file !== dist && !file.startsWith(dist + path.sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!existsSync(file)) file = path.join(dist, "index.html"); // the app routes with #, so this is rare
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(readFileSync(file));
  } catch {
    // a malformed address (for example a stray %) must not stop the server
    if (!res.headersSent) res.writeHead(400);
    res.end("Bad request");
  }
});

let attemptsLeft = 20;
server.on("error", (e) => {
  if (e.code === "EADDRINUSE" && attemptsLeft > 0) {
    attemptsLeft -= 1;
    const next = server.lastTriedPort + 1;
    server.lastTriedPort = next;
    server.listen(next, HOST);
    return;
  }
  console.error(`Could not start the server: ${e.message}`);
  process.exit(1);
});
server.once("listening", () => {
  const { port } = server.address();
  const address = `http://${HOST}:${port}/`;
  if (port !== wantedPort) console.log(`Port ${wantedPort} is in use, so port ${port} is used instead.`);
  console.log(`Disaster Relief Fund is running at ${address}`);
  console.log("Press Ctrl+C to stop.");
  if (open) openBrowser(address);
});
server.lastTriedPort = wantedPort;
server.listen(wantedPort, HOST);

function openBrowser(address) {
  const [cmd, cmdArgs] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", address]] : process.platform === "darwin" ? ["open", [address]] : ["xdg-open", [address]];
  try {
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => undefined).unref();
  } catch {
    // no browser launcher (a server without a desktop): the address is printed above
  }
}
