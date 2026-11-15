import { services } from '../lib/siteEvidence.js';
import {useStore,setState} from '../lib/store.js';
import {useEffect,useRef,useState} from 'react';
let engine;
function loadCesium(){
  if(window.Cesium)return Promise.resolve(window.Cesium);
  if(!engine){
    const root=import.meta.env.BASE_URL+'cesium/';
    window.CESIUM_BASE_URL=root;
    const css=document.createElement('link');css.rel='stylesheet';css.href=root+'Widgets/widgets.css';document.head.append(css);
    engine=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=root+'Cesium.js';script.onload=()=>resolve(window.Cesium);script.onerror=()=>{engine=null;reject(Error('Cesium failed to load'))};document.head.append(script)});
  }
  return engine;
}
function Globe({body,lat,lon,height,flat,offset,onChoose}){
  const el=useRef(null),instance=useRef(null),[ready,setReady]=useState(false),[failed,setFailed]=useState(false);
  useEffect(()=>{
    let active=true,viewer;
    setReady(false);setFailed(false);
    (async()=>{
      const C=await loadCesium();if(!active)return;
      const [a,b]=body==='earth'?[6378137,6356752.314245]:body==='moon'?[1737400,1737400]:[3396190,3396190];
      const ellipsoid=new C.Ellipsoid(a,a,b);
      const tilingScheme=body==='earth' ? new C.WebMercatorTilingScheme({ellipsoid}) : new C.GeographicTilingScheme({ellipsoid});
      const provider=new C.UrlTemplateImageryProvider({url:services[body]+'/tile/{z}/{y}/{x}',tilingScheme,tileWidth:body==='earth'?256:512,tileHeight:body==='earth'?256:512,maximumLevel:body==='earth'?18:8,credit:body==='earth'?'Esri World Imagery':'NASA / USGS / Esri'});
      provider.errorEvent.addEventListener(()=>{if(active)setFailed(true)});
      if(!active)return;
      viewer=new C.Viewer(el.current,{ellipsoid,globe:new C.Globe(ellipsoid),mapProjection:new C.GeographicProjection(ellipsoid),baseLayer:new C.ImageryLayer(provider),terrainProvider:new C.EllipsoidTerrainProvider({ellipsoid}),sceneMode:flat?C.SceneMode.SCENE2D:C.SceneMode.SCENE3D,requestRenderMode:true,maximumRenderTimeChange:Infinity,animation:false,timeline:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,infoBox:false,selectionIndicator:false,fullscreenButton:false,skyBox:false,skyAtmosphere:false});
      viewer.scene.screenSpaceCameraController.enableInputs=false;
      if(onChoose){
        viewer.screenSpaceEventHandler.setInputAction(event=>{
          const hit=viewer.camera.pickEllipsoid(event.position,ellipsoid);if(!hit)return;
          const q=ellipsoid.cartesianToCartographic(hit),geocentric=body==='mars'?Math.atan2(b*b*Math.sin(q.latitude),a*a*Math.cos(q.latitude)):q.latitude;
          onChoose({body,lat:C.Math.toDegrees(geocentric),lon:C.Math.toDegrees(q.longitude)});
        },C.ScreenSpaceEventType.LEFT_CLICK);
      }
      instance.current={C,viewer,ellipsoid,a,b};setReady(true);
    })().catch(()=>{if(active)setFailed(true)});
    return ()=>{active=false;instance.current=null;if(viewer&&!viewer.isDestroyed())viewer.destroy()};
  },[body,flat]);
  useEffect(()=>{if(!ready||!instance.current)return;const {C,viewer,ellipsoid,a,b}=instance.current;
    const phi=body==='mars'?Math.atan2(a*a*Math.sin(lat*Math.PI/180),b*b*Math.cos(lat*Math.PI/180))*180/Math.PI:lat;
    const position=(h)=>C.Cartesian3.fromDegrees(lon,phi,h,ellipsoid);
    const origin=position(0),basis=C.Transforms.eastNorthUpToFixedFrame(origin,ellipsoid);
    const local=(x,y)=>C.Matrix4.multiplyByPoint(basis,new C.Cartesian3(x,y,0),new C.Cartesian3());
    const center=ellipsoid.cartesianToCartographic(local(offset[0],offset[1]));
    const cameraPoint=C.Cartesian3.fromRadians(center.longitude,center.latitude,height,ellipsoid);
    viewer.entities.removeAll();viewer.entities.add({position:position(0),point:{pixelSize:8,color:C.Color.WHITE,outlineColor:C.Color.RED,outlineWidth:2,disableDepthTestDistance:Infinity}});
    const corners=[[-1000,-1000],[1000,-1000],[1000,1000],[-1000,1000],[-1000,-1000]].map(([x,y])=>local(x,y));
    viewer.entities.add({polyline:{positions:corners,width:2,material:C.Color.WHITE,arcType:C.ArcType.NONE}});
    viewer.camera.setView({destination:cameraPoint,orientation:{heading:0,pitch:-Math.PI/2,roll:0}});
    viewer.scene.requestRender();
  },[ready,lat,lon,height,body,offset]);
  return <section><strong>{body==='earth'?'A · Earth':'B · '+(body==='moon'?'Moon':'Mars')}</strong><div ref={el} style={{height:230,position:'relative'}}/>{failed&&<p role="status">Visualization unavailable. The source data or rendering process could not be verified.</p>}</section>;
}
export default function GlobePair({earth,target}){
 const saved=useStore(s=>s.inspectionPatch);
 const patch=saved?.targetId===target.id?saved:target;
 const choose=q=>setState({inspectionPatch:{...q,targetId:target.id}});
 const offset=useStore(s=>s.cameraOffset),setOffset=value=>setState(s=>({cameraOffset:typeof value==="function"?value(s.cameraOffset):value}));
 const height=useStore(s=>s.cameraHeight),flat=useStore(s=>s.cameraFlat),setHeight=cameraHeight=>setState({cameraHeight}),setFlat=cameraFlat=>setState({cameraFlat});
 return <section><div className="row" style={{flexWrap:'wrap'}}><label>Linked camera height (km) <input type="range" min="3" max="4500" step="1" value={height/1000} onChange={e=>setHeight(Number(e.target.value)*1000)}/> {height/1000}</label><button className="btn btn-sm" aria-pressed={flat} onClick={()=>setFlat(!flat)}>{flat?'Flat maps':'Globes'} · switch projection</button><button className="btn btn-sm" onClick={()=>{setOffset([0,0]);setHeight(5000)}}>Center 2 km footprints</button>
 {Object.entries({West:[-1,0],East:[1,0],North:[0,1],South:[0,-1]}).map(([label,vec])=><button key={label} className="btn btn-sm" onClick={()=>setOffset(o=>o.map((v,i)=>v+vec[i]*height/4))} aria-label={'Pan both views '+label}>{label}</button>)}</div><div className="site-images">{earth&&<Globe body="earth" {...earth} height={height} flat={flat} offset={offset}/>}<Globe {...target} lat={patch.lat} lon={patch.lon} onChoose={choose} height={height} flat={flat} offset={offset}/></div><form className="row" key={target.id+','+patch.lat+','+patch.lon} style={{flexWrap:'wrap'}} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);choose({body:target.body,lat:Number(f.get('latitude')),lon:Number(f.get('longitude'))});setOffset([0,0])}}>
 <label>Patch latitude (°) <input className="input num" type="number" name="latitude" min="-90" max="90" step="any" required defaultValue={patch.lat}/></label>
 <label>Longitude (°) <input className="input num" type="number" name="longitude" min="-180" max="180" step="any" required defaultValue={patch.lon}/></label>
 <button className="btn btn-sm">Set inspection patch</button><button type="button" className="btn btn-sm" onClick={()=>{setState({inspectionPatch:null});setOffset([0,0])}}>Reset to target</button></form>
 <p className="small dim">Click the planetary globe or enter coordinates to place a fixed 2 × 2 km inspection footprint. Terrain and imagery follow the selected footprint. Mission rankings use the catalogued target.</p></section>
}
