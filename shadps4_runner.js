// Drives the shadPS4 WebAssembly build (shadps4.js / shadps4.wasm from shadps4_emscripten):
// copies a game folder the user picks into the emulator's in-memory filesystem, starts it, and
// wires its output (log, presented frames) and input (keyboard -> PS4 pad) to the page.
//
// Exposes window.shadps4 for the page and the Playwright tests.

/* global createShadPS4 */
(function () {
  "use strict";

  // Files larger than this aren't copied into the in-memory filesystem (it lives in browser
  // memory). Disc images of PS2 Classics are ~4GB; the emulator only needs them once a game
  // actually reads its disc.
  const MAX_COPY_BYTES = 1024 * 1024 * 1024;

  // PS4 pad button bits (OrbisPadButtonDataOffset in shadPS4's core/libraries/pad/pad.h).
  const PAD = {
    up: 0x10, right: 0x20, down: 0x40, left: 0x80,
    l2: 0x100, r2: 0x200, l1: 0x400, r1: 0x800,
    triangle: 0x1000, circle: 0x2000, cross: 0x4000, square: 0x8000,
    options: 0x8, touchpad: 0x100000, l3: 0x2, r3: 0x4,
  };
  const KEYMAP = {
    ArrowUp: PAD.up, ArrowDown: PAD.down, ArrowLeft: PAD.left, ArrowRight: PAD.right,
    KeyX: PAD.cross, KeyZ: PAD.circle, KeyS: PAD.square, KeyA: PAD.triangle,
    KeyQ: PAD.l1, KeyW: PAD.r1, Digit1: PAD.l2, Digit2: PAD.r2,
    Enter: PAD.options, Space: PAD.touchpad,
  };

  const state = {
    module: null,
    files: [],
    started: false,
    frames: 0,
    log: [],
    listeners: { log: [], frame: [], status: [] },
  };

  function emit(kind, value) {
    for (const fn of state.listeners[kind]) fn(value);
  }

  function stripAnsi(s) {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
  }

  function addLog(line, isError) {
    const text = stripAnsi(String(line));
    state.log.push(text);
    if (state.log.length > 20000) state.log.splice(0, 5000);
    emit("log", { text, isError: !!isError });
  }

  function status(text) {
    emit("status", text);
  }

  function environmentProblems() {
    const problems = [];
    if (!self.crossOriginIsolated) {
      problems.push("page is not cross-origin isolated (SharedArrayBuffer unavailable)");
    }
    if (typeof WebAssembly !== "object") {
      problems.push("WebAssembly unavailable");
    } else {
      try {
        // 64-bit memories (the build is wasm64) must be constructible.
        new WebAssembly.Memory({ initial: 1n, maximum: 1n, address: "i64" });
      } catch (e) {
        try {
          new WebAssembly.Memory({ initial: 1, maximum: 1, index: "i64" });
        } catch (e2) {
          problems.push("this browser has no WebAssembly memory64 support");
        }
      }
    }
    return problems;
  }

  async function loadModule(canvas) {
    if (state.module) return state.module;
    if (typeof createShadPS4 !== "function") {
      throw new Error("shadps4.js is missing - run scripts/sync_runtime.sh");
    }
    status("Loading shadps4.wasm…");
    const ctx = canvas.getContext("2d");
    const mod = await createShadPS4({
      print: (t) => addLog(t, false),
      printErr: (t) => addLog(t, true),
      shadps4OnFrame: (rgba, w, h, index) => {
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
        state.frames = index;
        emit("frame", { w, h, index });
      },
      shadps4OnTitle: (title) => {
        document.title = title;
        status(title);
      },
    });
    state.module = mod;
    status("Runtime ready");
    return mod;
  }

  // `files` is a FileList/array from <input webkitdirectory> or a drop; each has
  // webkitRelativePath "Folder/sub/file".
  function setGameFiles(files) {
    state.files = Array.from(files);
    const eboot = state.files.find((f) => /(^|\/)eboot\.bin$/i.test(f.webkitRelativePath || f.name));
    return {
      count: state.files.length,
      bytes: state.files.reduce((n, f) => n + f.size, 0),
      eboot: eboot ? (eboot.webkitRelativePath || eboot.name) : null,
    };
  }

  async function copyToFs(mod) {
    const FS = mod.FS;
    const eboot = state.files.find((f) => /(^|\/)eboot\.bin$/i.test(f.webkitRelativePath || f.name));
    if (!eboot) throw new Error("no eboot.bin in the chosen folder");
    const root = (eboot.webkitRelativePath || eboot.name).replace(/eboot\.bin$/i, "");
    let copied = 0;
    let skipped = 0;
    for (const f of state.files) {
      const rel = f.webkitRelativePath || f.name;
      if (!rel.startsWith(root)) continue;
      const path = "/game/" + rel.slice(root.length);
      FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
      if (f.size > MAX_COPY_BYTES) {
        addLog(`[page] not copying ${rel} (${(f.size / 2 ** 30).toFixed(1)} GiB) into memory`, true);
        skipped++;
        continue;
      }
      FS.writeFile(path, new Uint8Array(await f.arrayBuffer()));
      copied++;
      if (copied % 25 === 0) status(`Copying game files… ${copied}`);
    }
    addLog(`[page] copied ${copied} files into /game (${skipped} skipped)`);
    return "/game/eboot.bin";
  }

  async function start(canvas) {
    if (state.started) return;
    const problems = environmentProblems();
    if (problems.length) throw new Error(problems.join("; "));
    const mod = await loadModule(canvas);
    const eboot = await copyToFs(mod);
    state.started = true;
    status("Running");
    addLog(`[page] starting shadPS4 on ${eboot}`);
    mod.callMain([eboot]);
  }

  function key(e, down) {
    const bit = KEYMAP[e.code];
    if (bit === undefined || !state.module || !state.started) return;
    e.preventDefault();
    state.module._shadps4_pad_button(0, bit, down ? 1 : 0);
  }
  window.addEventListener("keydown", (e) => key(e, true));
  window.addEventListener("keyup", (e) => key(e, false));

  window.shadps4 = {
    environmentProblems,
    setGameFiles,
    start,
    on(kind, fn) { state.listeners[kind].push(fn); },
    get log() { return state.log; },
    get frames() { return state.frames; },
    get started() { return state.started; },
    KEYMAP,
  };
})();
