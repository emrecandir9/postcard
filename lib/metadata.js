import exifr from 'exifr';
import { MONTHS } from '../shared/layout.js';

// Offline reverse geocoding: GeoNames cities with population >= 1000 (npm `all-the-cities`, ~6 MB).
// Loaded on first use only, so server start stays fast (~80 ms to decode, once).
let cities = null;
async function loadCities() {
  if (!cities) {
    const { default: all } = await import('all-the-cities');
    // Leave out sections of a city (PPLX, e.g. "Financial District") and historical,
    // abandoned or destroyed places.
    const skip = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);
    cities = all
      .filter((c) => !skip.has(c.featureCode))
      .map((c) => ({ name: c.name, country: c.country, population: c.population, lon: c.loc.coordinates[0], lat: c.loc.coordinates[1] }));
  }
  return cities;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const MAX_DISTANCE_KM = 100; // farther than this from any town: no location rather than a misleading one
const RADIUS_PER_SQRT_POP = 0.005; // km; a city of population P is treated as a disc of radius 0.005·√P

function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/**
 * "City, Country" for a GPS position, or null when nothing is within 100 km.
 * Nearest city by distance, except that a point inside a big city's rough extent (a disc sized by its
 * population) belongs to that city: the Eiffel Tower is 3.4 km from Neuilly-sur-Seine's centre point
 * and 4.0 km from Paris's, but it is in Paris. When several discs contain the point, the one it is
 * most deeply inside (smallest distance / radius) wins.
 */
export async function placeName(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null; // unset GPS written as zeros
  let nearest = null;
  let nearestD = Infinity;
  let inside = null;
  let insideRatio = Infinity;
  for (const c of await loadCities()) {
    if (Math.abs(c.lat - lat) > 2) continue; // cheap pre-filter: > ~220 km away in latitude
    const d = distanceKm(lat, lon, c.lat, c.lon);
    if (d < nearestD) {
      nearest = c;
      nearestD = d;
    }
    const radius = RADIUS_PER_SQRT_POP * Math.sqrt(c.population);
    if (d <= radius && d / radius < insideRatio) {
      inside = c;
      insideRatio = d / radius;
    }
  }
  const city = inside ?? (nearestD <= MAX_DISTANCE_KM ? nearest : null);
  if (!city) return null;
  let country = city.country;
  try {
    country = regionNames.of(city.country) || city.country;
  } catch {
    // unknown code: keep it as is
  }
  return `${city.name}, ${country}`;
}

/** Month and year from an EXIF date string "YYYY:MM:DD HH:MM:SS" (as written by the camera, no time zone). */
function monthYear(value) {
  const m = /^(\d{4})[:-](\d{2})[:-]\d{2}/.exec(typeof value === 'string' ? value.trim() : '');
  if (!m) return { month: null, year: null };
  const month = MONTHS[Number(m[2]) - 1];
  if (!month || m[1] === '0000') return { month: null, year: null };
  return { month, year: m[1] };
}

/**
 * Capture date and place from a photo's metadata (JPEG, PNG, WebP, HEIC, TIFF…).
 * Never throws: anything missing or unreadable is null.
 */
export async function readMetadata(buffer) {
  const out = { location: null, month: null, year: null };
  try {
    const tags = await exifr.parse(buffer, { pick: ['DateTimeOriginal', 'CreateDate'], reviveValues: false });
    Object.assign(out, monthYear(tags?.DateTimeOriginal ?? tags?.CreateDate));
  } catch {
    // unreadable or no EXIF
  }
  try {
    const gps = await exifr.gps(buffer);
    if (gps) out.location = await placeName(gps.latitude, gps.longitude);
  } catch {
    // unreadable or no GPS
  }
  return out;
}
