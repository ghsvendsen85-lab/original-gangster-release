import * as THREE from 'three';

/**
 * Neon blade signs over the city's shops and cafés: a dark board standing out
 * from the wall with the trade spelt down it in glass tube, which lights up as
 * the evening comes on (a few flicker), and a wash of its colour on the
 * pavement below. Two instanced draws; the lettering is one small atlas.
 */

/** The word on each trade's sign, and its tube colour. */
export const NEON_WORDS: Record<string, { word: string; color: number; always?: boolean }> = {
  cafe: { word: 'CAFE', color: 0x38e4ff, always: true },
  restaurant: { word: 'EATS', color: 0xff3a2a, always: true },
  gym: { word: 'BOXING', color: 0x5cff7a, always: true },
  pawnbroker: { word: 'PAWN', color: 0xffb030, always: true },
  jewellers: { word: 'JEWELS', color: 0xd070ff, always: true },
  barbers: { word: 'BARBER', color: 0xff4c9c },
  bakers: { word: 'BAKERY', color: 0xffb030 },
  butchers: { word: 'MEATS', color: 0xff3a2a },
  grocers: { word: 'GROCER', color: 0x5cff7a },
  tailors: { word: 'TAILOR', color: 0x38e4ff },
  furrier: { word: 'FURS', color: 0xd070ff },
  laundry: { word: 'LAUNDRY', color: 0x38e4ff },
  newspaper: { word: 'NEWS', color: 0xffb030 },
  printers: { word: 'PRINTS', color: 0xff4c9c },
};

const WORDS = [...new Set(Object.values(NEON_WORDS).map(w => w.word))];
const CELL_W = 64, CELL_H = 320, MAX_SIGNS = 400;
/** Blade size, metres: out from the wall, and tall. */
export const NEON_BLADE = { width: 1.0, height: 3.4 };

/** Does this building get a sign? Some trades always, the rest about half the time. */
export function neonWordFor(typeId: string, buildingId: number): { word: string; color: number } | null {
  const w = NEON_WORDS[typeId];
  if (!w) return null;
  if (!w.always && ((buildingId * 2654435761) >>> 0) % 100 >= 50) return null;
  return w;
}

