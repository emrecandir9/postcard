# Field Notes Postcard — design

Date: 2026-11-14

## Intent

A personal, self-hosted version of prettypostcard.com. Upload a travel photo, fill in a few
details, and get a "rubber stamp field notes" postcard: the photo plus an aged-paper panel with
a small hand-stamped drawing of the scene and typewriter text. Download it now, or have it
emailed on a future date.

Why this shape: Gemini (Nano Banana) draws a good stamp but gets layout and cropping wrong when
asked for the whole poster. So the app does all cropping and joining itself, and Gemini only
draws the paper panel. The layout is then identical every time.

## Goals

- Runs on the owner's Mac at a local address. One user, no accounts.
- Image generation through the `agy` CLI on the owner's Google AI Pro plan. No API key, no paid service.
- Landing page similar in spirit to prettypostcard.com, with placeholder example images.
- Create page: form on the left, live preview on the right; responsive down to phone width
  (the two columns stack).
- Exact, repeatable output layout for both photo orientations.
- Scheduled email that goes out even when the Mac is off.

## Non-goals

- Public hosting, accounts, pricing, FAQ, physical mail.
- Multiple photos per postcard, galleries, history of past postcards.

## Anti-goals

- Any path that costs money (API billing, paid email service, domain).
- Gemini redrawing, cropping or altering the photo. The photo in the result is the user's
  own pixels, cropped by the app.

## Approaches

**Generation**
1. Hosted public site calling the Gemini API. Rejected: costs money per image.
2. Hosted site with the Mac as a background generator. Rejected: only works while the Mac is on,
   and spends a personal plan on public traffic.
3. **Chosen: local app on the Mac that calls `agy` directly.** Free, simple, private.

**Scheduled email**
1. **Chosen: Google Apps Script in the owner's Google account.** The app posts the finished
   postcard, recipient, date and message to the script. The script stores it in Drive and an
   hourly trigger sends what is due from the owner's Gmail. Any future date, no domain, free.
2. Resend with built-in scheduling. Rejected: short scheduling window, needs a domain.
3. Daily GitHub Actions job. Rejected: postcards stored in a repo; scheduled jobs pause after
   60 days of inactivity.

## Pages

**Landing (`/`)** — hero with headline, short description and a "Create postcard" button, a row
of example postcards (placeholders for now), a three-step "how it works" strip, footer. The
button goes to `/create`.

**Create (`/create`)**

Left column, in order:
1. Photo upload (drag and drop or click; JPEG/PNG/WebP/HEIC if the browser can read it).
2. Location (text).
3. Three words to describe the photo (optional; left blank, Gemini suggests them).
4. Date: month (short name: Jan, Feb, …) and year. Defaults to the current month.
5. Delivery: "Download now" or "Send by email".
   - Email selected: recipient email, send date (date picker, today or later), optional message.
6. Create button.

Right column: live preview, drawn in the browser at the final proportions.
- The uploaded photo, cropped exactly as it will be in the result.
- The paper panel in the cream paper colour, with the text in the final typewriter font and
  positions, updating as the user types. Empty fields show grey placeholders
  ("LOCATION", "word · word · word", "MON YEAR").
- A dashed placeholder box where the stamp will go, labelled "stamp drawn after you create".
- Before upload, the photo area is a placeholder in the horizontal layout.

After Create: a progress state (generation takes about a minute), then the finished postcard
replaces the preview, with a Download button — or, for email, a confirmation line
("Scheduled for 14 May 2027 to name@…") plus Download.

## Layout rules (width:height throughout)

| Photo | Photo crop | Paper panel | Joined | Result |
|---|---|---|---|---|
| Horizontal (wider than tall) | 16:9, centred | 16:7 | paper below photo | 1:1 |
| Vertical or square | 3:4, centred | 1:2 | paper right of photo | 5:4 |

- Crops are centred: equal amounts off top and bottom, or off left and right when the photo is
  already wider (or narrower) than the target.
- Output sizes: horizontal 2048×2048 (photo 2048×1152, paper 2048×896); vertical 2400×1920
  (photo 1440×1920, paper 960×1920). The photo is not upscaled beyond 2× its own size; if it
  is small, the whole result scales down to fit.
- EXIF rotation is applied before measuring orientation.
- Photo and paper meet directly. No line, border or shadow.

## Generation pipeline (server)

1. Receive photo and fields. Fix rotation, decide orientation, crop the photo.
2. If keywords are blank: one text-only `agy` call with the photo, asking for exactly three short
   English keywords as JSON.
3. One image `agy` call: the cropped photo as reference plus the rewritten prompt (below),
   asking for the paper panel only in the nearest supported ratio.
4. Find the new image under `~/.gemini/antigravity-cli/brain/` (newest file after a marker),
   polling briefly because agy may answer before the file exists.
5. Fit the panel: centre-crop to the exact target ratio (16:7 or 1:2), resize to the target size.
6. Print the text onto the panel (see below).
7. Join photo and panel, save as JPEG (quality ~92), return it.
8. Email mode: also post the JPEG and details to the Apps Script.

