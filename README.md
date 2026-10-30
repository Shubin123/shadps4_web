# shadps4_web

The browser frontend for the WebAssembly build of [shadPS4](https://github.com/shadps4-emu/shadps4).
The engine side (x86-64 interpreter, guest memory, the patched shadPS4 build) is
**[shadps4_emscripten](https://github.com/Shubin123/shadps4_emscripten)** - its
[PROJECT.md](https://github.com/Shubin123/shadps4_emscripten/blob/main/PROJECT.md) has the full
status. This repo is the page plus the built `shadps4.js`/`shadps4.wasm`.

**Live:** <https://shubin123.github.io/shadps4_web/>

What works: pick an extracted PS4 game folder (the one with `eboot.bin`), press Start, and
upstream shadPS4 boots it in the page - modules load, the game's code runs in the interpreter,
its log streams into the page, and VideoOut frames are drawn to the canvas (WebGPU, falling back
to WebGL2, then a 2D canvas). With WebGPU, the emulator also gets the device and renders what
the game draws with the PS4 GPU on it: shaders recompiled to WGSL, draws, compute dispatches,
render targets and textures, with display buffers read back at each flip. Missing: geometry and
tessellation stages, MSAA. It is also very slow (the game's CPU code is interpreted). Needs a
browser with wasm64 and cross-origin isolation (Chrome/Edge 133+). Files are
read locally, never uploaded; files over 1GB are skipped (they're held in memory).

```
web/
  index.html            the page
  shadps4_runner.js     loads the module, copies the game folder in, frames/log/input
  gpu_presenter.js      draws frames: WebGPU, else WebGL2, else 2D canvas
  shadps4.js/.wasm      the build, copied from shadps4_emscripten (scripts/sync_runtime.sh)
  coi-serviceworker.js  cross-origin isolation on GitHub Pages (v0.1.7, MIT)
  server.cjs            local dev server with the COOP/COEP headers pthreads need
scripts/
  sync_runtime.sh       copy build/wasm/shadps4.{js,wasm} from ../shadps4_emscripten
  deploy_pages.sh       publish web/ to the gh-pages branch
tests/
  e2e.mjs               drive the page in headless Chromium with Playwright
  present.mjs           each presenter draws a test pattern; checks what lands on the canvas
```

URL parameters: `?renderer=webgpu|webgl2|2d` forces a presenter. `?gpu=off` keeps WebGPU from
the emulator, so compute dispatches are dropped. `?env=NAME=value,...` sets environment variables
for the emulator, such as the options of the Paleblood replacements the backend compiles in for
Bloodborne (`BB_TARGET_FPS=60`, `BB_LIMITER_WAIT=sleep`).

## Run locally

```
npm install
npm run serve                              # http://localhost:8766
node tests/e2e.mjs <game folder> "<log text to wait for>" [seconds]
node tests/present.mjs
```

The e2e test serves `web/`, picks the folder through the page's input, presses Start and waits
for the given text in the emulator log, saving `e2e.log` and `e2e.png` (`QUERY="gpu=off&renderer=webgl2"`
runs it on the fallback path). Both tests use Playwright's full Chromium (`npx playwright install
chromium`) with WebGPU enabled. For example, with Bully
(CUSA03507) it passes on `"IOP Flat Memory"` - see PROJECT.md in the backend for how far that
game gets and why.

`npm install` also brings in `webgpu` (Dawn's WebGPU for Node). Nothing here uses it; the
backend's Node runs and GPU tests (`scripts/run_node.sh`, `gpu_tests_node.js`) pick it up from
this checkout to render without a browser.

## Deploy

GitHub Pages serves the `gh-pages` branch directly (no Actions workflow):

```
./scripts/deploy_pages.sh
```
