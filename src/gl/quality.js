/**
 * Adaptive quality.
 *
 * Watches rolling frame time and steps down. It never steps back up: recovering
 * mid-scroll shows as a resolution flicker that reads worse than the quality
 * it bought back.
 */
const TIERS = [
  { dprCap: 1.0, post: 0 },
  { dprCap: 1.5, post: 1 },
  { dprCap: 2.0, post: 1 },
];

export function createQuality({ onTier, startTier = TIERS.length - 1 } = {}) {
  let tier = startTier;
  let warmup = 40; // ignore the first frames — shader compilation lands there
  let frames = 0;
  let elapsed = 0;

  onTier?.(TIERS[tier], tier);

  function sample(dt) {
    if (tier === 0) return;

    if (warmup > 0) {
      warmup--;
      return;
    }

    frames++;
    elapsed += dt;

    if (frames < 70) return;

    const fps = frames / elapsed;
    frames = 0;
    elapsed = 0;

    if (fps < 46) {
      tier--;
      onTier?.(TIERS[tier], tier);
      warmup = 40; // let the new tier settle before judging it
    }
  }

  return { sample, get tier() { return tier; }, TIERS };
}
