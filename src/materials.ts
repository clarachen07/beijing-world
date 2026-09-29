/**
 * 材质系统：建筑（程序化窗户夜景）、道路、水面、绿地、路灯。
 * 核心技巧：窗户不需要 UV —— 在片元着色器里用世界坐标按楼层/开间网格化，
 * 白天呈玻璃色微暗，夜晚按哈希随机点亮 + 泛光。
 */
import * as THREE from 'three';

export const uniforms = {
  uNight: { value: 0 }, // 0=白天 1=夜晚
};

/** 注入建筑材质：程序化窗户 + 夜景灯光 */
export function makeBuildingMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPos;
        uniform float uNight;
        float bhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // ── 程序化窗户 ──
        vec3 bNormal = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
        float winEmit = 0.0;
        if (abs(bNormal.y) < 0.6) {
          float u = abs(bNormal.x) > abs(bNormal.z) ? vWorldPos.z : vWorldPos.x;
          float v = vWorldPos.y;
          vec2 cell = vec2(floor(u / 2.9), floor(v / 3.3));
          vec2 f = vec2(fract(u / 2.9), fract(v / 3.3));
          float inWin = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
          // 建筑指纹（位置粗哈希）→ 每栋楼亮灯模式不同
          float seed = floor((vWorldPos.x + vWorldPos.z) / 24.0);
          float lit = step(0.62, bhash(cell + vec2(seed * 3.3, seed * 1.7)));
          winEmit = inWin * lit * uNight;
          // 白天: 窗户呈深色玻璃（带天空反射蓝调）
          vec3 glassDay = diffuseColor.rgb * vec3(0.34, 0.42, 0.5) + vec3(0.05, 0.08, 0.12);
          diffuseColor.rgb = mix(diffuseColor.rgb, glassDay, inWin * (1.0 - uNight) * 0.85);
          // 夜晚未点亮面略暗
          diffuseColor.rgb *= mix(1.0, 0.82, uNight);
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * winEmit * 1.35;`
      );
  };
  return mat;
}

export function makeRoadMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uNight;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= mix(1.0, 0.5, uNight);`
      );
  };
  return mat;
}

export function makeWaterMaterial(): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    vertexColors: true,
    flatShading: true,
    shininess: 120,
    specular: new THREE.Color(0x88aacc),
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function makeGreenMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uNight;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= mix(1.0, 0.4, uNight);`
      );
  };
  return mat;
}

/** 路灯光点（Points，柔光圆贴图） */
export function makeStreetlightMaterial(): THREE.PointsMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,220,160,1)');
  g.addColorStop(0.35, 'rgba(255,190,110,0.55)');
  g.addColorStop(1, 'rgba(255,170,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.PointsMaterial({
    size: 7,
    map: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  return mat;
}
