// Scroll reveals and pointer tilt, shared by every page (the plan's "Motion contract").
//   data-reveal               fades and slides in when it scrolls into view
//   data-reveal-delay="120"   optional delay in ms
//   data-tilt                 tilts gently toward the pointer with a soft lift (fine pointers only);
//                             it sets `transform`, so put it on an element that has no transform of its own
// Nothing is hidden until this module has run (the `motion-ready` class on <html>), and under
// prefers-reduced-motion everything is shown at once and nothing tilts.
// Elements added later are picked up automatically; initMotion(root) does it by hand.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const revealSeen = new WeakSet();
const tiltSeen = new WeakSet();
const root = document.documentElement;

const MAX_TILT_X = 6; // degrees, top/bottom
const MAX_TILT_Y = 8; // degrees, left/right

const observer =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('is-revealed');
            observer.unobserve(entry.target);
          }
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
      )
    : null;

function animated() {
  return !reduced.matches && observer !== null;
}

function setupReveal(el) {
  const delay = Number(el.dataset.revealDelay);
  if (delay > 0) el.style.setProperty('--reveal-delay', `${delay}ms`);
  if (animated()) observer.observe(el);
  else el.classList.add('is-revealed');
}

function setupTilt(el) {
  let frame = 0;
  let last = null;

  el.addEventListener('pointermove', (event) => {
    if (reduced.matches || !finePointer.matches || event.pointerType !== 'mouse') return;
    last = event;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const x = (last.clientX - box.left) / box.width - 0.5;
      const y = (last.clientY - box.top) / box.height - 0.5;
      el.style.setProperty('--tilt-x', `${(-y * 2 * MAX_TILT_X).toFixed(2)}deg`);
      el.style.setProperty('--tilt-y', `${(x * 2 * MAX_TILT_Y).toFixed(2)}deg`);
      el.classList.add('is-tilting');
    });
  });

  el.addEventListener('pointerleave', () => {
    cancelAnimationFrame(frame);
    frame = 0;
    el.classList.remove('is-tilting');
    el.style.removeProperty('--tilt-x');
    el.style.removeProperty('--tilt-y');
  });
}

function collect(node, selector) {
  if (!(node instanceof Element)) return [];
  const found = [...node.querySelectorAll(selector)];
  if (node.matches(selector)) found.unshift(node);
  return found;
}

/** Wires up every [data-reveal] and [data-tilt] inside `scope` (and `scope` itself). Safe to call twice. */
export function initMotion(scope = document.documentElement) {
  const start = scope === document ? document.documentElement : scope;
  for (const el of collect(start, '[data-reveal]')) {
    if (revealSeen.has(el)) continue;
    revealSeen.add(el);
    setupReveal(el);
  }
  for (const el of collect(start, '[data-tilt]')) {
    if (tiltSeen.has(el)) continue;
    tiltSeen.add(el);
    setupTilt(el);
  }
}

if (animated()) root.classList.add('motion-ready');

reduced.addEventListener('change', () => {
  if (!reduced.matches) return;
  // Switched to reduced motion: show everything now and stop hiding.
  root.classList.remove('motion-ready');
  document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-revealed'));
});

initMotion(document);

new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) initMotion(node);
  }
}).observe(root, { childList: true, subtree: true });
