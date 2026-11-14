import { spawn } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, extname, relative, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { panelBrief, panelPrompt } from './prompt.js';

/** Overridable (tests, env). */
export const options = {
  bin: process.env.AGY_BIN || 'agy',
  brainDir: process.env.AGY_BRAIN_DIR || join(homedir(), '.gemini', 'antigravity-cli', 'brain'),
  runTimeoutMs: 330_000, // agy's own --print-timeout is 300 s
  pollTimeoutMs: 60_000, // agy may answer before the image file exists
  pollIntervalMs: 500, // the brain folder is also watched while agy runs
  replyIdleMs: 2_000, // reply names the image and stdout has been quiet this long → done
  quotaGraceMs: 500, // after a quota message appears, collect the rest of it (the reset time) before stopping agy
  noImageGraceMs: 3_000, // agy exited and its reply names no image file: wait only this long for a straggler
  model: process.env.AGY_MODEL || '', // empty: agy's default
  effort: process.env.AGY_EFFORT || '',
  agent: process.env.AGY_AGENT || '',
  log: (line) => console.log(line),
};

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/**
 * Newest image file (recursive) modified after sinceMs, or null.
 * Hidden folders are skipped: agy keeps copies of every image it views (including the reference
 * photo) under <conversation>/.system_generated/logs/media/, and those must never count as the panel.
 */
export function findNewestImage(dir, sinceMs) {
  let best = null;
  let bestTime = sinceMs;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isFile() || !IMAGE_EXT.has(extname(e.name).toLowerCase())) continue;
    const p = join(e.parentPath, e.name);
    if (relative(dir, p).split(sep).some((part) => part.startsWith('.'))) continue;
    let t;
    try {
      t = statSync(p).mtimeMs;
    } catch {
      continue;
    }
    if (t > bestTime) {
      best = p;
      bestTime = t;
    }
  }
  return best;
}

/**
 * The last JSON array of exactly three non-empty strings in the reply, lowercased.
 * No usable array → [] and the keywords line is simply left out of the postcard: a second agy call
 * would double the waiting time, which is the thing this single call exists to avoid.
 */
export function parseKeywords(text) {
  for (let j = text.lastIndexOf(']'); j !== -1; j = text.lastIndexOf(']', j - 1)) {
    for (let i = text.lastIndexOf('[', j); i !== -1; i = text.lastIndexOf('[', i - 1)) {
      let value;
      try {
        value = JSON.parse(text.slice(i, j + 1));
      } catch {
        continue;
      }
      if (Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'string' && v.trim())) {
        return value.map((v) => v.trim().toLowerCase());
      }
      break;
    }
    if (j === 0) break;
  }
  return [];
}

const QUOTA = /quota|rate.?limit|resource.?exhausted|\b429\b|usage limit/i;
const IMAGE_NAMES = /[\w.-]+\.(?:png|jpe?g|webp)\b/gi;

function tail(text, n = 400) {
  const t = text.trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}

/** "2h52m54s" → "about 2 h 53 min"; null when there is no usable duration. */
function humanDuration(text) {
  const h = Number(/(\d+)\s*h/i.exec(text)?.[1] ?? 0);
  const m = Number(/(\d+)\s*m(?!s)/i.exec(text)?.[1] ?? 0);
  const sec = Number(/(\d+)\s*s/i.exec(text)?.[1] ?? 0);
  const total = Math.round((h * 3600 + m * 60 + sec) / 60);
  if (!(h || m || sec)) return null;
  if (total < 1) return 'less than a minute';
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `about ${[hh && `${hh} h`, mm && `${mm} min`].filter(Boolean).join(' ')}`;
}

/** One plain sentence for a person, from agy output that reports a quota or rate limit. */
export function quotaError(text) {
  const reset = /reset[a-z]*\s+(?:after|in)\s+((?:\d+\s*[hms]\s*)+)/i.exec(text);
  const when = reset && humanDuration(reset[1]);
  return new Error(`Gemini's image quota is used up. ${when ? `It resets in ${when}.` : 'Try again later.'}`);
}

/**
 * Run agy with stdin closed. Resolves with stdout; rejects with a readable Error.
 * A quota or rate-limit message ends the run at once (agy's process group is stopped: nothing useful
 * can come of it), instead of waiting minutes for agy to give up by itself.
 */
function runAgy(args, cwd, onStdout = () => {}) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    let finished = false;
    let quotaTimer = null;
    // Own process group, so a timeout also stops anything agy started.
    const child = spawn(options.bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const stop = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(quotaTimer);
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      reject(error);
    };
    const timer = setTimeout(() => {
      stop(new Error(`agy timed out after ${Math.round(options.runTimeoutMs / 1000)} s. Try again.`));
    }, options.runTimeoutMs);
    const watchQuota = () => {
      if (quotaTimer || finished || !QUOTA.test(`${out}\n${err}`)) return;
      quotaTimer = setTimeout(() => {
        options.log(`[agy] quota or rate limit reported; stopping agy. agy said: ${tail(`${out}\n${err}`, 300)}`);
        stop(quotaError(`${out}\n${err}`));
      }, options.quotaGraceMs);
    };
    child.stdout.on('data', (d) => {
      out += d;
      onStdout(out);
      watchQuota();
    });
    child.stderr.on('data', (d) => {
      err += d;
      watchQuota();
    });
    child.on('error', (e) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(new Error(`Could not start agy (${e.code || e.message}). Is the agy CLI installed and on PATH?`));
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(quotaTimer);
      const all = `${out}\n${err}`;
      if (QUOTA.test(all)) return reject(quotaError(all));
      if (code !== 0) return reject(new Error(`agy failed (exit ${code}): ${tail(err || out) || 'no output'}`));
      resolve(out);
    });
  });
}

