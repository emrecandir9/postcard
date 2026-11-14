// Single source of truth for postcard geometry and text placement.
// Imported by the server (Node) and by the browser preview, so both draw the same thing.
// All ratios are width:height. Fractions are relative to the paper panel unless noted.

export const PAPER_COLOR = '#EAE0CA';
export const INK_COLOR = '#3A342C';
export const INK_OPACITY = 0.85;
export const FONT_FAMILY = 'Special Elite';
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Average glyph width of the typewriter font as a fraction of font size (used to fit long text).
const GLYPH_WIDTH = 0.62;
const LINE_HEIGHT = 1.5;

export const LAYOUTS = {
  // Horizontal photo: 16:9 photo on top, 16:7 paper below, 1:1 result.
  horizontal: {
    photoRatio: 16 / 9,
    paperRatio: 16 / 7,
    out: { w: 2048, h: 2048 },
    photo: { x: 0, y: 0, w: 2048, h: 1152 },
    paper: { x: 0, y: 1152, w: 2048, h: 896 },
    stampZone: { x: 0.12, y: 0.15, w: 0.36, h: 0.7 },
    text: { align: 'left', x: 0.6, maxWidth: 0.34, anchor: 'middle', y: 0.5, locationSize: 0.036, smallSize: 0.022 },
  },
  // Vertical or square photo: 3:4 photo on the left, 1:2 paper on the right, 5:4 result.
  vertical: {
    photoRatio: 3 / 4,
    paperRatio: 1 / 2,
    out: { w: 2400, h: 1920 },
    photo: { x: 0, y: 0, w: 1440, h: 1920 },
    paper: { x: 1440, y: 0, w: 960, h: 1920 },
    stampZone: { x: 0.12, y: 0.3, w: 0.76, h: 0.42 },
    text: { align: 'center', x: 0.5, maxWidth: 0.8, anchor: 'top', y: 0.78, locationSize: 0.07, smallSize: 0.042 },
  },
};

/** 'horizontal' when strictly wider than tall, otherwise 'vertical' (square counts as vertical). */
export function orientationOf(width, height) {
  return width > height ? 'horizontal' : 'vertical';
}

/** Largest centred box of the given ratio inside width x height, in whole pixels. */
export function cropBox(width, height, ratio) {
  let w = width;
  let h = Math.round(width / ratio);
  if (h > height) {
    h = height;
    w = Math.round(height * ratio);
  }
  return { left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h };
}

/**
 * Output scale (0..1] so the photo is never enlarged more than 2x.
 * cropWidth is the width in pixels of the cropped source photo.
 */
export function outputScale(orientation, cropWidth) {
  return Math.min(1, (cropWidth * 2) / LAYOUTS[orientation].photo.w);
}

/** The three display strings, already cased. Empty fields give empty strings. */
export function displayText({ location = '', keywords = [], month = '', year = '' }) {
  return {
    location: location.trim().toUpperCase(),
    keywords: keywords.map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 3).join(' · '),
    date: `${month} ${year}`.trim().toUpperCase(),
  };
}

function fit(text, baseSize, maxWidth) {
  if (!text) return baseSize;
  return Math.min(baseSize, maxWidth / (GLYPH_WIDTH * text.length));
}

/**
 * Text lines for a paper panel.
 * strings: { location, keywords, date } as returned by displayText (or placeholder strings).
 * Returns [{ key, text, size, x, y, align }]:
 *   size and x are fractions of the paper WIDTH; y is the line's vertical centre as a
 *   fraction of the paper HEIGHT; align is 'left' or 'center' (x is the left edge or the centre).
 * Lines with empty text are omitted.
 */
export function textLines(orientation, strings) {
  const { paper, text: t } = LAYOUTS[orientation];
  const aspect = paper.w / paper.h; // converts a width-fraction into a height-fraction
  const lines = [
    { key: 'location', text: strings.location, size: fit(strings.location, t.locationSize, t.maxWidth) },
    { key: 'keywords', text: strings.keywords, size: fit(strings.keywords, t.smallSize, t.maxWidth) },
    { key: 'date', text: strings.date, size: fit(strings.date, t.smallSize, t.maxWidth) },
  ].filter((l) => l.text);

  const heights = lines.map((l) => l.size * LINE_HEIGHT * aspect);
  const total = heights.reduce((a, b) => a + b, 0);
  let cursor = t.anchor === 'middle' ? t.y - total / 2 : t.y;
  return lines.map((l, i) => {
    const y = cursor + heights[i] / 2;
    cursor += heights[i];
    return { ...l, x: t.x, y, align: t.align };
  });
}
