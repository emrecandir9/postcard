// Loading page: polls the job (GET /api/postcards/:id, contract v2) and shows which stage it is in.

const $ = (id) => document.getElementById(id);

const STAGES = {
  preparing: {
    title: 'Preparing the photo',
    explain: 'Turning your photo upright and cropping it to the card.',
  },
  drawing: {
    title: 'Drawing the stamp',
    explain: 'Gemini is carving a small stamp from your photo. This is the slow part.',
  },
  printing: {
    title: 'Printing the text',
    explain: 'Typing the place, three words and the date onto the paper.',
  },
  finishing: {
    title: 'Finishing up',
    explain: 'Putting the photo and the paper together and saving your postcard.',
  },
};
const ORDER = Object.keys(STAGES);
const POLL_MS = 1000;
const SLOW_MS = 4 * 60 * 1000;

const id = new URLSearchParams(window.location.search).get('id');

// ---------- Typewriter letters for the printing scene ----------

const now = new Date();
const dateLine = now.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).toUpperCase();
let letterIndex = 0;
for (const [i, text] of ['FIELD NOTES', 'ink · paper · stamp', dateLine].entries()) {
  const line = document.createElement('p');
  line.className = `type-line type-line--${i}`;
  for (const ch of text) {
    const span = document.createElement('span');
    span.className = 'type-letter';
    span.textContent = ch;
    span.style.setProperty('--i', String(letterIndex++));
    line.append(span);
  }
  $('type-lines').append(line);
}
$('type-lines').lastElementChild.append(Object.assign(document.createElement('span'), { className: 'type-caret' }));

// ---------- Views ----------

function show(view) {
  for (const v of ['working', 'failed', 'missing']) $(v).hidden = v !== view;
}

let currentStage = null;

function setStage(stage) {
  if (!STAGES[stage] || stage === currentStage) return;
  currentStage = stage;
  const at = ORDER.indexOf(stage);
  for (const art of document.querySelectorAll('[data-art]')) art.classList.toggle('is-active', art.dataset.art === stage);
  for (const li of document.querySelectorAll('.step')) {
    const i = ORDER.indexOf(li.dataset.stage);
    li.classList.toggle('is-done', i < at);
    li.classList.toggle('is-current', i === at);
    if (i === at) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
    li.querySelector('.step__state').textContent = i < at ? ', done' : i === at ? ', in progress' : '';
  }
  $('stage-title').textContent = STAGES[stage].title;
  $('stage-explain').textContent = STAGES[stage].explain;
  document.title = `${STAGES[stage].title} · Field Notes Postcard`;
}

// ---------- Elapsed time (server time, ticked locally between polls) ----------

let serverElapsed = 0;
let receivedAt = Date.now();

function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function tick() {
  const ms = serverElapsed + (Date.now() - receivedAt);
  $('elapsed').textContent = formatElapsed(ms);
  $('time-note').textContent = ms > SLOW_MS ? 'taking longer than usual, still working' : 'usually one to three minutes';
}

const clock = setInterval(tick, 1000);

// ---------- Polling ----------

let failures = 0;

function stop() {
  clearInterval(clock);
}

function showMissing() {
  stop();
  show('missing');
  document.title = "Can't find that postcard · Field Notes Postcard";
}

async function poll() {
  let res;
  let body;
  try {
    res = await fetch(`/api/postcards/${encodeURIComponent(id)}`, { cache: 'no-store' });
    body = await res.json().catch(() => null);
  } catch {
    failures += 1;
    $('offline').hidden = failures < 3;
    setTimeout(poll, POLL_MS * 2);
    return;
  }
  failures = 0;
  $('offline').hidden = true;

  if (res.status === 404) return showMissing();
  if (!res.ok || !body) {
    setTimeout(poll, POLL_MS * 2);
    return;
  }

  if (body.status === 'done') {
    stop();
    window.location.replace(`/postcard?id=${encodeURIComponent(id)}`);
    return;
  }
  if (body.status === 'error') {
    stop();
    $('failed-text').textContent = body.error || 'Something went wrong while making it.';
    show('failed');
    document.title = "That didn't work · Field Notes Postcard";
    $('try-again').focus();
    return;
  }

  if (typeof body.elapsedMs === 'number') {
    serverElapsed = body.elapsedMs;
    receivedAt = Date.now();
    tick();
  }
  setStage(body.stage);
  setTimeout(poll, POLL_MS);
}

setStage('preparing');
if (id) poll();
else showMissing();
