import { RenderPipeline } from 'three/webgpu';
import { pass, uniform, float, vec2, vec4, mix, length, smoothstep, screenUV } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

/**
 * The effect chain.
 *
 * Order is not stylistic: bloom has to gather light while the frame is still
 * linear HDR, so it runs first and the tone map runs last. `RenderPipeline`
 * owns that final step via `outputColorTransform`, reading `renderer.toneMapping`
 * — which is why the renderer is set to AgX rather than to NoToneMapping.
 */
export function createPostFX({ renderer, scene, camera }) {
  const scenePass = pass(scene, camera);

  const uniforms = {
    // Note the scale: this node applies `offset * strength * 0.01`, so useful
    // values are order 1, not the order 1e-4 that pmndrs/postprocessing wants.
    aberration: uniform(0.3),
    vignette: uniform(0.62),
    bloomStrength: uniform(0.85),
  };

  // High threshold, moderate strength. Below ~0.7 the mid-tones of the field
  // start contributing and the whole frame veils.
  // High threshold, moderate strength. Below ~0.8 the mid-tones of the field
  // start contributing and the whole frame veils.
  const bloomNode = bloom(scenePass, uniforms.bloomStrength, 0.6, 0.85);

  let chain = scenePass.add(bloomNode);

  // Driven from scroll velocity in main.js — cheap, and it makes the whole
  // frame feel reactive rather than just the field.
  //
  // The centre argument must be passed explicitly. Its JSDoc says a null centre
  // falls back to (0.5, 0.5), but the node declares `center` as a required vec2
  // in `setLayout` and passes the raw null into the function call, so omitting
  // it throws "Cannot read properties of null (reading 'build')" at pipeline
  // build time — and then the entire chain silently renders black.
  // Scale 1 keeps this a pure RGB split with no per-channel zoom.
  chain = chromaticAberration(chain, uniforms.aberration, vec2(0.5, 0.5), 1.0);

  // Vignette last, before the output transform.
  const distance = length(screenUV.sub(vec2(0.5, 0.5)));
  const falloff = smoothstep(float(0.92), float(0.3), distance);
  chain = vec4(chain.rgb.mul(mix(float(1), falloff, uniforms.vignette)), chain.a);

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = chain;

  function setTheme(dark) {
    uniforms.vignette.value = dark ? 0.62 : 0.16;
    // On paper the field is ink rather than light, so blooming it just fogs
    // the page.
    uniforms.bloomStrength.value = dark ? 0.9 : 0.0;
  }

  let lensEnabled = true;

  function setQuality(tier) {
    // Tier 0 drops the lens work. Bloom stays — it is most of the look — but
    // comes down in strength.
    lensEnabled = tier > 0;
    if (tier === 0) {
      uniforms.aberration.value = 0;
      uniforms.bloomStrength.value = Math.min(uniforms.bloomStrength.value, 0.55);
    }
  }

  /** Scroll-reactive aberration; ignored once quality has stepped down. */
  function setAberration(value) {
    if (lensEnabled) uniforms.aberration.value = value;
  }

  function dispose() {
    pipeline.dispose?.();
  }

  return { pipeline, uniforms, setTheme, setQuality, setAberration, dispose };
}
