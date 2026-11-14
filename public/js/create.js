// Create page: form, live preview and the submit flow (HTTP contract in the plan).
import { LAYOUTS, MONTHS, orientationOf, displayText } from '/shared/layout.js';
import { mountPostcard, ratioLabel } from './postcard.js';

const $ = (id) => document.getElementById(id);

const form = $('postcard-form');
const fieldsets = [$('upload-set'), $('details-set')];
const photoInput = $('photo');
const dropzone = $('dropzone');
const photoTitle = $('photo-title');
const locationInput = $('location');
const keywordsInput = $('keywords');
const monthSelect = $('month');
const yearInput = $('year');
const downloadRadio = $('delivery-download');
const emailRadio = $('delivery-email');
const emailOffNote = $('email-off-note');
const emailFields = $('email-fields');
const emailInput = $('email');
const sendDateInput = $('sendDate');
const messageInput = $('message');
const submitButton = $('submit');

const previewCard = $('preview-card');
const previewMeta = $('preview-meta');
const live = $('live');
const result = $('result');
const resultImg = $('result-img');
const resultNote = $('result-note');
const downloadLink = $('download');
const progress = $('progress');
const progressText = $('progress-text');
const elapsedEl = $('elapsed');
const errorBox = $('error');
const errorText = $('error-text');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** YYYY-MM-DD in the browser's local time zone. */
function localISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- Defaults ----------

const now = new Date();
for (const [i, m] of MONTHS.entries()) monthSelect.add(new Option(m, m, false, i === now.getMonth()));
yearInput.value = String(now.getFullYear());
sendDateInput.min = localISODate(now);
sendDateInput.value = localISODate(now);

// ---------- Live preview ----------

const card = mountPostcard($('postcard'), {
  photoLabel: 'Your photo',
  stampLabel: 'stamp drawn after you create',
  placeholders: true,
});

let photoFile = null;
let photoURL = null;

function setOrientation(o) {
  card.setOrientation(o);
  const { w, h } = LAYOUTS[o].out;
  previewCard.style.setProperty('--pc-ratio', String(w / h));
  const what = photoFile ? (o === 'horizontal' ? 'Horizontal photo' : 'Vertical or square photo') : 'No photo yet';
  previewMeta.textContent = `${what} · ${ratioLabel(o)} card`;
}

function keywordList() {
  return keywordsInput.value.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 3);
}

function updateText() {
  card.setText(
    displayText({
      location: locationInput.value,
      keywords: keywordList(),
      month: monthSelect.value,
      year: yearInput.value.trim(),
    }),
  );
}

setOrientation('horizontal');
updateText();

for (const el of [locationInput, keywordsInput, monthSelect, yearInput]) {
  el.addEventListener('input', () => {
    updateText();
    clearError(el.id);
  });
}

// ---------- Photo ----------

async function usePhoto(file) {
  clearError('photo');
  if (!file) return;
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
    showFieldError('photo', "That file isn't an image.");
    return;
  }
  const url = URL.createObjectURL(file);
  const probe = new Image();
  probe.src = url;
  try {
    await probe.decode();
  } catch {
    URL.revokeObjectURL(url);
    showFieldError('photo', "This browser can't open that file. Try a JPEG, PNG or WebP.");
    return;
  }
  if (photoURL) URL.revokeObjectURL(photoURL);
  photoFile = file;
  photoURL = url;
  // Browsers apply EXIF rotation, so the natural size is already the upright size.
  setOrientation(orientationOf(probe.naturalWidth, probe.naturalHeight));
  card.setPhoto(url);
  photoTitle.textContent = '';
  photoTitle.append(`${file.name} · `);
  const change = document.createElement('span');
  change.className = 'dropzone__link';
  change.textContent = 'change photo';
  photoTitle.append(change);
  dropzone.classList.add('has-photo');
  showLive();
}

photoInput.addEventListener('change', () => usePhoto(photoInput.files[0]));

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!photoInput.disabled) dropzone.classList.add('is-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('is-over');
  if (!photoInput.disabled) usePhoto(e.dataTransfer.files[0]);
});
// A photo dropped next to the drop zone should not replace the page.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------- Delivery ----------

function emailChosen() {
  return emailRadio.checked && !emailRadio.disabled;
}

function syncDelivery() {
  emailFields.hidden = !emailChosen();
}

for (const r of [downloadRadio, emailRadio]) r.addEventListener('change', syncDelivery);

fetch('/api/config')
  .then((res) => (res.ok ? res.json() : null))
  .catch(() => null)
  .then((config) => {
    const enabled = config?.emailEnabled === true;
    emailRadio.disabled = !enabled;
    emailOffNote.hidden = enabled;
    if (!enabled) downloadRadio.checked = true;
    syncDelivery();
  });

for (const el of [emailInput, sendDateInput]) el.addEventListener('input', () => clearError(el.id));

// ---------- Validation ----------

