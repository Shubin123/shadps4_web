// Checks every way the page can draw frames (web/gpu_presenter.js): presents a test pattern with
// WebGPU, WebGL2 and the 2D canvas in headless Chromium and compares what lands on the canvas.
//
//   node tests/present.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = 8890 + Math.floor(Math.random() * 100);
const server = spawn(process.execPath, [path.join(here, "..", "web", "server.cjs")], {
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 500));

// Full Chromium (new headless), not the headless shell: the shell's canvases can't get WebGPU
// textures without SwiftShader ANGLE flags.
const browser = await chromium.launch({ headless: true, channel: "chromium", args: ["--enable-unsafe-webgpu"] });
let failures = 0;
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(`http://localhost:${port}/`);
  for (const kind of ["webgpu", "webgl2", "2d"]) {
    const r = await page.evaluate((k) => window.shadps4.selfTestPresenter(k), kind);
    const ok = r.ok && r.kind === kind;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${kind}: drew with ${r.kind}, ${r.mismatches} mismatched bytes` +
      (r.fallbackReasons.length ? ` (${r.fallbackReasons.join("; ")})` : ""));
  }
} finally {
  await browser.close();
  server.kill();
}
process.exit(failures ? 1 : 0);
