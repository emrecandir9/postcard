// Draws a postcard in the page with HTML and CSS, using the same geometry the server uses.
// Every position, ratio, colour and font size comes from /shared/layout.js.
import { LAYOUTS, PAPER_COLOR, INK_COLOR, INK_OPACITY, FONT_FAMILY, textLines } from '/shared/layout.js';

export const PLACEHOLDERS = { location: 'LOCATION', keywords: 'word · word · word', date: 'MON YEAR' };

const pct = (n) => `${n * 100}%`;

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

/** "1:1" or "5:4": the result's proportions for an orientation. */
export function ratioLabel(orientation) {
  const { w, h } = LAYOUTS[orientation].out;
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

function make(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  return el;
}

function place(el, box, frame) {
  el.style.left = pct(box.x / frame.w);
  el.style.top = pct(box.y / frame.h);
  el.style.width = pct(box.w / frame.w);
  el.style.height = pct(box.h / frame.h);
}

/**
 * Turns `root` into a postcard drawing.
 * options.photoLabel: text on the empty photo area; options.stampLabel: text in the dashed stamp box;
 * options.placeholders: show grey placeholder text for empty fields.
 */
export function mountPostcard(root, { photoLabel = '', stampLabel = '', placeholders = false } = {}) {
  root.classList.add('pc');
  root.style.setProperty('--pc-paper', PAPER_COLOR);
  root.style.setProperty('--pc-ink', INK_COLOR);
  root.style.setProperty('--pc-ink-opacity', String(INK_OPACITY));
  root.style.setProperty('--pc-font', `'${FONT_FAMILY}', 'Courier New', monospace`);

  const photo = make('div', 'pc__photo');
  const photoText = make('span', 'pc__photo-label', photoLabel);
  const img = make('img', 'pc__img');
  img.alt = '';
  img.hidden = true;
  photo.append(photoText, img);

  const paper = make('div', 'pc__paper');
  const stamp = make('div', 'pc__stamp');
  if (stampLabel) stamp.append(make('span', 'pc__stamp-label', stampLabel));
  paper.append(stamp);

  root.replaceChildren(photo, paper);

  let orientation = null;
  let strings = { location: '', keywords: '', date: '' };

  function drawText() {
    if (!orientation) return;
    paper.querySelectorAll('.pc__line').forEach((el) => el.remove());
    const shown = { ...strings };
    const empty = new Set();
    if (placeholders) {
      for (const key of Object.keys(PLACEHOLDERS)) {
        if (!shown[key]) {
          shown[key] = PLACEHOLDERS[key];
          empty.add(key);
        }
      }
    }
    for (const line of textLines(orientation, shown)) {
      const el = make('p', `pc__line pc__line--${line.key}`, line.text);
      if (empty.has(line.key)) el.classList.add('pc__line--placeholder');
      el.style.setProperty('--size', String(line.size));
      el.style.left = pct(line.x);
      el.style.top = pct(line.y);
      el.dataset.align = line.align;
      paper.append(el);
    }
  }

  return {
    get orientation() {
      return orientation;
    },
    setOrientation(next) {
      if (next === orientation) return;
      orientation = next;
      const L = LAYOUTS[next];
      root.dataset.orientation = next;
      root.style.aspectRatio = `${L.out.w} / ${L.out.h}`;
      root.style.setProperty('--pc-ratio', String(L.out.w / L.out.h));
      root.style.setProperty('--pc-label-size', String(L.text.smallSize));
      place(photo, L.photo, L.out);
      place(paper, L.paper, L.out);
      place(stamp, L.stampZone, { w: 1, h: 1 });
      drawText();
    },
    /** src: an image URL, or null to show the empty photo area. */
    setPhoto(src) {
      if (src) img.src = src;
      else img.removeAttribute('src');
      img.hidden = !src;
      photoText.hidden = Boolean(src);
    },
    /** next: { location, keywords, date } as returned by displayText(). */
    setText(next) {
      strings = { ...strings, ...next };
      drawText();
    },
  };
}
