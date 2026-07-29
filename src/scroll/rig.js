import { Vector3, MathUtils } from 'three/webgpu';

/**
 * Scroll position → one plain state object per frame.
 *
 * This module is the only place that knows the choreography, and it knows
 * nothing about three.js objects beyond the camera it positions. `gl/*` reads
 * the state and knows nothing about scroll.
 *
 * One row per form. Every visual decision about a shot lives here, so the whole
 * page can be re-timed by editing numbers rather than code.
 *
 * `theta` deliberately winds past 2π across the page — never wrap it back, or
 * the camera spins the long way round on the way to the next stop.
 */
const STOPS = [
  // scan — hero. Pushed well right and held back: this is the only copy that
  // has to be readable the instant the page opens, so the subject clears it
  // rather than relying on the scrim alone.
  { radius: 14.6, theta: 0.42, phi: 1.46, fov: 42, offset: [0.58, 0.02] },
  // The project stops all sit well right of centre: on a split section the copy
  // owns the left two thirds, and a subject any closer to the middle lands
  // under the scrim that keeps that copy readable.
  // arm — thesis
  { radius: 11.2, theta: 1.12, phi: 1.34, fov: 40, offset: [0.52, -0.03] },
  // wave — visualizer
  { radius: 10.2, theta: 2.04, phi: 1.22, fov: 44, offset: [0.54, 0.00] },
  // board — TFT
  { radius: 10.8, theta: 2.96, phi: 1.12, fov: 42, offset: [0.52, 0.03] },
  // page — CV Studio
  { radius: 9.6, theta: 3.88, phi: 1.50, fov: 40, offset: [0.54, 0.00] },
  // lattice — approach + stack. These are full-width reading sections, so the
  // lattice stays centred and pulled back: it is only atmosphere here.
  { radius: 14.2, theta: 4.74, phi: 1.30, fov: 46, offset: [0.08, 0.00] },
  // core — contact
  { radius: 10.4, theta: 5.86, phi: 1.44, fov: 40, offset: [0.46, 0.02] },
];

/** Slow in and out, so the camera settles at a stop instead of sailing through. */
const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Where the handover happens inside a segment, as a fraction of it.
 *
 * Without this the scene value moves linearly between two stops, so the
 * midpoint of the scroll range sits at exactly the point of maximum dispersion
 * — and a reader who stops there is left looking at permanent mush rather than
 * at a form. Holding near each stop and crossing quickly in between makes the
 * settled, readable state the common one and the burst a brief event.
 */
const HANDOVER_START = 0.34;
const HANDOVER_LENGTH = 0.32;

