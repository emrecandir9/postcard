import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { emailEnabled, scheduleEmail } from '../lib/email.js';

let server;
let received;
let reply;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      received = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.APPS_SCRIPT_URL = `http://localhost:${server.address().port}/exec`;
  process.env.APPS_SCRIPT_SECRET = 's3cret';
});

after(() => {
  server.close();
  delete process.env.APPS_SCRIPT_URL;
  delete process.env.APPS_SCRIPT_SECRET;
});

const job = { recipient: 'me@example.com', sendDate: '2027-05-14', message: 'Hi', location: 'Lisbon', jpeg: Buffer.from('jpegbytes') };

test('emailEnabled needs both URL and secret', () => {
  assert.equal(emailEnabled(), true);
  const s = process.env.APPS_SCRIPT_SECRET;
  delete process.env.APPS_SCRIPT_SECRET;
  assert.equal(emailEnabled(), false);
  process.env.APPS_SCRIPT_SECRET = s;
});

test('scheduleEmail posts the contract JSON', async () => {
  reply = { ok: true };
  await scheduleEmail(job);
  assert.equal(received.secret, 's3cret');
  assert.equal(received.recipient, 'me@example.com');
  assert.equal(received.sendDate, '2027-05-14');
  assert.equal(received.message, 'Hi');
  assert.equal(received.location, 'Lisbon');
  assert.match(received.filename, /\.jpg$/);
  assert.equal(Buffer.from(received.imageBase64, 'base64').toString(), 'jpegbytes');
});

test('scheduleEmail throws the script error when ok is false', async () => {
  reply = { ok: false, error: 'bad secret' };
  await assert.rejects(scheduleEmail(job), /bad secret/);
});
