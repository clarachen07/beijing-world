/**
 * 环境系统：天空穹顶（渐变+太阳+星空）、昼夜光照、雾。
 * nightT ∈ [0,1] 由 main 驱动，所有环境属性随之插值。
 */
import * as THREE from 'three';
import { uniforms } from './materials';

export class Environment {
  sun = new THREE.DirectionalLight(0xffd9a8, 2.6);
  moon = new THREE.DirectionalLight(0x8fa4d0, 0.0);
  hemi = new THREE.HemisphereLight(0xbfd0e8, 0x6b6052, 0.85);
  ambient = new THREE.AmbientLight(0x606878, 0.25);
  sky!: THREE.Mesh;
  fog = new THREE.FogExp2(0xdec5a5, 0.000055);

  nightT = 0;
  target = 0; // 目标昼夜状态

  constructor() {
    // 午后太阳：偏西（金色暖调）
    this.sun.position.set(-9000, 7200, -5000);
    this.moon.position.set(6000, 7000, -4000);

    const geo = new THREE.SphereGeometry(30000, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uNight: uniforms.uNight,
        uSunDir: { value: new THREE.Vector3().copy(this.sun.position).normalize() },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform float uNight;
        uniform vec3 uSunDir;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0); // 注意：pow 不接受负底数，必须 clamp 到 0
          // 白天：暖金地平线 → 蓝天
          vec3 dayH = vec3(0.94, 0.78, 0.60);
          vec3 dayT = vec3(0.35, 0.55, 0.82);
          // 夜晚：深蓝夜幕
          vec3 nightH = vec3(0.028, 0.038, 0.075);
          vec3 nightT = vec3(0.002, 0.004, 0.012);
          vec3 col = mix(mix(dayH, dayT, pow(h, 0.55)), mix(nightH, nightT, pow(h, 0.45)), uNight);
          // 太阳与光晕
          float sd = max(dot(vDir, uSunDir), 0.0);
          vec3 sunCol = vec3(1.0, 0.72, 0.42);
          col += sunCol * pow(sd, 900.0) * 2.4 * (1.0 - uNight);
          col += sunCol * pow(sd, 22.0) * 0.35 * (1.0 - uNight);
          // 星空
          vec3 sp = floor(vDir * 320.0);
          float star = step(0.9985, hash(sp)) * smoothstep(0.05, 0.25, vDir.y);
          float tw = 0.6 + 0.4 * hash(sp + 1.7);
          col += vec3(0.9, 0.93, 1.0) * star * tw * uNight * 1.4;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
  }

  /** 每帧更新（nightT 向 target 平滑过渡） */
  update(dt: number) {
    const speed = 0.5;
    this.nightT += (this.target - this.nightT) * Math.min(1, dt * speed);
    if (Math.abs(this.target - this.nightT) < 0.001) this.nightT = this.target;
    const n = this.nightT;

    this.sun.intensity = 2.6 * (1 - n);
    this.sun.color.setHSL(0.085, 0.75, 0.62 - n * 0.05);
    this.moon.intensity = 0.5 * n;
    this.hemi.intensity = 0.85 * (1 - n) + 0.16 * n;
    this.hemi.color.set(0xbfd0e8).lerp(new THREE.Color(0x2a3654), n);
    this.hemi.groundColor.set(0x6b6052).lerp(new THREE.Color(0x14161c), n);
    this.ambient.intensity = 0.25 * (1 - n) + 0.12 * n;

    const dayFog = new THREE.Color(0xd8c4a8);
    const nightFog = new THREE.Color(0x070b14);
    this.fog.color.copy(dayFog).lerp(nightFog, n);
    this.fog.density = 0.000029 + n * 0.000014;

    uniforms.uNight.value = n;
  }
}
