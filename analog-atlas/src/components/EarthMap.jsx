import { showTooltip, closeTooltip } from '../lib/tooltip.js';
import EarthLayerSelect from './EarthLayerSelect.jsx';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Plus, Minus, Globe2, Map as MapIcon, Layers } from 'lucide-react';
import { cellLatLon, cellRing } from '../lib/geo.js';
import { useReducedMotion } from './ui.jsx';
import { hasWebGL } from '../lib/webgl.js';
import FlatMap from './FlatMap.jsx';
import { LITE } from '../lib/perf.js';

maplibregl.setWorkerUrl(workerUrl);

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const BASEMAPS = {
  marble: { label: 'Blue Marble', tiles: GIBS + '/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg', maxzoom: 8 },
  relief: { label: 'Terrain relief', tiles: GIBS + '/ASTER_GDEM_Color_Shaded_Relief/default/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpeg', maxzoom: 12 },
};
const MERC = 85.0511287798;
const CORNERS = [[-180, MERC], [180, MERC], [180, -MERC], [-180, -MERC]];

/**
 * God's-eye Earth map. MapLibre globe, NASA GIBS imagery (static copy if tiles fail), the
 * suitability surface painted by the worker into a canvas source, clustered top candidates,
 * documented field sites, the selected cell and shortlisted pins.
 */
export default function EarthMap(props) {
  return hasWebGL() ? <GlobeMap {...props} /> : <FlatMap {...props} />;
}

