import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
const r=JSON.parse(await readFile('config/landmarks.json','utf8'));
test('one WGS84 metre registry defines all 32 real placements',()=>{
 assert.equal(r.origin.lat,39.9475);assert.equal(r.origin.lon,116.41);assert.equal(r.landmarks.length,32);
 assert.equal(new Set(r.landmarks.map(d=>d.id)).size,32);assert.equal(new Set(r.landmarks.map(d=>d.model)).size,29);
 for(const d of r.landmarks){assert.ok(d.lat>39.8&&d.lat<40.1);assert.ok(d.lon>116.2&&d.lon<116.6);assert.ok(d.footprints.length);assert.ok(d.replacesOSMIds.length);
  assert.ok(d.replacesOSMIds.every(id=>/^(way|relation)\/[0-9]+$/.test(id)));assert.ok(d.lookAnchor.every(Number.isFinite));
  for(const p of d.footprints){assert.ok(p.length>=4);assert.deepEqual(p[0],p.at(-1));assert.ok(p.flat().every(Number.isFinite));}
 }
});
test('real corrected tower heights and shared corner model are retained',()=>{
 const by=id=>r.landmarks.find(d=>d.id===id);
 assert.equal(by('cctv').heightM,234);assert.equal(by('chinazun').heightM,528);assert.equal(by('qiniandian').heightM,36.8);assert.equal(by('taihedian').heightM,37.44);
 assert.ok(by('birdnest').rotDeg>80&&by('birdnest').rotDeg<90,'stadium long axis follows its north/south mapped footprint');
 assert.deepEqual(new Set(r.landmarks.filter(d=>d.id.startsWith('jiaolou')).map(d=>d.lod.near)).size,1);
 assert.ok(by('cctv').replacesOSMIds.includes('relation/7820447'));
 assert.ok(by('monument').replacesOSMIds.includes('relation/8847722'));
});
test('all immutable runtime files and honest evidence manifests exist',async()=>{
 for(const d of r.landmarks){
  for(const p of [d.lod.near,d.lod.medium,d.lod.far,d.collision]){assert.match(p,/-[0-9a-f]{10}\.glb$/);assert.ok((await stat('public/'+p.replace(/^\.\//,''))).size>100);}
  const m=JSON.parse(await readFile(`assets-source/landmarks/${d.id}.json`,'utf8'));
  assert.equal(m.positionAccuracy.surveyed,false);assert.equal(m.positionAccuracy.claimedMeters,null);assert.ok(m.footprintEvidence.length);assert.ok(m.photoReferences.length);assert.equal(m.textures.photoPixelsEmbedded,false);
 }
});
