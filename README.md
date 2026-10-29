# shadps4_web

The browser frontend for the WebAssembly build of [shadPS4](https://github.com/shadps4-emu/shadps4).
The engine side (x86-64 interpreter, guest memory, the patched shadPS4 build) is
**[shadps4_emscripten](https://github.com/Shubin123/shadps4_emscripten)** - its
[PROJECT.md](https://github.com/Shubin123/shadps4_emscripten/blob/main/PROJECT.md) has the full
status. This repo is the page plus the built `shadps4.js`/`shadps4.wasm`.

**Live:** <https://shubin123.github.io/shadps4_web/>

What works: pick an extracted PS4 game folder (the one with `eboot.bin`), press Start, and
upstream shadPS4 boots it in the page - modules load, the game's code runs in the interpreter,
its log streams into the page, and VideoOut frames are drawn to the canvas. What doesn't yet:
anything the game draws with the PS4 GPU (no WebGPU backend), so expect a black screen; it is
also slow. Needs a browser with wasm64 and cross-origin isolation (Chrome/Edge 133+). Files are
read locally, never uploaded; files over 1GB are skipped (they're held in memory).

```
web/
  index.html            the page
  shadps4_runner.js     loads the module, copies the game folder in, frames/log/input
  shadps4.js/.wasm      the build, copied from shadps4_emscripten (scripts/sync_runtime.sh)
  coi-serviceworker.js  cross-origin isolation on GitHub Pages (v0.1.7, MIT)
  server.cjs            local dev server with the COOP/COEP headers pthreads need
scripts/
  sync_runtime.sh       copy build/wasm/shadps4.{js,wasm} from ../shadps4_emscripten
  deploy_pages.sh       publish web/ to the gh-pages branch
tests/
  e2e.mjs               drive the page in headless Chromium with Playwright
```

## Run locally

```
npm install
npm run serve                              # http://localhost:8766
node tests/e2e.mjs <game folder> "<log text to wait for>" [seconds]
```

The e2e test serves `web/`, picks the folder through the page's input, presses Start and waits
for the given text in the emulator log, saving `e2e.log` and `e2e.png`. For example, with Bully
(CUSA03507) it passes on `"IOP Flat Memory"` - see PROJECT.md in the backend for how far that
game gets and why.

## Deploy

GitHub Pages serves the `gh-pages` branch directly (no Actions workflow):

```
./scripts/deploy_pages.sh
```
