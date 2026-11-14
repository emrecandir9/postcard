import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUTS, orientationOf, cropBox, outputScale, displayText, textLines } from '../shared/layout.js';

test('orientationOf: wider is horizontal, square and taller are vertical', () => {
  assert.equal(orientationOf(4000, 3000), 'horizontal');
  assert.equal(orientationOf(3000, 3000), 'vertical');
  assert.equal(orientationOf(3000, 4000), 'vertical');
});

test('cropBox: 4:3 to 16:9 trims top and bottom equally', () => {
  assert.deepEqual(cropBox(4000, 3000, 16 / 9), { left: 0, top: 375, width: 4000, height: 2250 });
});

test('cropBox: 21:9 to 16:9 trims left and right', () => {
  const b = cropBox(5040, 2160, 16 / 9);
  assert.equal(b.width, 3840);
  assert.equal(b.left, 600);
  assert.equal(b.height, 2160);
  assert.equal(b.top, 0);
});

test('cropBox: 3:4 to 3:4 is unchanged', () => {
  assert.deepEqual(cropBox(3000, 4000, 3 / 4), { left: 0, top: 0, width: 3000, height: 4000 });
});

test('cropBox: 9:16 to 3:4 trims top and bottom', () => {
  assert.deepEqual(cropBox(2160, 3840, 3 / 4), { left: 0, top: 480, width: 2160, height: 2880 });
});

test('cropBox: square to 3:4 trims left and right', () => {
  assert.deepEqual(cropBox(3000, 3000, 3 / 4), { left: 375, top: 0, width: 2250, height: 3000 });
});

test('outputScale: small crop scales down, large crop stays 1', () => {
  assert.equal(outputScale('horizontal', 800), 0.78125);
  assert.equal(outputScale('horizontal', 4000), 1);
  assert.equal(outputScale('vertical', 720), 1);
});

test('displayText: casing and " · " join, max three keywords', () => {
  const d = displayText({ location: '  Lisbon, Portugal ', keywords: [' Tram ', 'HILLS', '', 'tiles', 'extra'], month: 'May', year: '2027' });
  assert.equal(d.location, 'LISBON, PORTUGAL');
  assert.equal(d.keywords, 'tram · hills · tiles');
  assert.equal(d.date, 'MAY 2027');
});

test('displayText: empty fields give empty strings', () => {
  assert.deepEqual(displayText({}), { location: '', keywords: '', date: '' });
});

test('textLines: omits empty lines', () => {
  const lines = textLines('horizontal', { location: 'LISBON', keywords: '', date: 'MAY 2027' });
  assert.deepEqual(lines.map((l) => l.key), ['location', 'date']);
  for (const l of lines) {
    assert.equal(l.x, LAYOUTS.horizontal.text.x);
    assert.equal(l.align, 'left');
  }
});

test('textLines: a 60-character location shrinks below the base size', () => {
  const long = 'A'.repeat(60);
  for (const o of ['horizontal', 'vertical']) {
    const [loc] = textLines(o, { location: long, keywords: 'a · b · c', date: 'MAY 2027' });
    assert.ok(loc.size < LAYOUTS[o].text.locationSize, `${o}: ${loc.size}`);
    const [short] = textLines(o, { location: 'OSLO', keywords: '', date: '' });
    assert.equal(short.size, LAYOUTS[o].text.locationSize);
  }
});
