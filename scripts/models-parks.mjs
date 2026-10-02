/** Verified current OSM building layouts. Never clear a complete park polygon. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const features=JSON.parse(await readFile('raw/geospatial/osm.geojson','utf8')).features;
const M=111320*Math.cos(39.9475*Math.PI/180);
const ring=f=>f.geometry.coordinates[0][0];
const center=f=>{const p=ring(f);return [(Math.min(...p.map(p=>p[0]))+Math.max(...p.map(p=>p[0])))/2,(Math.min(...p.map(p=>p[1]))+Math.max(...p.map(p=>p[1])))/2];};
const building=(id,lat,lon,name)=>{const f=features.find(f=>f.id===id);const p=ring(f);const [x,y]=center(f);return {id,name:name??f.properties.name??'配殿',x:(x-lon)*M,y:(y-lat)*111132,w:(Math.max(...p.map(p=>p[0]))-Math.min(...p.map(p=>p[0])))*M,d:(Math.max(...p.map(p=>p[1]))-Math.min(...p.map(p=>p[1])))*111132,heightM:Number(f.properties.height)||8,roof:f.properties.building==='roof'?'pavilion':'hip',polygon:p};};
const records=[];
for(const [id,name,en,anchorId,ids,source] of [
 ['ditan','地坛','TEMPLE OF EARTH','way/78050667',['way/377843163','way/384269689','way/384269690'],'https://www.beijing.gov.cn/renwen/rwzyd/qgzdwwbhdw/dt/202210/t20221027_2846021.html'],
 ['ritan','日坛','TEMPLE OF THE SUN','way/1429665519',['way/478407386','way/478407387','way/478407388','way/1451040725','way/1551951784','way/1551951802','way/1551953162'],'https://www.beijing.gov.cn/fuwu/bmfw/sy/jrts/202310/t20231006_3270320.html'],
 ['yuetan','月坛公园','TEMPLE OF THE MOON','way/606113402',['way/606113402','way/663760762','way/663761011','way/671411992'],'https://www.beijing.gov.cn/renwen/rwzyd/lyjq/3A/ytgy/202210/t20221020_2840205.html'],
]){
 const f=features.find(f=>f.id===anchorId);const [lon,lat]=center(f);const layout=ids.map(way=>building(way,lat,lon,id==='ditan'&&way==='way/377843163'?'皇祇室':undefined));
 const altars=id==='ditan'?[{x:0,y:0,w:35,d:35,sizes:[35,20.5],tiers:2,heightM:2.53,source:'https://www.visitbeijing.com.cn/article/4DyfUKZoo38'}]:id==='ritan'?[{x:0,y:0,w:18.33,d:18.33,tiers:1,heightM:1.89,source:anchorId}]:[];
 const enclosureId=id==='ditan'?'way/78050667':id==='ritan'?'way/123893918':undefined;
 const enclosure=enclosureId?features.find(f=>f.id===enclosureId):undefined;
 const enclosurePolygon=enclosure?ring(enclosure).map(([a,b])=>[(a-lon)*M,(b-lat)*111132]):undefined;
 const footprints=layout.map(b=>b.polygon),replacesOSMIds=layout.map(b=>b.id);
 if(id==='ritan'){footprints.push(ring(f));replacesOSMIds.push(anchorId);}
 records.push({id,model:id,name,en,lat,lon,rotDeg:0,elevationM:0,heightM:Math.max(...layout.map(b=>b.heightM))+3,labelH:22,focus:id==='yuetan'?440:400,lookAnchor:[0,5,0],showLabel:true,footprint:[],footprints,replacesOSMIds,layout,altars,
  enclosures:enclosurePolygon?[{polygonLocal:enclosurePolygon,heightM:id==='ditan'?2.3:2.5}]:[],
  accuracy:id==='yuetan'?'Current OSM-footprint pavilions and bell tower; unverified historic altar not invented':'OSM-footprint buildings; altar position within mapped enclosure and facade heights are approximate',
  sources:[source,...ids.map(id=>`https://www.openstreetmap.org/${id}`)],lod:{near:`./models/landmarks/${id}.glb`,medium:`./models/landmarks/${id}-medium.glb`,far:`./models/landmarks/${id}-far.glb`,distancesM:[800,2800]},collision:`./models/landmarks/${id}-collision.glb`});
}
await mkdir('assets-source/landmarks',{recursive:true});await writeFile('assets-source/landmarks/parks.json',JSON.stringify(records,null,2)+'\n');console.log('Registered verified park layouts: '+records.map(r=>r.id).join(', '));
