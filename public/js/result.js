// Result page: the finished postcard, full size, with Download and Make another (contract v2).

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(window.location.search).get('id');

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function showMessage(title, text, linkText) {
  $('message-title').textContent = title;
  $('message-text').textContent = text;
  $('message-link').textContent = linkText;
  $('message').hidden = false;
  document.title = `${title} · Field Notes Postcard`;
}

function showNotFound() {
  showMessage(
    "We can't find that postcard",
    'The link may be incomplete, or the postcard was never finished. You can make a new one.',
    'Make a postcard',
  );
}

function showPostcard(r) {
  const place = typeof r.location === 'string' ? r.location.trim() : '';
  const img = $('result-img');
  const download = $('download');

  if (r.width && r.height) {
    img.width = r.width;
    img.height = r.height;
  }
  img.alt = place ? `Your postcard from ${place}` : 'Your postcard';
  img.addEventListener('load', () => img.classList.add('is-in'), { once: true });
  img.addEventListener('error', () => {
    $('ready').hidden = true;
    showMessage("The postcard image didn't load", 'The postcard was made, but its image file could not be opened.', 'Make another');
  }, { once: true });
  img.src = r.imageUrl;

  const slug = place.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  download.href = r.imageUrl;
  download.download = slug ? `postcard-${slug}.jpg` : 'postcard.jpg';

  const note = $('result-note');
  if (r.scheduled?.email && r.scheduled?.sendDate) {
    note.textContent = `Scheduled for ${formatDate(r.scheduled.sendDate)} to ${r.scheduled.email}`;
    note.hidden = false;
  } else if (r.emailError) {
    note.textContent = `The postcard is ready, but the email couldn't be scheduled: ${r.emailError}`;
    note.classList.add('is-error');
    note.hidden = false;
  }

  $('result-title').textContent = img.alt;
  document.title = `${img.alt} · Field Notes Postcard`;
  $('ready').hidden = false;
}

async function load() {
  if (!id) return showNotFound();
  let res;
  let body;
  try {
    res = await fetch(`/api/postcards/${encodeURIComponent(id)}`, { cache: 'no-store' });
    body = await res.json().catch(() => null);
  } catch {
    return showMessage("Couldn't reach the app", 'Is the server still running? Reload this page to try again.', 'Make another');
  }
  if (res.status === 404) return showNotFound();
  if (!res.ok || !body) return showMessage('Something went wrong', body?.error || `The server answered with HTTP ${res.status}.`, 'Make another');

  if (body.status === 'working') return window.location.replace(`/making?id=${encodeURIComponent(id)}`);
  if (body.status === 'error') {
    return showMessage("That postcard didn't work out", body.error || 'Something went wrong while making it.', 'Try again');
  }
  if (body.status === 'done' && body.result?.imageUrl) return showPostcard(body.result);
  showMessage('Something went wrong', 'The server sent an unexpected answer.', 'Make another');
}

load();