export function createRig({ camera, sections }) {
  const lookAt = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const worldUp = new Vector3(0, 1, 0);

  /** @type {{ y: number, scene: number }[]} */
  let anchors = [];
  let maxScroll = 1;

  const state = {
    scene: 0,
    progress: 0,
    disperse: 1,
    velocity: 0,
  };

  const smoothed = { scene: 0 };
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  /**
   * Anchor each form to the moment its section sits in the middle of the
   * viewport, then interpolate between anchors. Re-run on refresh so it tracks
   * font loading and resize.
   */
  function measure() {
    const vh = window.innerHeight;
    maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);

    anchors = sections.map((el, i) => {
      const rect = el.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const scene = Number(el.dataset.scene) || 0;

      // The hero must respond to the very first scroll, and the finale needs
      // room to arrive before the page bottoms out.
      if (i === 0) return { y: 0, scene };
      if (i === sections.length - 1) return { y: Math.min(top - vh * 0.55, maxScroll), scene };

      return { y: top + rect.height / 2 - vh / 2, scene };
    });

    anchors.push({ y: maxScroll, scene: anchors[anchors.length - 1].scene });

    // Enforce monotonic anchors — overlapping sections would otherwise produce
    // a scene value that runs backwards.
    for (let i = 1; i < anchors.length; i++) {
      if (anchors[i].y <= anchors[i - 1].y) anchors[i].y = anchors[i - 1].y + 1;
    }
  }

  function sceneFromScroll(y) {
    if (anchors.length === 0) return 0;
    if (y <= anchors[0].y) return anchors[0].scene;

    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      if (y <= b.y) {
        const raw = (y - a.y) / (b.y - a.y);
        const windowed = MathUtils.clamp((raw - HANDOVER_START) / HANDOVER_LENGTH, 0, 1);
        return a.scene + (b.scene - a.scene) * smootherstep(windowed);
      }
    }
    return anchors[anchors.length - 1].scene;
  }

  /** Linear sample of the STOPS table at a fractional index. */
  function sample(s) {
    const clamped = MathUtils.clamp(s, 0, STOPS.length - 1);
    const i = Math.min(Math.floor(clamped), STOPS.length - 2);
    const f = clamped - i;
    const a = STOPS[i];
    const b = STOPS[i + 1];
    const mix = (k) => a[k] + (b[k] - a[k]) * f;
    return {
      radius: mix('radius'),
      theta: mix('theta'),
      phi: mix('phi'),
      fov: mix('fov'),
      offsetX: a.offset[0] + (b.offset[0] - a.offset[0]) * f,
      offsetY: a.offset[1] + (b.offset[1] - a.offset[1]) * f,
    };
  }

  function setPointer(nx, ny) {
    pointer.tx = nx;
    pointer.ty = ny;
  }

  /**
   * @param {number} dt seconds since last frame
   * @param {number} scrollY current scroll position
   * @param {number} velocity scroll velocity, px/frame
   */
  function update(dt, scrollY, velocity) {
    state.progress = MathUtils.clamp(scrollY / maxScroll, 0, 1);
    state.velocity = velocity;

    const targetScene = sceneFromScroll(scrollY);

    // Frame-rate independent smoothing. `current += (target - current) * 0.1`
    // would run at a different speed on a 144 Hz display.
    const ease = 1 - Math.exp(-dt * 9);
    smoothed.scene += (targetScene - smoothed.scene) * ease;
    state.scene = smoothed.scene;

    const pEase = 1 - Math.exp(-dt * 4.5);
    pointer.x += (pointer.tx - pointer.x) * pEase;
    pointer.y += (pointer.ty - pointer.y) * pEase;

    const shot = sample(state.scene);
    const aspect = camera.aspect;
    const portrait = aspect < 1;

    // In portrait, hold the horizontal field of view constant and back off,
    // otherwise the subject crops to a sliver.
    const fov = portrait
      ? MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(shot.fov) / 2) / aspect))
      : shot.fov;

    if (Math.abs(camera.fov - fov) > 0.001) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const radius = shot.radius * (portrait ? 1.18 : 1);

    // Spherical, not cartesian: interpolating radius/theta/phi arcs like a
    // camera orbiting a subject. Interpolating XYZ would cut a chord through it.
    const sinPhi = Math.sin(shot.phi);
    camera.position.set(
      sinPhi * Math.sin(shot.theta),
      Math.cos(shot.phi),
      sinPhi * Math.cos(shot.theta),
    ).multiplyScalar(radius);

    lookAt.set(0, 0, 0);

    // Lateral dolly: slide the subject across the frame by translating the
    // camera *and* its look-at together. Aiming an off-centre look-at instead
    // would shear the perspective.
    const offsetX = portrait ? 0 : shot.offsetX;
    const offsetY = portrait ? shot.offsetY - 0.16 : shot.offsetY;

    forward.copy(lookAt).sub(camera.position).normalize();
    right.copy(forward).cross(worldUp).normalize();
    up.copy(right).cross(forward).normalize();

    // Expressed in half-frame units, so the framing is identical at every
    // aspect ratio and field of view.
    const halfH = Math.tan(MathUtils.degToRad(fov) / 2) * radius;
    const halfW = halfH * aspect;
    const shiftX = -offsetX * halfW;
    const shiftY = -offsetY * halfH;

    camera.position.addScaledVector(right, shiftX).addScaledVector(up, shiftY);
    lookAt.addScaledVector(right, shiftX).addScaledVector(up, shiftY);

    // Parallax moves the camera only, never the look-at — it reads as looking
    // around the subject rather than dragging it.
    camera.position.addScaledVector(right, pointer.x * 0.55).addScaledVector(up, pointer.y * 0.4);

    camera.lookAt(lookAt);

    return state;
  }

  return { measure, update, setPointer, state, STOPS };
}
