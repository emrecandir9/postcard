import { LAYOUTS, PAPER_COLOR } from '../shared/layout.js';

const pct = (f) => `${Math.round(f * 100)}%`;

// Owner's original sections (docs/original-prompt.md), kept unchanged in substance.
// PAPER AREA: the colour range is replaced by the app's paper colour so the panel matches the preview.
const SHARED = `PAPER AREA
Softly aged cream paper: slightly warmer and deeper than off-white, like a field journal page kept for a few years (averaging about ${PAPER_COLOR}). Gentle, uneven tonal variation, a little warmer toward the outer edges, subtle fibers, natural grain, a few faint handling marks, and a matte surface. The aging stays quiet: a light nostalgic warmth, not yellowed, not brown, not parchment. Never pure or bright digital white. Large areas of unprinted paper are kept as whitespace; the blank space is an essential part of the layout.

STAMP CONTENT
Analyze the original photo and extract the most location-distinctive subject outlines, architectural structures, terrain contours, plant forms, roads, shorelines, or other key visual relationships, and compress them into a small multi-color rubber stamp image.
Do not replicate every element of the photo. Keep only the minimum information needed to instantly recognize the location, subject, and scene relationships. Remove crowds, dense windows, fragmented vegetation, and irrelevant backgrounds.
The stamp keeps ample whitespace around it and is never enlarged into a standard illustration, full landscape painting, or brand logo. It has no frame or border; its edges fade naturally into the paper.
Organize the stamp based on the photo's composition:
* Iconic architecture: the most distinctive outer contours, roofs, domes, arches, towers, or main structures.
* Mountain settlements: buildings compressed into a few terraced color blocks aligned along the terrain.
* Coastal scenery: mountain contours, settlement layers, shorelines, and sparse intermittent water ripples.
* City panoramas: the main skyline, one iconic building, and one or two layers of distant mountains.
* Natural landscapes: primary mountain forms, trees, shorelines, or road directions.
* Foreground occlusions: if narratively important in the photo, kept as foreground stamp outlines.

INKS
2–4 spot inks extracted from the original photo. Prioritize desaturated colors like carbon black, deep green, brick red, ochre yellow, slate blue, or taupe brown, without forcing a fixed palette. Preserve the most distinctive color character of the photo, with only a small area of color for visual emphasis.

SKY INK
When sky is visible in the photo, its color appears in the stamp as one extra light spot ink (maximum 5 inks in total), sampled from the sky's actual hue: faded powder blue for a clear sky, pale grey-blue for overcast, muted apricot or dusty rose for sunset. It is used sparingly, only behind the skyline or ridgeline, as a few loose horizontal bands, a soft partial patch, or broken horizontal strokes that fade out before the stamp's edges. It covers roughly 15–25% of the stamp area, printed with light pressure so the paper shows through, and stays lighter than the main inks so it sits behind the subject. Never a filled sky block or smooth gradient. No sky in the photo, no sky ink.

STAMP RENDERING
Each color is a separately hand-stamped layer: authentic rubber stamp carving texture, hand-engraved marks, uneven line widths, contour notches, fractured edges, dry ink shortages, paper show-through, granular ink, uneven pressure, partial ghosting, and about 1–2 mm of subtle misregistration.
Natural misalignment between color layers; edges are never digitally smoothed. The print looks like a real carved stamp pressed onto aged paper, not a filtered photo, smooth vector illustration, or line-art logo.

MOOD
Like field notes kept by an architect, travel writer, or natural observer: quiet, restrained, tactilely real, regionally specific, with handmade imperfections and a collectible feel. The stamp captures the most recognizable fragments of memory.

AVOID
Any text, letters, numbers, captions, dates, signatures or lettering of any kind; any part of the reference photo itself; a photo-realistic image; paper edges, a frame, a shadow or a table or background behind the paper; circular seals, Chinese red stamps, postage stamp perforations, wax seals, sticker collages, tourist souvenir templates, smooth vector logos, generic city icons, full replication of all architecture, dense detailing, childlike craftiness, cartoon style, 3D rendering, plastic textures, glossy digital gradients, oversaturation, decorative clutter, pure or bright white paper, heavy yellowing, tea or coffee stains, burnt or torn edges, antique treasure-map parchment, a filled sky block or smooth sky gradient in the stamp.`;

function placement(orientation) {
  const z = LAYOUTS[orientation].stampZone;
  const box = `The whole stamp, including any water lines or sky bands, stays inside the box from ${pct(z.x)} to ${pct(z.x + z.w)} of the width (measured from the left edge) and from ${pct(z.y)} to ${pct(z.y + z.h)} of the height (measured from the top edge); it does not have to fill the box.`;
  if (orientation === 'horizontal') {
    return `Place the stamp left of centre: its centre about ${pct(z.x + z.w / 2)} from the left edge and ${pct(z.y + z.h / 2)} from the top, the stamp about ${pct(z.h - 0.1)}–${pct(z.h)} of the strip's height tall and at most ${pct(z.w)} of its width wide. ${box} Leave the right half of the strip and everything outside that box completely blank paper.`;
  }
  return `Place the stamp horizontally centred: its centre about ${pct(z.x + z.w / 2)} from the left edge and ${pct(z.y + z.h / 2)} down the panel, the stamp about ${pct(z.h)} of the panel's height tall and at most ${pct(z.w)} of its width wide, with clear paper on both sides. ${box} Leave the top quarter, the bottom quarter and everything outside that box completely blank paper.`;
}

/**
 * The full description of the panel. It is written to a file in the job folder and the agent is pointed
 * at it, so the agent does not spend time rewriting a long prompt for its image generator.
 */
export function panelBrief(orientation) {
  const shape = orientation === 'horizontal'
    ? 'a wide strip of softly aged cream paper, aspect ratio 16:7 (use the widest ratio available if 16:7 is not)'
    : 'a tall panel of softly aged cream paper, aspect ratio 1:2 (use the tallest ratio available if 1:2 is not)';
  return `The reference photo is a reference only: look at it to understand the scene. Do not reproduce, include or redraw the photo itself.
Create one image: ${shape}, filled edge to edge with paper and nothing else. The paper runs off all four edges: no border, frame, shadow, margin, torn edge or background behind it.
On the paper, print one small multi-colour rubber stamp impression derived from the photo.
${placement(orientation)}
No text, letters, numbers, captions, dates or signatures anywhere.

${SHARED}
`;
}

/**
 * The agy prompt: one call makes the panel and, when wanted, suggests the keywords in the same reply
 * (the reply is printed after the image exists, so no second call is needed).
 */
export function panelPrompt(photoPath, briefPath, { keywords = false } = {}) {
  const kw = keywords
    ? `\nBefore you generate anything, look at the photo, choose three short English keywords (one word each, lowercase) that describe what is in it, and write them straight away as one line: a JSON array of strings, for example ["tram","hills","tiles"].`
    : '';
  const reply = keywords
    ? 'reply with only two lines: the absolute path of the image, then the same keywords line again.'
    : 'reply with only one line: the absolute path of the final image.';
  return `Generate exactly one image with your image generator: call it once and only once. Whatever it returns is final, even if it is not perfect. Never regenerate, retry, refine or make a second version, and tell the image generator the same. Pass it these two files by path, unchanged; do not rewrite or summarise the brief:
- ${briefPath}: the full description of the image to make.
- ${photoPath}: the reference photo the stamp is based on (the photo itself must not appear in the image).${kw}
When the image is ready, ${reply} Do not open, check, copy, convert or edit the image afterwards, and do not run any commands.`;
}
