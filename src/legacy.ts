/**
 * Blender 精细地标模型 (GLB) 加载与落位。
 * 模型在 Blender 中按真实尺寸(Z-up)建模, glTF 导出后 Y-up,
 * three.js 加载后平移到 latLonToLocal 坐标即与 OSM 城市对齐。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { latLonToLocal } from './geo';
import { resolveAsset } from './loader';
import { uniforms } from './materials';
import type { Landmark } from './landmarks';

export interface LegacyDef {
  file: string;
  lat: number;
  lon: number;
  rotDeg?: number;
  name: string;
  en: string;
  labelH: number; // 标签锚点高度
  focus: number;
}

// 坐标全部来自 OSM 真实数据
export const LEGACY_DEFS: LegacyDef[] = [
  { file: 'taihedian', lat: 39.91582, lon: 116.39078, name: '太和殿', en: 'HALL OF SUPREME HARMONY', labelH: 42, focus: 420 },
  { file: 'qiniandian', lat: 39.88225, lon: 116.40662, name: '祈年殿', en: 'TEMPLE OF HEAVEN', labelH: 40, focus: 420 },
  { file: 'tiananmen', lat: 39.9072, lon: 116.3911, name: '天安门', en: 'TIANANMEN', labelH: 42, focus: 320 },
  { file: 'zhengyangmen', lat: 39.89918, lon: 116.39153, name: '正阳门', en: 'ZHENG YANG MEN', labelH: 46, focus: 260 },
  { file: 'jianlou', lat: 39.89797, lon: 116.39164, rotDeg: 180, name: '前门箭楼', en: 'QIANMEN ARROW TOWER', labelH: 36, focus: 200, },
  { file: 'yongdingmen', lat: 39.87106, lon: 116.39309, name: '永定门', en: 'YONGDINGMEN GATE', labelH: 38, focus: 240 },
  { file: 'wumen', lat: 39.91229, lon: 116.391, name: '午门', en: 'MERIDIAN GATE', labelH: 50, focus: 420 },
  { file: 'shenwumen', lat: 39.92092, lon: 116.39057, rotDeg: 180, name: '神武门', en: 'GATE OF DIVINE MIGHT', labelH: 40, focus: 300 },
  { file: 'donghuamen', lat: 39.9137, lon: 116.39518, rotDeg: -90, name: '东华门', en: 'EAST GLORIOUS GATE', labelH: 34, focus: 240 },
  { file: 'xihuamen', lat: 39.91337, lon: 116.38669, rotDeg: 90, name: '西华门', en: 'WEST GLORIOUS GATE', labelH: 34, focus: 240 },
  { file: 'taihemen', lat: 39.91395, lon: 116.39088, name: '太和门', en: 'GATE OF SUPREME HARMONY', labelH: 30, focus: 260 },
  { file: 'jiaolou', lat: 39.9123, lon: 116.3863, rotDeg: 45, name: '故宫角楼', en: 'CORNER TOWER', labelH: 26, focus: 200, },
  { file: 'jiaolou', lat: 39.9123, lon: 116.3951, rotDeg: -45, name: '故宫角楼', en: 'CORNER TOWER', labelH: 26, focus: 200, showLabel: false } as any,
  { file: 'jiaolou', lat: 39.9209, lon: 116.3863, rotDeg: 135, name: '故宫角楼', en: 'CORNER TOWER', labelH: 26, focus: 200, showLabel: false } as any,
  { file: 'jiaolou', lat: 39.9209, lon: 116.3951, rotDeg: -135, name: '故宫角楼', en: 'CORNER TOWER', labelH: 26, focus: 200, showLabel: false } as any,
  { file: 'gulou', lat: 39.9403, lon: 116.3893, name: '鼓楼', en: 'DRUM TOWER', labelH: 48, focus: 260 },
  { file: 'zhonglou', lat: 39.9417, lon: 116.3893, name: '钟楼', en: 'BELL TOWER', labelH: 52, focus: 240 },
  { file: 'chinazun', lat: 39.91157, lon: 116.46014, name: '中国尊', en: 'CHINA ZUN · 528M', labelH: 420, focus: 700 },
  { file: 'guomao3', lat: 39.9086, lon: 116.4599, name: '国贸三期', en: 'CHINA WORLD TOWER', labelH: 280, focus: 600 },
  { file: 'cctv', lat: 39.9153, lon: 116.4642, name: '央视大楼', en: 'CCTV HEADQUARTERS', labelH: 240, focus: 520 },
  { file: 'birdnest', lat: 39.9929, lon: 116.3966, name: '鸟巢', en: "BIRD'S NEST", labelH: 88, focus: 500 },
  { file: 'watercube', lat: 39.99155, lon: 116.3842, name: '水立方', en: 'WATER CUBE', labelH: 48, focus: 320 },
  { file: 'ncpa', lat: 39.90333, lon: 116.38357, name: '国家大剧院', en: 'NATIONAL GRAND THEATRE', labelH: 62, focus: 420 },
];

/** 注入玻璃幕墙窗户着色器（现代地标夜间亮灯） */
function enhanceMaterial(mat: THREE.Material) {
  const std = mat as THREE.MeshStandardMaterial;
  const isGlass = /glass/i.test(std.name || '');
  if (!isGlass) return;
  std.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        uniform float uNight;
        float lhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 n2 = normalize(vNormal);
        if (abs(n2.y) < 0.5) {
          float u = abs(n2.x) > abs(n2.z) ? vWPos.z : vWPos.x;
          vec2 cell = vec2(floor(u / 3.6), floor(vWPos.y / 3.6));
          vec2 f = vec2(fract(u / 3.6), fract(vWPos.y / 3.6));
          float inWin = step(0.15, f.x) * step(f.x, 0.85) * step(0.2, f.y) * step(f.y, 0.8);
          float seed = floor((vWPos.x + vWPos.z) / 30.0);
          float lit = step(0.55, lhash(cell + seed));
          totalEmissiveRadiance += vec3(0.9, 0.75, 0.45) * inWin * lit * uNight * 0.8;
        }`
      );
  };
  std.needsUpdate = true;
}

export function loadLegacyLandmarks(
  onProgress: (frac: number, label: string) => void,
  onEach: (def: LegacyDef, obj: THREE.Object3D, lm: Landmark) => void
): Promise<void> {
  const loader = new GLTFLoader();
  const items = LEGACY_DEFS.filter((d, i) => LEGACY_DEFS.findIndex((x) => x.file === d.file) === i || true);
  let done = 0;
  return Promise.all(
    items.map(
      (def) =>
        new Promise<void>((resolve) => {
          loader.load(
            resolveAsset(`./models/legacy/${def.file}.glb`),
            (gltf) => {
              const obj = gltf.scene;
              const [x, z] = latLonToLocal(def.lat, def.lon);
              obj.position.set(x, 0, z);
              if (def.rotDeg) obj.rotation.y = (def.rotDeg * Math.PI) / 180;
              obj.traverse((o) => {
                if ((o as THREE.Mesh).isMesh) {
                  o.castShadow = false;
                  o.receiveShadow = false;
                  const mesh = o as THREE.Mesh;
                  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                  mats.forEach(enhanceMaterial);
                }
              });
              const showLabel = (def as any).showLabel !== false;
              const anchor = new THREE.Vector3(x, def.labelH, z);
              onEach(def, obj, {
                name: def.name,
                en: def.en,
                anchor,
                focus: def.focus,
                group: obj as THREE.Group,
                _showLabel: showLabel,
              } as any);
              done++;
              onProgress(done / items.length, `加载精细地标 ${done}/${items.length}`);
              resolve();
            },
            undefined,
            (err) => {
              // CDN 失败 → 回退同源重试一次
              if (!String(err).includes('file://')) {
                loader.load(`./models/legacy/${def.file}.glb`, (g2) => {
                  const obj = g2.scene;
                  const [x, z] = latLonToLocal(def.lat, def.lon);
                  obj.position.set(x, 0, z);
                  if (def.rotDeg) obj.rotation.y = (def.rotDeg * Math.PI) / 180;
                  obj.traverse((o) => {
                    if ((o as THREE.Mesh).isMesh) {
                      const mesh = o as THREE.Mesh;
                      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                      mats.forEach(enhanceMaterial);
                    }
                  });
                  onEach(def, obj, {
                    name: def.name, en: def.en,
                    anchor: new THREE.Vector3(x, def.labelH, z),
                    focus: def.focus, group: obj as THREE.Group, _showLabel: true,
                  } as any);
                  done++;
                  onProgress(done / items.length, `加载精细地标 ${done}/${items.length}`);
                  resolve();
                }, undefined, () => {
                  console.warn(`地标模型 ${def.file} 加载失败`);
                  done++;
                  resolve();
                });
                return;
              }
              console.warn(`地标模型 ${def.file} 加载失败`, err);
              done++;
              resolve();
            }
          );
        })
    )
  ).then(() => undefined);
}
