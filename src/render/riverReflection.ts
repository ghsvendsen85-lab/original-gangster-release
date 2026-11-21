import * as THREE from 'three';
import type { ReflectionUniforms } from './pondWater';

/**
 * A mirror image of the city in the river, for the free 3D view: the scene
 * drawn once more, at reduced size, from the camera reflected in the water's
 * level plane (an oblique near plane cuts away everything below the water).
 * The river's shader (pondWater.ts) samples it through `matrix`, rippled by
 * the water's own surface.
 */
export class RiverReflection {
  private target: THREE.WebGLRenderTarget;
  private mirror = new THREE.PerspectiveCamera();
  private plane = new THREE.Plane();
  private clip = new THREE.Vector4();
  private q = new THREE.Vector4();
  private view = new THREE.Vector3();
  private look = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private rot = new THREE.Matrix4();
  private normal = new THREE.Vector3(0, 1, 0);
  private point = new THREE.Vector3();

  private uniforms: ReflectionUniforms | null = null;

  constructor(private scale = .5) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 });
    this.target.texture.generateMipmaps = false;
  }

  /** The water material that shows the reflection (a rebuilt landscape brings a new one). */
  bind(uniforms: ReflectionUniforms): void {
    if (this.uniforms && this.uniforms !== uniforms) this.uniforms.reflectionStrength.value = 0;
    this.uniforms = uniforms;
    uniforms.reflectionMap.value = this.target.texture;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.target.setSize(Math.max(1, Math.round(width * pixelRatio * this.scale)), Math.max(1, Math.round(height * pixelRatio * this.scale)));
  }

  /**
   * Render the reflection for `camera` in the plane y = `level`; `hide` are
   * drawn in the main view only (the water itself, effects that would double).
   * Returns false (and turns the reflection off) when the camera is below the water.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, level: number, hide: THREE.Object3D[], strength: number): boolean {
    this.point.set(0, level, 0);
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.view.subVectors(this.point, this.camPos);
    const u = this.uniforms;
    if (!u || strength <= 0 || this.view.dot(this.normal) > 0) { this.off(); return false; }
    // Reflect the camera's position, view direction and up in the plane.
    this.view.set(this.camPos.x, 2 * level - this.camPos.y, this.camPos.z);
    this.rot.extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    this.look.y = 2 * level - this.look.y;
    const m = this.mirror;
    m.position.copy(this.view);
    m.up.set(0, 1, 0).applyMatrix4(this.rot);
    m.up.y = -m.up.y;
    m.lookAt(this.look);
    m.near = camera.near; m.far = camera.far; m.fov = camera.fov; m.aspect = camera.aspect;
    m.updateMatrixWorld(true);
    m.projectionMatrix.copy(camera.projectionMatrix);
    m.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

    // Texture lookup: world → mirror clip → [0, 1].
    u.reflectionMatrix.value.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1)
      .multiply(m.projectionMatrix).multiply(m.matrixWorldInverse);

    // Oblique near plane at the water (Lengyel): nothing under the water is drawn.
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.point).applyMatrix4(m.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const e = m.projectionMatrix.elements;
    this.q.set((Math.sign(this.clip.x) + e[8]) / e[0], (Math.sign(this.clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    e[2] = this.clip.x; e[6] = this.clip.y; e[10] = this.clip.z + 1 - .003; e[14] = this.clip.w;

    const shown = hide.map(o => o.visible);
    for (const o of hide) o.visible = false;
    const before = renderer.getRenderTarget(), autoShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    u.reflectionStrength.value = 0;
    try {
      renderer.setRenderTarget(this.target);
      renderer.clear();
      renderer.render(scene, m);
    } finally {
      renderer.setRenderTarget(before);
      renderer.shadowMap.autoUpdate = autoShadow;
      hide.forEach((o, i) => { o.visible = shown[i]; });
    }
    u.reflectionStrength.value = strength;
    return true;
  }

  off(): void { if (this.uniforms) this.uniforms.reflectionStrength.value = 0; }

  dispose(): void { this.target.dispose(); }
}
