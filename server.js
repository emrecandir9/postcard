import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MONTHS, displayText } from './shared/layout.js';
import { preparePhoto, fitPanel, compose } from './lib/pipeline.js';
import { printText } from './lib/text.js';
import * as agy from './lib/agy.js';
import * as email from './lib/email.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class BadRequest extends Error {}

const localDate = (d = new Date()) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validate the form fields per the HTTP contract. Throws BadRequest. */
function validate(body, file, emailOn) {
  const f = (k) => (typeof body[k] === 'string' ? body[k].trim() : '');
  if (!file) throw new BadRequest('Please choose a photo.');
  const location = f('location');
  if (!location) throw new BadRequest('Please enter a location.');
  if (location.length > 100) throw new BadRequest('Location is too long (100 characters at most).');
  const keywords = f('keywords').split(',').map((k) => k.trim()).filter(Boolean);
  if (keywords.length > 3) throw new BadRequest('Use at most three words to describe the photo.');
  if (keywords.some((k) => k.length > 30)) throw new BadRequest('Each describing word must be 30 characters or fewer.');
  const month = f('month');
  if (!MONTHS.includes(month)) throw new BadRequest(`Month must be one of ${MONTHS.join(', ')}.`);
  const year = f('year');
  if (!/^\d{4}$/.test(year)) throw new BadRequest('Year must be four digits.');
  const delivery = f('delivery');
  if (delivery !== 'download' && delivery !== 'email') throw new BadRequest('Delivery must be "download" or "email".');

  const out = { location, keywords, month, year, delivery };
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

/** Express app. Dependencies are injectable so tests can stub agy and email. */
export function createApp(deps = {}) {
  const {
    generatePanel = agy.generatePanel,
    suggestKeywords = agy.suggestKeywords,
    scheduleEmail = email.scheduleEmail,
    emailEnabled = email.emailEnabled,
    resultsDir = join(tmpdir(), 'postcard-results'),
  } = deps;

  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } });

  app.use(express.static(here('./public')));
  app.get('/create', (req, res) => res.sendFile(here('./public/create.html')));
  app.use('/fonts', express.static(here('./assets/fonts')));
  app.use('/shared', express.static(here('./shared')));
  app.use('/results', express.static(resultsDir));

  app.get('/api/config', (req, res) => res.json({ emailEnabled: emailEnabled() }));

  app.post('/api/postcards', upload.single('photo'), async (req, res) => {
    let input;
    let prepared;
    try {
      input = validate(req.body ?? {}, req.file, emailEnabled());
      try {
        prepared = await preparePhoto(req.file.buffer);
      } catch {
        throw new BadRequest('Could not read the photo. Please use a JPEG, PNG or WebP image.');
      }
    } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ error: e.message });
      throw e;
    }

    const { orientation, scale, photo } = prepared;
    const jobDir = await mkdtemp(join(tmpdir(), 'postcard-job-'));
    let jpeg;
    let keywords = input.keywords.map((k) => k.toLowerCase());
    try {
      const photoPath = join(jobDir, 'photo.jpg');
      await sharp(photo).jpeg({ quality: 90 }).toFile(photoPath);
      if (keywords.length === 0) keywords = await suggestKeywords(photoPath, input.location, jobDir);
      const panelPath = await generatePanel(orientation, photoPath, jobDir);
      let panel;
      try {
        panel = await fitPanel(await readFile(panelPath), orientation, scale);
      } catch {
        throw new Error('Gemini returned a file that is not a readable image. Try again.');
      }
      const strings = displayText({ location: input.location, keywords, month: input.month, year: input.year });
      panel = await printText(panel, orientation, strings);
      jpeg = await compose(photo, panel, orientation, scale);
    } catch (e) {
      return res.status(502).json({ error: e.message || 'Generation failed. Try again.' });
    } finally {
      await rm(jobDir, { recursive: true, force: true });
    }

    const id = randomUUID();
    await mkdir(resultsDir, { recursive: true });
    await writeFile(join(resultsDir, `${id}.jpg`), jpeg);

    let scheduled = null;
    let emailError = null;
    if (input.delivery === 'email') {
      try {
        await scheduleEmail({ recipient: input.email, sendDate: input.sendDate, message: input.message, location: input.location, jpeg });
        scheduled = { email: input.email, sendDate: input.sendDate };
      } catch (e) {
        emailError = e.message || 'Scheduling the email failed.';
      }
    }
    res.json({ id, imageUrl: `/results/${id}.jpg`, keywords, scheduled, emailError });
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
  const server = createApp().listen(port, () => {
    console.log(`Postcard app on http://localhost:${port}`);
  });
  // A postcard can take several minutes; never cut the request off.
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.timeout = 0;
}
