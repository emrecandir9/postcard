import { spawn } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, relative, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { panelPrompt, keywordsPrompt } from './prompt.js';

/** Overridable (tests, env). */
export const options = {
  bin: process.env.AGY_BIN || 'agy',
  brainDir: process.env.AGY_BRAIN_DIR || join(homedir(), '.gemini', 'antigravity-cli', 'brain'),
  runTimeoutMs: 330_000, // agy's own --print-timeout is 300 s
  pollTimeoutMs: 60_000, // agy may answer before the image file exists
  pollIntervalMs: 1_000,
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

/** First JSON array of exactly three non-empty strings in the text, lowercased. */
export function parseKeywords(text) {
  for (let i = text.indexOf('['); i !== -1; i = text.indexOf('[', i + 1)) {
    for (let j = text.indexOf(']', i); j !== -1; j = text.indexOf(']', j + 1)) {
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
  }
  throw new Error('Gemini did not return three keywords. Type three words yourself or try again.');
}

const QUOTA = /quota|rate.?limit|resource.?exhausted|\b429\b|usage limit/i;

function tail(text, n = 400) {
  const t = text.trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}

/** Run agy with stdin closed. Resolves with stdout; rejects with a readable Error. */
function runAgy(args, cwd) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    let timedOut = false;
    // Own process group, so a timeout also stops anything agy started.
    const child = spawn(options.bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      reject(new Error(`agy timed out after ${Math.round(options.runTimeoutMs / 1000)} s. Try again.`));
    }, options.runTimeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start agy (${e.code || e.message}). Is the agy CLI installed and on PATH?`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const all = `${out}\n${err}`;
      if (timedOut) return;
      if (QUOTA.test(all) && (code !== 0 || !out.trim())) {
        return reject(new Error(`Gemini quota or rate limit reached: ${tail(all, 200)}`));
      }
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

/** Ask agy for the paper panel. Resolves with the generated image's path. */
export function generatePanel(orientation, photoPath, jobDir) {
  return enqueue(async () => {
    const marker = join(jobDir, '.agy-marker');
    writeFileSync(marker, '');
    const since = statSync(marker).mtimeMs;
    const out = await runAgy(
      ['-p', panelPrompt(orientation, photoPath), '--mode', 'accept-edits', '--print-timeout', '300s', '--add-dir', jobDir],
      jobDir,
    );
    const deadline = Date.now() + options.pollTimeoutMs;
    for (;;) {
      const found = findNewestImage(options.brainDir, since);
      if (found) return found;
      if (Date.now() >= deadline) break;
      await sleep(options.pollIntervalMs);
    }
    if (QUOTA.test(out)) throw new Error(`Gemini quota or rate limit reached: ${tail(out, 200)}`);
    throw new Error(`Gemini finished but no image file appeared. agy said: ${tail(out, 300) || 'nothing'}`);
  });
}

/** Ask agy (text only) for three keywords describing the photo. */
export function suggestKeywords(photoPath, location, jobDir) {
  return enqueue(async () => {
    const out = await runAgy(
      ['-p', keywordsPrompt(photoPath, location), '--model', 'gemini-4-argon-high', '--mode', 'plan', '--add-dir', jobDir],
      jobDir,
    );
    return parseKeywords(out);
  });
}
