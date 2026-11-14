// Landing page: the example-postcard wheel in the hero and the labelled postcard in "Anatomy".
import { LAYOUTS, FONT_FAMILY, displayText, textLines } from '/shared/layout.js';
import { mountPostcard } from './postcard.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const wide = window.matchMedia('(min-width: 900px)');

// Used when /img/examples/examples.json is missing. No `file`, so they stay CSS drawings.
const FALLBACK_EXAMPLES = [
  { orientation: 'horizontal', location: 'Big Sur, USA', keywords: ['salt', 'fog', 'cliffs'], date: 'OCT 2025' },
  { orientation: 'vertical', location: 'Lisbon, Portugal', keywords: ['tiles', 'trams', 'hills'], date: 'MAY 2026' },
  { orientation: 'horizontal', location: 'Dolomites, Italy', keywords: ['larch', 'scree', 'quiet'], date: 'SEP 2025' },
  { orientation: 'vertical', location: 'Kyoto, Japan', keywords: ['moss', 'lanterns', 'rain'], date: 'APR 2024' },
  { orientation: 'horizontal', location: 'Wadi Rum, Jordan', keywords: ['dunes', 'dusk', 'stars'], date: 'MAR 2025' },
  { orientation: 'vertical', location: 'Reykjavik, Iceland', keywords: ['harbour', 'wind', 'roofs'], date: 'JUL 2026' },
];

// Photo-area colours for the CSS drawings (see .pc[data-tone] in landing.css).
const TONES = ['sea', 'sand', 'sage', 'dusk', 'stone', 'sky'];

// A small two-ink "stamp" for the CSS drawings, so a placeholder card reads as a postcard.
const STAMP_SKETCH = `<svg class="stamp-sketch" viewBox="0 0 100 72" aria-hidden="true">
  <circle cx="71" cy="20" r="8" fill="#c0785c" opacity="0.7"/>
  <path d="M6 56 31 21l13 17 11-12 39 30z" fill="#8a9474" opacity="0.75"/>
  <path d="M6 56 31 21l13 17 11-12 39 30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M29 28l-6 9m10-5-8 12m27-11-6 9m10-5-8 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <path d="M10 63h20m8 0h30m8 0h14M18 68h16m10 0h26" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>`;

function orientationOf(entry) {
  return entry.orientation === 'horizontal' ? 'horizontal' : 'vertical';
}

function stringsOf(entry) {
  return displayText({
    location: entry.location || '',
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
    month: entry.date || '',
    year: '',
  });
}

