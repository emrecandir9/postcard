import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { options, findNewestImage, parseKeywords, generatePanel, suggestKeywords } from '../lib/agy.js';

let root;
before(() => {
  root = mkdtempSync(join(tmpdir(), 'postcard-agy-test-'));
  options.pollIntervalMs = 50;
  options.pollTimeoutMs = 2000;
});
after(() => rmSync(root, { recursive: true, force: true }));

function fakeBin(name, script) {
  const p = join(root, name);
  writeFileSync(p, `#!/bin/sh\n${script}\n`);
  chmodSync(p, 0o755);
  return p;
}

test('findNewestImage: newest image newer than the marker, searched recursively', () => {
  const brain = join(root, 'brain1');
  mkdirSync(join(brain, 'conv-a'), { recursive: true });
  mkdirSync(join(brain, 'conv-b', 'deep'), { recursive: true });
  const since = Date.now();
  const old = join(brain, 'conv-a', 'old.png');
  writeFileSync(old, 'x');
  utimesSync(old, new Date(since - 60000), new Date(since - 60000));
  const a = join(brain, 'conv-a', 'new.jpg');
  const b = join(brain, 'conv-b', 'deep', 'newer.webp');
  const txt = join(brain, 'conv-b', 'notes.md');
  writeFileSync(a, 'x');
  writeFileSync(b, 'x');
  writeFileSync(txt, 'x');
  utimesSync(a, new Date(since + 1000), new Date(since + 1000));
  utimesSync(b, new Date(since + 2000), new Date(since + 2000));
  utimesSync(txt, new Date(since + 3000), new Date(since + 3000));
  assert.equal(findNewestImage(brain, since), b);
  assert.equal(findNewestImage(brain, since + 5000), null);

  // agy's copies of viewed images (e.g. the reference photo) live in hidden folders and never count.
  const media = join(brain, 'conv-b', '.system_generated', 'logs', 'media');
  mkdirSync(media, { recursive: true });
  const copy = join(media, 'step_2_media_0.jpg');
  writeFileSync(copy, 'x');
  utimesSync(copy, new Date(since + 9000), new Date(since + 9000));
  assert.equal(findNewestImage(brain, since), b);
  assert.equal(findNewestImage(brain, since + 5000), null);
  assert.equal(findNewestImage(join(root, 'missing'), since), null);
});

test('parseKeywords: first JSON array of three strings, lowercased', () => {
  assert.deepEqual(parseKeywords('["Tram", "hills", "tiles"]'), ['tram', 'hills', 'tiles']);
  assert.deepEqual(parseKeywords('Sure! Here you go:\n```json\n[ "harbor", "Boats", "dusk" ]\n```\n'), ['harbor', 'boats', 'dusk']);
  assert.deepEqual(parseKeywords('Looked at [the photo]. ["a","b"] then ["sea","cliffs","lighthouse"]'), ['sea', 'cliffs', 'lighthouse']);
  assert.throws(() => parseKeywords('no keywords here'), /keywords/i);
  assert.throws(() => parseKeywords('["one", "two"]'), /keywords/i);
  assert.throws(() => parseKeywords('[1, 2, 3]'), /keywords/i);
});

test('generatePanel: finds the image that appears after agy has already exited', async () => {
  const brain = join(root, 'brain2');
  mkdirSync(brain);
  const job = join(root, 'job2');
  mkdirSync(job);
  options.brainDir = brain;
  options.bin = fakeBin('agy-late', `mkdir -p "${brain}/conv"; (sleep 0.3; printf x > "${brain}/conv/panel.jpg") & echo "generating"; exit 0`);
  const path = await generatePanel('horizontal', join(job, 'photo.jpg'), job);
  assert.equal(path, join(brain, 'conv', 'panel.jpg'));
});

