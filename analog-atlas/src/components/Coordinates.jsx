import {useState} from 'react';
export default function Coordinates({lat,lon,label}) {
  const [status,setStatus]=useState('');
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) return null;
  const pair=lat+', '+lon;
  return <div className="coord-row"><span>{label}: <b>{pair}°</b> (lat, lon)</span><button className="btn btn-sm" aria-label={'Copy '+label+' coordinates'} onClick={async()=>{try{await navigator.clipboard.writeText(pair);setStatus('Copied')}catch{setStatus('Select and copy the coordinates above')}}}>Copy</button><span role="status">{status}</span></div>;
}
