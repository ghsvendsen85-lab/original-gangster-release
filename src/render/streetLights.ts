import * as THREE from 'three';

/**
 * Street lamps that light the street after dusk:
 *  - a soft pool of warm light on the ground under every lamp (one instanced,
 *    additive decal: costs next to nothing however many lamps are in view), and
 *  - real point lights in the lamps nearest the view, so walls, people and
 *    cars beside them are lit as well.
 * The number of point lights is fixed (their intensity goes to 0 by day) so
 * no material ever recompiles as the day turns.
 */

/** Lamp head height above the kerb, metres (lampPostGeometry's lanterns, scaled). */
export const LAMP_HEAD_HEIGHT = 3.1;
/** Diameter of the light pool on the ground, metres. */
export const LAMP_POOL_SIZE = 16;
const POINT_LIGHTS = 8;
const LAMP_COLOR = 0xffc982;

export function lampPoolGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
}

export function lampPoolMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      color: { value: new THREE.Color(LAMP_COLOR) },
      strength: { value: 0 },
    }]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 color;
      uniform float strength;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        // Inverse-square-ish falloff from the foot of the lamp, to nothing at the rim.
        float a = (1.0 - smoothstep(0.0, 1.0, d)) / (1.0 + 9.0 * d * d);
        gl_FragColor = vec4(color * a * strength, 1.0);
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
}

/**
 * Light from lit windows and shopfronts falling on the pavement: a strip along
 * a building's wall, local x along the wall (-0.5..0.5), z from the wall (0)
 * out to the strip's depth (1). Instances are scaled (length, 1, depth).
 */
export function windowSpillGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, .5);
}

/** Pavement-strip depth for window light, metres. */
export const WINDOW_SPILL_DEPTH = 3.2;

export function windowSpillMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      color: { value: new THREE.Color(0xffc978) },
      strength: { value: 0 },
    }]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vWall;   // x: metres along the wall, y: 0 at the wall .. 1 at the strip's edge
      varying float vLength;
      varying float vGain;
      void main() {
        vLength = length(instanceMatrix[0].xyz);
        vWall = vec2((position.x + 0.5) * vLength, position.z);
        vGain = 1.0;
        #ifdef USE_INSTANCING_COLOR
          vGain = instanceColor.r;
        #endif
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 color;
      uniform float strength;
      varying vec2 vWall;
      varying float vLength;
      varying float vGain;
      void main() {
        float outward = 1.0 - vWall.y;
        float fall = outward * outward;
        // Soft ends at the building's corners.
        float ends = smoothstep(0.0, 1.2, vWall.x) * smoothstep(0.0, 1.2, vLength - vWall.x);
        // A patch of light under each window bay (about 2.6 m apart), spreading as it leaves the wall.
        float bay = abs(fract(vWall.x / 2.6) - 0.5) * 2.0;
        float bayLight = 1.0 - smoothstep(0.3, 0.8 + 0.2 * vWall.y, bay);
        float patches = mix(1.0, 0.45 + 0.55 * bayLight, 0.8 - 0.5 * vWall.y);
        gl_FragColor = vec4(color * fall * ends * patches * strength * vGain, 1.0);
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
}

export class StreetLights {
  readonly group = new THREE.Group();
  private lights: THREE.PointLight[] = [];
  private positions: THREE.Vector3[] = [];
  private chosenAt = new THREE.Vector3(Infinity, 0, Infinity);
  private order: number[] = [];

  constructor() {
    this.group.name = 'street-lights';
    for (let i = 0; i < POINT_LIGHTS; i++) {
      const light = new THREE.PointLight(LAMP_COLOR, 0, 18, 2);
      light.castShadow = false;
      this.lights.push(light);
      this.group.add(light);
    }
  }

  /** Where the lamps stand (their foot, at kerb height). Replaces the previous list. */
  setLamps(positions: THREE.Vector3[]): void {
    this.positions = positions;
    this.chosenAt.set(Infinity, 0, Infinity);
  }

  /** Light the lamps nearest `focus`; `strength` 0 (day) .. 1 (night). */
  update(focus: THREE.Vector3, strength: number): void {
    if (strength <= .001 || !this.positions.length) {
      for (const l of this.lights) l.intensity = 0;
      return;
    }
    // Re-choose the nearest lamps only once the view has moved a few metres.
    if (Math.hypot(focus.x - this.chosenAt.x, focus.z - this.chosenAt.z) > 4) {
      this.chosenAt.copy(focus);
      this.order = nearestIndices(this.positions, focus, this.lights.length);
    }
    this.lights.forEach((light, i) => {
      const p = this.positions[this.order[i]];
      if (!p) { light.intensity = 0; return; }
      light.position.set(p.x, p.y + LAMP_HEAD_HEIGHT, p.z);
      light.updateMatrixWorld();
      light.intensity = 26 * strength;
    });
  }

  dispose(): void {
    for (const l of this.lights) l.dispose();
    this.group.clear();
  }
}

/** Indices of the `count` positions nearest `focus` on the ground plane. */
export function nearestIndices(positions: readonly THREE.Vector3[], focus: THREE.Vector3, count: number): number[] {
  const best: { i: number; d: number }[] = [];
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i], d = (p.x - focus.x) ** 2 + (p.z - focus.z) ** 2;
    if (best.length < count) { best.push({ i, d }); best.sort((a, b) => a.d - b.d); continue; }
    if (d >= best[best.length - 1].d) continue;
    best[best.length - 1] = { i, d };
    best.sort((a, b) => a.d - b.d);
  }
  return best.map(b => b.i);
}
