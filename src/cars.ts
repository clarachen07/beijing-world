import * as THREE from 'three';
import { TrafficSimulation } from './traffic';

export class Traffic {
  readonly group = new THREE.Group(); readonly simulation: TrafficSimulation;
  readonly mesh: THREE.InstancedMesh; readonly lights: THREE.Points;
  private lightPositions: Float32Array; private matrix = new THREE.Matrix4(); private position = new THREE.Vector3();
  private rotation = new THREE.Quaternion(); private scale = new THREE.Vector3(1, 1, 1);
  private sample = { x: 0, z: 0, dx: 0, dz: 1 };
  private seconds = 0;
  constructor(paths: Float32Array[], count = 240, private heightAt: (x: number, z: number) => number = () => 0) {
    this.simulation = new TrafficSimulation(paths, count);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 1.4, 4.3), new THREE.MeshLambertMaterial(), this.simulation.cars.length);
    const palette = [0xe6e5e1, 0x323d46, 0xb9b4a5, 0x8a3c33, 0x476582, 0xcec7af];
    const color = new THREE.Color();
    this.simulation.cars.forEach((_, i) => this.mesh.setColorAt(i, color.setHex(palette[i % palette.length])));
    this.mesh.frustumCulled = false; this.group.add(this.mesh);
    this.lightPositions = new Float32Array(this.simulation.cars.length * 3);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(this.lightPositions, 3));
    this.lights = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffe4bd, size: 3, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.lights.frustumCulled = false; this.group.add(this.lights); this.evaluateAt(0, 0);
  }
  get cars() { return this.simulation.cars; }
  evaluateAt(seconds: number, night: number) {
    this.seconds = seconds;
    this.simulation.cars.forEach((car, i) => {
      this.simulation.evaluate(i, seconds, this.sample);
      const { x, z, dx, dz } = this.sample, y = this.heightAt(x, z);
      this.position.set(x, y + 0.85, z);
      this.rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(dx * car.direction, dz * car.direction));
      this.matrix.compose(this.position, this.rotation, this.scale); this.mesh.setMatrixAt(i, this.matrix);
      this.lightPositions[i * 3] = x + dx * car.direction * 2.15;
      this.lightPositions[i * 3 + 1] = y + 0.65;
      this.lightPositions[i * 3 + 2] = z + dz * car.direction * 2.15;
    });
    this.mesh.instanceMatrix.needsUpdate = true; this.lights.geometry.attributes.position.needsUpdate = true;
    (this.lights.material as THREE.PointsMaterial).opacity = night * 0.75; this.lights.visible = night > 0.05;
  }
  update(dt: number, night: number) { this.evaluateAt(this.seconds + dt, night); }
  dispose() {
    this.group.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose();
    this.lights.geometry.dispose(); (this.lights.material as THREE.Material).dispose(); this.group.clear();
  }
}
