import * as THREE from 'three';
import { createSmokeTexture } from './smokeTexture';

/**
 * Atmosphere: soft billboards for chimney smoke, steam from the street's
 * vents and manholes, exhaust from moving cars, gun smoke after a shot, and
 * mist over the river at night and in the rain. One instanced draw; the CPU
 * moves a few hundred particles a frame. Purely visual.
 */

export type SmokeKind = 'chimney' | 'steam' | 'exhaust' | 'gun' | 'mist';

const CAPACITY = 1600;

interface KindStyle { life: number; size0: number; size1: number; alpha: number; rise: number; drag: number; tint: [number, number, number]; glow?: boolean }

const STYLE: Record<SmokeKind, KindStyle> = {
  // Coal smoke: grey-brown, rising and spreading on the wind.
  chimney: { life: 9, size0: 1.6, size1: 8, alpha: .6, rise: 1.4, drag: .35, tint: [.34, .32, .3] },
  // Steam: white, quick to rise and quick to go.
  steam: { life: 3.4, size0: .8, size1: 4.6, alpha: .34, rise: 1.5, drag: .8, tint: [.95, .95, .93], glow: true },
  // Exhaust: thin blue-grey puffs left behind on the road.
  exhaust: { life: 1.8, size0: .35, size1: 1.8, alpha: .28, rise: .35, drag: 1.6, tint: [.55, .56, .58] },
  // Powder smoke: a pale cloud that hangs where the gun was fired.
  gun: { life: 3.5, size0: .5, size1: 2.6, alpha: .5, rise: .25, drag: 1.2, tint: [.8, .79, .76], glow: true },
  // River mist: low, wide, slow.
  mist: { life: 14, size0: 7, size1: 14, alpha: .16, rise: .03, drag: .2, tint: [.78, .8, .82], glow: true },
};

export interface SmokeSource { x: number; y: number; z: number }

export interface SmokeConditions {
  /** Ambient light on the smoke (multiplies its colour). */
  light: THREE.Color;
  /** 0 day .. 1 night: steam and mist show more at night. */
  night: number;
  /** 0..1 rain: more steam and mist, chimney smoke beaten down. */
  rain: number;
  /** Wind on the smoke, metres a second (x, z). */
  wind: THREE.Vector2;
}

export class AmbientSmoke {
  readonly mesh: THREE.Mesh;
  private geometry = new THREE.InstancedBufferGeometry();
  private material: THREE.ShaderMaterial;
  private texture = createSmokeTexture();
  private centers = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  private params = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  private tints = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  private px = new Float32Array(CAPACITY); private py = new Float32Array(CAPACITY); private pz = new Float32Array(CAPACITY);
  private vx = new Float32Array(CAPACITY); private vy = new Float32Array(CAPACITY); private vz = new Float32Array(CAPACITY);
  private age = new Float32Array(CAPACITY); private life = new Float32Array(CAPACITY);
  private spin = new Float32Array(CAPACITY); private kind = new Uint8Array(CAPACITY);
  private live = 0;
  private chimneys: SmokeSource[] = [];
  private vents: SmokeSource[] = [];
  private mist: { x: number; z: number; w: number; h: number; y: number }[] = [];
  private seed = 1;
  private kinds = Object.keys(STYLE) as SmokeKind[];
  enabled = true;

