#!/bin/sh
# Starts the Disaster Relief Fund app at http://localhost:4173 and opens it in your browser.
# Needs Node.js (https://nodejs.org). Without Node.js, open Disaster-Relief-Fund.html instead.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org, or open Disaster-Relief-Fund.html instead."
  xdg-open "Disaster-Relief-Fund.html" >/dev/null 2>&1 || true
  exit 1
fi
node scripts/serve.mjs
