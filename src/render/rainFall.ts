import * as THREE from 'three';

/**
 * Falling rain: thin streaks in a box that follows the view. Every drop has a
 * fixed place in a repeating volume of world space, so the rain does not slide
 * with the camera; the vertex shader moves and wraps the drops, the CPU does
 * nothing per drop.
 */
const DROPS = 14000;

export class RainFall {
  readonly mesh: THREE.LineSegments;
  private material: THREE.ShaderMaterial;

  constructor() {
    const seeds = new Float32Array(DROPS * 2 * 4);
    let s = 1234567;
    const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 | 0) >>> 0) / 4294967296;
    for (let i = 0; i < DROPS; i++) {
      const x = rnd(), y = rnd(), z = rnd(), len = .7 + rnd() * .6;
      seeds.set([x, y, z, 0], i * 8);
      seeds.set([x, y, z, len], i * 8 + 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 2 * 3), 3));
    geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        boxMin: { value: new THREE.Vector3() },
        boxSize: { value: new THREE.Vector3(100, 50, 100) },
        time: { value: 0 },
        velocity: { value: new THREE.Vector3(1.2, -13, .6) },
        streak: { value: .9 },
        color: { value: new THREE.Color(.75, .78, .82) },
        opacity: { value: 0 },
        density: { value: 1 },
      }]),
      vertexShader: /* glsl */`
        #include <common>
        #include <fog_pars_vertex>
        attribute vec4 seed;
        uniform vec3 boxMin, boxSize, velocity;
        uniform float time, streak, density;
        varying float vFade;
        void main() {
          vec3 w = seed.xyz * boxSize + velocity * time;
          vec3 head = mod(w - boxMin, boxSize) + boxMin;
          // The tail runs back up the drop's path.
          vec3 p = head - normalize(velocity) * streak * seed.w * 1.4;
          // Fewer drops when the rain is light; soft at the top and sides of the box.
          vec3 local = (head - boxMin) / boxSize;
          float edge = smoothstep(0.0, .08, local.x) * smoothstep(1.0, .92, local.x)
            * smoothstep(0.0, .08, local.z) * smoothstep(1.0, .92, local.z) * smoothstep(1.0, .85, local.y);
          vFade = edge * step(fract(seed.x * 91.7 + seed.z * 37.3), density) * mix(.4, 1.0, step(.5, seed.w));
          vec4 mvPosition = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <fog_pars_fragment>
        uniform vec3 color;
        uniform float opacity;
        varying float vFade;
        void main() {
          if (vFade < .01) discard;
          gl_FragColor = vec4(color, opacity * vFade);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.mesh = new THREE.LineSegments(geometry, this.material);
    this.mesh.name = 'rain';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /**
   * Rain in a box centred on `centre` (ground level), `width` across and
   * `height` tall; `amount` 0..1; `light` the brightness of the drops.
   */
  update(centre: THREE.Vector3, width: number, height: number, time: number, amount: number, light: THREE.Color): void {
    this.mesh.visible = amount > .01;
    if (!this.mesh.visible) return;
    const u = this.material.uniforms;
    u.boxSize.value.set(width, height, width);
    u.boxMin.value.set(centre.x - width / 2, centre.y - 2, centre.z - width / 2);
    u.time.value = time;
    u.density.value = .25 + .75 * amount;
    u.opacity.value = .09 + .17 * amount;
    u.streak.value = .7 + .5 * amount;
    u.color.value.copy(light);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
