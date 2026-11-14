import sharp from 'sharp';
import { LAYOUTS, PAPER_COLOR, orientationOf, cropBox, outputScale } from '../shared/layout.js';

/** A layout rectangle scaled to whole pixels. Edges are rounded, so adjacent regions share a boundary. */
function scaled(rect, scale) {
  const x = Math.round(rect.x * scale);
  const y = Math.round(rect.y * scale);
  return { x, y, w: Math.round((rect.x + rect.w) * scale) - x, h: Math.round((rect.y + rect.h) * scale) - y };
}

/** Pixel regions of the result at a given scale. */
export function regions(orientation, scale) {
  const L = LAYOUTS[orientation];
  return {
    out: scaled({ x: 0, y: 0, ...L.out }, scale),
    photo: scaled(L.photo, scale),
    paper: scaled(L.paper, scale),
  };
}

/**
 * Apply EXIF rotation, decide orientation, centre-crop to the layout ratio and resize.
 * The photo is the user's own pixels: only rotated, cropped and resized.
 */
export async function preparePhoto(buffer) {
  const { data, info } = await sharp(buffer).rotate().raw().toBuffer({ resolveWithObject: true });
  const raw = { raw: { width: info.width, height: info.height, channels: info.channels } };
  const orientation = orientationOf(info.width, info.height);
  const box = cropBox(info.width, info.height, LAYOUTS[orientation].photoRatio);
  const scale = outputScale(orientation, box.width);
  const { photo } = regions(orientation, scale);
  const out = await sharp(data, raw)
    .extract(box)
    .resize(photo.w, photo.h, { fit: 'fill' })
    .png({ compressionLevel: 1 })
    .toBuffer();
  return { orientation, scale, photo: out };
}

/** Centre-crop a generated panel to the exact paper ratio and resize it to the paper size. */
// Share of each side trimmed off Gemini's panel before it is fitted. With one drawing per postcard,
// the first draft sometimes shows a faint paper edge along its borders; this cuts it away.
export const PANEL_EDGE_TRIM = 0.03;

export async function fitPanel(buffer, orientation, scale) {
  const { paper } = regions(orientation, scale);
  const { data, info } = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
  const dx = Math.round(info.width * PANEL_EDGE_TRIM);
  const dy = Math.round(info.height * PANEL_EDGE_TRIM);
  return sharp(data)
    .extract({ left: dx, top: dy, width: info.width - 2 * dx, height: info.height - 2 * dy })
    .resize(paper.w, paper.h, { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .png({ compressionLevel: 1 })
    .toBuffer();
}

/** Join photo and panel edge to edge; JPEG quality 92. */
export async function compose(photo, panel, orientation, scale) {
  const r = regions(orientation, scale);
  return sharp({ create: { width: r.out.w, height: r.out.h, channels: 3, background: PAPER_COLOR } })
    .composite([
      { input: photo, left: r.photo.x, top: r.photo.y },
      { input: panel, left: r.paper.x, top: r.paper.y },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}
