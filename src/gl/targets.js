/**
 * Procedural point targets — one form per scroll scene.
 *
 * Every generator fills a Float32Array of `count * 4`: xyz plus an accent
 * weight in w, which the material uses to pick colour and point size. vec4
 * rather than vec3 so the attribute stride never runs into alignment rules.
 *
 * Everything is surface-sampled, not volume-filled: these are meant to read as
 * depth scans of an object, and a solid cloud of points reads as fog.
 *
 * Seeded throughout, so the layout is identical on every load.
 */

import { nextFrame } from '../util/frame.js';

export const SCENES = ['scan', 'arm', 'wave', 'board', 'page', 'lattice', 'core'];

/** mulberry32 — small, fast, and deterministic. */
function mulberry32(seed) {
  return function rng() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── writing helpers ──────────────────────────────────────────────── */

function put(out, i, x, y, z, w) {
  const o = i * 4;
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
  out[o + 3] = w;
}

/** Orthonormal basis around an axis, so capsules can be swept in any direction. */
function basis(ax, ay, az) {
  const len = Math.hypot(ax, ay, az) || 1;
  const dx = ax / len;
  const dy = ay / len;
  const dz = az / len;

  // pick the world axis least aligned with d, so the cross product stays stable
  let ux = 0;
  let uy = 0;
  let uz = 1;
  if (Math.abs(dz) > 0.9) {
    ux = 1;
    uy = 0;
    uz = 0;
  }

  let rx = uy * dz - uz * dy;
  let ry = uz * dx - ux * dz;
  let rz = ux * dy - uy * dx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;

  const sx = dy * rz - dz * ry;
  const sy = dz * rx - dx * rz;
  const sz = dx * ry - dy * rx;

  return { dx, dy, dz, rx, ry, rz, sx, sy, sz, len };
}

/** Points on the lateral surface of a capsule from a→b. */
function capsule(out, at, n, rng, a, b, radius, w) {
  const { dx, dy, dz, rx, ry, rz, sx, sy, sz, len } = basis(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  for (let i = 0; i < n; i++) {
    const t = rng();
    const ang = rng() * Math.PI * 2;
    const r = radius * (0.94 + rng() * 0.06);
    const cx = a[0] + dx * len * t;
    const cy = a[1] + dy * len * t;
    const cz = a[2] + dz * len * t;
    put(
      out,
      at + i,
      cx + (rx * Math.cos(ang) + sx * Math.sin(ang)) * r,
      cy + (ry * Math.cos(ang) + sy * Math.sin(ang)) * r,
      cz + (rz * Math.cos(ang) + sz * Math.sin(ang)) * r,
      w,
    );
  }
  return at + n;
}

/** Even points on a sphere shell (Fibonacci, jittered). */
function sphere(out, at, n, rng, cx, cy, cz, radius, w) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    const rad = radius * (0.97 + rng() * 0.03);
    put(out, at + i, cx + Math.cos(th) * r * rad, cy + y * rad, cz + Math.sin(th) * r * rad, w);
  }
  return at + n;
}

/** Points along a straight line, slightly thickened. */
function line(out, at, n, rng, a, b, jitter, w) {
  for (let i = 0; i < n; i++) {
    const t = rng();
    put(
      out,
      at + i,
      a[0] + (b[0] - a[0]) * t + (rng() - 0.5) * jitter,
      a[1] + (b[1] - a[1]) * t + (rng() - 0.5) * jitter,
      a[2] + (b[2] - a[2]) * t + (rng() - 0.5) * jitter,
      w,
    );
  }
  return at + n;
}

/** Flat annulus in the XZ plane. */
function disc(out, at, n, rng, cx, cy, cz, rInner, rOuter, w) {
  for (let i = 0; i < n; i++) {
    const ang = rng() * Math.PI * 2;
    const r = Math.sqrt(rInner * rInner + rng() * (rOuter * rOuter - rInner * rInner));
    put(out, at + i, cx + Math.cos(ang) * r, cy + (rng() - 0.5) * 0.03, cz + Math.sin(ang) * r, w);
  }
  return at + n;
}

/* ── the forms ────────────────────────────────────────────────────── */

