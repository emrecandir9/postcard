import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY_MS = 24 * 3_600_000;

/**
 * Postcard jobs. Working and recent jobs live in memory; a finished postcard's status is also saved
 * as <id>.json beside <id>.jpg, so it can still be read after a restart. Finished jobs are dropped
 * from memory 24 h after they end (done ones remain readable from disk).
 */
export function createJobStore({ resultsDir, now = Date.now, ttlMs = DAY_MS }) {
  const jobs = new Map();

  function prune() {
    for (const [id, job] of jobs) {
      if (job.finishedAt !== null && now() - job.finishedAt > ttlMs) jobs.delete(id);
    }
  }

  /** The status object of the HTTP contract. */
  function view(job) {
    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      elapsedMs: (job.finishedAt ?? now()) - job.startedAt,
      error: job.error,
      result: job.result,
    };
  }

  return {
    create() {
      prune();
      const job = { id: randomUUID(), status: 'working', stage: 'preparing', startedAt: now(), finishedAt: null, error: null, result: null };
      jobs.set(job.id, job);
      return job;
    },

    async get(id) {
      prune();
      const job = jobs.get(id);
      if (job) return view(job);
      if (!ID_RE.test(id)) return null;
      try {
        return JSON.parse(await readFile(join(resultsDir, `${id}.json`), 'utf8'));
      } catch {
        return null;
      }
    },

    async done(job, result) {
      job.result = result;
      job.status = 'done';
      job.finishedAt = now();
      await mkdir(resultsDir, { recursive: true });
      await writeFile(join(resultsDir, `${job.id}.json`), JSON.stringify(view(job)));
    },

    fail(job, message) {
      job.error = message;
      job.status = 'error';
      job.finishedAt = now();
    },
  };
}
