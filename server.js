import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MONTHS, displayText } from './shared/layout.js';
import { preparePhoto, fitPanel, compose, regions } from './lib/pipeline.js';
import { printText } from './lib/text.js';
import { appPrompt } from './lib/prompt.js';
import * as agy from './lib/agy.js';
import * as email from './lib/email.js';
import * as metadata from './lib/metadata.js';
import { createJobStore } from './lib/jobs.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class BadRequest extends Error {}

const localDate = (d = new Date()) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Validate the form fields per the HTTP contract. Throws BadRequest.
 * location, month and year are optional: absent → from the photo's metadata, empty → left off.
 */
function validate(body, file, emailOn) {
  const f = (k) => (typeof body[k] === 'string' ? body[k].trim() : '');
  if (!file) throw new BadRequest('Please choose a photo.');
  const location = f('location');
  if (location.length > 100) throw new BadRequest('Location is too long (100 characters at most).');
  const keywords = f('keywords').split(',').map((k) => k.trim()).filter(Boolean);
  if (keywords.length > 3) throw new BadRequest('Use at most three words to describe the photo.');
  if (keywords.some((k) => k.length > 30)) throw new BadRequest('Each describing word must be 30 characters or fewer.');
  const month = f('month');
  if (month && !MONTHS.includes(month)) throw new BadRequest(`Month must be one of ${MONTHS.join(', ')}.`);
  const year = f('year');
  if (year && !/^\d{4}$/.test(year)) throw new BadRequest('Year must be four digits.');
  const delivery = f('delivery');
  if (delivery !== 'download' && delivery !== 'email') throw new BadRequest('Delivery must be "download" or "email".');

  // Fields left out of the form entirely are filled from the photo's metadata later; a field sent
  // empty means the user cleared it on purpose, so that line is left off the postcard.
  const fromPhoto = ['location', 'month', 'year'].filter((k) => body[k] === undefined);
  const out = { location, keywords, month, year, delivery, fromPhoto };
  if (delivery === 'email') {
    if (!emailOn) throw new BadRequest("Email isn't set up yet — see docs/email-setup.md.");
    out.email = f('email');
    if (!EMAIL_RE.test(out.email)) throw new BadRequest('Please enter a valid email address.');
    out.sendDate = f('sendDate');
    if (!isRealDate(out.sendDate)) throw new BadRequest('Send date must be a real date (YYYY-MM-DD).');
    if (out.sendDate < localDate()) throw new BadRequest('Send date must be today or later.');
    out.message = f('message');
    if (out.message.length > 2000) throw new BadRequest('Message is too long (2000 characters at most).');
  }
  return out;
}

const UNREADABLE = 'Could not read the photo. Please use a JPEG, PNG or WebP image.';

const UNREADABLE_PANEL = 'Could not read the image from Gemini. Please save it as a JPEG, PNG or WebP and add it again.';

/** Quick check (header only) that sharp can decode the upload, so bad files get a 400 before the job starts. */
async function checkReadable(buffer, unreadable = UNREADABLE) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new BadRequest(unreadable);
  }
  if (meta.format === 'heif' && meta.compression === 'hevc') {
    throw new BadRequest(unreadable === UNREADABLE ? 'HEIC photos cannot be read here. Please use a JPEG, PNG or WebP image.' : unreadable);
  }
}

