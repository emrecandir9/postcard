/** Email is enabled only when both Apps Script settings are present. */
export function emailEnabled() {
  return Boolean(process.env.APPS_SCRIPT_URL && process.env.APPS_SCRIPT_SECRET);
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'postcard';
}

/** Hand the postcard to the Google Apps Script web app. Throws a readable Error on any failure. */
export async function scheduleEmail({ recipient, sendDate, message, location, jpeg }) {
  if (!emailEnabled()) throw new Error('Email is not set up: APPS_SCRIPT_URL and APPS_SCRIPT_SECRET are missing from .env.');
  let res;
  try {
    res = await fetch(process.env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        secret: process.env.APPS_SCRIPT_SECRET,
        recipient,
        sendDate,
        message,
        location,
        filename: `postcard-${slug(location)}.jpg`,
        imageBase64: jpeg.toString('base64'),
      }),
    });
  } catch (e) {
    throw new Error(`Could not reach the email script: ${e.message}`);
  }
  let data;
  try {
    data = JSON.parse(await res.text());
  } catch {
    throw new Error(`The email script gave an unexpected response (HTTP ${res.status}). Check APPS_SCRIPT_URL.`);
  }
  if (!data || data.ok !== true) throw new Error(`The email script rejected the postcard: ${data?.error || 'unknown error'}`);
}
