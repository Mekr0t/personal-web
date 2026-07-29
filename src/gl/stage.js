import {
  WebGPURenderer,
  Scene,
  PerspectiveCamera,
  AgXToneMapping,
  Vector3,
} from 'three/webgpu';

/**
 * Renderer, scene and camera. Knows nothing about the site's content.
 *
 * WebGPU is the default backend; `WebGPURenderer` installs its own WebGL2
 * fallback when the browser has no WebGPU, so there is no branch to write here.
 * `?webgl` in the URL forces the fallback path so it can actually be tested —
 * an untested fallback is not a fallback.
 */
export async function createStage(canvas) {
  const forceWebGL = new URLSearchParams(location.search).has('webgl');

  const renderer = new WebGPURenderer({
    canvas,
    alpha: true,
    antialias: false, // handled in the post chain
    forceWebGL,
  });

  // RenderPipeline applies tone mapping and the colour-space transform as the
  // last step of the chain, so bloom still gathers light while the frame is
  // linear HDR. AgX rolls saturated highlights toward white instead of clipping
  // them to a flat disc, which matters for a field of additive points.
  renderer.toneMapping = AgXToneMapping;
  renderer.setClearColor(0x000000, 0);

  await renderer.init();

  const scene = new Scene();

  const camera = new PerspectiveCamera(42, 1, 0.1, 120);
  camera.position.set(0, 0, 14);

  const target = new Vector3(0, 0, 0);

  const state = {
    width: 0,
    height: 0,
    dpr: 0,
    dprCap: 2,
  };

  /**
   * Mobile browser chrome sliding in and out fires `resize` continuously.
   * Reallocating every render target for a no-op change is an expensive way to
   * do nothing, so bail out when nothing actually changed.
   */
  function resize(force = false) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, state.dprCap);

    if (!force && width === state.width && height === state.height && dpr === state.dpr) {
      return false;
    }

    state.width = width;
    state.height = height;
    state.dpr = dpr;

    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    return true;
  }

  resize(true);
  window.addEventListener('resize', () => resize(), { passive: true });

  function setDprCap(cap) {
    if (cap === state.dprCap) return;
    state.dprCap = cap;
    resize(true);
  }

  function dispose() {
    renderer.dispose();
  }

  return {
    renderer,
    scene,
    camera,
    target,
    state,
    resize,
    setDprCap,
    dispose,
    isWebGPU: renderer.backend?.isWebGPUBackend === true,
  };
}