function GlobeMap({ imageryOnly, result, layerImage, sel, pins = [], uploads = [], onPick, flyTo, paired = false, defaultProjection, compact = false, label = 'Map of Earth candidate sites' }) {
  const box = useRef(null);
  const map = useRef(null);
  const canvas = useRef(null);
  const markers = useRef(new Map());
  const [loaded, setLoaded] = useState(false);
  const [proj, setProj] = useState(defaultProjection || (LITE ? 'mercator' : 'globe'));
  const [showLayers, setShowLayers] = useState(false);
  const layerButton = useRef(null);
  const [fallback, setFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const reduced = useReducedMotion();
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    canvas.current = Object.assign(document.createElement('canvas'), { width: 720, height: 720 });
    let m;
    try { m = new maplibregl.Map({
      container: box.current,
      style: {
        version: 8,
        glyphs: location.origin+import.meta.env.BASE_URL+"map-fonts/{range}.pbf?font={fontstack}",
        projection: { type: proj },
        sources: {
          base: { type: 'raster', tiles: [BASEMAPS.marble.tiles], tileSize: 256, maxzoom: 8, attribution: 'NASA GIBS' },
          fallback: { type: 'image', url: import.meta.env.BASE_URL + 'textures/earth_3857.jpg', coordinates: CORNERS },
          suit: { type: 'canvas', canvas: canvas.current, coordinates: CORNERS, animate: false },
          land: { type: 'geojson', data: import.meta.env.BASE_URL + 'data/land.geojson' },
          cands: { type: 'geojson', data: empty(), cluster: true, clusterMaxZoom: 6, clusterRadius: 44, clusterProperties: { best: ['max', ['get', 's']] } },
          footprints: { type:'geojson', data:empty() },
          sel: { type: 'geojson', data: empty() },
          pins: { type: 'geojson', data: empty() },
          uploads: { type: 'geojson', data: empty() },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#03060d' } },
          { id: 'fallback', type: 'raster', source: 'fallback', paint: { 'raster-brightness-max': 0.5, 'raster-saturation': -0.4 } },
          { id: 'base', type: 'raster', source: 'base', paint: { 'raster-brightness-max': 0.52, 'raster-saturation': -0.4, 'raster-contrast': 0.08, 'raster-fade-duration': 0 } },
          { id: 'suit', type: 'raster', source: 'suit', paint: { 'raster-opacity': 0.88, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } },
          { id: 'land', type: 'line', source: 'land', paint: { 'line-color': 'rgba(174,200,255,0.28)', 'line-width': 0.7 } },
          { id: 'clusters', type: 'circle', source: 'cands', filter: ['has', 'point_count'], paint: {
            'circle-color': ['interpolate', ['linear'], ['get', 'best'], 0.4, 'rgba(30,80,200,0.55)', 0.9, 'rgba(156,194,255,0.7)', 1, 'rgba(255,255,255,0.8)'],
            'circle-stroke-color': '#03060d', 'circle-stroke-width': 1,
            'circle-radius': ['step', ['get', 'point_count'], 11, 20, 14, 100, 17, 500, 20] } },
          { id:'cluster-count', type:'symbol', source:'cands', filter:['has','point_count'], layout:{'text-field':['to-string',['get','point_count']],'text-font':['Noto Sans Regular'],'text-size':12,'text-allow-overlap':true},paint:{'text-color':'#fff','text-halo-color':'#152035','text-halo-width':1.2}},
          { id:'candidate-footprint', type:'line', source:'footprints', minzoom:7, paint:{'line-color':'#97bfea','line-opacity':0.55,'line-width':1}},
          { id: 'cand', type: 'circle', source: 'cands', filter: ['!', ['has', 'point_count']], paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3, 6, 6],
            'circle-color': ['interpolate', ['linear'], ['get', 's'], 0.3, '#1e50c8', 0.7, '#4c8dff', 0.9, '#cfe0ff', 1, '#ffffff'],
            'circle-stroke-color': '#03060d', 'circle-stroke-width': 1 } },
          { id: 'uploads', type: 'circle', source: 'uploads', paint: { 'circle-radius': 6, 'circle-color': '#f2b544', 'circle-stroke-color': '#03060d', 'circle-stroke-width': 1.5 } },
          { id: 'pins', type: 'circle', source: 'pins', paint: { 'circle-radius': 7, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#9cc2ff', 'circle-stroke-width': 2.5 } },
          { id: 'sel-fill', type: 'fill', source: 'sel', paint: { 'fill-color': 'rgba(76,141,255,0.18)' } },
          { id: 'sel-line', type: 'line', source: 'sel', paint: { 'line-color': '#ffffff', 'line-width': 2 } },
        ],
      },
      center: [20, 15], zoom: compact ? 0.8 : 1.6, maxZoom: 11, attributionControl: { compact: true },
      dragRotate: false, pitchWithRotate: false, fadeDuration: 0,
    }); } catch (e) { console.warn('[Analog Atlas] map could not start, using flat map', e); setFailed(true); return undefined; }
    map.current = m;
    let failures = 0;
    m.on('error', (e) => {
      if (e.sourceId === 'base' && ++failures > 6 && !fallback) {
        m.setLayoutProperty('fallback', 'visibility', 'visible');
        m.setLayoutProperty('base', 'visibility', 'none');
        setFallback(true);
      }
    });
    m.on('style.load', () => setLoaded(true));
    m.on('click', 'clusters', async (e) => {
      const f = e.features[0];
      const z = await m.getSource('cands').getClusterExpansionZoom(f.properties.cluster_id);
      m.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3, duration: reduced ? 0 : 500 });
    });
    const pickLayers = ['cand', 'pins', 'uploads'];
    m.on('click', (e) => {
      const hit = m.queryRenderedFeatures(e.point, { layers: ['clusters', ...pickLayers] });
      if (hit[0]?.layer.id === 'clusters') return;
      const upload=hit.find(h=>h.layer.id==='uploads');
      if(upload){pickRef.current?.({uploadIndex:Number(upload.properties.uploadIndex)});return}
      const f = hit.find((h) => h.properties.i != null);
      if (f) pickRef.current?.({ i: Number(f.properties.i) });
      else pickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
    let marker;
    const anchor = {
      contextElement: box.current,
      getBoundingClientRect() {
        const rect = m.getCanvas().getBoundingClientRect();
        const point = m.project(marker);
        return new DOMRect(rect.left + point.x, rect.top + point.y, 0, 0);
      },
    };
    m.on('mousemove', (e) => {
      const f = m.queryRenderedFeatures(e.point, { layers: ['clusters', ...pickLayers] })[0];
      m.getCanvas().style.cursor = f ? 'pointer' : 'crosshair';
      if (!f) return closeTooltip(anchor);
      marker = [...f.geometry.coordinates];
      marker[0] += 360 * Math.round((e.lngLat.lng - marker[0]) / 360);
      const p = f.properties;
      const text = f.layer.id === 'clusters' ? `${p.point_count} candidate cells · best match ${Math.round(p.best * 100)}/100 · click to zoom in` : p.name ? `${p.name} · ${p.s != null ? Math.round(p.s * 100) + '/100 match' : ''}` : `Match ${Math.round(p.s * 100)}/100`;
      showTooltip(anchor, text);
    });
    m.on('mouseout', () => closeTooltip(anchor));
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(box.current);
    return () => { closeTooltip(anchor); ro.disconnect(); m.remove(); };
  }, []);

  // Suitability surface or single-feature layer → canvas source.
  useEffect(() => {
    const m = map.current, img = layerImage || result?.raster;
    if (!loaded || !img) return;
    const ctx = canvas.current.getContext('2d');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    const src = m.getSource('suit');
    src.play(); requestAnimationFrame(() => src.pause());
    m.triggerRepaint();
  }, [loaded, result, layerImage]);

  useEffect(() => {
    if (!loaded) return;
    const m = map.current;
    for (const id of ['suit', 'land', 'clusters', 'cluster-count', 'cand', 'candidate-footprint', 'pins', 'uploads', 'sel-fill', 'sel-line']) {
      m.setLayoutProperty(id, 'visibility', imageryOnly ? 'none' : 'visible');
    }
    for (const id of ['base', 'fallback']) m.setPaintProperty(id, 'raster-brightness-max', imageryOnly ? 1 : 0.52);
  }, [loaded, imageryOnly]);

  // Candidates (top 2,000), clustered.
  useEffect(() => {
    if (!loaded || !result) return;
    const pts = result.points, feats = [];
    for (let k = 0; k < pts.length / 4; k++) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [pts[k * 4], pts[k * 4 + 1]] }, properties: { s: pts[k * 4 + 2], i: pts[k * 4 + 3] } });
    map.current.getSource('footprints').setData({type:'FeatureCollection',features:feats.map(f=>({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[cellRing(f.geometry.coordinates[1],f.geometry.coordinates[0])]}}))});
    map.current.getSource('cands').setData({ type: 'FeatureCollection', features: feats });
  }, [loaded, result]);

  useEffect(() => {
    if (!loaded) return;
    const m = map.current;
    const feat = (id) => { const [la, lo] = cellLatLon(id); return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [cellRing(la, lo)] }, properties: {} }; };
    m.getSource('sel').setData({ type: 'FeatureCollection', features: sel != null ? [feat(sel)] : [] });
    m.getSource('pins').setData({ type: 'FeatureCollection', features: pins.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { i: p.i, name: p.name } })) });
    m.getSource('uploads').setData({ type: 'FeatureCollection', features: uploads.map((u,uploadIndex) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [u.lon, u.lat] }, properties: { name: u.name, s: u.score, uploadIndex } })) });
  }, [loaded, sel, pins, uploads]);

  useEffect(() => {
    if (!loaded || !flyTo) return;
    map.current.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: Math.max(map.current.getZoom(), flyTo.zoom ?? 4), duration: reduced ? 0 : 1100, essential: true });
  }, [loaded, flyTo]);

  useEffect(() => { if (loaded) map.current.setProjection({ type: proj }); }, [loaded, proj]);
  useEffect(()=>{
    if(!loaded||!paired)return;
    const m=map.current;let applying=false;
    const send=()=>{if(!applying)window.dispatchEvent(new CustomEvent('atlas-paired-camera',{detail:{origin:m,center:m.getCenter().toArray(),zoom:m.getZoom()}}))};
    const receive=e=>{if(e.detail.origin===m)return;applying=true;try{m.jumpTo({center:e.detail.center,zoom:e.detail.zoom})}finally{applying=false}};
    m.on('move',send);window.addEventListener('atlas-paired-camera',receive);
    return ()=>{m.off('move',send);window.removeEventListener('atlas-paired-camera',receive)};
  },[loaded,paired]);
  if (failed) return <FlatMap {...{ imageryOnly, result, layerImage, sel, onPick }} />;
  const z = (d) => map.current?.easeTo({ zoom: map.current.getZoom() + d, duration: reduced ? 0 : 250 });
  return (
    <div className="earth-map" aria-label={label} role="region">
      <div ref={box} className="map-box" tabIndex={0} aria-label="Interactive Earth map. Use the ranked list for keyboard access." />
      <div className="map-ctrl">
        <button className="btn btn-sm icon-btn" onClick={() => z(1)} aria-label="Zoom in"><Plus size={16} /></button>
        <button className="btn btn-sm icon-btn" onClick={() => z(-1)} aria-label="Zoom out"><Minus size={16} /></button>
        <button className="btn btn-sm icon-btn" onClick={() => setProj((p) => (p === 'globe' ? 'mercator' : 'globe'))} aria-label={proj === 'globe' ? 'Switch to flat map' : 'Switch to globe'} data-tooltip={proj === 'globe' ? 'Flat map' : 'Globe'}>
          {proj === 'globe' ? <MapIcon size={15} /> : <Globe2 size={15} />}
        </button>
        {!compact && (
          <button ref={layerButton} className="btn btn-sm icon-btn" onClick={() => setShowLayers(v => !v)} aria-label="Choose Earth dimension" data-tooltip="Choose Earth dimension" aria-expanded={showLayers}><Layers size={15} /></button>
        )}
      </div>
      {showLayers && <div className="earth-layer-picker" onKeyDown={e => { if (e.key === 'Escape') { setShowLayers(false); layerButton.current.focus(); } }}>
        <label>Earth dimension<EarthLayerSelect label="Earth dimension" onChange={() => { setShowLayers(false); layerButton.current.focus(); }} /></label>
      </div>}
      {fallback && <div className="map-note small">Live NASA imagery unavailable: showing the bundled Blue Marble copy.</div>}
    </div>
  );
}

const empty = () => ({ type: 'FeatureCollection', features: [] });
