import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import opentype from 'opentype.js';
import { INK_COLOR, INK_OPACITY, textLines } from '../shared/layout.js';

export const FONT_PATH = fileURLToPath(new URL('../assets/fonts/SpecialElite-Regular.ttf', import.meta.url));

// Glyph outlines come straight from the bundled TTF (no system font lookup, so no silent fallback).
const bytes = readFileSync(FONT_PATH);
const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

/**
 * Print the text lines onto a paper panel (already sized to the paper region), as an SVG overlay of
 * glyph paths, in INK_COLOR at INK_OPACITY, multiplied onto the paper.
 */
export async function printText(panelBuffer, orientation, strings) {
  const { width: W, height: H } = await sharp(panelBuffer).metadata();
  const paths = textLines(orientation, strings).map((line) => {
    const px = line.size * W;
    const width = font.getAdvanceWidth(line.text, px);
    const left = line.align === 'center' ? line.x * W - width / 2 : line.x * W;
    // Baseline placed as a browser would centre the line box: centre + (ascent - descent) / 2.
    const baseline = line.y * H + ((font.ascender + font.descender) / 2 / font.unitsPerEm) * px;
    return font.getPath(line.text, left, baseline, px).toPathData(2);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
    + paths.map((d) => `<path d="${d}" fill="${INK_COLOR}" fill-opacity="${INK_OPACITY}"/>`).join('')
    + '</svg>';
  return sharp(panelBuffer)
    .composite([{ input: Buffer.from(svg), blend: 'multiply' }])
    .png({ compressionLevel: 1 })
    .toBuffer();
}
