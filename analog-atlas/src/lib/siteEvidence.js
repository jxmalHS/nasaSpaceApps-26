export const services = {
  earth: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
  moon: 'https://astro.arcgis.com/arcgis/rest/services/OnMoon/LRO_WAC/MapServer',
  mars: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer',
};
export function imageTile(body, lat, lon) {
  if (!Object.hasOwn(services, body) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return null;
  const earth = body === 'earth';
  if (earth && Math.abs(lat)>85.0511) return null;
  const level = earth ? 12 : 7;
  const columns = 2 ** level * (earth ? 1 : 2);
  const rows = 2 ** level;
  const x = Math.min(columns - 1e-9, (lon + 180) / 360 * columns);
  const y = Math.min(rows - 1e-9, earth ? (1 - Math.asinh(Math.tan(lat * Math.PI/180))/Math.PI)/2 * rows : (90-lat)/180*rows);
  return {url: services[body] + '/tile/' + level + '/' + Math.floor(y) + '/' + Math.floor(x), x:x%1, y:y%1, source:services[body]};
}
export function climateUrl(lat,lon,fields) {
  const u=new URL('https://power.larc.nasa.gov/api/temporal/climatology/point');
  u.search=new URLSearchParams({latitude:lat,longitude:lon,start:2001,end:2020,community:'AG',parameters:fields.join(','),format:'JSON'});
  return u.href;
}
