import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import opentype from 'opentype.js';
import { FONT_FAMILY, LAYOUTS, displayText, textLines } from '../shared/layout.js';
import { printText, FONT_PATH } from '../lib/text.js';

const PAPER = { r: 234, g: 224, b: 202 };

async function raw(buffer) {
  return sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

function pixel({ data, info }, x, y) {
  const i = (Math.round(y) * info.width + Math.round(x)) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

/** Darkest pixel (lowest r+g+b) inside a rectangle. */
function darkest(img, x0, y0, x1, y1) {
  let min = Infinity;
  for (let y = Math.round(y0); y < Math.round(y1); y++) {
    for (let x = Math.round(x0); x < Math.round(x1); x++) {
      const p = pixel(img, x, y);
      min = Math.min(min, p.r + p.g + p.b);
    }
  }
  return min;
}

test('bundled font file is Special Elite', () => {
  const b = readFileSync(FONT_PATH);
  const font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  assert.equal(font.names.fontFamily.en, FONT_FAMILY);
});

for (const orientation of ['horizontal', 'vertical']) {
  test(`printText (${orientation}): same size, ink on text lines, stamp zone untouched`, async () => {
    const { w, h } = LAYOUTS[orientation].paper;
    const panel = await sharp({ create: { width: w, height: h, channels: 3, background: PAPER } }).png().toBuffer();
    const strings = displayText({ location: 'Lisbon', keywords: ['tram', 'hills', 'tiles'], month: 'May', year: '2027' });
    const out = await printText(panel, orientation, strings);

    const meta = await sharp(out).metadata();
    assert.deepEqual({ width: meta.width, height: meta.height }, { width: w, height: h });

    const img = await raw(out);
    const paperSum = PAPER.r + PAPER.g + PAPER.b;
    for (const line of textLines(orientation, strings)) {
      const px = line.size * w;
      const cy = line.y * h;
      const cx = line.align === 'left' ? line.x * w + px : line.x * w;
      // Ink somewhere in a small box around the start/centre of the line.
      assert.ok(darkest(img, cx - px, cy - px / 2, cx + px, cy + px / 2) < paperSum - 150, `${line.key} has no ink`);
    }
    const z = LAYOUTS[orientation].stampZone;
    const centre = pixel(img, (z.x + z.w / 2) * w, (z.y + z.h / 2) * h);
    assert.deepEqual(centre, PAPER);
  });
}

test('printText accepts & < > in text (glyph paths, no markup)', async () => {
  const panel = await sharp({ create: { width: 960, height: 1920, channels: 3, background: PAPER } }).png().toBuffer();
  const out = await printText(panel, 'vertical', { location: 'ROCK & <ROLL>', keywords: '', date: '' });
  assert.equal((await sharp(out).metadata()).width, 960);
});