/** 00 — raw depth scan. Discrete latitude rings, nothing classified yet. */
function scan(out, count, rng) {
  const RINGS = 46;
  const R = 3.75;
  let at = 0;
  for (let i = 0; i < count; i++) {
    const ring = Math.floor(rng() * RINGS);
    // bias sampling toward the equator so rings stay visually even in density
    const v = (ring + 0.5) / RINGS;
    const phi = Math.acos(1 - 2 * v);
    const theta = rng() * Math.PI * 2;

    // a little radial noise reads as sensor error rather than a perfect sphere
    const r = R * (1 + (rng() - 0.5) * 0.035);
    const sp = Math.sin(phi);
    put(
      out,
      at++,
      sp * Math.cos(theta) * r,
      Math.cos(phi) * r,
      sp * Math.sin(theta) * r,
      ring % 6 === 0 ? 0.9 : 0.12,
    );
  }
  return out;
}

/** 01 — articulated arm, mid-reach. */
function arm(out, count, rng) {
  // shifted so the whole linkage sits roughly around the origin
  const X = -1.5;
  const j0 = [X + 0.0, -3.0, 0.0];
  const j1 = [X + 0.0, -0.7, 0.0];
  const j2 = [X + 2.3, 1.1, 0.25];
  const j3 = [X + 3.9, -0.5, 0.5];
  const j4 = [X + 4.3, -1.5, 0.6];

  const n = (f) => Math.floor(count * f);
  let at = 0;

  at = disc(out, at, n(0.1), rng, j0[0], j0[1] - 0.15, j0[2], 0.35, 1.5, 0.15); // base plate
  at = capsule(out, at, n(0.07), rng, [j0[0], j0[1] - 0.15, j0[2]], j0, 0.95, 0.2); // pedestal
  at = capsule(out, at, n(0.17), rng, j0, j1, 0.52, 0.22); // column
  at = capsule(out, at, n(0.19), rng, j1, j2, 0.42, 0.22); // upper arm
  at = capsule(out, at, n(0.16), rng, j2, j3, 0.34, 0.22); // forearm
  at = capsule(out, at, n(0.06), rng, j3, j4, 0.2, 0.85); // wrist

  at = sphere(out, at, n(0.05), rng, j1[0], j1[1], j1[2], 0.6, 0.95); // joints
  at = sphere(out, at, n(0.045), rng, j2[0], j2[1], j2[2], 0.5, 0.95);
  at = sphere(out, at, n(0.04), rng, j3[0], j3[1], j3[2], 0.42, 0.95);

  // gripper fingers
  at = line(out, at, n(0.02), rng, [j4[0] - 0.22, j4[1], j4[2]], [j4[0] - 0.3, j4[1] - 0.55, j4[2]], 0.05, 1);
  at = line(out, at, n(0.02), rng, [j4[0] + 0.22, j4[1], j4[2]], [j4[0] + 0.3, j4[1] - 0.55, j4[2]], 0.05, 1);

  // the block it is reaching for, sitting on the work surface
  const bx = j4[0] + 0.05;
  const by = j4[1] - 1.15;
  const bz = j4[2];
  const s = 0.42;
  const edges = [
    [[-1, -1, -1], [1, -1, -1]], [[1, -1, -1], [1, -1, 1]], [[1, -1, 1], [-1, -1, 1]], [[-1, -1, 1], [-1, -1, -1]],
    [[-1, 1, -1], [1, 1, -1]], [[1, 1, -1], [1, 1, 1]], [[1, 1, 1], [-1, 1, 1]], [[-1, 1, 1], [-1, 1, -1]],
    [[-1, -1, -1], [-1, 1, -1]], [[1, -1, -1], [1, 1, -1]], [[1, -1, 1], [1, 1, 1]], [[-1, -1, 1], [-1, 1, 1]],
  ];
  const per = Math.floor(n(0.055) / edges.length);
  for (const [a, b] of edges) {
    at = line(out, at, per, rng,
      [bx + a[0] * s, by + a[1] * s, bz + a[2] * s],
      [bx + b[0] * s, by + b[1] * s, bz + b[2] * s], 0.02, 1);
  }

  // work surface grid, so the arm has something to stand on
  while (at < count) {
    const gx = (rng() - 0.5) * 9;
    const gz = (rng() - 0.5) * 6;
    put(out, at++, gx, -3.2, gz, 0.06);
  }
  return out;
}

