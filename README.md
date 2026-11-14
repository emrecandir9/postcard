# Field Notes Postcard

A small local web app that turns a travel photo into a "rubber stamp field notes" postcard. You
upload a photo; location and date are optional. The app crops the photo and asks Google Gemini (through the
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

Then open http://localhost:3000. Set `PORT` to use another port.

## How a postcard is made

1. On `/create` you pick a photo. The page asks the server for the photo's metadata
   (`POST /api/metadata`) and fills in the place ("City, Country", from the GPS position) and the
   month and year it was taken. Every field can be changed or cleared.
2. "Create postcard" sends the form (`POST /api/postcards`). The server answers at once with a job id
   and the browser moves to `/making?id=…`, which polls `GET /api/postcards/<id>` and shows the stage:
   - **preparing**: read the photo, fill blank fields from its metadata, rotate and crop it;
   - **drawing**: Gemini draws the paper panel with the stamp (the long part);
   - **printing**: the text is printed in the typewriter font;
   - **finishing**: photo and panel are joined, saved, and the email is scheduled if asked.
3. When it is done the browser shows `/postcard?id=…` with the finished image.

Location, month and year: a typed value wins. A field the form does not send at all is taken from
the photo's metadata; if the photo has none, that line is left off. A field sent empty (you cleared
what the page filled in) is left off the postcard on purpose. Places are looked up offline (GeoNames
cities with 1,000+ people, from the `all-the-cities` package); nothing is sent anywhere.

Keywords: if you leave them blank, Gemini suggests three in the same call that draws the panel. If its
reply has no usable keywords, the keywords line is left off rather than asking again (that would
double the wait).

Only one postcard is made at a time; a second one waits in "preparing". Finished postcards stay
readable after a restart (a small `<id>.json` is saved beside each `<id>.jpg`). The server log shows
how long each stage took, plus the steps inside "drawing" (when agy's image appeared, when it replied).

Optional settings in `.env`: `AGY_MODEL`, `AGY_EFFORT`, `AGY_AGENT` are passed to `agy` as `--model`,
`--effort` and `--agent` (empty means agy's default).

## Tests

```sh
npm test
```

## Scheduled email (optional)

Email goes through a Google Apps Script in your own Google account, so it is sent even when the Mac
is off. Follow [docs/email-setup.md](docs/email-setup.md), then copy `.env.example` to `.env` and
fill in `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET`. Until both are set, the email option stays off.

## Where things are

- `server.js`: web server, the `/api/postcards` jobs and `/api/metadata`.
- `lib/`: cropping and joining (`pipeline.js`), the `agy` call (`agy.js`), prompts (`prompt.js`), text printing (`text.js`), email hand-off (`email.js`), photo metadata and place names (`metadata.js`), the job list (`jobs.js`).
- `shared/layout.js`: all sizes and positions, used by both the server and the browser preview.
- `public/`: the web pages.
- `docs/samples/`: example postcards from real runs.

Finished postcards (and their small status files) are kept in your system temp folder
(`postcard-results`) and are not stored anywhere else.

## Font

Special Elite by Astigmatic, from the google/fonts repository, licensed under the Apache License 2.0.
