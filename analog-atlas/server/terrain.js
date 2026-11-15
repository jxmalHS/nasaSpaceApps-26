import https from 'node:https';
import tls from 'node:tls';
import { PNG } from 'pngjs';

const lola = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/';
const mola = 'https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg128/';
const earthTiles = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const rad = Math.PI / 180;
const n = 128;

// Read only predefined products. Validate range responses before decoding signed elevations.
const ca = tls.getCACertificates ? [...tls.rootCertificates, ...tls.getCACertificates('system')] : undefined;
function read(url, range) {

  return new Promise((resolve, reject) => {
    const req = https.get(url, { ca, headers: range ? { Range: 'bytes=' + range.join('-') } : {} }, res => {
      if (range ? res.statusCode !== 206 || !res.headers['content-range']?.startsWith('bytes ' + range.join('-') + '/') : res.statusCode !== 200) {
        res.destroy(); reject(new Error('Source did not return the requested data')); return;
      }
      const chunks = []; let length = 0;
      res.on('error', reject);
      res.on('data', chunk => {
        length += chunk.length;
        if (length > 12e6) res.destroy(new Error('Unexpected response size'));
        else chunks.push(chunk);
      });
      res.on('end', () => range && length !== range[1]-range[0]+1 ? reject(new Error('Incomplete DEM')) : resolve(Buffer.concat(chunks)));
    });
    const timer = setTimeout(() => req.destroy(new Error('Source timed out')), 18000);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject);
  });
}

function grid(lat, lon, radius) {
  const phi = lat*rad, lambda = lon*rad;
  return Array.from({length:n*n}, (_,i) => {
    const east = 2000*(i%n/(n-1)-0.5), north = 2000*(0.5-Math.floor(i/n)/(n-1));
    const d = Math.hypot(east,north)/radius, bearing = Math.atan2(east,north);
    const p = Math.asin(Math.sin(phi)*Math.cos(d)+Math.cos(phi)*Math.sin(d)*Math.cos(bearing));
    const l = lambda+Math.atan2(Math.sin(bearing)*Math.sin(d)*Math.cos(phi),Math.cos(d)-Math.sin(phi)*Math.sin(p));
    return [p/rad, ((l/rad+540)%360)-180];
  });
}
function interpolate(x,y,get) {
  const a=Math.floor(x), b=Math.floor(y), dx=x-a, dy=y-b;
  const top=get(a,b)*(1-dx)+get(a+1,b)*dx;
  return Math.round((top*(1-dy)+(get(a,b+1)*(1-dx)+get(a+1,b+1)*dx)*dy)*100)/100;
}
async function earth(grid,lat) {
  const zoom=Math.max(8,Math.min(13,Math.round(Math.log2(156543*Math.cos(lat*rad)/30))));
  const width=256*2**zoom, tiles=new Map();
  const pixels=grid.map(([p,l])=>{
    if(Math.abs(p)>85.0511) throw new Error('Outside Mercator coverage');
    return [(l+180)/360*width-.5,(1-Math.asinh(Math.tan(p*rad))/Math.PI)/2*width-.5];
  });
  function tile(x,y) {return [Math.floor(((x%width)+width)%width/256),Math.floor(y/256)].join('/');}
  for(const [x,y] of pixels) for(const a of [Math.floor(x),Math.floor(x)+1]) for(const b of [Math.floor(y),Math.floor(y)+1]) tiles.set(tile(a,b),null);
  await Promise.all([...tiles.keys()].map(async key=>{
    const png=PNG.sync.read(await read(earthTiles+'/'+zoom+'/'+key+'.png'));
    if(png.width!==256||png.height!==256)throw new Error('Unexpected tile dimensions');
    tiles.set(key,png.data);
  }));
  const z=pixels.map(([x,y])=>interpolate(x,y,(a,b)=>{
    const rgb=tiles.get(tile(a,b)),i=4*((b&255)*256+(a&255));
    if(!rgb[i+3])throw new Error('No elevation coverage');
    return rgb[i]*256+rgb[i+1]+rgb[i+2]/256-32768;
  }));
  return {z,source:'AWS Terrain Tiles · Terrarium, zoom '+zoom,sourceUrl:'https://registry.opendata.aws/terrain-tiles/',sampleSpacingM:Math.round(156543*Math.cos(lat*rad)/2**zoom)};
}
async function planetary(body,lat,lon,grid) {
  let url,cols,rows,project,spacing,scale,source;
  const lunar=body==='moon';
  if(lunar && lat < -80.1) {
    cols=rows=30400;spacing=20;scale=.5;url=lola+'polar/img/ldem_80s_20m.img';source='LRO LOLA · south polar DEM';
    project=([p,l])=>{const d=2*1737400*Math.tan(Math.PI/4+p*rad/2)/20;return [15199.5+d*Math.sin(l*rad),15199.5-d*Math.cos(l*rad)];};
  }else{
    const east=(lon+360)%360;
    const marius=lunar && lat>0.1 && lat<14.9 && east>300.1 && east<329.9;
    const ppd=lunar?(marius?1024:64):128;
    const top=lunar?(marius?15:90):lat>=44?88:lat>=0?44:lat>=-44?0:-44;
    const left=lunar?(marius?300:0):90*Math.floor(east/90);
    cols=ppd*(lunar?(marius?30:360):90);rows=ppd*(lunar?(marius?15:180):44);
    url=lunar?lola+'cylindrical/img/'+(marius?'ldem_1024_00n_15n_300_330':'ldem_64')+'.img':mola+'megt'+String(Math.abs(top)).padStart(2,'0')+(top<0?'s':'n')+String(left).padStart(3,'0')+'hb.img';
    source=lunar?'LRO LOLA · cylindrical DEM':'MGS MOLA · gridded topography';
    spacing=Math.round(rad*(lunar?1737400:3396190)/ppd);scale=lunar?.5:1;
    project=([p,l])=>[(((l+360)%360)-left)*ppd-.5,(top-p)*ppd-.5];
  }
  const xy=grid.map(project), xs=xy.map(p=>p[0]),ys=xy.map(p=>p[1]);
  const start=Math.floor(Math.min(...ys)),end=Math.floor(Math.max(...ys))+1;
  if(start<0||end>=rows||Math.min(...xs)<0||Math.max(...xs)>=cols-1)throw new Error('Footprint crosses DEM boundary');
  const bytes=await read(url,[start*cols*2,(end+1)*cols*2-1]);
  return {source,sourceUrl:url.replace('.img',lunar?'.lbl':'.xml'),sampleSpacingM:spacing,z:xy.map(([x,y])=>interpolate(x,y,(a,b)=>{
    const offset=((b-start)*cols+a)*2, v=lunar?bytes.readInt16LE(offset):bytes.readInt16BE(offset);
    if(v===-32768) throw new Error('Missing elevation');
    return v*scale;
  }))};
}
export async function measure(body,lat,lon) {
  if(!['earth','moon','mars'].includes(body)||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new RangeError('Invalid coordinates');
  const points=grid(lat,lon,{earth:6371008.8,moon:1737400,mars:3396190}[body]);
  const data=body==='earth'?await earth(points,lat):await planetary(body,lat,lon,points);
  return {body,lat,lon,n,size_m:2000,...data};
}
