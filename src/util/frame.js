/**
 * Hand control back to the browser so it can actually paint.
 *
 * Without this, a sequence of synchronous stages updates the DOM several times
 * and the user sees only the last one — the loader appears frozen at its first
 * value and then the whole page arrives at once.
 *
 * Falls back to a timeout because `requestAnimationFrame` never fires in a
 * background tab, and boot must not depend on the tab being visible.
 */
export function nextFrame() {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(() => setTimeout(done, 0));
    setTimeout(done, 60);
  });
}
