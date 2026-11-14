// Create page: form, live preview, photo metadata autofill and the submit (HTTP contract v2 in the plan).
import { LAYOUTS, MONTHS, orientationOf, displayText } from '/shared/layout.js';
import { mountPostcard, ratioLabel, PLACEHOLDERS } from './postcard.js';

const $ = (id) => document.getElementById(id);

const form = $('postcard-form');
const photoInput = $('photo');
const dropzone = $('dropzone');
const photoTitle = $('photo-title');
const photoStatus = $('photo-status');
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
const errorBox = $('error');
const errorText = $('error-text');

/** YYYY-MM-DD in the browser's local time zone. */
function localISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- Defaults ----------

const now = new Date();
monthSelect.add(new Option('—', ''));
for (const m of MONTHS) monthSelect.add(new Option(m, m));
sendDateInput.min = localISODate(now);
sendDateInput.value = localISODate(now);

// ---------- Live preview ----------

// Placeholders are drawn here (not by mountPostcard) because they depend on whether a photo is chosen.
const card = mountPostcard($('postcard'), {
  photoLabel: 'Your photo',
  stampLabel: 'stamp drawn after you create',
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

/**
 * Before a photo is chosen every empty line shows a placeholder. After that an empty location or
 * date is left off, as on the final card; empty keywords keep their placeholder because Gemini fills them.
 */
function updateText() {
  const strings = displayText({
    location: locationInput.value,
    keywords: keywordList(),
    month: monthSelect.value,
    year: yearInput.value.trim(),
  });
  const placeholderKeys = (photoFile ? ['keywords'] : Object.keys(PLACEHOLDERS)).filter((k) => !strings[k]);
  for (const k of placeholderKeys) strings[k] = PLACEHOLDERS[k];
  card.setText(strings);
  for (const k of placeholderKeys) {
    previewCard.querySelector(`.pc__line--${k}`)?.classList.add('pc__line--placeholder');
  }
}

setOrientation('horizontal');
updateText();

// ---------- Photo metadata ----------

// Fields the user typed in or changed themselves; metadata never overwrites these.
const AUTO_FIELDS = { location: locationInput, month: monthSelect, year: yearInput };
const touched = new Set();
let metadataRequest = 0;

for (const [name, el] of Object.entries(AUTO_FIELDS)) {
  el.addEventListener('input', () => {
    touched.add(name);
    $(`${name}-from`).hidden = true;
  });
}

function cleanMetadata(body) {
  const location = typeof body?.location === 'string' ? body.location.trim().slice(0, 100) : '';
  const month = MONTHS.includes(body?.month) ? body.month : '';
  const year = /^\d{4}$/.test(String(body?.year ?? '')) ? String(body.year) : '';
  return { location, month, year };
}

async function readMetadata(file) {
  const request = ++metadataRequest;
  photoStatus.textContent = 'Reading the place and date from the photo…';
  let found = { location: '', month: '', year: '' };
  try {
    const data = new FormData();
    data.append('photo', file, file.name);
    const res = await fetch('/api/metadata', { method: 'POST', body: data });
    if (res.ok) found = cleanMetadata(await res.json());
  } catch {
    // No metadata is not a problem: the fields stay as they are.
  }
  if (request !== metadataRequest) return; // a newer photo was chosen meanwhile

  for (const [name, el] of Object.entries(AUTO_FIELDS)) {
    if (touched.has(name)) continue;
    // Replace values filled from an earlier photo too, so they never outlive it.
    el.value = found[name];
    $(`${name}-from`).hidden = !found[name];
  }
  updateText();
  const got = Object.entries(found).filter(([name, v]) => v && !touched.has(name)).length;
  const any = Object.values(found).some(Boolean);
  photoStatus.textContent = got
    ? 'Filled in what the photo knows. You can change it.'
    : any
      ? ''
      : 'No place or date found in this photo. Add them if you like.';
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
  clearError('photo'); // a submit tried while the photo was still loading
  // Browsers apply EXIF rotation, so the natural size is already the upright size.
  setOrientation(orientationOf(probe.naturalWidth, probe.naturalHeight));
  card.setPhoto(url);
  updateText();
  photoTitle.textContent = '';
  photoTitle.append(`${file.name} · `);
  const change = document.createElement('span');
  change.className = 'dropzone__link';
  change.textContent = 'change photo';
  photoTitle.append(change);
  dropzone.classList.add('has-photo');
  hideError();
  readMetadata(file);
}

photoInput.addEventListener('change', () => usePhoto(photoInput.files[0]));

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('is-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('is-over');
  usePhoto(e.dataTransfer.files[0]);
});
// A photo dropped next to the drop zone should not replace the page.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

for (const el of [locationInput, keywordsInput, monthSelect, yearInput]) {
  el.addEventListener('input', () => {
    updateText();
    clearError(el.id);
  });
}

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
  const year = yearInput.value.trim();
  if (year && !/^\d{4}$/.test(year)) problems.push(['year', 'Enter a four-digit year, or leave it blank.']);
  if (emailChosen()) {
    if (!emailInput.value.trim() || !emailInput.checkValidity()) {
      problems.push(['email', 'Enter a valid email address.']);
    }
    if (!sendDateInput.value || sendDateInput.value < localISODate(new Date())) {
      problems.push(['sendDate', 'Pick today or a later date.']);
    }
  }
  for (const name of ['photo', 'year', 'email', 'sendDate']) clearError(name);
  for (const [name, message] of problems) showFieldError(name, message);
  if (problems.length) $(problems[0][0]).focus();
  return problems.length === 0;
}

// ---------- Submit ----------

let busy = false;

function setBusy(on) {
  busy = on;
  submitButton.disabled = on;
  submitButton.textContent = on ? 'Sending…' : 'Create postcard';
}

function showError(message) {
  errorText.textContent = message;
  errorBox.hidden = false;
  errorBox.scrollIntoView({ block: 'nearest' });
}

function hideError() {
  errorBox.hidden = true;
  errorText.textContent = '';
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

  hideError();
  setBusy(true);
  try {
    const res = await fetch('/api/postcards', { method: 'POST', body: data });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `Something went wrong (HTTP ${res.status}).`);
    if (typeof body?.id !== 'string' || !body.id) throw new Error('The server sent an unexpected answer.');
    window.location.assign(`/making?id=${encodeURIComponent(body.id)}`);
  } catch (err) {
    setBusy(false);
    showError(err instanceof TypeError ? "Couldn't reach the app. Is the server still running?" : err.message);
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  submit();
});

// Coming back with the Back button can restore the page from cache mid-submit.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) setBusy(false);
});
