// End-to-end check of the browser build: serves web/, opens it in Chromium (Playwright), picks a
// game folder through the page's folder input, starts it, and waits for an expected line in the
// emulator's log. Writes the full log and a screenshot next to the given output path.
//
//   node tests/e2e.mjs <game folder> [expected log text] [timeout seconds] [out prefix]
// QUERY (e.g. "renderer=webgl2" or "gpu=off") is appended to the page URL.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const [gameDir, expected = "Module started", timeoutSec = "180", outPrefix = path.join(here, "..", "e2e")] =
  process.argv.slice(2);
if (!gameDir) {
  console.error("usage: node tests/e2e.mjs <game folder> [expected log text] [timeout s] [out prefix]");
  process.exit(2);
}

const port = 8790 + Math.floor(Math.random() * 100);
const server = spawn(process.execPath, [path.join(here, "..", "web", "server.cjs")], {
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 500));

// Full Chromium with WebGPU on (the headless shell's canvases can't present WebGPU textures).
const browser = await chromium.launch({ headless: true, channel: "chromium", args: ["--enable-unsafe-webgpu"] });
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const consoleLines = [];
  page.on("console", (m) => consoleLines.push(`[console.${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${e.message}`));
  await page.goto(`http://localhost:${port}/${process.env.QUERY ? "?" + process.env.QUERY : ""}`);
  const env = await page.evaluate(() => ({
    isolated: self.crossOriginIsolated,
    problems: window.shadps4.environmentProblems(),
    ua: navigator.userAgent,
  }));
  console.log("browser:", env.ua);
  console.log("isolated:", env.isolated, "problems:", env.problems);

  await page.setInputFiles("#folder-input", path.resolve(gameDir));
  console.log("picked:", await page.textContent("#folder-label"));
  await page.click("#btn-start");

  const deadline = Date.now() + Number(timeoutSec) * 1000;
  let log = [];
  while (Date.now() < deadline) {
    log = await page.evaluate(() => window.shadps4.log.slice());
    if (log.some((l) => l.includes(expected))) {
      ok = true;
      break;
    }
    if (log.some((l) => /RuntimeError|Assertion Failed|guest fault/.test(l))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Let a little more output arrive, then record everything.
  await new Promise((r) => setTimeout(r, 3000));
  log = await page.evaluate(() => window.shadps4.log.slice());
  writeFileSync(`${outPrefix}.log`, [...log, "", ...consoleLines].join("\n"));
  await page.screenshot({ path: `${outPrefix}.png`, fullPage: true });
  const gfx = await page.evaluate(() => ({ presenter: window.shadps4.presenter, webgpu: window.shadps4.webgpu }));
  console.log(`log lines: ${log.length}, frames: ${await page.evaluate(() => window.shadps4.frames)}, ` +
    `presenter: ${gfx.presenter}, WebGPU device: ${gfx.webgpu}`);
  console.log(ok ? `PASS: saw "${expected}"` : `FAIL: did not see "${expected}" within ${timeoutSec}s`);
} finally {
  await browser.close();
  server.kill();
}
process.exit(ok ? 0 : 1);
