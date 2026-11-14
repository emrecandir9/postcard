import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server.js';
import { jpegWithExif } from './helpers.js';

let root;
let resultsDir;
const servers = [];
const calls = { panel: [], email: [], keywords: [] };
const behaviour = { panelThrows: false, emailEnabled: true, emailThrows: false, keywords: ['sea', 'cliffs', 'light'], gate: null };
const logs = [];

const deps = () => ({
  resultsDir,
  emailEnabled: () => behaviour.emailEnabled,
  log: (line) => logs.push(line),
  async generatePanel(orientation, photoPath, jobDir, opts = {}) {
    calls.panel.push({ orientation, opts });
    assert.ok(existsSync(photoPath), 'cropped photo is written for agy');
    if (behaviour.gate) await behaviour.gate;
    if (behaviour.panelThrows) throw new Error('agy timed out after 330 s. Try again.');
    const p = join(jobDir, 'fake-panel.png');
    await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#EAE0CA' } }).png().toFile(p);
    return { imagePath: p, keywords: opts.keywords ? behaviour.keywords : [] };
  },
  async suggestKeywords(photoPath) {
    calls.keywords.push(photoPath);
    assert.ok(existsSync(photoPath), 'cropped photo is written for agy');
    return ['harbour', 'sails', 'bridge'];
  },
  async scheduleEmail(args) {
    calls.email.push(args);
    if (behaviour.emailThrows) throw new Error('Email script rejected the postcard: bad secret');
  },
});

async function start(extra = {}) {
  const app = createApp({ ...deps(), ...extra });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  return `http://localhost:${server.address().port}`;
}

let base;
before(async () => {
  root = mkdtempSync(join(tmpdir(), 'postcard-server-test-'));
  resultsDir = join(root, 'results');
  base = await start();
});

after(() => {
  for (const s of servers) s.close();
  rmSync(root, { recursive: true, force: true });
});

const today = new Date().toLocaleDateString('en-CA');
const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA');
const plainPhoto = () => sharp({ create: { width: 1200, height: 900, channels: 3, background: '#336699' } }).jpeg().toBuffer();

