import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(SplitText);

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Copy reveals.
 *
 * Headlines split into lines and rise out of their own mask; everything else
 * fades up. Both are one-shot and both wait until the element is actually in
 * view — a headline that plays its animation while three screens below the fold
 * has simply been thrown away.
 */
export async function createReveals() {
  const splits = [];

  if (reduced.matches) {
    for (const el of document.querySelectorAll('[data-reveal]')) el.classList.add('is-in');
    return { start() {}, dispose() {} };
  }

  /* ── fade-up blocks ────────────────────────────────────────────── */

  const fadeObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        fadeObserver.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
  );

  const fadeTargets = [...document.querySelectorAll('[data-reveal]')];

  /* ── split headlines ───────────────────────────────────────────── */

  const splitTargets = [...document.querySelectorAll('[data-split]')];

  // Hold the headlines back until they have been split and set to their start
  // position. Otherwise they render fully visible, then snap to hidden the
  // moment the font resolves, then animate in — a visible double take.
  for (const el of splitTargets) el.style.visibility = 'hidden';

  // Split only once the real font is in. Lines measured against fallback
  // metrics re-wrap the moment the webfont arrives, and the fixed line boxes
  // never reflow. Race a timeout so a stalled font load cannot hold the page.
  await Promise.race([
    document.fonts.ready,
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);

  const lineObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        const split = entry.target._split;
        lineObserver.unobserve(entry.target);
        if (!split) continue;

        gsap.to(split.lines, {
          yPercent: 0,
          duration: 1.05,
          ease: 'expo.out',
          stagger: 0.075,
          onComplete() {
            // Revert, or the fixed line boxes never reflow on resize.
            split.revert();
            entry.target._split = null;
          },
        });
      }
    },
    { threshold: 0.2 },
  );

  for (const el of splitTargets) {
    const split = new SplitText(el, { type: 'lines', linesClass: 'line__in' });

    // Wrap each line in its own overflow-hidden mask, so a line slides out from
    // behind its own edge rather than through its neighbour.
    for (const lineEl of split.lines) {
      const mask = document.createElement('span');
      mask.className = 'line';
      lineEl.parentNode.insertBefore(mask, lineEl);
      mask.appendChild(lineEl);
    }

    gsap.set(split.lines, { yPercent: 118 });
    el.style.visibility = '';

    el._split = split;
    splits.push(split);
    lineObserver.observe(el);
  }

  /**
   * Attach the observers.
   *
   * Deliberately not done at construction time. The boot overlay covers the
   * page while the GPU work finishes, and an observer attached underneath it
   * fires immediately for everything already in view — so by the time the
   * overlay lifts, the whole page has quietly finished animating and the user
   * sees a static page appear.
   */
  function start() {
    for (const el of fadeTargets) fadeObserver.observe(el);
    for (const el of splitTargets) if (el._split) lineObserver.observe(el);

    // Safety net. These elements start at opacity 0, so anything that stops the
    // observer from ever firing — a tab that never composites, an aggressive
    // privacy extension — would leave the page blank rather than merely
    // un-animated. Reveal whatever is still hidden after a few seconds.
    setTimeout(() => {
      for (const el of fadeTargets) el.classList.add('is-in');
      for (const el of splitTargets) {
        if (el._split) gsap.set(el._split.lines, { yPercent: 0 });
      }
    }, 4000);
  }

  function dispose() {
    fadeObserver.disconnect();
    lineObserver.disconnect();
    for (const split of splits) split.revert();
  }

  return { start, dispose };
}
