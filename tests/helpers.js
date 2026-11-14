import sharp from 'sharp';

export const blank = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#888' } });

/** Degrees → EXIF rational triple "d/1 m/1 s*100/100". */
function dms(deg) {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60 * 100);
  return `${d}/1 ${m}/1 ${s}/100`;
}

/** A small JPEG carrying an EXIF capture date and/or GPS position. */
export async function jpegWithExif({ date, lat, lon }) {
  const exif = { IFD0: { Make: 'Test' } };
  if (date) exif.IFD2 = { DateTimeOriginal: date };
  if (lat !== undefined) {
    exif.IFD3 = {
      GPSLatitudeRef: lat >= 0 ? 'N' : 'S',
      GPSLatitude: dms(lat),
      GPSLongitudeRef: lon >= 0 ? 'E' : 'W',
      GPSLongitude: dms(lon),
    };
  }
  return blank().withExif(exif).jpeg().toBuffer();
}