async function post(fields, { photo, withPhoto = true, url = base } = {}) {
  const fd = new FormData();
  if (withPhoto) fd.append('photo', new Blob([photo ?? (await plainPhoto())], { type: 'image/jpeg' }), 'p.jpg');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${url}/api/postcards`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}

async function status(id, url = base) {
  const res = await fetch(`${url}/api/postcards/${id}`);
  return { status: res.status, body: await res.json() };
}

/** Poll until the job is no longer working. */
async function settle(id, url = base) {
  for (let i = 0; i < 200; i++) {
    const { body } = await status(id, url);
    if (body.status !== 'working') return body;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('job did not finish');
}

/** POST and wait for the finished job. */
async function make(fields, opts) {
  const { status: code, body } = await post(fields, opts);
  assert.equal(code, 202, JSON.stringify(body));
  return settle(body.id, opts?.url);
}

const valid = { location: 'Lisbon', keywords: '', month: 'May', year: '2027', delivery: 'download' };

test('GET /api/config reports emailEnabled', async () => {
  const res = await fetch(`${base}/api/config`);
  assert.deepEqual(await res.json(), { emailEnabled: true });
});

test('400 for missing photo, bad month, bad year, too many keywords, bad delivery or email fields', async () => {
  const cases = [
    [valid, { withPhoto: false }],
    [{ ...valid, location: 'x'.repeat(101) }],
    [{ ...valid, month: 'May.' }],
    [{ ...valid, year: '27' }],
    [{ ...valid, keywords: 'a, b, c, d' }],
    [{ ...valid, delivery: 'fax' }],
    [{ ...valid, delivery: 'email', email: 'not-an-email', sendDate: today }],
    [{ ...valid, delivery: 'email', email: 'me@example.com', sendDate: yesterday }],
    [{ ...valid, delivery: 'email', email: 'me@example.com', sendDate: '2027-02-30' }],
  ];
  const before = calls.panel.length;
  for (const [fields, opts] of cases) {
    const { status: code, body } = await post(fields, opts);
    assert.equal(code, 400, JSON.stringify(fields));
    assert.deepEqual(Object.keys(body), ['error']);
    assert.ok(body.error.length > 0);
  }
  assert.equal(calls.panel.length, before, 'no generation for invalid input');
});

test('400 for an unreadable photo file', async () => {
  const { status: code, body } = await post(valid, { photo: Buffer.from('not an image') });
  assert.equal(code, 400);
  assert.match(body.error, /photo/i);
});

test('202 {id} at once; stages run in order preparing → drawing → printing → finishing; done result shape', async () => {
  let open;
  behaviour.gate = new Promise((r) => (open = r));
  logs.length = 0;
  const { status: code, body } = await post(valid);
  assert.equal(code, 202);
  assert.deepEqual(Object.keys(body), ['id']);
  assert.match(body.id, /^[\w-]+$/);

  // While Gemini is "drawing", the status says so.
  let seen;
  for (let i = 0; i < 100; i++) {
    seen = (await status(body.id)).body;
    if (seen.stage === 'drawing') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(seen.status, 'working');
  assert.equal(seen.stage, 'drawing');
  assert.equal(seen.error, null);
  assert.equal(seen.result, null);
  assert.equal(typeof seen.elapsedMs, 'number');
  behaviour.gate = null;
  open();

  const done = await settle(body.id);
  assert.deepEqual(Object.keys(done).sort(), ['elapsedMs', 'error', 'id', 'result', 'stage', 'status']);
  assert.equal(done.status, 'done');
  assert.equal(done.stage, 'finishing');
  assert.equal(done.error, null);
  assert.deepEqual(done.result, {
    imageUrl: `/results/${body.id}.jpg`,
    width: 2048,
    height: 2048,
    orientation: 'horizontal',
    location: 'Lisbon',
    keywords: ['sea', 'cliffs', 'light'],
    month: 'May',
    year: '2027',
    scheduled: null,
    emailError: null,
  });

  // Stage order and per-stage times in the server log.
  const text = logs.filter((l) => l.includes(body.id.slice(0, 8))).join('\n');
  const order = ['preparing', 'drawing', 'printing', 'finishing'].map((s) => text.search(new RegExp(`${s} \\d+ ms`)));
  assert.ok(order.every((i) => i >= 0), text);
  assert.deepEqual([...order].sort((a, b) => a - b), order, text);
  assert.match(text, /done in \d+ ms/);

  const img = await fetch(`${base}${done.result.imageUrl}`);
  assert.equal(img.status, 200);
  const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 2048, 2048]);
});

test('keywords: typed ones are used and Gemini is not asked; blank ones are asked for in the same call', async () => {
  const done = await make({ ...valid, keywords: ' Tram, hills ,TILES' });
  assert.deepEqual(done.result.keywords, ['tram', 'hills', 'tiles']);
  assert.deepEqual(calls.panel.at(-1).opts, { keywords: false });
  const asked = await make(valid);
  assert.deepEqual(asked.result.keywords, ['sea', 'cliffs', 'light']);
  assert.deepEqual(calls.panel.at(-1).opts, { keywords: true });
});

test('keywords: no usable keywords in the reply → empty list, postcard still made', async () => {
  behaviour.keywords = [];
  const done = await make(valid);
  behaviour.keywords = ['sea', 'cliffs', 'light'];
  assert.equal(done.status, 'done');
  assert.deepEqual(done.result.keywords, []);
});

test('location, month and year: typed value → (if the field is absent) photo metadata → omitted', async () => {
  const exif = await jpegWithExif({ date: '2024:04:12 10:30:00', lat: 48.8584, lon: 2.2945 });
  const base3 = { keywords: 'a,b,c', delivery: 'download' };
  // Typed values win over metadata.
  const typed = await make({ ...base3, location: 'Lisbon', month: 'May', year: '2027' }, { photo: exif });
  assert.deepEqual([typed.result.location, typed.result.month, typed.result.year], ['Lisbon', 'May', '2027']);
  // Absent fields come from the metadata, each on its own.
  const fromMeta = await make(base3, { photo: exif });
  assert.deepEqual([fromMeta.result.location, fromMeta.result.month, fromMeta.result.year], ['Paris, France', 'Apr', '2024']);
  const mixed = await make({ ...base3, month: 'May' }, { photo: exif });
  assert.deepEqual([mixed.result.location, mixed.result.month, mixed.result.year], ['Paris, France', 'May', '2024']);
  // Present but empty: the user cleared it, so the line is left off even though the photo has metadata.
  const cleared = await make({ ...base3, location: '', month: '  ', year: '' }, { photo: exif });
  assert.equal(cleared.status, 'done');
  assert.deepEqual([cleared.result.location, cleared.result.month, cleared.result.year], [null, null, null]);
  const partly = await make({ ...base3, location: '' }, { photo: exif });
  assert.deepEqual([partly.result.location, partly.result.month, partly.result.year], [null, 'Apr', '2024']);
  // Absent and no metadata in the photo: omitted too.
  const none = await make(base3);
  assert.deepEqual([none.result.location, none.result.month, none.result.year], [null, null, null]);
});

test('email scheduled; email failure still gives the postcard with emailError', async () => {
  const done = await make({ ...valid, keywords: 'a,b,c', delivery: 'email', email: 'me@example.com', sendDate: today, message: 'Hi!' });
  assert.deepEqual(done.result.scheduled, { email: 'me@example.com', sendDate: today });
  assert.equal(done.result.emailError, null);
  const last = calls.email.at(-1);
  assert.equal(last.recipient, 'me@example.com');
  assert.equal(last.location, 'Lisbon');
  assert.equal(last.message, 'Hi!');
  assert.ok(Buffer.isBuffer(last.jpeg));

  behaviour.emailThrows = true;
  const failed = await make({ ...valid, keywords: 'a,b,c', delivery: 'email', email: 'me@example.com', sendDate: today });
  behaviour.emailThrows = false;
  assert.equal(failed.status, 'done');
  assert.equal(failed.result.scheduled, null);
  assert.match(failed.result.emailError, /bad secret/);
  assert.equal((await fetch(`${base}${failed.result.imageUrl}`)).status, 200);
});

test('400 when email is chosen but not configured', async () => {
  behaviour.emailEnabled = false;
  const { status: code, body } = await post({ ...valid, delivery: 'email', email: 'me@example.com', sendDate: today });
  behaviour.emailEnabled = true;
  assert.equal(code, 400);
  assert.match(body.error, /email/i);
});

test('generation failure → status "error" with a readable message', async () => {
  behaviour.panelThrows = true;
  const done = await make({ ...valid, keywords: 'a,b,c' });
  behaviour.panelThrows = false;
  assert.equal(done.status, 'error');
  assert.equal(done.stage, 'drawing');
  assert.match(done.error, /timed out/);
  assert.equal(done.result, null);
});

test('404 {error} for an unknown or malformed id', async () => {
  for (const id of ['00000000-0000-4000-8000-000000000000', 'nope', '..%2F..%2Fetc']) {
    const { status: code, body } = await status(id);
    assert.equal(code, 404, id);
    assert.equal(typeof body.error, 'string');
  }
});

test('a finished postcard is still readable after a restart', async () => {
  const done = await make({ ...valid, keywords: 'a,b,c' });
  assert.ok(existsSync(join(resultsDir, `${done.id}.json`)));
  const restarted = await start(); // fresh app, empty memory, same results folder
  const again = await status(done.id, restarted);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, done);
  assert.equal((await fetch(`${restarted}${done.result.imageUrl}`)).status, 200);
});

test('jobs run one at a time and old finished jobs are dropped from memory after the time limit', async () => {
  let now = Date.now();
  const url = await start({ now: () => now, resultsDir: join(root, 'results-ttl') });
  let open;
  behaviour.gate = new Promise((r) => (open = r));
  const a = (await post({ ...valid, keywords: 'a,b,c' }, { url })).body.id;
  const b = (await post({ ...valid, keywords: 'a,b,c' }, { url })).body.id;
  await new Promise((r) => setTimeout(r, 150));
  const before = calls.panel.length;
  assert.equal((await status(b, url)).body.stage, 'preparing', 'second job waits its turn');
  behaviour.gate = null;
  open();
  await settle(a, url);
  await settle(b, url);
  assert.ok(calls.panel.length >= before);

  // An error job (memory only) disappears after 24 h; a done job is still served from disk.
  behaviour.panelThrows = true;
  const failed = await make({ ...valid, keywords: 'a,b,c' }, { url });
  behaviour.panelThrows = false;
  assert.equal((await status(failed.id, url)).status, 200);
  now += 24 * 3_600_000 + 1;
  assert.equal((await status(failed.id, url)).status, 404);
  assert.equal((await status(a, url)).body.status, 'done');
});

test('POST /api/metadata: EXIF date and GPS → City, Country; nothing → all null; unreadable → all null', async () => {
  const send = async (buf) => {
    const fd = new FormData();
    fd.append('photo', new Blob([buf], { type: 'image/jpeg' }), 'p.jpg');
    const res = await fetch(`${base}/api/metadata`, { method: 'POST', body: fd });
    return { status: res.status, body: await res.json() };
  };
  const exif = await send(await jpegWithExif({ date: '2024:04:12 10:30:00', lat: 48.8584, lon: 2.2945 }));
  assert.deepEqual(exif, { status: 200, body: { location: 'Paris, France', month: 'Apr', year: '2024' } });
  const none = { location: null, month: null, year: null };
  assert.deepEqual(await send(await plainPhoto()), { status: 200, body: none });
  assert.deepEqual(await send(Buffer.from('garbage')), { status: 200, body: none });
  const noFile = await fetch(`${base}/api/metadata`, { method: 'POST', body: new FormData() });
  assert.equal(noFile.status, 400);
});

test('pages and static routes', async () => {
  for (const p of ['/', '/create', '/making', '/postcard']) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), /html/);
  }
  const font = await fetch(`${base}/fonts/SpecialElite-Regular.ttf`);
  assert.equal(font.status, 200);
  const layout = await fetch(`${base}/shared/layout.js`);
  assert.equal(layout.status, 200);
  assert.match(layout.headers.get('content-type'), /javascript/);
});

// ---------- Gemini app (manual) mode ----------

test('GET /api/brief: one prompt for the Gemini app that covers both photo shapes', async () => {
  const res = await fetch(`${base}/api/brief`);
  assert.equal(res.status, 200);
  const { prompt } = await res.json();
  assert.match(prompt, /attached photo/i);
  assert.match(prompt, /wider than it is tall[^\n]*16:7/);
  assert.match(prompt, /taller than it is wide, or square[^\n]*1:2/);
  assert.match(prompt, /PAPER AREA/);
});

async function postWithPanel(fields, panel) {
  const fd = new FormData();
  fd.append('photo', new Blob([await plainPhoto()], { type: 'image/jpeg' }), 'p.jpg');
  fd.append('panel', new Blob([panel], { type: 'image/png' }), 'stamp.png');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${base}/api/postcards`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}

