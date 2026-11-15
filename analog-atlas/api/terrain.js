import { measure } from '../server/terrain.js';

export default async function terrain(req,res) {
  const p=new URL(req.url,'http://localhost').searchParams;
  const lat=p.get('lat'),lon=p.get('lon');
  res.setHeader('Content-Type','application/json');
  try {
    if(req.method!=='GET'||!lat?.trim()||!lon?.trim()) throw new RangeError();
    const patch=await measure(p.get('body'),Number(lat),Number(lon));
    res.setHeader('Cache-Control','public, max-age=86400, s-maxage=604800');
    res.end(JSON.stringify(patch));
  }catch(error){
    res.statusCode=error instanceof RangeError?400:503;
    res.end(JSON.stringify({error:'Measured terrain unavailable for this footprint.'}));
  }
}