async function loadExamples() {
  try {
    const res = await fetch('/img/examples/examples.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    const valid = Array.isArray(list) ? list.filter((e) => e && typeof e === 'object') : [];
    if (valid.length >= 3) return valid;
  } catch {
    // Missing or unreadable: fall through to the built-in placeholders.
  }
  return FALLBACK_EXAMPLES;
}

/** Six entries for the wheel: the ones not marked `anatomy` when there are enough of them. */
function wheelEntries(list) {
  const plain = list.filter((e) => e.anatomy !== true);
  return (plain.length >= 6 ? plain : list).slice(0, 6);
}

/** Resolves true once the image at `src` has loaded, false if it cannot. */
function imageLoads(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

/**
 * A postcard element for one example: the CSS drawing at once, swapped for the real image once it loads.
 * Returns the element; its aspect ratio comes from LAYOUTS.
 */
function examplePostcard(entry, index, className) {
  const orientation = orientationOf(entry);
  const { w, h } = LAYOUTS[orientation].out;
  const face = document.createElement('div');
  face.className = `example-pc ${className}`;
  face.dataset.orientation = orientation;
  face.style.aspectRatio = `${w} / ${h}`;

  const drawing = document.createElement('div');
  drawing.dataset.tone = TONES[index % TONES.length];
  const pc = mountPostcard(drawing);
  pc.setOrientation(orientation);
  pc.setText(stringsOf(entry));
  drawing.querySelector('.pc__stamp').innerHTML = STAMP_SKETCH;
  face.append(drawing);

  if (entry.file) {
    const img = new Image();
    img.className = 'example-pc__img';
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('load', () => {
      face.replaceChildren(img);
      face.classList.add('is-photo');
    });
    img.src = `/img/examples/${encodeURIComponent(entry.file)}`;
  }
  return face;
}

/* ---------- Hero wheel ----------
   The cards sit on a circle whose centre is to the right of the main card. The whole wheel is one
   number, `rot` (in cards). Each card gets the cosine and sine of its angle as --c and --s, and
   landing.css turns those into a 3D transform, scale, haze and stacking. Narrow screens swap the
   CSS constants for a flat, side-to-side arrangement. */

const TURN_MS = 650;
const AUTO_MS = 5000;
const HOVER_DWELL_MS = 140;

function setupWheel(wheel, entries) {
  const ring = wheel.querySelector('.wheel__ring');
  const caption = wheel.querySelector('.wheel__caption');
  const n = entries.length;
  const step = (Math.PI * 2) / n;

  const cards = entries.map((entry, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'wheel__card';
    card.dataset.orientation = orientationOf(entry);
    card.setAttribute('aria-roledescription', 'slide');
    card.setAttribute('aria-label', `${i + 1} of ${n}: postcard from ${entry.location || 'a trip'}`);
    const face = examplePostcard(entry, i, 'wheel__face');
    face.dataset.tilt = '';
    card.append(face);
    ring.append(card);
    return card;
  });

  let rot = 0; // where the wheel is drawn now
  let target = 0; // where it is heading
  let frame = 0;
  let userTookOver = false;
  let paused = false;
  let autoTimer = 0;
  let dwellTimer = 0;

  const mod = (i) => ((i % n) + n) % n;
  const mainIndex = () => mod(Math.round(target));

  function draw() {
    cards.forEach((card, i) => {
      const angle = (i - rot) * step;
      const c = Math.cos(angle);
      card.style.setProperty('--c', c.toFixed(4));
      card.style.setProperty('--s', Math.sin(angle).toFixed(4));
      card.style.zIndex = String(Math.round(100 + c * 50));
      card.classList.toggle('is-back', c < -0.75);
    });
  }

  function markMain() {
    const main = mainIndex();
    const entry = entries[main];
    cards.forEach((card, i) => {
      const isMain = i === main;
      card.classList.toggle('is-main', isMain);
      card.tabIndex = isMain ? 0 : -1;
      if (isMain) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    });
    caption.textContent = [entry.location, entry.date].filter(Boolean).join(' · ').toUpperCase();
  }

  const animating = () => frame !== 0;

  function turnTo(index, { byUser = false } = {}) {
    let delta = mod(index - mainIndex());
    if (delta > n / 2) delta -= n;
    if (byUser) stopAuto();
    if (!delta) return;

    const hadFocus = ring.contains(document.activeElement);
    target += delta;
    markMain();
    if (hadFocus) cards[mainIndex()].focus({ preventScroll: true });

    cancelAnimationFrame(frame);
    frame = 0;
    if (reducedMotion.matches) {
      rot = target;
      draw();
    } else {
      const from = rot;
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / TURN_MS);
        const eased = 1 - (1 - t) ** 3;
        rot = from + (target - from) * eased;
        draw();
        frame = t < 1 ? requestAnimationFrame(tick) : 0;
      };
      frame = requestAnimationFrame(tick);
    }
    scheduleAuto();
  }

  // Auto-advance: every few seconds, paused while the pointer or focus is on the wheel,
  // and off for good once someone turns it themselves. Never under reduced motion.
  function scheduleAuto() {
    clearTimeout(autoTimer);
    if (userTookOver || paused || reducedMotion.matches) return;
    autoTimer = setTimeout(() => {
      if (document.hidden || !inView) scheduleAuto();
      else turnTo(mainIndex() + 1);
    }, AUTO_MS);
  }
  function stopAuto() {
    userTookOver = true;
    clearTimeout(autoTimer);
    caption.setAttribute('aria-live', 'polite');
  }

  let inView = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
    }).observe(wheel);
  }

  wheel.addEventListener('pointerenter', () => {
    paused = true;
    clearTimeout(autoTimer);
  });
  wheel.addEventListener('pointerleave', () => {
    paused = false;
    scheduleAuto();
  });
  wheel.addEventListener('focusin', () => {
    paused = true;
    clearTimeout(autoTimer);
  });
  wheel.addEventListener('focusout', (e) => {
    if (wheel.contains(e.relatedTarget)) return;
    paused = false;
    scheduleAuto();
  });

  cards.forEach((card, i) => {
    // Hover: a short dwell so sweeping across the wheel does not spin it. Only real pointer
    // movement counts, so a card sliding under a still mouse never triggers another turn.
    card.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || i === mainIndex() || animating() || dwellTimer) return;
      if (card.classList.contains('is-back')) return;
      dwellTimer = setTimeout(() => {
        dwellTimer = 0;
        if (i !== mainIndex() && !animating()) turnTo(i, { byUser: true });
      }, HOVER_DWELL_MS);
    });
    card.addEventListener('pointerleave', () => {
      clearTimeout(dwellTimer);
      dwellTimer = 0;
    });
    // Tap or click (touch, pen, mouse) and keyboard activation.
    card.addEventListener('click', () => {
      if (performance.now() - swipedAt < 500) return;
      turnTo(i, { byUser: true });
    });
    card.addEventListener('focus', () => {
      if (i !== mainIndex()) turnTo(i, { byUser: true });
    });
  });

  wheel.addEventListener('keydown', (e) => {
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    if (!back && !forward) return;
    e.preventDefault();
    turnTo(mainIndex() + (forward ? 1 : -1), { byUser: true });
  });

  wheel.querySelectorAll('.wheel__nav').forEach((btn) => {
    btn.addEventListener('click', () => turnTo(mainIndex() + Number(btn.dataset.step), { byUser: true }));
  });

  // Swipe on touch screens.
  let swipeStart = null;
  let swipedAt = -Infinity; // the click that follows a swipe is ignored
  ring.addEventListener('pointerdown', (e) => {
    swipeStart = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY };
  });
  ring.addEventListener('pointerup', (e) => {
    if (!swipeStart) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    swipedAt = performance.now();
    turnTo(mainIndex() + (dx < 0 ? 1 : -1), { byUser: true });
  });
  ring.addEventListener('pointercancel', () => {
    swipeStart = null;
  });

  draw();
  markMain();
  wheel.classList.add('is-ready');
  scheduleAuto();
}

