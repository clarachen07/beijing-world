/** Rebuild measured landmark placement and exact OSM replacement identities. */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
const origin = { lat: 39.9475, lon: 116.41 };
const mlon = 111320 * Math.cos(origin.lat * Math.PI / 180);
const features = new Map();
for (const file of (await readdir('raw')).filter(f => /^buildings_.*\.json$/.test(f))) {
  for (const e of JSON.parse(await readFile(`raw/${file}`, 'utf8')).elements) {
    if (e.type === 'way' && e.geometry?.length > 3) features.set(e.id, e);
  }
}
// Prefer the complete four-ring extract, retaining relation identities.
try {
  for (const f of JSON.parse(await readFile('raw/geospatial/osm.geojson','utf8')).features) {
    if(f.geometry.type!=='MultiPolygon'||!(f.properties.building||f.properties['building:part']||f.properties.leisure==='stadium'))continue;
    const [type,id]=f.id.split('/');features.set(Number(id),{type,id:Number(id),tags:f.properties,geometry:f.geometry.coordinates[0][0].map(([lon,lat])=>({lon,lat}))});
  }
} catch(error) { if(error.code!=='ENOENT')throw error; }
const center = e => {
  const p = e.geometry;
  return [(Math.min(...p.map(p => p.lat)) + Math.max(...p.map(p => p.lat))) / 2,
    (Math.min(...p.map(p => p.lon)) + Math.max(...p.map(p => p.lon))) / 2];
};
const distance = (e, lat, lon) => { const [a,b] = center(e); return Math.hypot((a-lat)*111132, (b-lon)*mlon); };
const rows = [
  ['taihedian','太和殿','HALL OF SUPREME HARMONY',39.91582,116.39078,37.44,420,638449347],
  ['qiniandian','祈年殿','TEMPLE OF HEAVEN',39.88225,116.40662,36.8,420,43921139],
  ['tiananmen','天安门','TIANANMEN',39.907339,116.391252,34.7,320,8847697],
  ['zhengyangmen','正阳门','ZHENGYANG GATE',39.89918,116.39153,43.65,260],
  ['jianlou','前门箭楼','QIANMEN ARROW TOWER',39.89797,116.39164,35.37,220,439956436],
  ['yongdingmen','永定门','YONGDINGMEN GATE',39.87106,116.39309,26,240],
  ['wumen','午门','MERIDIAN GATE',39.91229,116.391,35.6,420,638156366],
  ['shenwumen','神武门','GATE OF DIVINE MIGHT',39.92092,116.39057,31,300,638741722],
  ['donghuamen','东华门','EAST GLORIOUS GATE',39.9137,116.39518,25,240,40343947],
  ['xihuamen','西华门','WEST GLORIOUS GATE',39.91337,116.38669,25,240,40343948],
  ['taihemen','太和门','GATE OF SUPREME HARMONY',39.91395,116.39088,23.8,260,638308745],
  ['jiaolou-sw','故宫角楼','CORNER TOWER',39.91239,116.38656,27.5,200],
  ['jiaolou-se','故宫东南角楼','SOUTHEAST CORNER TOWER',39.91260,116.39518,27.5,200],
  ['jiaolou-nw','故宫西北角楼','NORTHWEST CORNER TOWER',39.920779,116.386327,27.5,200,638703808],
  ['jiaolou-ne','故宫东北角楼','NORTHEAST CORNER TOWER',39.92100,116.39498,27.5,200],
  ['gulou','鼓楼','DRUM TOWER',39.93935,116.38974,46.7,260,267371087],
  ['zhonglou','钟楼','BELL TOWER',39.94102,116.38964,47.9,240,425993664],
  ['chinazun','中国尊','CHINA ZUN · 528M',39.9115,116.4602,528,720,599547918],
  ['guomao3','国贸三期','CHINA WORLD TOWER · 330M',39.91097545,116.45236545,330,600,116944490],
  ['cctv','央视大楼','CCTV HEADQUARTERS',39.9138,116.4579,234,520,7820447],
  ['birdnest','鸟巢',"BIRD’S NEST",39.99165,116.3907,69,520,152301551],
  ['watercube','水立方','WATER CUBE',39.9916,116.38417,31,330,29201257],
  ['ncpa','国家大剧院','NATIONAL CENTRE FOR THE PERFORMING ARTS',39.90334165,116.38354725,46.68,420,4974233],
  ['white-dagoba','北海白塔','WHITE DAGOBA',39.924421,116.383002,35.9,240,561193504],
  ['monument','人民英雄纪念碑','MONUMENT TO THE PEOPLE’S HEROES',39.9046,116.3913,37.94,110],
  ['olympic-tower','奥林匹克塔','OLYMPIC PARK TOWER',40.00655,116.387873,246.8,400,962658730],
  ['linglong','玲珑塔','LINGLONG TOWER',39.9958,116.38775,132,260,161460527],
];
const sourceURLs = {
  taihedian:['https://www.dpm.org.cn/explore/building/236465.html','https://www.dpm.org.cn/building/talk/223525.html'],
  qiniandian:['https://gygl.beijing.gov.cn/mlgy/mlgy_gyjg01/201912/t20191211_1048233.html','https://tiantanpark.cn/scenic_spot_list/detail/1254.html','https://gygl.beijing.gov.cn/whgy/whgy_wsgc/201912/t20191206_885633.html','https://www.tiantanpark.cn/scenic_spot_list_g7yU_96/p/1.html','https://whc.unesco.org/uploads/nominations/881.pdf'],
  wumen:['https://www.dpm.org.cn/explore/building/236454.html'],
  tiananmen:['https://www.dpm.org.cn/Uploads/File/pdf/21/37/8d/21378dd0b3131359d9cafc62a7a3369f.pdf'],
  zhengyangmen:['https://wwj.beijing.gov.cn/bjww/wwjzzcslm/1737418/1738081/gzdt53/10856451/2020082814592768170.pdf'],
  cctv:['https://www.oma.com/projects/cctv-headquarters','https://www.turnerconstruction.com/projects/china-central-television-headquarters-cctv'],
  birdnest:['https://www.herzogdemeuron.com/projects/226-national-stadium/'],
  'white-dagoba':['https://gygl.beijing.gov.cn/mlgy/mlgy_gyjg01/201912/t20191211_1048483.html'],
};
// Preserve the final engineering references without changing the OSM approximation classification.
const additionalSourceURLs = {
  birdnest:[
    'https://www.arup.com/globalassets/downloads/arup-journal/the-arup-journal-2009-issue-1.pdf',
    'https://www.engineering.org.cn/sscae/CN/1160100327263363612',
    'https://www.n-s.cn/aboutindex.html',
    'https://www.n-s.cn/article_8f40ed628459423285ef875561413fb1.html',
  ],
  watercube:[
    'https://architectureau.com/articles/practice-23/',
    'https://yuandacn.com/index.php/en/projects-cn-2/101-domestic/beijing/219-national-swimming-center-2.html',
  ],
};
const landmarks = rows.map(([id,name,en,lat,lon,heightM,focus,wayId]) => {
  let main = features.get(wayId);
  if (!main) main = [...features.values()].filter(e => e.tags?.name === name && distance(e,lat,lon)<180).sort((a,b)=>distance(a,lat,lon)-distance(b,lat,lon))[0];
  if (id.startsWith('jiaolou')) {
    const roofParts=[...features.values()].filter(e=>e.tags?.['building:part']&&Number(e.tags.height)===27&&distance(e,lat,lon)<70);
    if(roofParts.length)main=roofParts.sort((a,b)=>distance(a,lat,lon)-distance(b,lat,lon))[0];
  }
  if (main) [lat,lon] = center(main);
  const model = id.startsWith('jiaolou') ? 'jiaolou' : id;
  let related = main ? [main] : [];
  const radius = id === 'cctv' ? 130 : id === 'birdnest' ? 240 : id === 'tiananmen' ? 72 : id === 'olympic-tower' ? 40 : id.startsWith('jiaolou') ? 25 : id === 'wumen' ? 90 : 0;
  if (radius) related.push(...[...features.values()].filter(e => e.tags?.['building:part'] && distance(e,lat,lon)<radius));
  if(id.startsWith('jiaolou'))related.push(...[...features.values()].filter(e=>/^[东西][南北]城墙$/.test(e.tags?.name??'')&&distance(e,lat,lon)<45));
  related = [...new Map(related.map(e=>[e.id,e])).values()];
  const rotDeg = ({birdnest:86.29,donghuamen:90,xihuamen:90,shenwumen:180,jianlou:180,'jiaolou-sw':0,'jiaolou-se':90,'jiaolou-nw':270,'jiaolou-ne':180}[id] ?? -1.5);
  return { id, model, name, en, lat, lon, rotDeg, elevationM:0, heightM, labelH:heightM+6,
    focus, lookAnchor:[0,heightM*0.45,0], showLabel:!['jiaolou-se','jiaolou-nw','jiaolou-ne'].includes(id),
    footprint:related[0]?.geometry.map(p=>[p.lon,p.lat]) ?? [], footprints:related.map(e=>e.geometry.map(p=>[p.lon,p.lat])),
    replacesOSMIds:related.map(e=>`${e.type}/${e.id}`),
    accuracy:sourceURLs[id]?'source-calibrated architectural reconstruction':'OSM-footprint architectural approximation',
    sources:[...(sourceURLs[id]??[]),...related.map(e=>`https://www.openstreetmap.org/${e.type}/${e.id}`),...(additionalSourceURLs[id]??[])],
    ...(id==='birdnest'?{rotationEvidence:{method:'principal axis of current mapped stadium footprint; not a surveyed angle',source:'https://www.openstreetmap.org/way/152301551',verifiedAt:'2026-10-02'}}:{}),
    lod:{near:`./models/landmarks/${model}.glb`,medium:`./models/landmarks/${model}-medium.glb`,far:`./models/landmarks/${model}-far.glb`,distancesM:[650,2400]},
    collision:`./models/landmarks/${model}-collision.glb` };
});
for (const [id,name,en,lat,lon,box] of [
  ['yonghegong','雍和宫','YONGHE TEMPLE',39.9467,116.41096,[39.94542,116.41043,39.9477,116.41152]],
  ['confucius-guozijian','孔庙 · 国子监','CONFUCIUS TEMPLE · IMPERIAL COLLEGE',39.9453,116.4077,[39.94455,116.40645,39.94618,116.40885]],
]) {
  const layout = [...features.values()].filter(e=> { const [a,b]=center(e); return e.tags?.building && a>box[0]&&b>box[1]&&a<box[2]&&b<box[3]&&!e.tags.shop; }).map(e=> {
    const [a,b]=center(e);const p=e.geometry; const w=(Math.max(...p.map(x=>x.lon))-Math.min(...p.map(x=>x.lon)))*mlon;
    const d=(Math.max(...p.map(x=>x.lat))-Math.min(...p.map(x=>x.lat)))*111132;
    const name=e.tags.name??e.tags['name:en']??'配殿';
    return {id:`${e.type}/${e.id}`,name,x:(b-lon)*mlon,y:(a-lat)*111132,w,d,heightM:Number(e.tags.height)||(/万福阁/.test(name)?25:/辟雍/.test(name)?18:/大成殿|法轮殿/.test(name)?16:9),roof:/辟雍|碑亭/.test(name)?'pavilion':'hip',polygon:p.map(p=>[p.lon,p.lat])};
  });
  landmarks.push({id,model:id,name,en,lat,lon,rotDeg:0,elevationM:0,heightM:25,labelH:32,focus:450,lookAnchor:[0,10,0],showLabel:true,
    footprint:[],footprints:layout.map(b=>b.polygon),replacesOSMIds:layout.map(b=>b.id),layout,
    accuracy:'OSM-footprint architectural approximation; facade and unmeasured heights remain approximate',
    sources:['https://www.openstreetmap.org/copyright'],lod:{near:`./models/landmarks/${id}.glb`,medium:`./models/landmarks/${id}-medium.glb`,far:`./models/landmarks/${id}-far.glb`,distancesM:[800,2800]},collision:`./models/landmarks/${id}-collision.glb`});
}
try { landmarks.push(...JSON.parse(await readFile('assets-source/landmarks/parks.json','utf8'))); } catch(error) {if(error.code!=='ENOENT')throw error;}
try {const elevations=JSON.parse(await readFile('raw/geospatial/landmark-elevations.json','utf8'));for(const l of landmarks)l.elevationM=elevations[l.id]??0;}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir('config',{recursive:true});
await writeFile('config/landmarks.json',JSON.stringify({version:2,origin,coordinates:'WGS84 longitude, latitude; local metres east/up/south',modelCoordinates:'Blender metres: X east, Y north, Z up; glTF Y up',landmarks},null,2)+'\n');
console.log(`Registered ${landmarks.length} landmark placements, ${landmarks.reduce((n,l)=>n+l.replacesOSMIds.length,0)} exact OSM replacement ways.`);