test('an uploaded stamp panel is used as is: agy draws nothing and is asked only for blank keywords', async () => {
  const red = await sharp({ create: { width: 1600, height: 700, channels: 3, background: '#C03020' } }).png().toBuffer();
  const before = calls.panel.length;
  const kwBefore = calls.keywords.length;
  const { status: code, body } = await postWithPanel({ ...valid, keywords: '' }, red);
  assert.equal(code, 202, JSON.stringify(body));
  const done = await settle(body.id);
  assert.equal(done.status, 'done', done.error);
  assert.equal(calls.panel.length, before, 'agy not asked to draw');
  assert.equal(calls.keywords.length, kwBefore + 1, 'agy asked for keywords once');
  assert.deepEqual(done.result.keywords, ['harbour', 'sails', 'bridge']);
  // Bottom-left of the paper strip (away from the text) carries the uploaded panel's colour.
  const jpeg = await (await fetch(`${base}${done.result.imageUrl}`)).arrayBuffer();
  const { data, info } = await sharp(Buffer.from(jpeg)).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => data.slice((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3);
  const [r, g, b] = at(60, info.height - 60);
  assert.ok(r > 150 && g < 90 && b < 80, `expected red paper, got ${r},${g},${b}`);
});

test('typed keywords are printed with an uploaded panel; an unreadable panel is a 400', async () => {
  const paper = await sharp({ create: { width: 800, height: 1600, channels: 3, background: '#EAE0CA' } }).png().toBuffer();
  const kwBefore = calls.keywords.length;
  const ok = await postWithPanel({ ...valid, keywords: 'tram, hills, tiles' }, paper);
  assert.equal(ok.status, 202);
  assert.deepEqual((await settle(ok.body.id)).result.keywords, ['tram', 'hills', 'tiles']);
  assert.equal(calls.keywords.length, kwBefore, 'typed keywords: agy not asked');

  const before = calls.panel.length;
  const bad = await postWithPanel(valid, Buffer.from('not an image'));
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Gemini/);
  assert.equal(calls.panel.length, before);
});