/* ---------- Anatomy ----------
   Every part's box, and the point on it where its leader line ends (its anchor), is worked out
   from LAYOUTS and textLines as fractions of the card, so the lines land on the right parts for
   either orientation. Nothing is drawn on the card itself except those thin lines. */

function anatomyParts(orientation, strings) {
  const L = LAYOUTS[orientation];
  const { w: W, h: H } = L.out;
  const P = L.paper;
  const Z = L.stampZone;
  const t = L.text;
  const fromPaper = (fx, fy) => ({ x: (P.x + fx * P.w) / W, y: (P.y + fy * P.h) / H });

  const photo = { x: L.photo.x / W, y: L.photo.y / H, w: L.photo.w / W, h: L.photo.h / H };
  const paper = { x: P.x / W, y: P.y / H, w: P.w / W, h: P.h / H };
  const stampTopLeft = fromPaper(Z.x, Z.y);
  const stamp = { ...stampTopLeft, w: (Z.w * P.w) / W, h: (Z.h * P.h) / H };

  const parts = {
    photo: { box: photo, anchor: { x: photo.x + photo.w * 0.18, y: photo.y + photo.h * 0.5 } },
    // An empty patch of paper: beside the stamp when the paper is below the photo, above it when beside.
    paper: {
      box: paper,
      anchor: orientation === 'horizontal' ? fromPaper(Z.x / 2, (Z.y + Z.h + 1) / 2) : fromPaper(0.5, Z.y / 2),
    },
    stamp: { box: stamp, anchor: null },
  };

  // The stamp's line ends at the corner of its zone that faces the stamp's label.
  const stampOnLeft = stamp.x + stamp.w / 2 <= 0.5;
  parts.stamp.anchor = { x: stampOnLeft ? stamp.x : stamp.x + stamp.w, y: stamp.y };

  // Text lines: the line ends just past the end of its own text line, so the three ends step
  // apart sideways even where the lines are close together.
  const blockLeft = t.align === 'center' ? t.x - t.maxWidth / 2 : t.x;
  const aspect = P.w / P.h;
  for (const line of textLines(orientation, strings)) {
    const bandH = line.size * aspect * 1.5; // one line's height as a fraction of the paper height
    const top = fromPaper(blockLeft, line.y - bandH / 2);
    const width = Math.min(textWidth(line.text, line.size), t.maxWidth);
    const end = line.align === 'center' ? line.x + width / 2 : line.x + width;
    parts[line.key] = {
      box: { x: top.x, y: top.y, w: (t.maxWidth * P.w) / W, h: (bandH * P.h) / H },
      anchor: { ...fromPaper(end, line.y), dx: TEXT_ANCHOR_GAP },
    };
  }
  return parts;
}

