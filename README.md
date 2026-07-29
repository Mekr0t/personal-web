# romansafranko.com

Personal site. A WebGPU point field is the whole visual identity: ~92k points
that hold seven procedural forms at once and blend between them as you scroll —
a raw depth scan, a robot arm, an audio spectrum, a hex board, a document, a
lattice, and a convergent core, one per section.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # → dist/
npm run preview
```

Deployed on Vercel, which auto-detects Vite and builds `dist/`.

## Stack

| Concern | Choice |
| --- | --- |
| Rendering | **three.js r185** `WebGPURenderer`, with automatic WebGL2 fallback |
| Shaders | **TSL** — authored in JS, compiled to WGSL *and* GLSL |
| Post | three's `RenderPipeline` — bloom → chromatic aberration → vignette → AgX |
| Smooth scroll | **Lenis**, wired into the GSAP ticker so one clock drives everything |
| Reveals | **GSAP** + `SplitText`, plus IntersectionObserver |
| Build | **Vite 8** (Rolldown) |

No ScrollTrigger: the rig reads `scrollY` directly and IntersectionObserver
covers reveals and scrollspy, so it would be weight with no job.

## How the field works

`src/gl/targets.js` generates one `Float32Array` per form — `count * 4`, xyz
plus an accent weight in w. Surface-sampled, never volume-filled, because a
solid cloud of points reads as fog rather than as a scan. Seeded with
mulberry32, so the layout is identical on every load.

`src/gl/field.js` uploads all seven as instanced `vec4` attributes and blends
them in the vertex shader with a triangular window around each integer stop:

```
w_k = max(0, 1 - |scene - k|)
```

Only two forms are ever active, the weights always sum to 1, and the blend is
continuous in both directions.

**There is no compute pass, deliberately.** Position is a pure function of
(targets, scene, time) — there is nothing to integrate frame to frame, so a
compute kernel would only be state the vertex stage has to read back. It also
means the identical code path runs on the WebGL2 fallback, where compute is
emulated through transform feedback and storage reads are the fragile part.

Dispersion peaks exactly between two stops (`sin(fract(scene) · π)`), which is
what makes the field burst apart and re-converge instead of sliding between
shapes.

## Tuning

| Want to change | Where |
| --- | --- |
| Camera path per section | `STOPS` in `src/scroll/rig.js` |
| The forms themselves | `src/gl/targets.js` |
| Point size, colour, dispersion | `src/gl/field.js` |
| Bloom / aberration / vignette | `src/gl/postfx.js` |
| Callout labels | `HOTSPOTS` in `src/ui/detections.js` |
| Which form a section maps to | `data-scene` in `index.html` |

`?webgl` forces the WebGL2 backend so the fallback can actually be tested — an
untested fallback is not a fallback. In dev, `window.site` exposes the live
modules, and `Node.captureStackTrace` is enabled so a failed node build reports
a location instead of `[Unknown location]`.

## Two things that cost time

- **`chromaticAberration` must be given an explicit centre.** Its JSDoc says a
  null centre falls back to `(0.5, 0.5)`, but the node declares `center` as a
  required `vec2` in `setLayout` and passes the raw null into the function call.
  Omitting it throws `Cannot read properties of null (reading 'build')` at
  pipeline build time and the whole chain renders black. Its strength is also
  scaled by `0.01` internally, so useful values are order 1 — not the order
  `1e-4` that pmndrs/postprocessing wants.

- **`contain: strict` on the canvas wrapper collapses it to 0×0.** `strict`
  implies size containment, so the renderer gets a zero-sized drawing buffer and
  WebGPU rejects every texture it tries to allocate. `contain: layout paint
  style` is what was meant.
