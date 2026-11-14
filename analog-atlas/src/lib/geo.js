import { BODY } from './catalog.js';

/** Great-circle distance on a named body. The radius is always passed explicitly, never a global default. */
export function distanceKm(lat1, lon1, lat2, lon2, body = 'earth') {
  const R = BODY[body].radiusKm;
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Square footprint polygon (GeoJSON ring) of side `km` centred on a point, on the given body. */
export function squareRing(lat, lon, km, body = 'earth') {
  const R = BODY[body].radiusKm;
  const dLat = (km / 2 / R) * (180 / Math.PI);
  const dLon = dLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return [[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]];
}

/** 0.5° cell outline. */
export function cellRing(lat, lon, deg = 0.5) {
  const h = deg / 2;
  return [[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]];
}

export const cellLatLon = (id, ncol = 720, deg = 0.5) => {
  const row = Math.floor(id / ncol), col = id % ncol;
  return [90 - (row + 0.5) * deg, -180 + (col + 0.5) * deg];
};

export const MERC_MAX = 85.0511287798;
export const mercY = (lat) => {
  const p = (Math.max(-MERC_MAX, Math.min(MERC_MAX, lat)) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + p / 2));
};