// Pixels between the end of a text line and the end of its leader line.
const TEXT_ANCHOR_GAP = 8;

/** Width of a printed line in the typewriter font, in the same units as `size` (paper widths). */
function textWidth(text, size) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `100px '${FONT_FAMILY}', 'Courier New', monospace`;
  return (ctx.measureText(text).width / 100) * size;
}

function svg(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function setupAnatomy(section, entry, index) {
  const figure = section.querySelector('.anatomy__figure');
  const cardBox = section.querySelector('.anatomy__card');
  const faceSlot = section.querySelector('.anatomy__face');
  const partsLayer = section.querySelector('.anatomy__parts');
  const leaders = section.querySelector('.anatomy__leaders');
  const labels = [...section.querySelectorAll('.anatomy__label')];
  const orientation = orientationOf(entry);
  const parts = anatomyParts(orientation, stringsOf(entry));
  const { w, h } = LAYOUTS[orientation].out;

  cardBox.dataset.orientation = orientation;
  cardBox.style.setProperty('--ratio', String(w / h));
  faceSlot.replaceChildren(examplePostcard(entry, index, 'anatomy__pc'));

  const pct = (n) => `${(n * 100).toFixed(3)}%`;
  const regions = {};
  labels.forEach((label) => {
    const key = label.dataset.part;
    const part = parts[key];
    if (!part) {
      label.hidden = true;
      return;
    }
    const region = document.createElement('div');
    region.className = 'anatomy__region';
    region.dataset.part = key;
    Object.assign(region.style, {
      left: pct(part.box.x),
      top: pct(part.box.y),
      width: pct(part.box.w),
      height: pct(part.box.h),
    });
    regions[key] = region;
    label.dataset.side = part.anchor.x <= 0.5 ? 'left' : 'right';
  });
  // Big parts first so the smaller ones on top of them get the pointer.
  partsLayer.replaceChildren(...Object.values(regions));

  // Linking: hovering or focusing a label lights its part, and hovering a part lights its label.
  let active = null;
  function paintActive() {
    figure.classList.toggle('has-active', Boolean(active));
    const linked = [...labels, ...Object.values(regions), ...leaders.children];
    for (const el of linked) el.classList.toggle('is-active', el.dataset.part === active);
  }
  function setActive(key) {
    if (key === active) return;
    active = key;
    paintActive();
  }
  for (const el of [...labels, ...Object.values(regions)]) {
    el.addEventListener('pointerenter', () => setActive(el.dataset.part));
    el.addEventListener('pointerleave', () => setActive(document.activeElement?.closest?.('.anatomy__label')?.dataset.part ?? null));
  }
  labels.forEach((label) => {
    label.addEventListener('focus', () => setActive(label.dataset.part));
    label.addEventListener('blur', () => setActive(null));
  });

  // Wide screens: labels in two columns beside the card, level with their parts, joined to them
  // by leader lines that end in a tiny dot. Narrow screens: a plain numbered list (CSS), no lines.
  function layoutLabels() {
    leaders.replaceChildren();
    if (!wide.matches) {
      labels.forEach((label) => label.removeAttribute('style'));
      return;
    }
    const fig = figure.getBoundingClientRect();
    const card = cardBox.getBoundingClientRect();
    const cardLeft = card.left - fig.left;
    const cardTop = card.top - fig.top;
    const gap = Math.max(48, Math.min(96, (fig.width - card.width) / 2 - 300));
    const columnWidth = Math.max(160, Math.min(300, (fig.width - card.width) / 2 - gap));
    leaders.setAttribute('viewBox', `0 0 ${fig.width} ${fig.height}`);

    for (const side of ['left', 'right']) {
      const group = labels
        .filter((l) => !l.hidden && l.dataset.side === side)
        .map((label) => {
          label.style.width = `${columnWidth}px`;
          const part = parts[label.dataset.part];
          return {
            label,
            key: label.dataset.part,
            mx: cardLeft + part.anchor.x * card.width + (part.anchor.dx || 0),
            my: cardTop + part.anchor.y * card.height,
            h: label.offsetHeight,
          };
        })
        .sort((a, b) => a.my - b.my);

      // Each label's first line level with its anchor, pushed apart where they would overlap.
      const firstLine = 13;
      let bottom = -Infinity;
      for (const item of group) {
        item.top = Math.max(item.my - firstLine, bottom + 16);
        bottom = item.top + item.h;
      }
      let limit = fig.height;
      for (const item of [...group].reverse()) {
        if (item.top + item.h > limit) item.top = limit - item.h;
        limit = item.top - 16;
      }

      for (const item of group) {
        const x = side === 'left' ? cardLeft - gap - columnWidth : cardLeft + card.width + gap;
        item.label.style.left = `${x}px`;
        item.label.style.top = `${item.top}px`;
        const edge = side === 'left' ? cardLeft - 16 : cardLeft + card.width + 16;
        const endX = side === 'left' ? x + columnWidth + 8 : x - 8;
        const endY = item.top + firstLine;
        const points = `${item.mx},${item.my} ${edge},${item.my} ${endX},${endY}`;
        // A faint light halo under each line keeps it visible where it crosses a dark photo.
        const halo = svg('polyline', { points, class: 'anatomy__halo' });
        const line = svg('polyline', { points, 'data-part': item.key });
        const dotHalo = svg('circle', { cx: item.mx, cy: item.my, r: 4, class: 'anatomy__halo' });
        const dot = svg('circle', { cx: item.mx, cy: item.my, r: 2.5, 'data-part': item.key });
        leaders.append(halo, dotHalo, line, dot);
      }
    }
    paintActive();
  }

  layoutLabels();
  new ResizeObserver(layoutLabels).observe(figure);
  wide.addEventListener('change', layoutLabels);
  document.fonts?.ready.then(layoutLabels);
}

const examples = await loadExamples();
const wheel = wheelEntries(examples);
setupWheel(document.getElementById('wheel'), wheel);

// Anatomy card: the entry marked `"anatomy": true` once its image has loaded; otherwise the first
// horizontal wheel example (drawn as a placeholder until, or unless, its own image loads).
const marked = examples.find((e) => e.anatomy === true && e.file);
const useMarked = marked ? await imageLoads(`/img/examples/${encodeURIComponent(marked.file)}`) : false;
const fallbackIndex = Math.max(
  0,
  wheel.findIndex((e) => orientationOf(e) === 'horizontal'),
);
// The leader lines are placed from the typewriter font's real letter widths.
await document.fonts.load(`100px '${FONT_FAMILY}'`).catch(() => {});
setupAnatomy(
  document.getElementById('anatomy'),
  useMarked ? marked : wheel[fallbackIndex],
  useMarked ? 0 : fallbackIndex,
);
