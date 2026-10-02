/** Permanent landscape geometry. Architectural landmarks share the model manager. */
import * as THREE from 'three';
import { latLonToLocal, hash01 } from './geo';
export interface Landmark {
  id?: string;
  name: string;
  en: string;
  anchor: THREE.Vector3;
  lookAnchor?: THREE.Vector3;
  focus: number;
  group: THREE.Group;
  showLabel?: boolean;
}
export const nightEmissives: {mat:THREE.MeshStandardMaterial;color:THREE.Color;intensity:number}[] = [];
export function updateLandmarkNight(t:number) {
  for (const e of nightEmissives) e.mat.emissive.copy(e.color).multiplyScalar(t*e.intensity);
}
function box(w:number,h:number,d:number,material:THREE.Material,x=0,y=0,z=0) {
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y+h/2,z);return m;
}
function wallRing() {
  const group=new THREE.Group();group.name='Palace perimeter with gate openings';
  const red=new THREE.MeshStandardMaterial({color:0x842e23,roughness:.9});
  const cap=new THREE.MeshStandardMaterial({color:0x77786e,roughness:.95});
  const width=753,depth=955,height=9.6,thickness=6;
  // Gate mouths stay open; no solid cross-city walls through the four real portals.
  for (const side of [-1,1]) {
    const gap=side===1?128:62;
    const span=(width-gap)/2;
    for (const sign of [-1,1]) {
      const x=sign*(gap/2+span/2),z=side*depth/2;
      group.add(box(span,height,thickness,red,x,0,z),box(span,.4,thickness+.3,cap,x,height,z));
    }
    const northSpan=depth/2+160-35,southSpan=depth/2-160-35;
    const x=side*width/2;
    group.add(box(thickness,height,northSpan,red,x,0,-depth/2+northSpan/2));
    group.add(box(thickness,height,southSpan,red,x,0,depth/2-southSpan/2));
  }
  return group;
}
function pavilion(material:THREE.Material,wood:THREE.Material) {
  const g=new THREE.Group();const columns=new THREE.InstancedMesh(new THREE.CylinderGeometry(.3,.3,5,8),wood,8);
  const matrix=new THREE.Matrix4();
  for(let i=0;i<8;i++){const a=i*Math.PI/4;matrix.makeTranslation(Math.cos(a)*4.2,2.5,Math.sin(a)*4.2);columns.setMatrixAt(i,matrix);}
  g.add(columns);
  const profile=[new THREE.Vector2(5.8,5.2),new THREE.Vector2(5.3,5.3),new THREE.Vector2(3.7,6.5),new THREE.Vector2(2.5,8),new THREE.Vector2(.2,10.2)];
  g.add(new THREE.Mesh(new THREE.LatheGeometry(profile,8),material));return g;
}
function jingshan(groundHeight?: (x:number,z:number)=>number, originX=0, originZ=0, ground=0) {
  const group=new THREE.Group();group.name='Jingshan east-west ridge';
  const nx=64,nz=36,halfX=235,halfZ=145;
  const positions:number[]=[],indices:number[]=[];
  // Five-peaked east-west ridge, zero at its boundary; elevation relative to city ground.
  const height=(x:number,z:number)=>{
    if(groundHeight)return groundHeight(originX+x,originZ+z)-ground;
    const boundary=Math.max(0,1-(x/halfX)**2)*Math.max(0,1-(z/halfZ)**2);
    const peaks=[[-150,23],[-80,31],[0,45.7],[80,31],[150,23]];
    const ridge=Math.max(...peaks.map(([p,h])=>h*Math.exp(-(((x-p)/65)**2))));
    return boundary**.35*ridge*Math.exp(-((z/halfZ)**2)*2.4);
  };
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
    const x=(ix/nx-.5)*halfX*2,z=(iz/nz-.5)*halfZ*2;positions.push(x,height(x,z),z);
  }
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
    const a=iz*(nx+1)+ix,b=a+1,c=a+nx+1,d=c+1;
    indices.push(a,c,b,b,c,d); // Two triangles per cell; old four-index quads corrupted topology.
  }
  const terrain=new THREE.BufferGeometry();terrain.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));terrain.setIndex(indices);terrain.computeVertexNormals();terrain.computeBoundingSphere();
  if(!groundHeight)group.add(new THREE.Mesh(terrain,new THREE.MeshStandardMaterial({color:0x65714b,roughness:1})));
  else terrain.dispose(); // The geospatial terrain already supplies this surface and its real imagery.
  const trees=new THREE.InstancedMesh(new THREE.ConeGeometry(2.8,8,7),new THREE.MeshStandardMaterial({color:0x3f6038,roughness:1}),650);
  const matrix=new THREE.Matrix4();let count=0;
  for(let i=0;i<900&&count<650;i++){
    const x=(hash01(i+11)*2-1)*halfX*.93,z=(hash01(i+197)*2-1)*halfZ*.93;
    if(Math.abs(z)<13&&[-150,-80,0,80,150].some(px=>Math.abs(px-x)<13))continue;
    const scale=.65+hash01(i+300)*.65;matrix.compose(new THREE.Vector3(x,height(x,z)+4*scale,z),new THREE.Quaternion(),new THREE.Vector3(scale,scale,scale));trees.setMatrixAt(count++,matrix);
  }
  trees.count=count;trees.computeBoundingSphere();group.add(trees);
  const roof=new THREE.MeshStandardMaterial({color:0xb9913d,roughness:.4,metalness:.1});const timber=new THREE.MeshStandardMaterial({color:0x913f2b,roughness:.75});
  for(const x of [-150,-80,0,80,150]){const p=pavilion(roof,timber);p.position.set(x,height(x,0),0);group.add(p);}
  return group;
}
export function buildLandmarks(options: {groundHeight?: (x:number,z:number)=>number} = {}): {group:THREE.Group;landmarks:Landmark[];dispose:()=>void} {
  const group=new THREE.Group();group.name='Historic landscape';const landmarks:Landmark[]=[];
  function add(id:string,name:string,en:string,lat:number,lon:number,obj:THREE.Group,labelH:number,focus:number){
    const [x,z]=latLonToLocal(lat,lon),ground=options.groundHeight?.(x,z)??0;obj.position.set(x,ground,z);group.add(obj);
    landmarks.push({id,name,en,anchor:new THREE.Vector3(x,labelH+ground,z),lookAnchor:new THREE.Vector3(x,labelH*.55+ground,z),focus,group:obj,showLabel:true});
  }
  add('forbidden-city','故宫','THE FORBIDDEN CITY',39.9166,116.3907,wallRing(),42,1400);
  const [jx,jz]=latLonToLocal(39.92355,116.39008),jg=options.groundHeight?.(jx,jz)??0;
  add('jingshan','景山','JINGSHAN PARK',39.92355,116.39008,jingshan(options.groundHeight,jx,jz,jg),options.groundHeight?13:58,440);
  add('shichahai','什刹海','SHICHAHAI LAKES',39.94,116.386,new THREE.Group(),12,500);
  return {group,landmarks,dispose(){
    const materials=new Set<THREE.Material>(),geometries=new Set<THREE.BufferGeometry>();
    group.traverse(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh)return;geometries.add(mesh.geometry);(Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(m=>materials.add(m));});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.removeFromParent();nightEmissives.length=0;
  }};
}
