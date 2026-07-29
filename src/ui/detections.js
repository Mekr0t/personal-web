import { Vector3 } from 'three/webgpu';

/**
 * Real DOM labels pinned to points in the 3D field — selectable, crisp, and
 * styled with the same detection-box language as the inline `.det` marks.
 *
 * Anchors are given in the world space of each form, so they only make sense
 * while that form is on screen. A label fades in once its scene has settled and
 * out again the moment the field starts dispersing, which keeps them off the
 * screen during the messy part of a handover.
 */
const HOTSPOTS = [
  { scene: 0, at: [0.2, 3.6, 0.6], label: 'surface', meta: 'depth 3.75m', lead: 1.5 },
  { scene: 0, at: [2.9, -1.4, 2.0], label: 'subject', meta: 'unclassified', lead: 0.8 },

  { scene: 1, at: [0.8, 1.1, 0.25], label: 'joint_02', meta: 'servo', lead: 1.6 },
  { scene: 1, at: [2.8, -1.5, 0.6], label: 'gripper', meta: 'open', lead: 0.9 },
  { scene: 1, at: [2.85, -2.65, 0.6], label: 'target', meta: 'letter', lead: 1.9 },

  { scene: 2, at: [2.5, 1.0, 0.0], label: 'spectrum', meta: '72 band', lead: 1.4 },
  { scene: 2, at: [-1.9, -1.4, 1.6], label: 'frame', meta: '9:16', lead: 0.9 },

  { scene: 3, at: [1.5, 0.85, -0.5], label: 'comp', meta: '7 units', lead: 1.5 },
  { scene: 3, at: [-2.3, -0.5, 0.7], label: 'board', meta: 'hex 7×4', lead: 0.9 },

  { scene: 4, at: [0.5, 1.35, 0.0], label: 'header', meta: 'parsed', lead: 1.5 },
  { scene: 4, at: [-1.15, -0.5, 0.0], label: 'ats', meta: 'pass', lead: 0.9 },

  { scene: 6, at: [0.0, 1.25, 0.0], label: 'signal', meta: 'locked', lead: 1.3 },
];

export function createDetections({ layer, camera }) {
  const projected = new Vector3();

  const items = HOTSPOTS.map((spot) => {
    const el = document.createElement('div');
    el.className = 'hot';
    // Stagger the leader lengths. Anchors routinely project to similar heights
    // as the camera orbits; varying the lead separates the labels horizontally
    // while every dot stays exactly on its anchor. Much simpler than collision
    // resolution, and it looks deliberate.
    el.style.setProperty('--lead', String(spot.lead));

    // Capped below 1 — a detector reporting 1.00 confidence reads as fake.
    const confidence = (0.88 + Math.random() * 0.11).toFixed(2);
    el.innerHTML =
      '<i class="hot__dot"></i><i class="hot__lead"></i>' +
      `<span class="hot__label">${spot.label}<b>${confidence}</b></span>`;

    el.style.opacity = '0';
    layer.appendChild(el);

    return { ...spot, el, world: new Vector3(...spot.at), shown: false };
  });

  let enabled = true;

  function update(scene) {
    if (!enabled) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    for (const item of items) {
      // Only while this form is settled. 0.22 of a scene unit either side is
      // roughly the window where the field has actually converged.
      const distance = Math.abs(scene - item.scene);
      const visible = distance < 0.22;

      if (!visible) {
        if (item.shown) {
          item.el.style.opacity = '0';
          item.shown = false;
        }
        continue;
      }

      projected.copy(item.world).project(camera);

      if (projected.z > 1) {
        if (item.shown) {
          item.el.style.opacity = '0';
          item.shown = false;
        }
        continue;
      }

      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;

      // Flip the label to the other side before it can clip the viewport edge.
      const side = x > width * 0.72 ? 'left' : 'right';
      const shift = side === 'left' ? '-100%' : '0';

      item.el.dataset.side = side;
      item.el.style.transform =
        `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(${shift}, -50%)`;

      if (!item.shown) {
        item.el.style.opacity = '1';
        item.shown = true;
      }
    }
  }

  function setEnabled(value) {
    enabled = value;
    layer.classList.toggle('is-on', value);
    if (!value) {
      for (const item of items) {
        item.el.style.opacity = '0';
        item.shown = false;
      }
    }
  }

  function dispose() {
    for (const item of items) item.el.remove();
  }

  return { update, setEnabled, dispose };
}
