/**
 * Adaptive quality.
 *
 * Watches rolling frame time and steps down. It never steps back up: recovering
 * mid-scroll shows as a resolution flicker that reads worse than the quality it
 * buys back.
 *
 * Because a downgrade is permanent, the evidence for it has to be good. A tab
 * that was backgrounded, a garbage collection pause, a throttled preview pane —
 * all produce frames measured in whole seconds, and a naive mean over a window
 * containing one of those concludes the machine is incapable and drops quality
 * on a scene that was otherwise running at 90 fps. So: discard stall frames
 * rather than averaging them in, and require two consecutive bad windows.
 */
const TIERS = [
  { dprCap: 1.0, post: 0 },
  { dprCap: 1.5, post: 1 },
  { dprCap: 2.0, post: 1 },
];

/** Anything slower than this is a stall, not rendering load. */
const STALL_SECONDS = 0.1;
const TARGET_FPS = 46;
const WINDOW_FRAMES = 70;

export function createQuality({ onTier, startTier = TIERS.length - 1 } = {}) {
  let tier = startTier;
  let warmup = 40; // ignore the first frames — shader compilation lands there
  let frames = 0;
  let elapsed = 0;
  let strikes = 0;

  onTier?.(TIERS[tier], tier);

  function sample(dt) {
    if (tier === 0) return;

    // A hidden tab is not evidence of anything.
    if (document.hidden) return;

    if (dt > STALL_SECONDS) {
      // Discard the whole window: it contains a stall, so its mean is
      // meaningless either way.
      frames = 0;
      elapsed = 0;
      return;
    }

    if (warmup > 0) {
      warmup--;
      return;
    }

    frames++;
    elapsed += dt;

    if (frames < WINDOW_FRAMES) return;

    const fps = frames / elapsed;
    frames = 0;
    elapsed = 0;

    if (fps < TARGET_FPS) {
      strikes++;
      if (strikes >= 2) {
        tier--;
        strikes = 0;
        onTier?.(TIERS[tier], tier);
        warmup = 40; // let the new tier settle before judging it
      }
    } else {
      strikes = 0;
    }
  }

  return { sample, get tier() { return tier; }, TIERS };
}
