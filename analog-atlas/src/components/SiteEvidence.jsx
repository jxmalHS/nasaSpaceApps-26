import Coordinates from './Coordinates.jsx';
import {useEffect,useState} from 'react';
import {baseRole,F,tests} from '../lib/catalog.js';
import {fmt} from '../lib/format.js';
import {imageTile,climateUrl} from '../lib/siteEvidence.js';

function SiteImage({body,lat,lon,name}) {
  const tile=imageTile(body,lat,lon);
  const [failed,setFailed]=useState('');
  // The geographic mosaic exaggerates east-west scale by more than 10x here.
  const polarOverview = body === 'moon' && Math.cos(lat*Math.PI/180) < 0.1;
  const rho=2*1737400*Math.tan(Math.PI/4+lat*Math.PI/360);
  const polarImage=import.meta.env.BASE_URL+'textures/moon_south_polar.jpg';
  const usePolar=body==='moon' && lat<=-75 && failed!==polarImage;
  const shown=usePolar?{url:polarImage,x:0.5+rho*Math.sin(lon*Math.PI/180)/914880,y:0.5-rho*Math.cos(lon*Math.PI/180)/914880}:tile;
  const credit={earth:'Esri World Imagery and contributors',moon:'LROC WAC global mosaic · NASA / ASU / Esri',mars:'Viking MDIM 2.1 · NASA / JPL / USGS / Esri'}[body];
  return <figure className="survey-figure"><header><span className={'tag-ab '+(body==='earth'?'a':'b')}>{body==='earth'?'A':'B'}</span><div><span className="survey-body">{body==='earth'?'Earth candidate':body==='moon'?'Lunar target':'Martian target'}</span><h3>{name}</h3></div></header>
    {shown && failed!==shown.url && (!polarOverview || usePolar) ? <div className="survey-image">
      <img src={shown.url} alt={(usePolar?'Polar elevation relief around ':'Regional orbital imagery around ')+name} onError={()=>setFailed(shown.url)} style={{display:'block',width:'100%',aspectRatio:'1',objectFit:'contain'}}/>
      <span aria-hidden="true" style={{position:'absolute',left:(shown.x*100)+'%',top:(shown.y*100)+'%',transform:'translate(-50%,-50%)',width:13,height:13,border:'2px solid white',borderRadius:'50%',boxShadow:'0 0 0 2px black'}}/>
    </div> : <p className="survey-missing">Visualization unavailable. The source data or rendering process could not be verified.</p>}
    <figcaption><Coordinates key={lat+","+lon} lat={lat} lon={lon} label={body==="earth"?"Index cell center":"Planetary target"}/> {usePolar?<><a href="https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/" target="_blank" rel="noreferrer">LRO LOLA south-polar relief</a> · regional elevation mosaic, displayed in polar projection.</>:tile?<a href={tile.source} target="_blank" rel="noreferrer">{credit}</a>:credit}</figcaption></figure>;
}
export default function SiteEvidence({earth,target,state,viewerControl,viewer}){
  const t=tests[state.testId];
  const ids=Object.keys(F).filter(id=>{
    const role=state.roles[id]??baseRole(t,id);
    return role==='target'||(role==='interference'&&!state.thresholds[id]?.off)||!!(state.thresholds[id]?.user&&!state.thresholds[id]?.off);
  });
  const fields=[...(ids.includes('t_mean_C')?['T2M']:[]),...(ids.includes('precip_mm')?['PRECTOTCORR']:[])];
  const url=earth&&fields.length?climateUrl(earth.lat,earth.lon,fields):'';
  const [climate,setClimate]=useState(null);
  useEffect(()=>{
    if(!url)return;
    const ctrl=new AbortController();let current=true;
    const timer=setTimeout(()=>ctrl.abort(),15000);
    fetch(url,{signal:ctrl.signal}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(j=>{
      if(current)setClimate({url,values:j.properties?.parameter,fill:j.header?.fill_value??-999});
    }).catch(()=>{if(current)setClimate({url})}).finally(()=>clearTimeout(timer));
    return ()=>{current=false;clearTimeout(timer);ctrl.abort()};
  },[url]);
  return <section className="site-evidence"><header className="survey-heading"><h1>Site comparison</h1>{viewerControl}</header>{viewer}
    <p>The ring marks the coordinate used for each image. These regional views have different scales. The terrain comparison below uses matched 2 km patches.</p>
    <div className="site-images">{earth?<SiteImage body="earth" {...earth} name={earth.place+', '+earth.country}/>:<p>Choose an Earth site.</p>}
      <SiteImage {...target}/></div>
    <h2 className="criteria-heading">Mission evidence</h2><p>{t.label}</p>
    <div style={{overflowX:'auto'}}><table className="stats-t criteria-table"><thead><tr><th>Mission feature</th><th>A · Earth index</th><th>B · Target catalogue</th></tr></thead><tbody>{ids.map(id=>{
      const b=target.f[id];return <tr key={id}><th scope="row">{F[id].label}</th><td>{Number.isFinite(earth?.values[id])?fmt(earth.values[id],id):'Unavailable'}<small>{F[id].source}</small></td><td>{Number.isFinite(b?.v)?fmt(b.v,id):'Unavailable'}<small className={b?.s==='estimate'?'estimate-label':''}>{Number.isFinite(b?.v)?(b.s==='estimate'?'Estimate':b.s==='verify'?'Requires local verification':b.s):''}</small></td></tr>
    })}</tbody></table></div>
    {url&&<div role="status"><h3>Earth climate reference</h3><a href={url} target="_blank" rel="noreferrer">NASA POWER · 2001–2020 annual climatology</a>
      {fields.map(f=>{const v=climate?.values?.[f]?.ANN;return <p key={f}>{f==='T2M'?'Mean air temperature':'Mean daily precipitation'} · {climate?.url!==url?'Loading…':Number.isFinite(v)&&v!==climate.fill?v+(f==='T2M'?' °C':' mm/day'):'Unavailable'}</p>})}</div>}
  </section>
}