function showFieldError(name, message) {
  const el = $(`${name}-error`);
  el.textContent = message;
  el.hidden = false;
  $(name).setAttribute('aria-invalid', 'true');
}

function clearError(name) {
  const el = $(`${name}-error`);
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
  $(name).removeAttribute('aria-invalid');
}

function validate() {
  const problems = [];
  if (!photoFile) problems.push(['photo', 'Choose a photo first.']);
  if (!locationInput.value.trim()) problems.push(['location', 'Enter a location.']);
  if (!/^\d{4}$/.test(yearInput.value.trim())) problems.push(['year', 'Enter a four-digit year.']);
  if (emailChosen()) {
    if (!emailInput.value.trim() || !emailInput.checkValidity()) {
      problems.push(['email', 'Enter a valid email address.']);
    }
    if (!sendDateInput.value || sendDateInput.value < localISODate(new Date())) {
      problems.push(['sendDate', 'Pick today or a later date.']);
    }
  }
  for (const name of ['photo', 'location', 'year', 'email', 'sendDate']) clearError(name);
  for (const [name, message] of problems) showFieldError(name, message);
  if (problems.length) $(problems[0][0]).focus();
  return problems.length === 0;
}

// ---------- Submit ----------

let busy = false;
let timer = null;

function formatElapsed(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Brings the preview card into view when it is off-screen (the stacked phone layout). */
function revealPreview() {
  const box = previewCard.getBoundingClientRect();
  if (box.top < 0 || box.top > window.innerHeight * 0.6) {
    previewCard.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  }
}

function setBusy(on) {
  busy = on;
  for (const fs of fieldsets) fs.disabled = on;
  previewCard.classList.toggle('is-busy', on);
  submitButton.textContent = on ? 'Creating…' : 'Create postcard';
  progress.hidden = !on;
  clearInterval(timer);
  if (on) {
    const started = Date.now();
    elapsedEl.textContent = '0:00';
    progressText.textContent = 'Creating your postcard. This takes two to three minutes.';
    timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      elapsedEl.textContent = formatElapsed(seconds);
      if (seconds === 120) progressText.textContent = 'Still working. Sometimes it takes a few minutes.';
    }, 1000);
  }
}

function showLive() {
  result.hidden = true;
  errorBox.hidden = true;
  live.hidden = false;
}

function showError(message) {
  errorBox.hidden = false;
  errorText.textContent = message;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function showResult(body, keywordsWereBlank) {
  if (keywordsWereBlank && Array.isArray(body.keywords) && body.keywords.length) {
    keywordsInput.value = body.keywords.join(', ');
    updateText();
  }
  const place = locationInput.value.trim();
  resultImg.src = body.imageUrl;
  resultImg.alt = `Your postcard from ${place}`;
  downloadLink.href = body.imageUrl;
  const slug = place.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'postcard';
  downloadLink.download = `postcard-${slug}.jpg`;

  resultNote.classList.remove('is-error');
  if (body.scheduled) {
    resultNote.textContent = `Scheduled for ${formatDate(body.scheduled.sendDate)} to ${body.scheduled.email}.`;
    resultNote.hidden = false;
  } else if (body.emailError) {
    resultNote.textContent = `The postcard is ready, but the email couldn't be scheduled: ${body.emailError}`;
    resultNote.classList.add('is-error');
    resultNote.hidden = false;
  } else {
    resultNote.hidden = true;
  }

  live.hidden = true;
  errorBox.hidden = true;
  result.hidden = false;
}

async function submit() {
  if (busy || !validate()) return;

  const keywords = keywordList();
  const data = new FormData();
  data.append('photo', photoFile, photoFile.name);
  data.append('location', locationInput.value.trim());
  if (keywords.length) data.append('keywords', keywords.join(', '));
  data.append('month', monthSelect.value);
  data.append('year', yearInput.value.trim());
  if (emailChosen()) {
    data.append('delivery', 'email');
    data.append('email', emailInput.value.trim());
    data.append('sendDate', sendDateInput.value);
    data.append('message', messageInput.value);
  } else {
    data.append('delivery', 'download');
  }

  showLive();
  setBusy(true);
  revealPreview();
  let ok = false;
  try {
    const res = await fetch('/api/postcards', { method: 'POST', body: data });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `Something went wrong (HTTP ${res.status}).`);
    if (!body?.imageUrl) throw new Error('The server sent an unexpected answer.');
    showResult(body, keywords.length === 0);
    ok = true;
  } catch (err) {
    showError(err instanceof TypeError ? "Couldn't reach the app. Is the server still running?" : err.message);
  } finally {
    setBusy(false);
  }
  revealPreview();
  (ok ? downloadLink : $('retry')).focus({ preventScroll: true });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  submit();
});
$('retry').addEventListener('click', submit);
$('back').addEventListener('click', () => {
  showLive();
  locationInput.focus({ preventScroll: true });
});
