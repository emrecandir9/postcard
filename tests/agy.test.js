import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { options, findNewestImage, parseKeywords, generatePanel, quotaError } from '../lib/agy.js';

let root;
const logged = [];
before(() => {
  root = mkdtempSync(join(tmpdir(), 'postcard-agy-test-'));
  options.pollIntervalMs = 50;
  options.pollTimeoutMs = 2000;
  options.keywordGraceMs = 1_000;
  options.quotaGraceMs = 100;
  options.noImageGraceMs = 300;
  options.log = (line) => logged.push(line);
});
after(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
/** A fresh brain dir, job dir and fake agy script. */
function setup(script) {
  n++;
  const brain = join(root, `brain${n}`);
  const job = join(root, `job${n}`);
  mkdirSync(brain);
  mkdirSync(job);
  options.brainDir = brain;
  const bin = join(root, `agy${n}`);
  writeFileSync(bin, `#!/bin/sh\nBRAIN="${brain}"\nJOB="${job}"\n${script}\n`);
  chmodSync(bin, 0o755);
  options.bin = bin;
  return { brain, job };
}

test('findNewestImage: newest image newer than the marker, searched recursively', () => {
  const brain = join(root, 'brain-find');
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

test('parseKeywords: the last JSON array of three strings in the reply, lowercased', () => {
  assert.deepEqual(parseKeywords('["Tram", "hills", "tiles"]'), ['tram', 'hills', 'tiles']);
  assert.deepEqual(parseKeywords('Sure! Here you go:\n```json\n[ "harbor", "Boats", "dusk" ]\n```\n'), ['harbor', 'boats', 'dusk']);
  assert.deepEqual(parseKeywords('Looked at [the photo]. ["a","b"] then ["sea","cliffs","lighthouse"]'), ['sea', 'cliffs', 'lighthouse']);
  // A combined reply: image path (as a markdown link) first, keywords last.
  const reply = 'Done: [panel.jpg](file:///Users/x/.gemini/antigravity-cli/brain/c1/panel_1794.jpg)\n["Island", "cliffs", "sea"]\n';
  assert.deepEqual(parseKeywords(reply), ['island', 'cliffs', 'sea']);
  // The prompt's own example must not win over the real answer that ends the reply.
  assert.deepEqual(parseKeywords('Format: ["tram","hills","tiles"]\nMine: ["dunes","camels","dusk"]'), ['dunes', 'camels', 'dusk']);
});

test('parseKeywords: no usable JSON → empty list (the keywords line is then left out)', () => {
  assert.deepEqual(parseKeywords('no keywords here'), []);
  assert.deepEqual(parseKeywords('["one", "two"]'), []);
  assert.deepEqual(parseKeywords('[1, 2, 3]'), []);
  assert.deepEqual(parseKeywords('["a", "", "c"]'), []);
  assert.deepEqual(parseKeywords(''), []);
});

test('generatePanel: one agy call returns both the image and the keywords from its reply', async () => {
  const { brain, job } = setup(`echo x >> "${root}/calls-combined"
mkdir -p "$BRAIN/conv"; printf img > "$BRAIN/conv/panel.jpg"
echo "Here is the panel: $BRAIN/conv/panel.jpg"; echo '["Harbor","boats","dusk"]'`);
  const out = await generatePanel('horizontal', join(job, 'photo.jpg'), job, { keywords: true });
  assert.deepEqual(out, { imagePath: join(brain, 'conv', 'panel.jpg'), keywords: ['harbor', 'boats', 'dusk'] });
  assert.equal(readFileSync(join(root, 'calls-combined'), 'utf8'), 'x\n', 'exactly one agy call');
});

test('generatePanel: a reply without usable keywords still gives the image, without a second agy call', async () => {
  const { brain, job } = setup(`echo x >> "${root}/calls-nokw"
printf img > "$BRAIN/p.png"; echo "I made the image but forgot the words."`);
  const out = await generatePanel('vertical', join(job, 'photo.jpg'), job, { keywords: true });
  assert.deepEqual(out, { imagePath: join(brain, 'p.png'), keywords: [] });
  assert.equal(readFileSync(join(root, 'calls-nokw'), 'utf8'), 'x\n');
});

test('generatePanel: prompt, brief file and flags; keywords are only asked for when wanted', async () => {
  const argsFile = join(root, 'args.txt');
  const { job } = setup(`for a in "$@"; do echo "$a" >> "${argsFile}"; done; echo ---- >> "${argsFile}"
cat > "${root}/stdin.txt"; printf x > "$BRAIN/p-$$.png"`);
  await generatePanel('vertical', '/abs/photo.jpg', job, { keywords: true });
  await generatePanel('vertical', '/abs/photo.jpg', job, { keywords: false });
  const [withKw, withoutKw] = readFileSync(argsFile, 'utf8').split('----\n');
  for (const args of [withKw, withoutKw]) {
    assert.match(args, /^-p$/m);
    assert.match(args, /\/abs\/photo\.jpg/);
    assert.match(args, /^--mode\naccept-edits$/m);
    assert.match(args, /^--print-timeout\n300s$/m);
    assert.match(args, new RegExp(`^--add-dir\\n${job}$`, 'm'));
  }
  assert.match(withKw, /JSON array/);
  assert.doesNotMatch(withoutKw, /JSON array/);
  // The long description lives in a file in the job folder that the prompt points to.
  const brief = join(job, 'brief.md');
  assert.ok(existsSync(brief));
  assert.ok(withKw.includes(brief));
  assert.match(readFileSync(brief, 'utf8'), /STAMP RENDERING/);
  assert.match(readFileSync(brief, 'utf8'), /aspect ratio 1:2/);
  assert.equal(readFileSync(join(root, 'stdin.txt'), 'utf8'), '');
});

test('generatePanel: optional --model, --effort and --agent flags', async () => {
  const argsFile = join(root, 'args-flags.txt');
  const { job } = setup(`for a in "$@"; do echo "$a" >> "${argsFile}"; done; printf x > "$BRAIN/p.png"`);
  Object.assign(options, { model: 'gemini-4-argon-high', effort: 'low', agent: 'some-agent' });
  try {
    await generatePanel('horizontal', '/abs/photo.jpg', job);
  } finally {
    Object.assign(options, { model: '', effort: '', agent: '' });
  }
  const args = readFileSync(argsFile, 'utf8');
  assert.match(args, /^--model\ngemini-4-argon-high$/m);
  assert.match(args, /^--effort\nlow$/m);
  assert.match(args, /^--agent\nsome-agent$/m);
});

test('generatePanel: finds the image that appears after agy has already exited', async () => {
  // The reply names the file, so it is worth polling for it after agy exits.
  const { brain, job } = setup(`mkdir -p "$BRAIN/conv"; (sleep 0.6; printf x > "$BRAIN/conv/panel.jpg") & echo "Saved $BRAIN/conv/panel.jpg"; exit 0`);
  const out = await generatePanel('horizontal', join(job, 'photo.jpg'), job);
  assert.equal(out.imagePath, join(brain, 'conv', 'panel.jpg'));
});

test('generatePanel: takes the first image and stops agy so it cannot draw a second one', async () => {
  const { brain, job } = setup(`echo '["a","b","c"]'; printf img > "$BRAIN/first.jpg"; sleep 2; printf v2 > "$BRAIN/second.jpg"; echo late > "${root}/late.txt"`);
  const t0 = Date.now();
  const out = await generatePanel('horizontal', join(job, 'photo.jpg'), job, { keywords: true });
  assert.ok(Date.now() - t0 < 1800, `took ${Date.now() - t0} ms`);
  assert.equal(out.imagePath, join(brain, 'first.jpg'));
  assert.deepEqual(out.keywords, ['a', 'b', 'c']);
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(existsSync(join(brain, 'second.jpg')), false, 'agy was not stopped');
  assert.equal(existsSync(join(root, 'late.txt')), false, 'agy was not stopped');
});

test('generatePanel: keywords printed after the image are still collected (within the grace)', async () => {
  const { brain, job } = setup(`printf img > "$BRAIN/one.jpg"; sleep 0.6; echo '["x","y","z"]'; sleep 3`);
  const out = await generatePanel('horizontal', join(job, 'photo.jpg'), job, { keywords: true });
  assert.deepEqual(out, { imagePath: join(brain, 'one.jpg'), keywords: ['x', 'y', 'z'] });
});

test('generatePanel: missing keywords do not hold the image back past the grace', async () => {
  const { brain, job } = setup(`printf img > "$BRAIN/one.jpg"; sleep 5`);
  const t0 = Date.now();
  const out = await generatePanel('horizontal', join(job, 'photo.jpg'), job, { keywords: true });
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  assert.deepEqual(out, { imagePath: join(brain, 'one.jpg'), keywords: [] });
});

test('generatePanel: an image still being written is not taken until its size settles', async () => {
  // The file keeps growing faster than the poll interval for a while after the reply names it.
  const { job } = setup(`printf p > "$BRAIN/big.jpg"; echo "$BRAIN/big.jpg"; echo '["a","b","c"]'
i=0; while [ $i -lt 30 ]; do sleep 0.02; printf p >> "$BRAIN/big.jpg"; i=$((i+1)); done; printf END >> "$BRAIN/big.jpg"; sleep 1`);
  const out = await generatePanel('horizontal', join(job, 'photo.jpg'), job, { keywords: true });
  assert.match(readFileSync(out.imagePath, 'utf8'), /END$/);
});

test('generatePanel: a reply that names the image but lacks the wanted keywords waits for agy to exit', async () => {
  const { brain, job } = setup(`printf v2 > "$BRAIN/v2.jpg"; echo "final: $BRAIN/v2.jpg"; sleep 0.6; echo '["x","y","z"]'`);
  const out = await generatePanel('horizontal', join(job, 'photo.jpg'), job, { keywords: true });
  assert.deepEqual(out, { imagePath: join(brain, 'v2.jpg'), keywords: ['x', 'y', 'z'] });
});

test('generatePanel: stage timings are logged', async () => {
  logged.length = 0;
  const { job } = setup(`printf x > "$BRAIN/p.png"; echo done`);
  await generatePanel('horizontal', join(job, 'photo.jpg'), job);
  const text = logged.join('\n');
  assert.match(text, /image .*p\.png.* at \d+ ms/);
  assert.match(text, /exited .*at \d+ ms/);
});

test('generatePanel: agy exits and its reply names no image → fails within a short grace, not the long poll', async () => {
  const { job } = setup('echo "I could not generate the image: the image tool returned an error. See [photo.jpg](file:///tmp/x/photo.jpg)."; exit 0');
  options.pollTimeoutMs = 10_000;
  const t0 = Date.now();
  try {
    await assert.rejects(generatePanel('horizontal', '/abs/photo.jpg', job), (e) => {
      assert.equal(e.message, 'Gemini finished without making an image. Try again.');
      return true;
    });
  } finally {
    options.pollTimeoutMs = 2000;
  }
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
});

test('generatePanel: a quota message fails the job at once, stops agy, and reads as one plain sentence', async () => {
  // Shaped like the real reply seen during a quota outage: markdown, a file link and keywords.
  const alive = join(root, 'still-alive.txt');
  const { job } = setup(`echo 'Image generation failed: 429 Too Many Requests: RESOURCE_EXHAUSTED (quota exceeded, reset after 2h52m54s).\`'
echo ''
echo 'For the reference photo ([photo.jpg](file:///var/x/photo.jpg)), the three keywords are:'
echo '\`["blue","sky","slate"]\`'
sleep 3; echo yes > "${alive}"`);
  options.pollTimeoutMs = 10_000;
  const t0 = Date.now();
  try {
    await assert.rejects(generatePanel('horizontal', '/abs/photo.jpg', job, { keywords: true }), (e) => {
      assert.equal(e.message, "Gemini's image quota is used up. It resets in about 2 h 53 min. Until then, choose \"Gemini app\" on the create page.");
      return true;
    });
  } finally {
    options.pollTimeoutMs = 2000;
  }
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
  await new Promise((r) => setTimeout(r, 3500));
  assert.equal(existsSync(alive), false, 'agy was stopped');
});

test('quotaError: reset time when given, otherwise "Try again later."', () => {
  assert.equal(quotaError('quota exceeded, reset after 2h52m54s').message, "Gemini's image quota is used up. It resets in about 2 h 53 min. Until then, choose \"Gemini app\" on the create page.");
  assert.equal(quotaError('rate limit; resets in 45m').message, "Gemini's image quota is used up. It resets in about 45 min. Until then, choose \"Gemini app\" on the create page.");
  assert.equal(quotaError('reset after 3h0m10s').message, "Gemini's image quota is used up. It resets in about 3 h. Until then, choose \"Gemini app\" on the create page.");
  assert.equal(quotaError('reset after 20s').message, "Gemini's image quota is used up. It resets in less than a minute. Until then, choose \"Gemini app\" on the create page.");
  assert.equal(quotaError('exhausted on model `gemini-3.1-flash-image`; quota resets after ~3h50m).').message, "Gemini's image quota is used up. It resets in about 3 h 50 min. Until then, choose \"Gemini app\" on the create page.");
  assert.equal(quotaError('Error 429: RESOURCE_EXHAUSTED').message, "Gemini's image quota is used up. Try again later. Until then, choose \"Gemini app\" on the create page.");
});

test('generatePanel: agy failure and quota messages are readable', async () => {
  const { job } = setup('echo "boom: something broke" >&2; exit 3');
  await assert.rejects(generatePanel('horizontal', '/abs/photo.jpg', job), /agy failed.*something broke/is);
  setup('echo "Error: RESOURCE_EXHAUSTED: quota exceeded" >&2; exit 1');
  await assert.rejects(generatePanel('horizontal', '/abs/photo.jpg', job), { message: "Gemini's image quota is used up. Try again later. Until then, choose \"Gemini app\" on the create page." });
  options.bin = join(root, 'does-not-exist');
  await assert.rejects(generatePanel('horizontal', '/abs/photo.jpg', job), /agy/i);
});

test('generatePanel: timeout kills agy with a readable error', async () => {
  const { job } = setup('sleep 5');
  options.runTimeoutMs = 300;
  try {
    await assert.rejects(generatePanel('horizontal', '/abs/photo.jpg', job), /timed out/i);
  } finally {
    options.runTimeoutMs = 330000;
  }
});

test('jobs run one at a time', async () => {
  const log = join(root, 'serial.txt');
  const { job } = setup(`echo start >> "${log}"; sleep 0.2; echo end >> "${log}"; printf x > "$BRAIN/$$.png"`);
  await Promise.all([
    generatePanel('horizontal', '/a.jpg', job),
    generatePanel('horizontal', '/b.jpg', job),
  ]);
  assert.equal(readFileSync(log, 'utf8'), 'start\nend\nstart\nend\n');
});
