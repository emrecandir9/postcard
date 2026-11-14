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
const drawerAgy = $('drawer-agy');
const drawerApp = $('drawer-app');
const drawerHint = $('drawer-hint');
const appSteps = $('app-steps');
const copyButton = $('copy-prompt');
const copyStatus = $('copy-status');
const promptText = $('prompt-text');
const panelInput = $('panel');
const panelDrop = $('panel-drop');
const panelTitle = $('panel-title');
const panelStatus = $('panel-status');

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
 * date is left off, as on the final card; empty keywords keep their placeholder because Gemini fills
 * them (in both modes).
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
  checkPanelShape();
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

// ---------- Stamp drawing: automatic (agy) or Gemini app ----------

const DRAWER_KEY = 'postcard.drawer';
let panelFile = null;
let panelURL = null;
let panelSize = null; // { w, h } of the image from Gemini

function appMode() {
  return drawerApp.checked;
}

function syncDrawer() {
  const app = appMode();
  appSteps.hidden = !app;
  drawerHint.textContent = app
    ? 'You make the stamp in the Gemini app and add it here. Uses the Gemini app’s own, larger allowance.'
    : 'Gemini draws it for you through agy. About 13 postcards every 5 hours.';
  card.setPaperImage(app ? panelURL : null);
  updateText();
  if (!app) clearError('panel');
  try {
    localStorage.setItem(DRAWER_KEY, app ? 'app' : 'agy');
  } catch {
    // Not remembered: fine.
  }
}

try {
  if (localStorage.getItem(DRAWER_KEY) === 'app') drawerApp.checked = true;
} catch {
  // Storage blocked: start on Automatic.
}
for (const r of [drawerAgy, drawerApp]) r.addEventListener('change', syncDrawer);
syncDrawer();

// One prompt for every photo (Gemini picks the shape from the photo it is given). It is loaded with
// the page, so a click copies it straight away, with or without a photo chosen.
const promptRequest = fetch('/api/brief')
  .then((res) => (res.ok ? res.json() : null))
  .then((body) => (typeof body?.prompt === 'string' ? body.prompt : null))
  .catch(() => null);

copyButton.addEventListener('click', async () => {
  copyStatus.textContent = '';
  const prompt = await promptRequest;
  if (!prompt) {
    copyStatus.textContent = "Couldn't get the prompt. Is the server still running? Reload the page.";
    return;
  }
  promptText.value = prompt;
  let copied = false;
  try {
    await navigator.clipboard.writeText(prompt);
    copied = true;
  } catch {
    // Clipboard API not allowed here: try the older copy command on the selected text.
    promptText.hidden = false;
    promptText.select();
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
  }
  promptText.hidden = copied;
  copyStatus.textContent = copied ? 'Copied.' : 'Copy the text below.';
  if (!copied) promptText.select();
});

/** Warn when Gemini's image is a very different shape from the paper, since part of it gets cut off. */
function checkPanelShape() {
  if (!panelSize) return;
  const want = LAYOUTS[card.orientation].paperRatio;
  const got = panelSize.w / panelSize.h;
  const off = Math.max(got / want, want / got);
  const shape = `${panelSize.w} × ${panelSize.h}`;
  if (off < 1.3) {
    panelStatus.textContent = `${shape}. The preview shows how it will be used.`;
  } else {
    const ask = card.orientation === 'horizontal' ? 'wider (21:9)' : 'taller (9:16)';
    panelStatus.textContent = `${shape}: a different shape from the paper, so its edges are cut off (see the preview). If the stamp is cut, ask Gemini for a ${ask} image.`;
  }
}

async function usePanel(file) {
  clearError('panel');
  if (!file) return;
  if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    showFieldError('panel', "That file isn't an image.");
    return;
  }
  const url = URL.createObjectURL(file);
  const probe = new Image();
  probe.src = url;
  try {
    await probe.decode();
  } catch {
    URL.revokeObjectURL(url);
    showFieldError('panel', "This browser can't open that file. Save Gemini's image as JPEG, PNG or WebP.");
    return;
  }
  if (panelURL) URL.revokeObjectURL(panelURL);
  panelFile = file;
  panelURL = url;
  panelSize = { w: probe.naturalWidth, h: probe.naturalHeight };
  card.setPaperImage(url);
  panelTitle.textContent = '';
  panelTitle.append(`${file.name} · `);
  const change = document.createElement('span');
  change.className = 'dropzone__link';
  change.textContent = 'change image';
  panelTitle.append(change);
  panelDrop.classList.add('has-photo');
  checkPanelShape();
}

const LINK_NOT_FILE = 'That came in as a link, not an image file. In Gemini, use Download (then drop the downloaded file here) or Copy image (then press ⌘V here).';

/** An image dragged straight out of a web page often arrives as a link: try to fetch it. */
async function panelFromLink(dataTransfer) {
  const link = (dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain')).split('\n')[0].trim();
  if (!/^(https?:|data:image\/|blob:)/i.test(link)) return null;
  try {
    const res = await fetch(link);
    const blob = await res.blob();
    if (!res.ok || !blob.type.startsWith('image/')) return null;
    return new File([blob], `gemini.${blob.type.split('/')[1] || 'png'}`, { type: blob.type });
  } catch {
    return null; // another site's image that the browser won't hand over
  }
}

panelInput.addEventListener('change', () => usePanel(panelInput.files[0]));

// The whole Gemini app box takes drops (not only the small zone), so the image is easy to land.
let dragDepth = 0;
appSteps.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  panelDrop.classList.add('is-over');
});
appSteps.addEventListener('dragover', (e) => e.preventDefault());
appSteps.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) panelDrop.classList.remove('is-over');
});
appSteps.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  panelDrop.classList.remove('is-over');
  const file = e.dataTransfer.files[0] ?? (await panelFromLink(e.dataTransfer));
  if (file) usePanel(file);
  else showFieldError('panel', LINK_NOT_FILE);
});

// Paste: "Copy image" in Gemini, then ⌘V anywhere on this page while Gemini app is chosen.
document.addEventListener('paste', (e) => {
  if (!appMode()) return;
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  const file = item.getAsFile();
  usePanel(new File([file], file.name && file.name !== 'image.png' ? file.name : `gemini-pasted.${file.type.split('/')[1] || 'png'}`, { type: file.type }));
  panelDrop.scrollIntoView({ block: 'nearest' });
});

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
  if (appMode() && !panelFile) problems.push(['panel', 'Add the image Gemini made (step 3).']);
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
  for (const name of ['photo', 'panel', 'year', 'email', 'sendDate']) clearError(name);
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
  if (appMode()) data.append('panel', panelFile, panelFile.name);
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
