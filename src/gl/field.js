import {
  Sprite,
  PointsNodeMaterial,
  InstancedBufferAttribute,
  AdditiveBlending,
  NormalBlending,
  Color,
} from 'three/webgpu';

import {
  instancedBufferAttribute,
  uniform,
  float,
  vec3,
  vec4,
  abs,
  max,
  fract,
  sin,
  dot,
  mix,
  smoothstep,
  length,
  normalize,
  pow,
  uv,
  mx_noise_vec3,
} from 'three/tsl';

import { buildTargets, SCENES } from './targets.js';

/**
 * The point field — the whole visual identity of the site in one draw call.
 *
 * Every point carries one position per form (seven `vec4` instanced attributes)
 * and the vertex shader blends between them by a continuous `scene` uniform.
 * Because the blend weights are a triangular window around each integer stop,
 * only two forms are ever active at once, but the transition is continuous in
 * both directions and needs no state.
 *
 * That is the reason there is no compute pass here. Position is a pure function
 * of (targets, scene, time): there is nothing to integrate frame to frame, so a
 * compute kernel would only be storage the vertex stage has to read back.
 *
 * Rendered as instanced sprites rather than `Points`, because WebGPU point
 * primitives are fixed at one pixel and cannot express size or softness.
 */
export function createField({ count = 90000 } = {}) {
  const targets = buildTargets(count);

  const attributes = targets.map((data) => new InstancedBufferAttribute(data, 4));
  const nodes = attributes.map((attr) => instancedBufferAttribute(attr, 'vec4'));

  const uniforms = {
    scene: uniform(0),
    time: uniform(0),
    disperse: uniform(1),
    intensity: uniform(1),
    base: uniform(new Color('#1F7A52')),
    accent: uniform(new Color('#4BEBA2')),
  };

  /* ── blend the seven forms ─────────────────────────────────────── */

  // Triangular window per form. Sums to exactly 1 between adjacent stops.
  const weightAt = (k) => max(float(1).sub(abs(uniforms.scene.sub(float(k)))), float(0));

  let blended = vec3(0, 0, 0);
  let accent = float(0);

  nodes.forEach((node, k) => {
    const w = weightAt(k);
    blended = blended.add(node.xyz.mul(w));
    accent = accent.add(node.w.mul(w));
  });

  /* ── per-point identity ────────────────────────────────────────── */

  // Stable random per point, derived from its resting position in form 0 so it
  // costs no extra attribute and never changes between frames.
  const hash = fract(sin(dot(nodes[0].xyz, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));

  /* ── dispersion during a handover ──────────────────────────────── */

  // Zero at every stop, one exactly between two. This is what makes the field
  // burst apart and re-converge rather than sliding between shapes.
  const transition = sin(fract(uniforms.scene).mul(Math.PI));

  const flow = blended
    .mul(0.32)
    .add(vec3(uniforms.time.mul(0.11), uniforms.time.mul(0.08), uniforms.time.mul(0.14)));

  const turbulence = mx_noise_vec3(flow).mul(1.25);

  // A little outward push on top of the noise, so the burst reads as radial
  // rather than as an even shake. Epsilon keeps normalize away from the origin.
  const outward = normalize(blended.add(vec3(0.0001, 0.0001, 0.0001))).mul(hash.mul(0.9).add(0.3));

  const dispersion = turbulence
    .add(outward)
    .mul(transition)
    .mul(uniforms.disperse)
    .mul(hash.mul(0.75).add(0.5));

  // Idle breathing, so a settled form is never completely static.
  const idle = mx_noise_vec3(blended.mul(0.45).add(uniforms.time.mul(0.07))).mul(0.032);

  /* ── material ──────────────────────────────────────────────────── */

  const material = new PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    sizeAttenuation: true,
  });

  material.positionNode = blended.add(dispersion).add(idle);

  // Accent points are larger; everything swells slightly mid-transition.
  material.sizeNode = accent.mul(0.062).add(0.036).mul(transition.mul(0.3).add(1));

  const tint = mix(uniforms.base, uniforms.accent, pow(accent, 0.65));
  material.colorNode = vec4(tint.mul(uniforms.intensity).mul(transition.mul(0.55).add(1)), 1);

  // Round, soft-edged points. Dim points stay dim so the accents can carry.
  const falloff = smoothstep(float(0.5), float(0.12), length(uv().sub(0.5)));
  material.opacityNode = falloff.mul(accent.mul(0.6).add(0.4));

  const object = new Sprite(material);
  object.count = count;
  // A Sprite's bounding sphere describes its 1×1 quad, not 90k instances spread
  // over ten units, so leaving culling on makes the field vanish off-centre.
  object.frustumCulled = false;
  object.renderOrder = 1;

  /* ── theme ─────────────────────────────────────────────────────── */

  function setTheme(dark) {
    if (dark) {
      uniforms.base.value.set('#1F7A52');
      uniforms.accent.value.set('#4BEBA2');
      uniforms.intensity.value = 1;
      material.blending = AdditiveBlending;
    } else {
      // On paper the field is ink, not light: normal blending, dark points.
      uniforms.base.value.set('#8FA79A');
      uniforms.accent.value.set('#0B5C33');
      uniforms.intensity.value = 1;
      material.blending = NormalBlending;
    }
    material.needsUpdate = true;
  }

  function dispose() {
    material.dispose();
    for (const attr of attributes) attr.array = null;
  }

  return { object, uniforms, material, setTheme, dispose, count, scenes: SCENES };
}