  constructor() {
    const plane = new THREE.PlaneGeometry(1, 1);
    this.geometry.index = plane.index;
    this.geometry.setAttribute('position', plane.getAttribute('position'));
    this.geometry.setAttribute('uv', plane.getAttribute('uv'));
    for (const a of [this.centers, this.params, this.tints]) a.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('smokeCenter', this.centers);
    this.geometry.setAttribute('smokeParams', this.params);
    this.geometry.setAttribute('smokeTint', this.tints);
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { smokeMap: { value: this.texture }, light: { value: new THREE.Color(1, 1, 1) } }]),
      vertexShader: /* glsl */`
        #include <common>
        #include <fog_pars_vertex>
        attribute vec3 smokeCenter;
        attribute vec4 smokeParams; // size, alpha, spin, lit by the street at night (0/1)
        attribute vec3 smokeTint;
        varying vec2 vUv;
        varying float vAlpha;
        varying vec3 vTint;
        varying float vGlow;
        void main() {
          vGlow = smokeParams.w;
          float c = cos(smokeParams.z), s = sin(smokeParams.z);
          vUv = mat2(c, -s, s, c) * (uv - .5) + .5;
          vAlpha = smokeParams.y;
          vTint = smokeTint;
          vec4 mvPosition = modelViewMatrix * vec4(smokeCenter, 1.0);
          mvPosition.xy += position.xy * smokeParams.x;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D smokeMap;
        uniform vec3 light;
        varying vec2 vUv;
        varying float vAlpha;
        varying vec3 vTint;
        varying float vGlow;
        void main() {
          vec4 smoke = texture2D(smokeMap, vUv);
          // The baked billows' brightness is their density: wisps, not balls.
          float n = clamp((smoke.r - .11) / .25, 0.0, 1.0);
          float a = smoke.a * vAlpha * (.15 + n * n * 1.6);
          if (a < .004) discard;
          // The baked billows give the shading; the kind's colour and the light the rest.
          // Steam and mist catch the lamps and windows at night; coal smoke stays dark.
          vec3 colour = vTint * max(light, vec3(vGlow * .4)) * (.8 + n * .35);
          gl_FragColor = vec4(colour, a);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'ambient-smoke';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.raycast = () => {};
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Chimney tops (from the buildings); about half of them are lit. */
  setChimneys(tops: SmokeSource[]): void { this.chimneys = tops; }
  /** Street vents and manholes that steam. */
  setVents(vents: SmokeSource[]): void { this.vents = vents; }
  /** The river's open water (world metres; y is world z) and its surface height. */
  setMist(rects: { x: number; y: number; w: number; h: number }[], waterY: number): void {
    this.mist = rects.map(r => ({ x: r.x, z: r.y, w: r.w, h: r.h, y: waterY }));
  }

  emit(kind: SmokeKind, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): void {
    if (!this.enabled || this.live >= CAPACITY) return;
    const i = this.live++, st = STYLE[kind];
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx + (this.rnd() - .5) * .3; this.vy[i] = vy + st.rise * (.7 + this.rnd() * .6); this.vz[i] = vz + (this.rnd() - .5) * .3;
    this.age[i] = 0; this.life[i] = st.life * (.75 + this.rnd() * .5);
    this.spin[i] = this.rnd() * 6.28; this.kind[i] = this.kinds.indexOf(kind);
  }

  /** A gunshot's smoke, at the muzzle. */
  gunshot(x: number, y: number, z: number): void {
    for (let k = 0; k < 3; k++) this.emit('gun', x + (this.rnd() - .5) * .3, y + (this.rnd() - .5) * .2, z + (this.rnd() - .5) * .3);
  }

  /** Called for each moving car near the view, each frame: puffs from the tail pipe. */
  exhaust(x: number, y: number, z: number, yaw: number, back: number, dt: number): void {
    if (this.rnd() > dt * 5) return;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.emit('exhaust', x - c * back, y + .3, z + s * back, -c * .6, 0, s * .6);
  }

  update(dt: number, focus: { x: number; z: number }, reach: number, cond: SmokeConditions): void {
    this.mesh.visible = this.enabled;
    if (!this.enabled) { this.live = 0; this.geometry.instanceCount = 0; return; }
    const near = (x: number, z: number) => Math.abs(x - focus.x) < reach && Math.abs(z - focus.z) < reach;
    // Chimneys: half are burning; the rain beats the smoke down a little.
    // Only the chimneys near the middle of the view (up to 80 of them) are drawn smoking.
    const chimneyReach = Math.min(reach, 130);
    let n = 0;
    for (let i = 0; i < this.chimneys.length && n < 80; i++) {
      const c = this.chimneys[i];
      if (Math.abs(c.x - focus.x) > chimneyReach || Math.abs(c.z - focus.z) > chimneyReach) continue;
      if (((Math.round(c.x * 7) * 73856093) ^ (Math.round(c.z * 7) * 19349663)) >>> 0 & 1) continue;
      n++;
      if (this.rnd() < dt * .9) this.emit('chimney', c.x, c.y, c.z);
    }
    // Steam: always some, more at night and in the rain (warm air, cold street).
    const steamRate = 2.2 + cond.night * 2 + cond.rain * 2.5;
    for (const v of this.vents) if (near(v.x, v.z) && this.rnd() < dt * steamRate) this.emit('steam', v.x + (this.rnd() - .5) * .5, v.y, v.z + (this.rnd() - .5) * .5);
    // River mist: in the evening, at night and in the rain.
    const mistRate = (Math.max(cond.night, cond.rain * .8) - .15) * 2.2;
    if (mistRate > 0) for (const m of this.mist) {
      const cx = m.x + m.w / 2, cz = m.z + m.h / 2;
      if (!near(cx, cz) && !near(m.x, m.z) && !near(m.x + m.w, m.z + m.h)) continue;
      if (this.rnd() < dt * mistRate * Math.min(4, m.w * m.h / 900)) {
        this.emit('mist', m.x + 3 + this.rnd() * Math.max(0, m.w - 6), m.y + .8, m.z + 3 + this.rnd() * Math.max(0, m.h - 6));
      }
    }

    // Move, age and write out.
    const light = cond.light;
    let w = 0;
    for (let i = 0; i < this.live; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      const st = STYLE[this.kinds[this.kind[i]]];
      const drag = Math.exp(-st.drag * dt);
      this.vx[i] = this.vx[i] * drag + cond.wind.x * (1 - drag);
      this.vz[i] = this.vz[i] * drag + cond.wind.y * (1 - drag);
      this.vy[i] *= Math.exp(-.12 * dt) * (1 - cond.rain * .3 * dt);
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (w !== i) {
        this.px[w] = this.px[i]; this.py[w] = this.py[i]; this.pz[w] = this.pz[i];
        this.vx[w] = this.vx[i]; this.vy[w] = this.vy[i]; this.vz[w] = this.vz[i];
        this.age[w] = this.age[i]; this.life[w] = this.life[i]; this.spin[w] = this.spin[i]; this.kind[w] = this.kind[i];
      }
      const t = this.age[w] / this.life[w];
      const fade = Math.min(1, t * 6) * (1 - t) * (1 - t);
      this.centers.setXYZ(w, this.px[w], this.py[w], this.pz[w]);
      this.params.setXYZW(w, st.size0 + (st.size1 - st.size0) * Math.sqrt(t), st.alpha * fade, this.spin[w] + t * .8, st.glow ? 1 : 0);
      this.tints.setXYZ(w, st.tint[0], st.tint[1], st.tint[2]);
      w++;
    }
    this.live = w;
    this.geometry.instanceCount = w;
    for (const a of [this.centers, this.params, this.tints]) a.needsUpdate = true;
    this.material.uniforms.light.value.copy(light);
  }

  get count(): number { return this.live; }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
