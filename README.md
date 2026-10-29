# shadps4_web

The web frontend for the in-progress WebAssembly build of
[shadPS4](https://github.com/shadps4-emu/shadps4). This repo is only the static site and its
built WebAssembly artifacts - the same split as [azahar_web](https://github.com/Shubin123/azahar_web).
The engine-side work (x86-64 interpreter, guest memory, patches against upstream shadPS4) lives in
**[shadps4_emscripten](https://github.com/Shubin123/shadps4_emscripten)**; see its
[PROJECT.md](https://github.com/Shubin123/shadps4_emscripten/blob/main/PROJECT.md) for status.

**Live:** <https://shubin123.github.io/shadps4_web/>

No game runs yet: the backend doesn't produce a `.wasm` module yet, so the page is a status
dashboard plus settings widgets for what a working build will have. When it does, its
`shadps4.js`/`shadps4.wasm` output goes in `web/` next to `index.html`.

```
web/
  index.html          the page (styled after azahar_web's widget-card layout)
  server.cjs          local dev server with the COOP/COEP headers pthreads need
scripts/
  deploy_pages.sh     publishes web/ to the gh-pages branch
```

## Run locally

```
npm run serve        # http://localhost:8766
```

## Deploy

GitHub Pages serves the `gh-pages` branch directly ("deploy from a branch" - no GitHub Actions
workflow). After changing anything in `web/`:

```
./scripts/deploy_pages.sh
```
