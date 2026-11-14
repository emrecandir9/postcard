import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { preparePhoto, fitPanel, compose } from '../lib/pipeline.js';

const RED = { r: 200, g: 30, b: 30 };
const BLUE = { r: 30, g: 40, b: 200 };
const PANEL = { r: 120, g: 200, b: 90 };

function solid(width, height, colour) {
  return sharp({ create: { width, height, channels: 3, background: colour } });
}

/** Source photo: a band of BLUE at the top that a centred crop must remove, RED elsewhere. */
async function bandedPhoto(width, height, band) {
  return solid(width, height, RED)
    .composite([{ input: await solid(width, band, BLUE).png().toBuffer(), left: 0, top: 0 }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function pixel(buffer, x, y) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

function near(actual, expected, tol = 12) {
  for (const k of ['r', 'g', 'b']) {
    assert.ok(Math.abs(actual[k] - expected[k]) <= tol, `${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
  }
}

test('preparePhoto applies EXIF rotation before deciding orientation', async () => {
  // Stored 400x300 (landscape): left half red, right half blue. Orientation 6 = display rotated 90° clockwise,
  // so it displays as 300x400 (vertical) with red on top.
  const stored = await solid(400, 300, BLUE)
    .composite([{ input: await solid(200, 300, RED).png().toBuffer(), left: 0, top: 0 }])
    .jpeg({ quality: 95 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  assert.equal((await sharp(stored).metadata()).orientation, 6);

  const { orientation, scale, photo } = await preparePhoto(stored);
  assert.equal(orientation, 'vertical');
  assert.equal(scale, 600 / 1440); // scale is measured on the rotated width (300), not the stored 400
  const meta = await sharp(photo).metadata();
  assert.equal(meta.width / meta.height, 3 / 4);
  near(await pixel(photo, Math.floor(meta.width / 2), 5), RED);
  near(await pixel(photo, Math.floor(meta.width / 2), meta.height - 5), BLUE);
});

test('horizontal: wrong-ratio panel (16:9) gives an exact 2048x2048 result with untouched photo pixels', async () => {
  // 1600x1200 (4:3): the 16:9 crop removes 150 px top and bottom, so the 140 px blue band disappears.
  const src = await bandedPhoto(1600, 1200, 140);
  const { orientation, scale, photo } = await preparePhoto(src);
  assert.equal(orientation, 'horizontal');
  assert.equal(scale, 1);
  const panel = await fitPanel(await solid(1920, 1080, PANEL).png().toBuffer(), orientation, scale);
  assert.deepEqual(await dims(panel), { width: 2048, height: 896 });

  const out = await compose(photo, panel, orientation, scale);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.deepEqual({ width: meta.width, height: meta.height }, { width: 2048, height: 2048 });
  near(await pixel(out, 1024, 10), RED); // top of photo region: still red, band cropped away
  near(await pixel(out, 1024, 1100), RED);
  near(await pixel(out, 1024, 1300), PANEL);
});

test('vertical: wrong-ratio panel (1:1) gives an exact 2400x1920 result', async () => {
  const src = await solid(1500, 2000, RED).jpeg({ quality: 95 }).toBuffer();
  const { orientation, scale, photo } = await preparePhoto(src);
  assert.equal(orientation, 'vertical');
  assert.equal(scale, 1);
  const panel = await fitPanel(await solid(1024, 1024, PANEL).png().toBuffer(), orientation, scale);
  assert.deepEqual(await dims(panel), { width: 960, height: 1920 });

  const out = await compose(photo, panel, orientation, scale);
  assert.deepEqual(await dims(out), { width: 2400, height: 1920 });
  near(await pixel(out, 700, 960), RED);
  near(await pixel(out, 1430, 960), RED);
  near(await pixel(out, 1450, 960), PANEL);
});

test('small 800x600 source scales the whole result down to 1600x1600 (photo at most 2x)', async () => {
  const src = await solid(800, 600, RED).jpeg({ quality: 95 }).toBuffer();
  const { orientation, scale, photo } = await preparePhoto(src);
  assert.equal(orientation, 'horizontal');
  assert.equal(scale, 0.78125);
  assert.deepEqual(await dims(photo), { width: 1600, height: 900 });
  const panel = await fitPanel(await solid(1920, 1080, PANEL).png().toBuffer(), orientation, scale);
  assert.deepEqual(await dims(panel), { width: 1600, height: 700 });
  assert.deepEqual(await dims(await compose(photo, panel, orientation, scale)), { width: 1600, height: 1600 });
});

test('small vertical source keeps photo and paper adjacent with no gap', async () => {
  const src = await solid(333, 500, RED).jpeg({ quality: 95 }).toBuffer();
  const { orientation, scale, photo } = await preparePhoto(src);
  const panel = await fitPanel(await solid(500, 900, PANEL).png().toBuffer(), orientation, scale);
  const p = await dims(photo);
  const q = await dims(panel);
  const out = await dims(await compose(photo, panel, orientation, scale));
  assert.equal(p.width + q.width, out.width);
  assert.equal(p.height, out.height);
  assert.equal(q.height, out.height);
  assert.ok(Math.abs(out.width / out.height - 5 / 4) < 0.01);
});

async function dims(buffer) {
  const m = await sharp(buffer).metadata();
  return { width: m.width, height: m.height };
}

test('fitPanel trims a thin paper edge off every side of the panel', async () => {
  // A 1376x768 panel (what Gemini returns) with a dark 1% frame, like a visible paper edge.
  const w = 1376, h = 768, b = Math.round(w * 0.01);
  const frame = await sharp({ create: { width: w, height: h, channels: 3, background: '#3a342c' } })
    .composite([{ input: await solid(w - 2 * b, h - 2 * b, PANEL).png().toBuffer(), left: b, top: b }])
    .png().toBuffer();
  for (const orientation of ['horizontal', 'vertical']) {
    const out = sharp(await fitPanel(frame, orientation, 1));
    const { data, info } = await out.raw().toBuffer({ resolveWithObject: true });
    const darkest = Math.min(...[0, info.width - 1].flatMap((x) => [0, info.height >> 1, info.height - 1].map((y) => data[(y * info.width + x) * info.channels])));
    assert.ok(darkest > 100, `${orientation}: edge pixel still dark (${darkest})`);
  }
});