/** Express app. Dependencies are injectable so tests can stub agy, email and the clock. */
export function createApp(deps = {}) {
  const {
    generatePanel = agy.generatePanel,
    suggestKeywords = agy.suggestKeywords,
    readMetadata = metadata.readMetadata,
    scheduleEmail = email.scheduleEmail,
    emailEnabled = email.emailEnabled,
    resultsDir = join(tmpdir(), 'postcard-results'),
    now = Date.now,
    log = (line) => console.log(line),
  } = deps;

  const store = createJobStore({ resultsDir, now });
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 2 } });

  app.use(express.static(here('./public')));
  app.get('/create', (req, res) => res.sendFile(here('./public/create.html')));
  app.get('/making', (req, res) => res.sendFile(here('./public/making.html')));
  app.get('/postcard', (req, res) => res.sendFile(here('./public/postcard.html')));
  app.use('/fonts', express.static(here('./assets/fonts')));
  app.use('/shared', express.static(here('./shared')));
  app.use('/results', express.static(resultsDir));

  app.get('/api/config', (req, res) => res.json({ emailEnabled: emailEnabled() }));

  // Gemini app mode: the prompt the owner pastes into the Gemini app with the photo attached.
  // One text for every photo: Gemini picks the shape from the attached photo.
  app.get('/api/brief', (req, res) => res.json({ prompt: appPrompt() }));

  app.post('/api/metadata', upload.single('photo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Please choose a photo.' });
    res.json(await readMetadata(req.file.buffer));
  });

  /** The whole pipeline for one job, with the time of each stage in the log. */
  async function run(job, input, buffer, panelBuffer) {
    const tag = `[postcard ${job.id.slice(0, 8)}]`;
    const times = {};
    let t = Date.now();
    const stage = (name) => {
      times[job.stage] = Date.now() - t;
      log(`${tag} ${job.stage} ${times[job.stage]} ms`);
      job.stage = name;
      t = Date.now();
    };
    const jobDir = await mkdtemp(join(tmpdir(), 'postcard-job-'));
    try {
      // preparing: fill blanks from the photo's metadata, rotate, crop.
      const fields = { location: input.location, month: input.month, year: input.year };
      if (input.fromPhoto.length) {
        const meta = await readMetadata(buffer);
        for (const k of input.fromPhoto) fields[k] = meta[k] ?? '';
      }
      const { location, month, year } = fields;
      let prepared;
      try {
        prepared = await preparePhoto(buffer);
      } catch {
        throw new Error(UNREADABLE);
      }
      const { orientation, scale, photo } = prepared;
      const photoPath = join(jobDir, 'photo.jpg');
      await sharp(photo).jpeg({ quality: 90 }).toFile(photoPath);

      // drawing: Gemini draws the paper panel (and suggests keywords in the same call when needed).
      // In Gemini app mode the panel was drawn in the app and uploaded: agy draws nothing and is only
      // asked for the keywords (text only, no image quota) when they were left blank.
      stage('drawing');
      const typed = input.keywords.map((k) => k.toLowerCase());
      let keywords = typed;
      let drawnPanel = panelBuffer;
      if (drawnPanel) {
        if (!typed.length) keywords = await suggestKeywords(photoPath, jobDir);
      } else {
        const drawn = await generatePanel(orientation, photoPath, jobDir, { keywords: typed.length === 0 });
        if (!typed.length) keywords = drawn.keywords;
        drawnPanel = await readFile(drawn.imagePath);
      }

      // printing: fit the panel and print the text (blank lines are left out).
      stage('printing');
      let panel;
      try {
        panel = await fitPanel(drawnPanel, orientation, scale);
      } catch {
        throw new Error(panelBuffer ? UNREADABLE_PANEL : 'Gemini returned a file that is not a readable image. Try again.');
      }
      panel = await printText(panel, orientation, displayText({ location, keywords, month, year }));

      // finishing: join, save, schedule the email.
      stage('finishing');
      const jpeg = await compose(photo, panel, orientation, scale);
      await mkdir(resultsDir, { recursive: true });
      await writeFile(join(resultsDir, `${job.id}.jpg`), jpeg);
      let scheduled = null;
      let emailError = null;
      if (input.delivery === 'email') {
        try {
          await scheduleEmail({ recipient: input.email, sendDate: input.sendDate, message: input.message, location, jpeg });
          scheduled = { email: input.email, sendDate: input.sendDate };
        } catch (e) {
          emailError = e.message || 'Scheduling the email failed.';
        }
      }
      const { out } = regions(orientation, scale);
      await store.done(job, {
        imageUrl: `/results/${job.id}.jpg`,
        width: out.w,
        height: out.h,
        orientation,
        location: location || null,
        keywords,
        month: month || null,
        year: year || null,
        scheduled,
        emailError,
      });
      times.finishing = Date.now() - t;
      log(`${tag} finishing ${times.finishing} ms`);
      log(`${tag} done in ${Object.values(times).reduce((a, b) => a + b, 0)} ms (${Object.entries(times).map(([k, v]) => `${k} ${v}`).join(', ')})`);
    } catch (e) {
      store.fail(job, e.message || 'Generation failed. Try again.');
      log(`${tag} failed during ${job.stage} after ${Date.now() - t} ms: ${job.error}`);
    } finally {
      await rm(jobDir, { recursive: true, force: true });
    }
  }

  // One postcard at a time; later jobs wait (their stage stays "preparing").
  let queue = Promise.resolve();

  // photo, plus an optional panel: the stamp image drawn in the Gemini app (Gemini app mode).
  const postcardFiles = upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'panel', maxCount: 1 }]);

  app.post('/api/postcards', postcardFiles, async (req, res) => {
    const photoFile = req.files?.photo?.[0];
    const panelFile = req.files?.panel?.[0];
    let input;
    try {
      input = validate(req.body ?? {}, photoFile, emailEnabled());
      await checkReadable(photoFile.buffer);
      if (panelFile) await checkReadable(panelFile.buffer, UNREADABLE_PANEL);
    } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ error: e.message });
      throw e;
    }
    const job = store.create();
    const buffer = photoFile.buffer;
    const panelBuffer = panelFile?.buffer;
    const queuedAt = Date.now();
    queue = queue.then(() => {
      const waited = Date.now() - queuedAt;
      if (waited > 50) log(`[postcard ${job.id.slice(0, 8)}] waited ${waited} ms for the previous postcard`);
      return run(job, input, buffer, panelBuffer);
    });
    res.status(202).json({ id: job.id });
  });

  app.get('/api/postcards/:id', async (req, res) => {
    const job = await store.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'No postcard with that id. It may have expired; please make it again.' });
    res.json(job);
  });

  // JSON errors for the API (multer limits, unexpected failures).
  app.use('/api', (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'The photo is larger than 30 MB.' : `Upload problem: ${err.message}`;
      return res.status(400).json({ error: msg });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}

if (import.meta.main) {
  const envFile = here('./.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`Postcard app on http://localhost:${port}`);
  });
}
