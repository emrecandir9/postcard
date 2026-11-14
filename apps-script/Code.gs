/**
 * Postcard email scheduler (Google Apps Script, V8 runtime).
 *
 * The postcard app on the Mac POSTs a finished postcard here. This script
 * saves the JPEG to a Drive folder and a row to a spreadsheet, both called
 * "Postcard outbox". An hourly trigger (made by setup) sends what is due from
 * your own account. Setup steps: docs/email-setup.md
 *
 * Request JSON:  { secret, recipient, sendDate, message, location, filename, imageBase64 }
 * Response JSON: { "ok": true }  or  { "ok": false, "error": "..." }
 * (Apps Script web apps always answer HTTP 200; read "ok" instead.)
 */

const OUTBOX_NAME = 'Postcard outbox';
const HEADERS = ['created', 'recipient', 'sendDate', 'location', 'message', 'fileId', 'status', 'sentAt'];
const COL = { created: 0, recipient: 1, sendDate: 2, location: 3, message: 4, fileId: 5, status: 6, sentAt: 7 };
const MAX_LOCATION = 200;
const MAX_MESSAGE = 5000;
// Nothing is sent before this hour (script time zone), so postcards arrive in the morning.
const SEND_FROM_HOUR = 8;

// ---------------------------------------------------------------------------
// Entry points: doPost (web app), sendDue (hourly trigger), setup (run once)
// ---------------------------------------------------------------------------

function doPost(e) {
  const unauthorized = { ok: false, error: 'unauthorized' };
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_(unauthorized);
  }
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!data || typeof data !== 'object' || !secretMatches_(data.secret, secret)) {
    return json_(unauthorized);
  }

  const check = validateRequest_(data);
  if (!check.ok) return json_({ ok: false, error: check.error });
  const v = check.value;

  let bytes;
  try {
    bytes = Utilities.base64Decode(v.imageBase64);
  } catch (err) {
    return json_({ ok: false, error: 'imageBase64 is not valid base64' });
  }
  if (!isJpeg_(bytes)) return json_({ ok: false, error: 'image is not a JPEG' });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ ok: false, error: 'busy, please try again' });
  }
  try {
    const folder = getOutboxFolder_();
    const file = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', v.filename));
    const sheet = getOutboxSheet_(folder);
    const created = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    appendTextRow_(sheet, [created, v.recipient, v.sendDate, v.location, v.message, file.getId(), 'pending', '']);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: 'could not save postcard: ' + errorText_(err) });
  } finally {
    lock.releaseLock();
  }
}

function sendDue() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) return; // nothing has been posted yet

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // another run is busy; the next hourly run picks it up
  try {
    const ss = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheets()[0];
    const tz = Session.getScriptTimeZone();
    const now = new Date();
    const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const hour = Number(Utilities.formatDate(now, tz, 'H'));
    const rows = sheet.getDataRange().getValues();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const sendDate = dateCellToString_(row[COL.sendDate], ss.getSpreadsheetTimeZone());
      if (!isDue_(row[COL.status], sendDate, today, hour)) continue;

      let result;
      try {
        sendPostcard_(row);
        result = ['sent', Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm')];
      } catch (err) {
        result = ['error: ' + errorText_(err), ''];
      }
      sheet.getRange(i + 1, COL.status + 1, 1, 2).setNumberFormat('@').setValues([result]);
    }
  } finally {
    lock.releaseLock();
  }
}

function setup() {
  const exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'sendDue';
  });
  if (!exists) ScriptApp.newTrigger('sendDue').timeBased().everyHours(1).create();
  Logger.log(exists ? 'The hourly trigger was already set up.' : 'Hourly trigger created.');
  if (!PropertiesService.getScriptProperties().getProperty('SECRET')) {
    Logger.log('Warning: the SECRET script property is not set yet. Every request will be refused until it is.');
  }
}

// ---------------------------------------------------------------------------
// Drive, Sheets and Mail helpers
// ---------------------------------------------------------------------------

function getOutboxFolder_() {
  const found = DriveApp.getFoldersByName(OUTBOX_NAME);
  return found.hasNext() ? found.next() : DriveApp.createFolder(OUTBOX_NAME);
}