/** 02 — a frozen frame of a radial spectrum. */
function wave(out, count, rng) {
  const BARS = 72;
  const R = 2.5;
  let at = 0;

  // a fixed pseudo-spectrum: loud low end, decaying tail, a little sparkle
  const heights = new Float32Array(BARS);
  for (let i = 0; i < BARS; i++) {
    const t = i / BARS;
    const band = Math.min(t, 1 - t) * 2; // mirror so the ring is symmetric
    heights[i] =
      (0.35 + Math.pow(1 - band, 1.9) * 2.6) *
      (0.55 + Math.abs(Math.sin(i * 1.7)) * 0.5 + Math.sin(i * 0.43) * 0.22);
  }

  const barPts = Math.floor((count * 0.72) / BARS);
  for (let i = 0; i < BARS; i++) {
    const ang = (i / BARS) * Math.PI * 2;
    const cx = Math.cos(ang) * R;
    const cz = Math.sin(ang) * R;
    const h = heights[i];
    for (let k = 0; k < barPts; k++) {
      const t = rng();
      const y = -1.4 + t * h * 1.5;
      const wob = (rng() - 0.5) * 0.09;
      put(out, at++, cx + Math.cos(ang) * wob, y, cz + Math.sin(ang) * wob, 0.25 + t * 0.75);
    }
  }

  at = disc(out, at, Math.floor(count * 0.12), rng, 0, -1.45, 0, R - 0.28, R + 0.28, 0.5); // base ring
  at = disc(out, at, Math.floor(count * 0.06), rng, 0, -1.45, 0, 0, 0.7, 0.9); // centre disc

  // sparse halo, so the ring is not floating in nothing
  while (at < count) {
    const ang = rng() * Math.PI * 2;
    const rr = R + 0.5 + rng() * 2.6;
    put(out, at++, Math.cos(ang) * rr, -1.4 + rng() * 2.4, Math.sin(ang) * rr, 0.05);
  }
  return out;
}

/** 03 — hex board with unit stacks. */
function board(out, count, rng) {
  const COLS = 7;
  const ROWS = 4;
  const HR = 0.62; // hex radius
  const dx = HR * Math.sqrt(3);
  const dz = HR * 1.5;
  const tilt = -0.62; // lean the board toward the camera

  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      cells.push([(c - (COLS - 1) / 2) * dx + (r % 2 ? dx / 2 : 0), (r - (ROWS - 1) / 2) * dz]);
    }
  }

  // rotate a point on the XZ plane about X, so the board tips up
  const place = (x, z, y = 0) => {
    const cy = Math.cos(tilt);
    const sy = Math.sin(tilt);
    return [x, y * cy - z * sy, y * sy + z * cy];
  };

  let at = 0;
  const outlinePts = Math.floor((count * 0.55) / cells.length);

  for (const [cx, cz] of cells) {
    for (let i = 0; i < outlinePts; i++) {
      const side = Math.floor(rng() * 6);
      const t = rng();
      const a0 = ((side + 0.5) / 6) * Math.PI * 2;
      const a1 = ((side + 1.5) / 6) * Math.PI * 2;
      const px = cx + (Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * t) * HR * 0.92;
      const pz = cz + (Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * t) * HR * 0.92;
      const p = place(px, pz);
      put(out, at++, p[0], p[1], p[2], 0.14);
    }
  }

  // a scatter of units standing on cells
  const units = [2, 5, 9, 13, 16, 21, 24];
  const unitPts = Math.floor((count * 0.34) / units.length);
  for (const idx of units) {
    const [cx, cz] = cells[idx % cells.length];
    const h = 0.5 + rng() * 0.75;
    for (let i = 0; i < unitPts; i++) {
      const t = rng();
      const ang = rng() * Math.PI * 2;
      const rr = HR * 0.34 * (1 - t * 0.55);
      const p = place(cx + Math.cos(ang) * rr, cz + Math.sin(ang) * rr, t * h);
      put(out, at++, p[0], p[1], p[2], 0.4 + t * 0.6);
    }
  }

  while (at < count) {
    const p = place((rng() - 0.5) * 9, (rng() - 0.5) * 7);
    put(out, at++, p[0], p[1] - 0.12, p[2], 0.05);
  }
  return out;
}

