/**
 * The small DOM behaviours: scrollspy, progress bar, email copy, footer facts.
 * Nothing here touches three.js.
 */
export function createChrome() {
  /* ── footer ───────────────────────────────────────────────────── */

  const year = document.getElementById('yr');
  if (year) year.textContent = String(new Date().getFullYear());

  const tech = document.getElementById('foot-tech');

  /** Called once the renderer has reported which backend it actually got. */
  function setBackend(name) {
    if (tech) tech.textContent = `${name} · three.js · no tracking`;
  }

  /* ── inline detection confidences ─────────────────────────────── */

  for (const el of document.querySelectorAll('.det')) {
    el.dataset.conf = (0.88 + Math.random() * 0.11).toFixed(2);
  }

  /* ── scrollspy ────────────────────────────────────────────────── */

  const links = new Map();
  for (const a of document.querySelectorAll('.nav__links a[data-nav]')) {
    links.set(a.dataset.nav, a);
  }

  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const a of links.values()) a.classList.remove('is-active');
        links.get(entry.target.id)?.classList.add('is-active');
      }
    },
    // A band across the middle of the viewport, so the active link changes when
    // a section is actually being read rather than when it first peeks in.
    { rootMargin: '-45% 0px -45% 0px' },
  );

  for (const id of links.keys()) {
    const section = document.getElementById(id);
    if (section) spy.observe(section);
  }

  /* ── progress bar ─────────────────────────────────────────────── */

  const progress = document.getElementById('nav-progress');

  function setProgress(value) {
    if (progress) progress.style.transform = `scaleX(${value.toFixed(4)})`;
  }

  /* ── email copy ───────────────────────────────────────────────── */

  const emailBtn = document.getElementById('email-btn');

  if (emailBtn) {
    const address = emailBtn.dataset.email;
    const labelEl = emailBtn.querySelector('.btn__label');
    let resetTimer = 0;

    emailBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(address);
        labelEl.textContent = 'copied to clipboard';
        emailBtn.classList.add('is-copied');

        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          labelEl.textContent = address;
          emailBtn.classList.remove('is-copied');
        }, 1800);
      } catch {
        // Clipboard is unavailable in insecure contexts and when permission is
        // refused — fall back to letting the mail client handle it.
        location.href = `mailto:${address}`;
      }
    });
  }

  return { setProgress, setBackend };
}