function atlas(): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const c = document.createElement('canvas');
  c.width = CELL_W * WORDS.length; c.height = CELL_H;
  const g = c.getContext('2d');
  if (!g) return new THREE.Texture();
  g.lineCap = g.lineJoin = 'round';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  WORDS.forEach((word, i) => {
    const letters = word.split(''), step = Math.min(44, (CELL_H - 40) / letters.length);
    const cx = i * CELL_W + CELL_W / 2, top = CELL_H / 2 - step * (letters.length - 1) / 2;
    g.font = `bold ${Math.round(step * .92)}px "Arial Narrow", Arial, sans-serif`;
    // Tube: a soft halo (green channel) under a bright core (red channel).
    letters.forEach((ch, k) => {
      g.strokeStyle = 'rgba(0,255,0,1)'; g.lineWidth = 9; g.filter = 'blur(4px)';
      g.strokeText(ch, cx, top + k * step);
      g.filter = 'none'; g.strokeStyle = 'rgba(255,255,0,1)'; g.lineWidth = 3.2;
      g.strokeText(ch, cx, top + k * step);
    });
    // A tube border round the board.
    g.strokeStyle = 'rgba(255,255,0,1)'; g.lineWidth = 2.5;
    g.strokeRect(i * CELL_W + 7, 10, CELL_W - 14, CELL_H - 20);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

export class NeonSigns {
  readonly group = new THREE.Group();
  private blades: THREE.InstancedMesh;
  private glows: THREE.InstancedMesh;
  private bladeMat: THREE.ShaderMaterial;
  private glowMat: THREE.ShaderMaterial;
  private word = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SIGNS * 2), 2);
  private texture = atlas();
  private n = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor() {
    const blade = new THREE.PlaneGeometry(NEON_BLADE.width, NEON_BLADE.height);
    blade.setAttribute('neonWord', this.word);
    this.bladeMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        atlas: { value: this.texture }, words: { value: WORDS.length },
        strength: { value: 0 }, time: { value: 0 }, daylight: { value: 1 },
      }]),
      vertexShader: /* glsl */`
        #include <common>
        #include <fog_pars_vertex>
        attribute vec2 neonWord; // atlas column, flicker phase
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vPhase;
        uniform float words;
        void main() {
          vUv = vec2((neonWord.x + uv.x) / words, uv.y);
          vColor = instanceColor;
          vPhase = neonWord.y;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D atlas;
        uniform float strength, time, daylight;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vPhase;
        void main() {
          vec2 tube = texture2D(atlas, vUv).rg;
          // A few signs stutter: now and then they drop out for a moment.
          float on = 1.0;
          if (vPhase > .8) {
            float t = time * 7.0 + vPhase * 40.0;
            on = step(.22, fract(sin(floor(t)) * 43758.5453)) * (.85 + .15 * sin(t * 9.0));
          }
          float lit = strength * on;
          // The board: dark enamel, lit by the day; the tubes pale glass when off.
          vec3 board = vec3(.07, .065, .06) * (.35 + daylight);
          vec3 glass = mix(vec3(.55, .55, .52) * (.3 + daylight * .7), vColor * 1.5 + .3, lit);
          vec3 colour = mix(board, glass, tube.r) + vColor * tube.g * lit * 1.6;
          gl_FragColor = vec4(colour, 1.0);
          #include <fog_fragment>
        }`,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.blades = new THREE.InstancedMesh(blade, this.bladeMat, MAX_SIGNS);
    this.blades.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SIGNS * 3), 3);

    this.glowMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { strength: { value: 0 } }]),
      vertexShader: /* glsl */`
        #include <common>
        #include <fog_pars_vertex>
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vUv = uv;
          vColor = instanceColor;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <fog_pars_fragment>
        uniform float strength;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          float d = length(vUv - .5) * 2.0;
          float a = (1.0 - smoothstep(0.0, 1.0, d)) / (1.0 + 7.0 * d * d);
          gl_FragColor = vec4(vColor * a * strength, 1.0);
          #include <fog_fragment>
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: true,
    });
    this.glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.glowMat, MAX_SIGNS);
    this.glows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SIGNS * 3), 3);
    for (const m of [this.blades, this.glows]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = m.receiveShadow = false;
      this.group.add(m);
    }
    this.group.name = 'neon-signs';
  }

  reset(): void { this.n = 0; }

  /**
   * A blade sign: its centre, the direction it stands out from the wall (yaw of
   * the wall's outward normal), and where its light falls on the pavement.
   */
  push(word: string, color: number, x: number, y: number, z: number, wallYaw: number, groundX: number, groundY: number, groundZ: number, seed: number): void {
    const i = this.n, column = WORDS.indexOf(word);
    if (i >= MAX_SIGNS || column < 0) return;
    this.n++;
    const d = this.dummy;
    // The board's plane holds the wall's normal: it is read from up and down the street.
    d.position.set(x, y, z); d.rotation.set(0, wallYaw + Math.PI / 2, 0); d.scale.setScalar(1); d.updateMatrix();
    this.blades.setMatrixAt(i, d.matrix);
    this.color.setHex(color);
    this.blades.setColorAt(i, this.color);
    this.word.setXY(i, column, ((seed * 2654435761) >>> 0) % 1000 / 1000);
    d.position.set(groundX, groundY, groundZ); d.rotation.set(0, 0, 0); d.scale.set(8, 1, 8); d.updateMatrix();
    this.glows.setMatrixAt(i, d.matrix);
    this.glows.setColorAt(i, this.color);
  }

  commit(): void {
    this.blades.count = this.glows.count = this.n;
    for (const m of [this.blades, this.glows]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.word.needsUpdate = true;
  }

  /** `strength` 0 (day) .. 1 (lit); `daylight` lights the board itself. */
  update(time: number, strength: number, daylight: number, enabled: boolean): void {
    this.group.visible = enabled && this.n > 0;
    this.bladeMat.uniforms.time.value = time;
    this.bladeMat.uniforms.strength.value = strength;
    this.bladeMat.uniforms.daylight.value = daylight;
    this.glowMat.uniforms.strength.value = strength * .55;
    this.glows.visible = strength > .01;
  }

  get count(): number { return this.n; }

  dispose(): void {
    this.group.removeFromParent();
    this.blades.geometry.dispose(); this.glows.geometry.dispose();
    this.bladeMat.dispose(); this.glowMat.dispose();
    this.texture.dispose();
  }
}
