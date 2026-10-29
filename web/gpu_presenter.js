// Puts emulator frames (RGBA8, top row first) on a canvas with the best API the browser has:
// WebGPU - sharing the emulator's device when it made one (shadps4.wasm's webgpu.js), so frames
// the GPU renders can later be shown without a trip through the CPU - else WebGL2, else a plain
// 2D canvas. Each draws the frame as a texture on a fullscreen triangle, nearest-sampled at the
// frame's own size; CSS scales the canvas.
//
//   const presenter = await ShadPS4Presenter.create(canvas, { device, prefer: "auto" });
//   presenter.present(rgba, width, height);
//
// prefer: "auto" | "webgpu" | "webgl2" | "2d" (the first one that works, from that one down).

/* exported ShadPS4Presenter */
const ShadPS4Presenter = (function () {
  "use strict";

  const ORDER = ["webgpu", "webgl2", "2d"];

  const WGSL = `
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VOut;
  o.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2<f32>(p.x, 1.0 - p.y);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4<f32> {
  return vec4<f32>(textureSample(frame, samp, v.uv).rgb, 1.0);
}`;

  const GLSL_VS = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  uv = vec2(p.x, 1.0 - p.y);
}`;
  const GLSL_FS = `#version 300 es
precision mediump float;
uniform sampler2D frame;
in vec2 uv;
out vec4 color;
void main() { color = vec4(texture(frame, uv).rgb, 1.0); }`;

  async function requestDevice() {
    if (typeof navigator === "undefined" || !navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? adapter.requestDevice() : null;
  }

  function webgpu(canvas, device) {
    const ctx = canvas.getContext("webgpu");
    if (!ctx) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "opaque" });
    const module = device.createShaderModule({ code: WGSL });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    const sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
    let texture = null;
    let bindGroup = null;
    return {
      kind: "webgpu",
      present(rgba, w, h) {
        if (!texture || texture.width !== w || texture.height !== h) {
          if (texture) texture.destroy();
          texture = device.createTexture({
            size: [w, h], format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
          bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: texture.createView() }, { binding: 1, resource: sampler }],
          });
        }
        device.queue.writeTexture({ texture }, rgba, { bytesPerRow: w * 4 }, [w, h]);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: ctx.getCurrentTexture().createView(),
            loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1],
          }],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
      },
    };
  }

  function webgl2(canvas) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false });
    if (!gl) return null;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, GLSL_VS));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, GLSL_FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    let size = [0, 0];
    return {
      kind: "webgl2",
      present(rgba, w, h) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        if (size[0] !== w || size[1] !== h) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          size = [w, h];
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        }
        gl.viewport(0, 0, w, h);
        gl.useProgram(program);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
  }

  function canvas2d(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return {
      kind: "2d",
      present(rgba, w, h) {
        ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
      },
    };
  }

  async function create(canvas, { device = null, prefer = "auto" } = {}) {
    const start = prefer === "auto" ? 0 : Math.max(0, ORDER.indexOf(prefer));
    const errors = [];
    for (const kind of ORDER.slice(start)) {
      try {
        let p = null;
        if (kind === "webgpu") {
          const dev = device || (await requestDevice());
          p = dev ? webgpu(canvas, dev) : null;
        } else if (kind === "webgl2") {
          p = webgl2(canvas);
        } else {
          p = canvas2d(canvas);
        }
        if (p) {
          const present = p.present;
          p.present = (rgba, w, h) => {
            if (canvas.width !== w || canvas.height !== h) {
              canvas.width = w;
              canvas.height = h;
            }
            present(rgba, w, h);
          };
          p.canvas = canvas;
          p.fallbackReasons = errors;
          return p;
        }
        errors.push(`${kind}: unavailable`);
      } catch (e) {
        errors.push(`${kind}: ${e.message || e}`);
      }
      // A canvas keeps the first context type it was asked for; later attempts need a fresh one.
      if (canvas.getContext && kind !== "2d") {
        const fresh = canvas.cloneNode(false);
        if (canvas.parentNode) canvas.parentNode.replaceChild(fresh, canvas);
        canvas = fresh;
      }
    }
    throw new Error("no way to draw on the canvas: " + errors.join("; "));
  }

  // Presents a test pattern on a new offscreen canvas and reads it back (in the same task, before
  // the canvas is composited). For tests: { kind, ok, mismatches }.
  async function selfTest(prefer) {
    const canvas = document.createElement("canvas");
    const presenter = await create(canvas, { prefer });
    const w = 61, h = 37; // odd sizes: row pitch and orientation both matter
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        rgba.set([x * 4, y * 6, (x * 7 + y * 3) & 255, 255], i);
      }
    }
    presenter.present(rgba, w, h);
    const probe = document.createElement("canvas");
    probe.width = w;
    probe.height = h;
    const ctx = probe.getContext("2d");
    ctx.drawImage(presenter.canvas, 0, 0);
    const got = ctx.getImageData(0, 0, w, h).data;
    let mismatches = 0;
    for (let i = 0; i < got.length; i++) {
      if (Math.abs(got[i] - rgba[i]) > 2) mismatches++;
    }
    return { kind: presenter.kind, ok: mismatches === 0, mismatches, fallbackReasons: presenter.fallbackReasons };
  }

  return { create, selfTest };
})();