/** 04 — a document, standing upright. */
function page(out, count, rng) {
  const W = 2.5;
  const H = 3.4;
  const x0 = -W / 2;
  const y0 = -H / 2;
  let at = 0;

  // border
  const borderPts = Math.floor(count * 0.14);
  for (let i = 0; i < borderPts; i++) {
    const t = rng() * 4;
    let x;
    let y;
    if (t < 1) { x = x0 + W * t; y = y0; }
    else if (t < 2) { x = x0 + W; y = y0 + H * (t - 1); }
    else if (t < 3) { x = x0 + W * (3 - t); y = y0 + H; }
    else { x = x0; y = y0 + H * (4 - t); }
    put(out, at++, x, y, 0, 0.75);
  }

  // header block
  const headPts = Math.floor(count * 0.1);
  for (let i = 0; i < headPts; i++) {
    put(out, at++, x0 + 0.22 + rng() * (W * 0.52), y0 + H - 0.42 - rng() * 0.3, rng() * 0.02, 1);
  }

  // body lines — ragged right edges, a gap for each section break
  const LINES = 17;
  const linePts = Math.floor((count * 0.66) / LINES);
  for (let l = 0; l < LINES; l++) {
    const y = y0 + H - 1.0 - l * 0.145;
    const isHead = l % 6 === 0;
    const len = isHead ? W * 0.34 : W * (0.62 + rng() * 0.3);
    for (let i = 0; i < linePts; i++) {
      put(out, at++, x0 + 0.22 + rng() * len, y + (rng() - 0.5) * 0.035, rng() * 0.02, isHead ? 0.95 : 0.22);
    }
  }

  while (at < count) {
    put(out, at++, x0 + 0.16, y0 + 0.25 + rng() * (H - 1.6), rng() * 0.02, 0.6); // margin rule
  }
  return out;
}

/** 05 — a structural lattice. Calm, orthogonal, for the reading sections. */
function lattice(out, count, rng) {
  const N = 4;
  const S = 3.1;
  const step = (S * 2) / N;
  let at = 0;

  const nodes = [];
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      for (let k = 0; k <= N; k++) {
        nodes.push([-S + i * step, -S + j * step, -S + k * step]);
      }
    }
  }

  // edge segments along each axis
  const edgePts = Math.floor(count * 0.72);
  for (let i = 0; i < edgePts; i++) {
    const axis = Math.floor(rng() * 3);
    const a = Math.floor(rng() * (N + 1));
    const b = Math.floor(rng() * (N + 1));
    const t = rng() * 2 - 1;
    const p = [0, 0, 0];
    p[axis] = t * S;
    p[(axis + 1) % 3] = -S + a * step;
    p[(axis + 2) % 3] = -S + b * step;
    put(out, at++, p[0], p[1], p[2], 0.13);
  }

  // brighter nodes at the intersections
  const nodePts = count - at;
  for (let i = 0; i < nodePts; i++) {
    const nd = nodes[Math.floor(rng() * nodes.length)];
    const j = 0.055;
    put(out, at++, nd[0] + (rng() - 0.5) * j, nd[1] + (rng() - 0.5) * j, nd[2] + (rng() - 0.5) * j, 0.85);
  }
  return out;
}

/** 06 — everything converges. */
function core(out, count, rng) {
  let at = 0;
  const dense = Math.floor(count * 0.55);
  at = sphere(out, at, dense, rng, 0, 0, 0, 1.15, 1);

  // shell
  const shell = Math.floor(count * 0.22);
  at = sphere(out, at, shell, rng, 0, 0, 0, 2.1, 0.35);

  // halo — a thin outward drift so the core has depth around it
  while (at < count) {
    const u = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const r = 2.4 + Math.pow(rng(), 2.2) * 4.2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    put(out, at++, s * Math.cos(th) * r, u * r * 0.75, s * Math.sin(th) * r, 0.07);
  }
  return out;
}

const GENERATORS = { scan, arm, wave, board, page, lattice, core };

/**
 * Build every target buffer.
 *
 * Async and yielding between forms on purpose: at 92k points this writes 2.6M
 * floats, which is long enough to block the main thread past the point where
 * the loader can repaint. One form per frame keeps the bar honestly moving.
 *
 * @param {number} count points per form
 * @param {(fraction: number) => void} [onProgress] called after each form
 * @returns {Promise<Float32Array[]>} one `count * 4` array per entry in SCENES
 */
export async function buildTargets(count, onProgress) {
  const out = [];

  for (let i = 0; i < SCENES.length; i++) {
    const buffer = new Float32Array(count * 4);
    GENERATORS[SCENES[i]](buffer, count, mulberry32(0x9e37 + i * 7919));
    out.push(buffer);

    onProgress?.((i + 1) / SCENES.length);
    await nextFrame();
  }

  return out;
}
