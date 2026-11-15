import { measure } from '../server/terrain.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const targets=JSON.parse(await readFile(new URL('../src/config/targets.json',import.meta.url))).targets;
const sites=[...targets,{body:'earth',id:91*720+545,lat:44.25,lon:92.75}];
let cursor=0;
async function worker(){
  while(cursor<sites.length){
    const {body,id,lat,lon}=sites[cursor++];
    try{
      const patch=await measure(body,lat,lon);
      const dir=new URL('../public/data/patches/'+body+'/',import.meta.url);
      await mkdir(dir,{recursive:true});await writeFile(new URL(id+'.json',dir),JSON.stringify(patch));
      console.log(body,id,patch.z.length,Math.min(...patch.z),Math.max(...patch.z));
    }catch(e){console.error(body,id,e.message);process.exitCode=1}
  }
}
await Promise.all(Array.from({length:4},worker));
