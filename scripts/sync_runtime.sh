#!/usr/bin/env bash
# Copies the browser build (shadps4.js + shadps4.wasm) from a shadps4_emscripten checkout into
# web/. Build it there first: scripts/build_wasm.sh --target shadps4
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
backend=${SHADPS4_EMSCRIPTEN:-$root/../shadps4_emscripten}
for f in shadps4.js shadps4.wasm; do
  cp "$backend/build/wasm/$f" "$root/web/$f"
done
ls -la "$root/web/shadps4.js" "$root/web/shadps4.wasm"