function getOutboxSheet_(folder) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) {
    try {
      if (!DriveApp.getFileById(id).isTrashed()) return SpreadsheetApp.openById(id).getSheets()[0];
    } catch (err) {
      // deleted or not accessible: make a new one below
    }
  }
  const ss = SpreadsheetApp.create(OUTBOX_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  const sheet = ss.getSheets()[0];
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  props.setProperty('SHEET_ID', ss.getId());
  return sheet;
}

// Writes the row as plain text so Sheets does not turn "2026-11-14" into a date
// or a message starting with "=" into a formula.
function appendTextRow_(sheet, values) {
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setNumberFormat('@').setValues([values]);
}

function sendPostcard_(row) {
  const recipient = String(row[COL.recipient]).trim();
  const location = String(row[COL.location]);
  const message = String(row[COL.message]);
  const blob = DriveApp.getFileById(String(row[COL.fileId]).trim()).getBlob();
  MailApp.sendEmail({
    to: recipient,
    subject: subjectFor_(location),
    body: plainBody_(message),
    htmlBody: htmlBody_(message, location),
    inlineImages: { postcard: blob.copyBlob() },
    attachments: [blob],
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Pure logic (no Google services; checked under Node)
// ---------------------------------------------------------------------------

function secretMatches_(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected === '') return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function validateRequest_(data) {
  const recipient = typeof data.recipient === 'string' ? data.recipient.trim() : '';
  if (!isEmail_(recipient)) return { ok: false, error: 'recipient must be one email address' };

  const sendDate = typeof data.sendDate === 'string' ? data.sendDate.trim() : '';
  // Past dates are accepted on purpose: the Mac and the script may be in different
  // time zones. A past date is simply sent on the next run.
  if (!isValidDate_(sendDate)) return { ok: false, error: 'sendDate must be a real date as YYYY-MM-DD' };

  if (data.location != null && typeof data.location !== 'string') return { ok: false, error: 'location must be text' };
  const location = oneLine_(data.location || '');
  if (location.length > MAX_LOCATION) return { ok: false, error: 'location is too long' };

  if (data.message != null && typeof data.message !== 'string') return { ok: false, error: 'message must be text' };
  const message = (data.message || '').trim();
  if (message.length > MAX_MESSAGE) return { ok: false, error: 'message is too long' };

  if (typeof data.imageBase64 !== 'string' || data.imageBase64 === '') {
    return { ok: false, error: 'imageBase64 is missing' };
  }

  return {
    ok: true,
    value: {
      recipient: recipient,
      sendDate: sendDate,
      location: location,
      message: message,
      filename: safeFilename_(data.filename),
      imageBase64: data.imageBase64,
    },
  };
}

function isEmail_(s) {
  return typeof s === 'string' && s.length <= 254 && /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/.test(s);
}

function isValidDate_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Due when still pending, the send date is today or earlier (YYYY-MM-DD compares
// correctly as text), and it is at least SEND_FROM_HOUR o'clock.
function isDue_(status, sendDate, today, hour) {
  return String(status).trim() === 'pending' && isValidDate_(sendDate) && sendDate <= today && hour >= SEND_FROM_HOUR;
}

// Sheets may hand back a Date if a cell was ever reformatted; turn it back into YYYY-MM-DD.
function dateCellToString_(value, tz) {
  if (value instanceof Date) return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  return String(value).trim();
}

function isJpeg_(bytes) {
  return !!bytes && bytes.length > 3 && (bytes[0] & 0xff) === 0xff && (bytes[1] & 0xff) === 0xd8 && (bytes[2] & 0xff) === 0xff;
}

function safeFilename_(name) {
  const base = String(name || '').replace(/\.jpe?g$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return (base.slice(0, 80) || 'postcard') + '.jpg';
}

function oneLine_(s) {
  return String(s).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function subjectFor_(location) {
  const place = oneLine_(location || '');
  return place ? 'A postcard from ' + place : 'A postcard';
}

function plainBody_(message) {
  return (message ? message + '\n\n' : '') + 'The postcard is attached.';
}

function htmlBody_(message, location) {
  const text = message ? '<p>' + escapeHtml_(message).replace(/\r?\n/g, '<br>') + '</p>' : '';
  const alt = escapeHtml_(subjectFor_(location));
  return (
    '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#222">' +
    text +
    '<img src="cid:postcard" alt="' + alt + '" style="display:block;max-width:100%;height:auto">' +
    '</div>'
  );
}

function errorText_(err) {
  return err && err.message ? err.message : String(err);
}
