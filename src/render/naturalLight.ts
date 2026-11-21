import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** A 1920s film look, after tone mapping: warm sepia grading, soft contrast, grain and a vignette. */
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 1 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time, amount;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      float luma = dot(c, vec3(.299, .587, .114));
      // Sepia, keeping a little of the colour.
      vec3 sepia = vec3(luma * 1.07, luma * .93, luma * .72);
      vec3 graded = mix(c, sepia, .62);
      // Lifted blacks and softened highlights, as on old print stock.
      graded = graded * .9 + .045;
      graded = mix(graded, smoothstep(0.0, 1.0, graded), .35);
      // Grain that moves 24 times a second.
      float frame = floor(time * 24.0);
      float grain = hash(vUv * vec2(1931.0, 1423.0) + frame * 7.13) - .5;
      graded += grain * .07;
      // The odd flicker of the projector lamp.
      graded *= 1.0 + (hash(vec2(frame, 3.1)) - .5) * .035;
      // Vignette.
      vec2 d = vUv - .5;
      graded *= mix(1.0, .55, smoothstep(.32, .78, length(d * vec2(1.15, 1.0))));
      gl_FragColor = vec4(mix(c, graded, amount), src.a);
    }`,
};

/**
 * Natural light for the free 3D view (the isometric view keeps the original's
 * staged lighting):
 *  - a sun fixed in the world that crosses the sky east → south → west,
 *  - a sky dome (horizon haze, deeper zenith, sun disc and glow, stars at night),
 *  - image-based ambient light taken from that sky, and
 *  - optional screen-space ambient occlusion.
 *
 * The map's x axis runs west → east and z north → south (street lines 'ns'
 * have constant x), so north is -z.
 */

/** The game day's sun, from the hour: rises in the east at 6, sets in the west at 19:30. */
export function naturalSunDirection(hour: number, out = new THREE.Vector3()): THREE.Vector3 {
  const t = THREE.MathUtils.clamp((hour - 6) / 13.5, 0, 1);
  // Bearing from east (+x) through south (+z) to west (-x).
  const bearing = Math.PI * t;
  // A mid-latitude summer's day: highest (about 62°) a little after noon.
  const altitude = THREE.MathUtils.degToRad(4 + 58 * Math.sin(Math.PI * t));
  return out.set(Math.cos(bearing) * Math.cos(altitude), Math.sin(altitude), Math.sin(bearing) * Math.cos(altitude)).normalize();
}

const SKY_VERTEX = /* glsl */`
  varying vec3 vDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vDir = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_Position.z = gl_Position.w; // on the far plane
  }`;

const SKY_FRAGMENT = /* glsl */`
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 ground;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform float sunDisc;
  uniform float stars;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
    col = mix(col, ground, smoothstep(0.0, -0.12, h));
    float s = max(dot(d, normalize(sunDir)), 0.0);
    // Disc, then a wide glow that is strongest near the horizon (haze).
    col += sunColor * sunDisc * (smoothstep(0.9994, 0.9997, s) * 12.0 + pow(s, 8.0) * 0.28 * (1.0 - 0.5 * clamp(h, 0.0, 1.0)));
    if (stars > 0.0) {
      vec3 cell = floor(d * 260.0);
      float n = hash(cell);
      col += step(0.9982, n) * stars * smoothstep(0.02, 0.25, h) * (0.6 + 0.4 * hash(cell + 7.0));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export interface SkyState {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  /** 0 (day) .. 1 (night): stars come out. */
  night: number;
}

/** Draws the scene through a GTAO pass; the building outline goes in before it so its depth test still works. */
class OutlinePass extends Pass {
  constructor(private draw: (renderer: THREE.WebGLRenderer) => void) { super(); this.needsSwap = false; }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(read);
    this.draw(renderer);
  }
}

/**
 * GTAO's own normal/depth pass must not redraw the sun's shadow map, and must
 * not see the sky dome (it would read as a wall around the city).
 */
class QuietGTAOPass extends GTAOPass {
  hidden: THREE.Object3D[] = [];
  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget, delta: number, mask: boolean): void {
    const auto = renderer.shadowMap.autoUpdate;
    const shown = this.hidden.map(o => o.visible);
    renderer.shadowMap.autoUpdate = false;
    for (const o of this.hidden) o.visible = false;
    try { super.render(renderer, write, read, delta, mask); } finally {
      renderer.shadowMap.autoUpdate = auto;
      this.hidden.forEach((o, i) => { o.visible = shown[i]; });
    }
  }
}

