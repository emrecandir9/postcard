# Field Notes Postcard

A small local web app that turns a travel photo into a "rubber stamp field notes" postcard. You
upload a photo and type a location. The app crops the photo and asks Google Gemini (through the
`agy` command-line tool) to draw an aged-paper panel with a small hand-stamped picture of the
scene. It then prints the text in a typewriter font and joins photo and panel into one image.
Download it straight away, or have it emailed on a date you pick.

- Horizontal photos give a square postcard (photo on top, paper below).
- Vertical or square photos give a 5:4 postcard (photo left, paper right).
- The photo in the postcard is your own pixels, only cropped and resized. Gemini draws only the paper panel.

## Requirements

- macOS with Node.js 22 or newer.
- The `agy` CLI installed and signed in (it uses your Google AI Pro plan, so there is no API key and nothing to pay).

## Run it

```sh
npm install
npm start
```

Then open http://localhost:3000. Set `PORT` to use another port. Each postcard takes one to three
minutes, and only one is made at a time.

## Tests

```sh
npm test
```

## Scheduled email (optional)

Email goes through a Google Apps Script in your own Google account, so it is sent even when the Mac
is off. Follow [docs/email-setup.md](docs/email-setup.md), then copy `.env.example` to `.env` and
fill in `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET`. Until both are set, the email option stays off.

## Where things are

- `server.js`: web server and the `/api/postcards` endpoint.
- `lib/`: cropping and joining (`pipeline.js`), the `agy` calls (`agy.js`), prompts (`prompt.js`), text printing (`text.js`), email hand-off (`email.js`).
- `shared/layout.js`: all sizes and positions, used by both the server and the browser preview.
- `public/`: the web pages.
- `docs/samples/`: example postcards from real runs.

Finished postcards are kept in your system temp folder (`postcard-results`) and are not stored anywhere else.

## Font

Special Elite by Astigmatic, from the google/fonts repository, licensed under the Apache License 2.0.