One generation at a time; a second request waits. Failures (agy error, timeout after 5 min,
no image found, quota exhausted) show a plain message and a Retry button; the form keeps its
contents.

## Text — builder's call, flagged for the owner

**The app prints the text; Gemini draws only paper and stamp.** Reason: this is the only way
the preview and the result match exactly, and it rules out misspelled or drifting text. The font
is a typewriter face (Special Elite, bundled locally), dark warm grey, slightly transparent and
multiplied onto the paper so the grain shows through.

Fixed positions, as fractions of the paper panel:
- Horizontal panel (16:7): stamp zone is the left-centre region (x 12–48%, y 15–85%). Text
  block starts at x 60%, vertically centred, left-aligned: location (largest), keywords joined
  with " · ", then "MON YEAR".
- Vertical panel (1:2): stamp zone x 12–88%, y 30–72%. Text block centred horizontally, starting
  at y 78%: location, keywords (one per line if they do not fit on one), "MON YEAR".
- Long locations shrink to fit the available width, down to a minimum size, then wrap.

The alternative (Gemini draws the text too, as in the original prompt) is one prompt change
away if the printed text looks too clean.

## Rewritten prompt (paper panel only)

Two variants share everything except the first block. Kept from the original, unchanged in
substance: PAPER AREA, STAMP CONTENT, INKS, SKY INK, STAMP RENDERING, MOOD. Removed: LAYOUT of
the whole poster, PHOTO CROP, PHOTO AREA, TEXT. Changed: the opening task, placement, AVOID.

Opening (horizontal variant):

> The attached photo is a reference only. Do not reproduce, include or redraw the photo itself.
> Create one image: a wide strip of softly aged cream paper, aspect ratio 16:7 (use the widest
> ratio available if 16:7 is not), filled edge to edge with paper and nothing else. The paper
> runs off all four edges: no border, frame, shadow, margin, torn edge or background behind it.
> On the paper, print one small multi-colour rubber stamp impression derived from the photo.
> Place the stamp left of centre: its centre about 30% from the left edge and vertically
> centred, about 60–70% of the strip's height. Leave the right half of the strip completely
> blank paper. No text, letters, numbers, captions, dates or signatures anywhere.

Vertical variant: "a tall panel … aspect ratio 1:2 (use the tallest ratio available if 1:2 is
not) … stamp horizontally centred, its centre about 50% down the panel, the stamp about 40% of the
panel's height tall … leave the bottom quarter and the top quarter blank."

AVOID adds: any text or lettering, any part of the photo itself, a photo-realistic image, paper
edges or a table behind the paper. AVOID drops the items about cropping, dividing lines and
photo borders.

## Scheduled email (Google Apps Script)

- A script file in the repo (`apps-script/Code.gs`) that the owner pastes into
  script.google.com and deploys as a web app ("execute as me"). Setup steps in the README.
- `doPost`: checks a shared secret, saves the JPEG to a Drive folder, appends a row to a sheet
  (recipient, send date, message, file id, status).
- Hourly trigger: for rows due today or earlier and not sent, sends an email from the owner's
  Gmail with the postcard inline and attached, the location as subject line, and the message as
  body; marks the row sent.
- Emails go out on the chosen day, in the morning of the script's time zone. No time-of-day picker.
- The web app URL and secret live in a local `.env` file. If they are missing, the email option
  is shown disabled with a note pointing to the setup steps.

## Technical choices (builder's calls)

- Node app, Express, `sharp` for cropping, text and joining, `multer` for upload.
- Front-end: plain HTML/CSS/JS, no framework; preview drawn with CSS and an `<img>` using
  `object-fit: cover`, at the same fractions the server uses (shared layout constants).
- Visual style: taken from one or two reference styles on styles.refero.design, shown to the
  owner before the pages are built.
- `agy` calls: `agy -p "<prompt>" --model gemini-4-argon-high --mode accept-edits
  --print-timeout 300s --add-dir <job folder> < /dev/null`, with the cropped photo named by
  absolute path in the prompt.
- Nothing is stored after a job except the result file for the current session, in a temp folder.

## Verification

- Unit tests for the layout maths: orientation, crop boxes, output sizes for 4:3, 3:2, 16:9,
  21:9, 1:1, 3:4, 9:16 inputs.
- A test that joins a fake paper panel and checks the result is exactly 1:1 or 5:4 with the
  photo pixels untouched in their region.
- One real end-to-end run of each orientation through `agy`, checked by eye.
- Email: one postcard scheduled for today to the owner's own address, confirmed received.

## Left to the builder

File layout, exact copy on the landing page, loading animation, font sizes within the rules above.

## Known risks

- `agy` has no aspect-ratio option; the ratio is requested in the prompt and the panel is
  cropped to fit. Gemini may return a less extreme ratio (e.g. 16:9 instead of 16:7); the centre
  crop then trims paper top and bottom, which is why the stamp is asked for at 60–70% height.
- Gemini may sometimes include text or a paper edge despite the prompt. Mitigation: Retry button.
- Apps Script web-app posts are limited to roughly 50 MB and Gmail to about 100 emails a day;
  both far above this use.
