import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/ibm-plex-sans';
import '@fontsource-variable/jetbrains-mono';

import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/ui.css';

import gsap from 'gsap';
import Lenis from 'lenis';
import { Node } from 'three/webgpu';

// Without this, a failed node build reports "[Unknown location]" and you are
// guessing which line of the graph is wrong.
if (import.meta.env.DEV) Node.captureStackTrace = true;

import { createStage } from './gl/stage.js';
import { createField } from './gl/field.js';
import { createPostFX } from './gl/postfx.js';
import { createQuality } from './gl/quality.js';
import { createRig } from './scroll/rig.js';
import { createChrome } from './ui/chrome.js';
import { createReveals } from './ui/reveal.js';
import { createDetections } from './ui/detections.js';
import { nextFrame } from './util/frame.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

/* ── boot progress ─────────────────────────────────────────────────── */

const bootEl = document.getElementById('boot');
const bootFill = document.getElementById('boot-fill');
const bootPct = document.getElementById('boot-pct');

function progress(value) {
  const pct = Math.round(value * 100);
  if (bootFill) bootFill.style.width = `${pct}%`;
  if (bootPct) bootPct.textContent = String(pct).padStart(2, '0');
}

function finishBoot() {
  progress(1);
  document.body.classList.add('is-booted', 'is-ready');
  // Nothing behind it is interactive, and it is aria-hidden, but leaving a
  // full-screen element in the tree is a good way to trap a future click.
  setTimeout(() => bootEl?.remove(), 900);
}

/* ── how many points can this machine reasonably draw ──────────────── */

function pointBudget() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const narrow = window.innerWidth < 900;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;

  if (coarse || narrow) return 34000;
  if (cores <= 4 || memory <= 4) return 60000;
  return 92000;
}

/* ── main ──────────────────────────────────────────────────────────── */

async function main() {
  const bootStarted = performance.now();
  const canvas = document.getElementById('stage');

  // The copy is real DOM and never depended on the canvas, so a machine with no
  // working GPU path still gets the whole site — it just gets it flat.
  const chrome = createChrome();

  // Kick the font wait and text splitting off now, but the observers are not
  // attached until the boot overlay lifts — see reveals.start() below.
  const revealsPending = createReveals();

  progress(0.08);
  // Yield after every stage, or none of these values ever reach the screen:
  // the next stage blocks the thread before the browser gets a chance to paint,
  // and the loader appears stuck on its first number.
  await nextFrame();

  let stage;
  try {
    stage = await createStage(canvas);
  } catch (error) {
    console.warn('[stage] no GPU backend available, running flat:', error);
    chrome.setBackend('no GPU');
    document.body.classList.add('is-flat');
    finishBoot();
    (await revealsPending).start();
    return;
  }

  chrome.setBackend(stage.isWebGPU ? 'WebGPU' : 'WebGL2');
  progress(0.2);
  await nextFrame();

  const { renderer, scene, camera } = stage;

  // The seven forms are built one per frame, so this stretch of the bar is
  // real progress rather than a guess.
  const field = await createField({
    count: pointBudget(),
    onProgress: (fraction) => progress(0.2 + fraction * 0.6),
  });
  scene.add(field.object);

  progress(0.82);
  await nextFrame();

  const postfx = createPostFX({ renderer, scene, camera });

  const sections = [...document.querySelectorAll('[data-scene]')];
  const rig = createRig({ camera, sections });
  rig.measure();

  const detections = createDetections({
    layer: document.getElementById('dets'),
    camera,
  });

  /* ── theme ───────────────────────────────────────────────────────── */

  function applyTheme() {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : darkQuery.matches;
    field.setTheme(dark);
    postfx.setTheme(dark);
  }

  applyTheme();
  darkQuery.addEventListener('change', applyTheme);

  /* ── adaptive quality ────────────────────────────────────────────── */

  const quality = createQuality({
    onTier(tierConfig, index) {
      stage.setDprCap(tierConfig.dprCap);
      postfx.setQuality(index);
    },
  });

  /* ── first frame, before anything is visible ─────────────────────── */

  // Compile shaders while the boot overlay is still up, so the reveal is not
  // the first thing to hitch. `renderer.init()` has already been awaited in
  // createStage, so the synchronous path is the supported one here.
  try {
    postfx.pipeline.render();
  } catch (error) {
    console.warn('[postfx] first frame failed:', error);
  }

  progress(0.96);
  await nextFrame();

  /* ── scroll ──────────────────────────────────────────────────────── */

  let lenis = null;

  if (!reduced.matches) {
    lenis = new Lenis({ duration: 1.05, lerp: 0.085, smoothWheel: true });
    // Lenis must advance before anything reads window.scrollY, so it is added
    // to the ticker first and the render callback is registered after it.
    gsap.ticker.add((time) => lenis.raf(time * 1000));
  }

  // Never let GSAP "catch up" after a stall — it produces a burst of oversized
  // deltas that read as a lurch.
  gsap.ticker.lagSmoothing(0);

  if (!reduced.matches) {
    window.addEventListener('pointermove', (event) => {
      rig.setPointer(
        (event.clientX / window.innerWidth) * 2 - 1,
        -((event.clientY / window.innerHeight) * 2 - 1),
      );
    }, { passive: true });
  }

  detections.setEnabled(!reduced.matches);

  // Re-measure once the fonts have settled and on resize — both change the
  // document height, and every anchor is a position in that height.
  document.fonts.ready.then(() => rig.measure());
  window.addEventListener('resize', () => rig.measure(), { passive: true });

  /* ── the loop ────────────────────────────────────────────────────── */

  let elapsed = 0;

  gsap.ticker.add((time, deltaMs) => {
    // Clamp so restoring a backgrounded tab does not integrate a two-second
    // step in one frame.
    const dt = Math.min(deltaMs / 1000, 1 / 20);
    elapsed += dt;

    const scrollY = lenis ? lenis.scroll : window.scrollY;
    const velocity = lenis ? lenis.velocity : 0;

    const state = rig.update(dt, scrollY, velocity);

    field.uniforms.scene.value = state.scene;
    field.uniforms.time.value = reduced.matches ? 0 : elapsed;
    field.uniforms.disperse.value = reduced.matches ? 0 : 1;

    // Aberration driven by scroll velocity: cheap, and it makes the whole frame
    // feel reactive rather than only the field.
    postfx.setAberration(0.25 + Math.min(Math.abs(velocity) * 0.03, 2.1));

    chrome.setProgress(state.progress);
    detections.update(state.scene);

    postfx.pipeline.render();

    quality.sample(dt);
  });

  finishBoot();

  // Start the copy animations as the overlay fades, not before it — otherwise
  // they play underneath it and the page arrives already finished.
  const reveals = await revealsPending;
  setTimeout(() => reveals.start(), 240);

  if (import.meta.env.DEV) {
    window.site = { stage, field, postfx, rig, quality, lenis };
    console.info(
      `[boot] ready · ${stage.isWebGPU ? 'WebGPU' : 'WebGL2'} · ${field.count} points · ` +
      `${Math.round(performance.now() - bootStarted)}ms`,
    );
  }
}

main().catch((error) => {
  console.error('[boot] failed:', error);
  document.body.classList.add('is-flat');
  finishBoot();
  // The copy must never be left invisible because the GPU path fell over.
  for (const el of document.querySelectorAll('[data-reveal]')) el.classList.add('is-in');
  for (const el of document.querySelectorAll('[data-split]')) el.style.visibility = '';
});