test('generatePanel: passes the prompt and flags with stdin closed', async () => {
  const brain = join(root, 'brain3');
  mkdirSync(brain);
  const job = join(root, 'job3');
  mkdirSync(job);
  options.brainDir = brain;
  const argsFile = join(root, 'args3.txt');
  options.bin = fakeBin('agy-args', `for a in "$@"; do echo "$a" >> "${argsFile}"; done; cat > "${root}/stdin3.txt"; printf x > "${brain}/p.png"`);
  await generatePanel('vertical', '/abs/photo.jpg', job);
  const { readFileSync } = await import('node:fs');
  const args = readFileSync(argsFile, 'utf8');
  assert.match(args, /^-p$/m);
  assert.match(args, /\/abs\/photo\.jpg/);
  assert.match(args, /^--mode\naccept-edits$/m);
  assert.match(args, /^--print-timeout\n300s$/m);
  assert.match(args, new RegExp(`^--add-dir\\n${job}$`, 'm'));
  assert.equal(readFileSync(join(root, 'stdin3.txt'), 'utf8'), '');
});

test('generatePanel: no image appears → readable error', async () => {
  const brain = join(root, 'brain4');
  mkdirSync(brain);
  const job = join(root, 'job4');
  mkdirSync(job);
  options.brainDir = brain;
  options.pollTimeoutMs = 300;
  options.bin = fakeBin('agy-noimage', 'echo "I could not do that"; exit 0');
  await assert.rejects(generatePanel('horizontal', '/abs/photo.jpg', job), /no image/i);
  options.pollTimeoutMs = 2000;
});

test('generatePanel: agy failure and quota messages are readable', async () => {
  const job = join(root, 'job5');
  mkdirSync(job);
  options.bin = fakeBin('agy-fail', 'echo "boom: something broke" >&2; exit 3');
  await assert.rejects(generatePanel('horizontal', '/abs/photo.jpg', job), /agy failed.*something broke/is);
  options.bin = fakeBin('agy-quota', 'echo "Error: RESOURCE_EXHAUSTED: quota exceeded" >&2; exit 1');
  await assert.rejects(generatePanel('horizontal', '/abs/photo.jpg', job), /quota/i);
  options.bin = join(root, 'does-not-exist');
  await assert.rejects(generatePanel('horizontal', '/abs/photo.jpg', job), /agy/i);
});

test('generatePanel: timeout kills agy with a readable error', async () => {
  const job = join(root, 'job6');
  mkdirSync(job);
  options.runTimeoutMs = 300;
  options.bin = fakeBin('agy-slow', 'sleep 5');
  await assert.rejects(generatePanel('horizontal', '/abs/photo.jpg', job), /timed out/i);
  options.runTimeoutMs = 330000;
});

test('suggestKeywords: parses canned agy output', async () => {
  const job = join(root, 'job7');
  mkdirSync(job);
  options.bin = fakeBin('agy-kw', 'echo "Here are three keywords:"; echo \'["Harbor","boats","dusk"]\'');
  assert.deepEqual(await suggestKeywords('/abs/photo.jpg', 'Porto', job), ['harbor', 'boats', 'dusk']);
  options.bin = fakeBin('agy-kw-bad', 'echo "I cannot see an image"');
  await assert.rejects(suggestKeywords('/abs/photo.jpg', 'Porto', job), /keywords/i);
});

test('jobs run one at a time', async () => {
  const brain = join(root, 'brain8');
  mkdirSync(brain);
  const job = join(root, 'job8');
  mkdirSync(job);
  options.brainDir = brain;
  const log = join(root, 'log8.txt');
  options.bin = fakeBin('agy-serial', `echo start >> "${log}"; sleep 0.2; echo end >> "${log}"; printf x > "${brain}/$$.png"`);
  await Promise.all([
    generatePanel('horizontal', '/a.jpg', job),
    generatePanel('horizontal', '/b.jpg', job),
  ]);
  const { readFileSync } = await import('node:fs');
  assert.equal(readFileSync(log, 'utf8'), 'start\nend\nstart\nend\n');
});