// One agy job at a time; later callers wait their turn.
let queue = Promise.resolve();
function enqueue(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

/** Wait until a file's size stops changing (the generator may still be writing it). */
async function settled(path) {
  let last = -1;
  for (let i = 0; i < 20; i++) {
    let size;
    try {
      size = statSync(path).size;
    } catch {
      size = -1;
    }
    if (size > 0 && size === last) return true;
    last = size;
    await sleep(options.pollIntervalMs);
  }
  return false;
}

/**
 * Ask agy for the paper panel (and, when `keywords` is true, three keywords in the same reply).
 * Resolves with { imagePath, keywords } as soon as the reply names the finished image; agy is then
 * left to shut down by itself (never killed mid-shutdown), and the next agy run waits for it.
 * Logs the time of each step in ms from the start.
 */
export function generatePanel(orientation, photoPath, jobDir, { keywords = false } = {}) {
  return new Promise((resolve, reject) => {
    enqueue(() => drawPanel(orientation, photoPath, jobDir, keywords, resolve)).catch(reject);
  });
}

async function drawPanel(orientation, photoPath, jobDir, wantKeywords, resolveEarly) {
  const marker = join(jobDir, '.agy-marker');
  writeFileSync(marker, '');
  const since = statSync(marker).mtimeMs;
  const briefPath = join(jobDir, 'brief.md');
  writeFileSync(briefPath, panelBrief(orientation));

  const args = ['-p', panelPrompt(photoPath, briefPath, { keywords: wantKeywords }), '--mode', 'accept-edits', '--print-timeout', '300s', '--add-dir', jobDir];
  if (options.model) args.push('--model', options.model);
  if (options.effort) args.push('--effort', options.effort);
  if (options.agent) args.push('--agent', options.agent);

  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  const seen = new Set();
  let stdout = '';
  let lastOutputAt = 0;
  let exited = false;
  let done = false;

  const finish = (imagePath) => {
    done = true;
    const kw = wantKeywords ? parseKeywords(stdout) : [];
    if (wantKeywords && kw.length === 0) options.log('[agy] reply had no usable keywords; the keywords line is left out');
    options.log(`[agy] result taken at ${ms()} ms: ${basename(imagePath)}`);
    resolveEarly({ imagePath, keywords: kw });
  };

  // Watch the brain folder while agy runs: log each new image, and take the result as soon as the
  // reply names the newest image, that file is complete, and stdout has gone quiet.
  const watch = (async () => {
    while (!exited && !done) {
      await sleep(options.pollIntervalMs);
      const found = findNewestImage(options.brainDir, since);
      if (!found) continue;
      if (!seen.has(found)) {
        seen.add(found);
        options.log(`[agy] image ${basename(found)} appeared at ${ms()} ms`);
      }
      const named = stdout.includes(basename(found));
      const quiet = lastOutputAt && Date.now() - lastOutputAt >= options.replyIdleMs;
      const kwReady = !wantKeywords || parseKeywords(stdout).length === 3;
      if (named && quiet && kwReady && !exited && !done && (await settled(found))) {
        if (findNewestImage(options.brainDir, since) === found && !done) finish(found);
      }
    }
  })();

  let out;
  try {
    out = await runAgy(args, jobDir, (text) => {
      if (!stdout) options.log(`[agy] reply started at ${ms()} ms`);
      stdout = text;
      lastOutputAt = Date.now();
    });
  } finally {
    exited = true;
    options.log(`[agy] exited at ${ms()} ms`);
    await watch;
  }
  if (done) return;
  stdout = out;

  // A reply that names an image file (other than the reference photo) means the file may still be
  // landing: poll for it. A reply that names none means no image was made: only a short grace for a
  // straggler, then a clear error.
  const namesImage = (out.match(IMAGE_NAMES) ?? []).some((name) => name !== basename(photoPath));
  const deadline = Date.now() + (namesImage ? options.pollTimeoutMs : options.noImageGraceMs);
  for (;;) {
    const found = findNewestImage(options.brainDir, since);
    if (found && (await settled(found))) {
      if (!seen.has(found)) options.log(`[agy] image ${basename(found)} appeared at ${ms()} ms`);
      return finish(found);
    }
    if (Date.now() >= deadline) break;
    await sleep(options.pollIntervalMs);
  }
  options.log(`[agy] no image file appeared. agy said: ${tail(out, 300) || 'nothing'}`);
  throw new Error('Gemini finished without making an image. Try again.');
}
