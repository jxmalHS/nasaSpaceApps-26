import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {patchStats, profile} from '../src/lib/patch.js';
import {measure} from '../server/terrain.js';

const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url)));
test('every catalogue target ships a finite north-up 2 km grid at its own coordinates',async()=>{
  const {targets}=await json('../src/config/targets.json');
  for(const {body,id,lat,lon} of targets){
    const p=await json('../public/data/patches/'+body+'/'+id+'.json');
    assert.deepEqual([p.body,p.lat,p.lon,p.size_m,p.n],[body,lat,lon,2000,128]);
    assert.equal(p.z.length,128**2);assert(p.z.every(Number.isFinite));
    assert(p.sourceUrl.startsWith('https://'));assert(p.sampleSpacingM>0);
    assert(patchStats(p).relief>0);
  }
});
test('Hami cell and displayed profile use the same measured elevations',async()=>{
  const p=await json('../public/data/patches/earth/66065.json');
  assert.deepEqual([p.lat,p.lon],[44.25,92.75]);
  const line=profile(p,[0,0],[1,1]);
  assert.equal(line.at(-1),p.z.at(-1)-p.z[0]);
  assert.equal(patchStats(p).slopeMean.toFixed(1),'1.8');
});
test('invalid coordinates and unsupported bodies fail before reading remote data',async()=>{
  await assert.rejects(measure('earth',91,0),RangeError);
  await assert.rejects(measure('venus',0,0),RangeError);
});
