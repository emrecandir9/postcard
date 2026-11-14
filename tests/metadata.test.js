import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMetadata, placeName } from '../lib/metadata.js';
import { blank, jpegWithExif } from './helpers.js';

test('readMetadata: EXIF date and GPS → "City, Country", month, year', async () => {
  const buf = await jpegWithExif({ date: '2024:04:12 10:30:00', lat: 48.8584, lon: 2.2945 });
  assert.deepEqual(await readMetadata(buf), { location: 'Paris, France', month: 'Apr', year: '2024' });
});

test('readMetadata: no metadata, or not an image → all null', async () => {
  const none = { location: null, month: null, year: null };
  assert.deepEqual(await readMetadata(await blank().jpeg().toBuffer()), none);
  assert.deepEqual(await readMetadata(await blank().png().toBuffer()), none);
  assert.deepEqual(await readMetadata(Buffer.from('not an image at all')), none);
  assert.deepEqual(await readMetadata(Buffer.alloc(0)), none);
});

test('readMetadata: date only, and a southern/western GPS position', async () => {
  assert.deepEqual(await readMetadata(await jpegWithExif({ date: '2019:12:31 23:59:59' })), { location: null, month: 'Dec', year: '2019' });
  const rio = await jpegWithExif({ lat: -22.9519, lon: -43.2105 }); // Christ the Redeemer
  assert.deepEqual(await readMetadata(rio), { location: 'Rio de Janeiro, Brazil', month: null, year: null });
});

test('placeName: nearest city, big cities claim their own area, full English country names', async () => {
  assert.equal(await placeName(35.0116, 135.7681), 'Kyoto, Japan');
  assert.equal(await placeName(40.6892, -74.0445), 'New York City, United States'); // Statue of Liberty
  assert.equal(await placeName(-33.8568, 151.2153), 'Sydney, Australia'); // Opera House
  assert.equal(await placeName(46.5586, 7.835), 'Lauterbrunnen, Switzerland'); // small town, nearest wins
  assert.equal(await placeName(33.3961, -118.4166), 'Avalon, United States'); // Catalina Island
  assert.equal(await placeName(0, 0), null); // unset GPS
  assert.equal(await placeName(-30, -140), null); // open Pacific: nothing within 100 km
  assert.equal(await placeName(Number.NaN, 2), null);
});
