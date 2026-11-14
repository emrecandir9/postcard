import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server.js';

let root;
let server;
let base;
const calls = { panel: 0, keywords: 0, email: [] };
const behaviour = { panelThrows: false, emailEnabled: true, emailThrows: false };

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'postcard-server-test-'));
  const app = createApp({
    resultsDir: join(root, 'results'),
    emailEnabled: () => behaviour.emailEnabled,
    async suggestKeywords() {
      calls.keywords++;
      return ['sea', 'cliffs', 'light'];
    },
    async generatePanel(orientation, photoPath, jobDir) {
      calls.panel++;
      assert.ok(existsSync(photoPath), 'cropped photo is written for agy');
      if (behaviour.panelThrows) throw new Error('agy timed out after 330 s. Try again.');
      const p = join(jobDir, 'fake-panel.png');
      await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#EAE0CA' } }).png().toFile(p);
      return p;
    },
    async scheduleEmail(args) {
      calls.email.push(args);
      if (behaviour.emailThrows) throw new Error('Email script rejected the postcard: bad secret');
    },
  });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

const today = new Date().toLocaleDateString('en-CA');
const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA');

async function photo() {
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: '#336699' } }).jpeg().toBuffer();
}

async function post(fields, { withPhoto = true } = {}) {
  const fd = new FormData();
  if (withPhoto) fd.append('photo', new Blob([await photo()], { type: 'image/jpeg' }), 'p.jpg');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${base}/api/postcards`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}

const valid = { location: 'Lisbon', keywords: '', month: 'May', year: '2027', delivery: 'download' };

test('GET /api/config reports emailEnabled', async () => {
  const res = await fetch(`${base}/api/config`);
  assert.deepEqual(await res.json(), { emailEnabled: true });
});

test('400 for missing photo, missing location, bad month, bad year, past sendDate, too many keywords', async () => {
  const cases = [
    [valid, { withPhoto: false }],
    [{ ...valid, location: '   ' }],
    [{ ...valid, month: 'May.' }],
    [{ ...valid, year: '27' }],
    [{ ...valid, keywords: 'a, b, c, d' }],
    [{ ...valid, delivery: 'fax' }],
    [{ ...valid, delivery: 'email', email: 'not-an-email', sendDate: today }],
    [{ ...valid, delivery: 'email', email: 'me@example.com', sendDate: yesterday }],
    [{ ...valid, delivery: 'email', email: 'me@example.com', sendDate: '2027-02-30' }],
  ];
  const before = calls.panel;
  for (const [fields, opts] of cases) {
    const { status, body } = await post(fields, opts);
    assert.equal(status, 400, JSON.stringify(fields));
    assert.equal(typeof body.error, 'string');
    assert.ok(body.error.length > 0);
  }
  assert.equal(calls.panel, before, 'no generation for invalid input');
});

test('400 for an unreadable photo file', async () => {
  const fd = new FormData();
  fd.append('photo', new Blob([Buffer.from('not an image')], { type: 'image/jpeg' }), 'p.jpg');
  for (const [k, v] of Object.entries(valid)) fd.append(k, v);
  const res = await fetch(`${base}/api/postcards`, { method: 'POST', body: fd });
  assert.equal(res.status, 400);
});

test('200: download, blank keywords are suggested, result is served', async () => {
  const { status, body } = await post(valid);
  assert.equal(status, 200);
  assert.match(body.id, /^[\w-]+$/);
  assert.equal(body.imageUrl, `/results/${body.id}.jpg`);
  assert.deepEqual(body.keywords, ['sea', 'cliffs', 'light']);
  assert.equal(body.scheduled, null);
  assert.equal(body.emailError, null);
  const img = await fetch(`${base}${body.imageUrl}`);
  assert.equal(img.status, 200);
  const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 2048, 2048]);
});

test('200: given keywords are used without asking Gemini', async () => {
  const before = calls.keywords;
  const { status, body } = await post({ ...valid, keywords: ' Tram, hills ,TILES' });
  assert.equal(status, 200);
  assert.deepEqual(body.keywords, ['tram', 'hills', 'tiles']);
  assert.equal(calls.keywords, before);
});

test('200: email scheduled', async () => {
  behaviour.emailThrows = false;
  const { status, body } = await post({ ...valid, keywords: 'a,b,c', delivery: 'email', email: 'me@example.com', sendDate: today, message: 'Hi!' });
  assert.equal(status, 200);
  assert.deepEqual(body.scheduled, { email: 'me@example.com', sendDate: today });
  assert.equal(body.emailError, null);
  const last = calls.email.at(-1);
  assert.equal(last.recipient, 'me@example.com');
  assert.equal(last.location, 'Lisbon');
  assert.equal(last.message, 'Hi!');
  assert.ok(Buffer.isBuffer(last.jpeg));
});

test('200 with emailError when the email script rejects (postcard still returned)', async () => {
  behaviour.emailThrows = true;
  const { status, body } = await post({ ...valid, keywords: 'a,b,c', delivery: 'email', email: 'me@example.com', sendDate: today });
  behaviour.emailThrows = false;
  assert.equal(status, 200);
  assert.equal(body.scheduled, null);
  assert.match(body.emailError, /bad secret/);
  assert.equal((await fetch(`${base}${body.imageUrl}`)).status, 200);
});

test('400 when email is chosen but not configured', async () => {
  behaviour.emailEnabled = false;
  const { status, body } = await post({ ...valid, delivery: 'email', email: 'me@example.com', sendDate: today });
  behaviour.emailEnabled = true;
  assert.equal(status, 400);
  assert.match(body.error, /email/i);
});

test('502 with a readable error when generation throws', async () => {
  behaviour.panelThrows = true;
  const { status, body } = await post({ ...valid, keywords: 'a,b,c' });
  behaviour.panelThrows = false;
  assert.equal(status, 502);
  assert.match(body.error, /timed out/);
});

test('static routes: font and shared module', async () => {
  const font = await fetch(`${base}/fonts/SpecialElite-Regular.ttf`);
  assert.equal(font.status, 200);
  const layout = await fetch(`${base}/shared/layout.js`);
  assert.equal(layout.status, 200);
  assert.match(layout.headers.get('content-type'), /javascript/);
});