export class NaturalLight {
  readonly sky: THREE.Mesh;
  private skyMaterial: THREE.ShaderMaterial;
  private envScene = new THREE.Scene();
  private envSky: THREE.Mesh;
  private pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envKey = '';
  private envAt = -Infinity;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private aoPass: QuietGTAOPass | null = null;
  private filmPass: ShaderPass | null = null;
  private outputPass: OutputPass | null = null;
  private size = new THREE.Vector2(1, 1);
  private pixelRatio = 1;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        zenith: { value: new THREE.Color(0x3a6fb0) },
        horizon: { value: new THREE.Color(0xb8c8d8) },
        ground: { value: new THREE.Color(0x3b3a36) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(1, .9, .7) },
        sunDisc: { value: 1 },
        stars: { value: 0 },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const geometry = new THREE.SphereGeometry(1, 48, 24);
    this.sky = new THREE.Mesh(geometry, this.skyMaterial);
    this.sky.name = 'natural-sky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.visible = false;
    this.sky.matrixAutoUpdate = false;
    this.scene.add(this.sky);
    // The environment map sees the same sky (without the sun's hot spot).
    this.envSky = new THREE.Mesh(geometry, this.skyMaterial);
    this.envSky.scale.setScalar(100);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  /** Follow the camera and take the time of day's colours. Call once a frame (free view only). */
  update(camera: THREE.Camera & { far: number }, state: SkyState, envIntensity: number): void {
    const u = this.skyMaterial.uniforms;
    u.zenith.value.copy(state.zenith);
    u.horizon.value.copy(state.horizon);
    u.ground.value.copy(state.ground);
    u.sunDir.value.copy(state.sunDir);
    u.sunColor.value.copy(state.sunColor);
    u.stars.value = state.night;
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(camera.far * .9);
    this.sky.updateMatrix();
    this.sky.matrixWorld.copy(this.sky.matrix);

    // Rebuild the ambient light when the sky has visibly changed (at most every 1.5 s).
    const key = [state.zenith, state.horizon, state.ground].map(c => c.getHexString()).join('');
    const now = performance.now();
    if (key !== this.envKey && now - this.envAt > 1500) {
      this.envKey = key; this.envAt = now;
      u.sunDisc.value = 0; u.stars.value = 0;
      const next = this.pmrem.fromScene(this.envScene, 0, .1, 200);
      u.sunDisc.value = 1; u.stars.value = state.night;
      this.envTarget?.dispose();
      this.envTarget = next;
      this.scene.environment = next.texture;
    }
    this.scene.environmentIntensity = envIntensity;
  }

  /** The isometric view: no sky dome and no image-based light (keeps its look and its shaders). */
  rest(): void {
    this.sky.visible = false;
    this.scene.environmentIntensity = 0;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.size.set(width, height); this.pixelRatio = pixelRatio;
    if (this.composer) { this.composer.setPixelRatio(pixelRatio); this.composer.setSize(width, height); }
  }

  /**
   * Draw the main view through post-processing: scene → outline → (GTAO, free
   * view only) → tone mapping → (film look). Returns after drawing to the screen.
   */
  renderComposed(camera: THREE.Camera, outline: (renderer: THREE.WebGLRenderer) => void, options: { ao: boolean; film: boolean; time: number }): void {
    if (!this.composer) {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, target);
      this.renderPass = new RenderPass(this.scene, camera);
      this.composer.addPass(this.renderPass);
      this.composer.addPass(new OutlinePass(outline));
      this.aoPass = new QuietGTAOPass(this.scene, camera, 1, 1);
      // City scale is metres: occlusion within a metre or two (kerbs, doorways, wall feet).
      this.aoPass.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2.5, scale: 1, samples: 16, distanceFallOff: 1 });
      this.aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.aoPass.blendIntensity = .85;
      this.aoPass.hidden = [this.sky];
      this.composer.addPass(this.aoPass);
      this.outputPass = new OutputPass();
      this.composer.addPass(this.outputPass);
      this.filmPass = new ShaderPass(FilmShader);
      this.composer.addPass(this.filmPass);
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(this.size.x, this.size.y);
    }
    this.renderPass!.camera = camera;
    const ao = options.ao && (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    this.aoPass!.enabled = ao;
    if (ao) this.aoPass!.camera = camera;
    this.filmPass!.enabled = options.film;
    this.filmPass!.uniforms.time.value = options.time;
    // The last enabled pass draws to the screen.
    this.outputPass!.renderToScreen = !options.film;
    this.filmPass!.renderToScreen = options.film;
    this.composer.render();
  }

  dispose(): void {
    this.scene.remove(this.sky);
    if (this.envTarget && this.scene.environment === this.envTarget.texture) this.scene.environment = null;
    this.sky.geometry.dispose();
    this.skyMaterial.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.aoPass?.dispose();
    this.filmPass?.dispose();
    this.outputPass?.dispose();
    this.composer?.renderTarget1.dispose();
    this.composer?.renderTarget2.dispose();
    this.composer?.dispose();
  }
}
