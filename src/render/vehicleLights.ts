import * as THREE from 'three';
import { InstancePool } from './pool';

/**
 * Car lights after dusk, beyond the lamp glass itself (scene.ts's headlamps):
 *  - the beam each car throws on the road ahead, an additive decal that widens
 *    and fades with distance (wet roads take it brighter, as they would), and
 *  - red tail lamps at the back.
 */

/** Beam length and width on the road, metres. */
export const BEAM_LENGTH = 15, BEAM_WIDTH = 6.5;

/** A ground plane, local x forward from the lamps (0..1), z across (-0.5..0.5). */
function beamGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(.5, 0, 0);
}

function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      color: { value: new THREE.Color(0xffe6b0) },
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
        float along = vUv.x, across = abs(vUv.y - .5) * 2.0;
        // A cone from the lamps: narrow at the car, wide and faint far off.
        float width = mix(.25, 1.0, sqrt(along));
        float a = (1.0 - smoothstep(width * .55, width, across)) * smoothstep(0.0, .08, along) * pow(1.0 - along, 1.6);
        // The hot spot a few metres ahead.
        a *= .6 + .8 * exp(-pow((along - .22) * 5.0, 2.0));
        gl_FragColor = vec4(color * a * strength, 1.0);
        #include <fog_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    fog: true,
  });
}

function tailGeometry(): THREE.BufferGeometry {
  const parts = [-1, 1].map(side => new THREE.SphereGeometry(.07, 6, 4).translate(0, 0, side * .62));
  const positions: number[] = [], indices: number[] = [];
  for (const g of parts) {
    const base = positions.length / 3;
    positions.push(...(g.getAttribute('position').array as Float32Array));
    indices.push(...Array.from(g.index!.array, i => i + base));
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
}

export class VehicleLights {
  readonly beams: InstancePool;
  readonly tails: InstancePool;
  private beamMat = beamMaterial();
  private tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, opacity: 0, toneMapped: false });
  private dummy = new THREE.Object3D();
  private strength = 0;

  constructor(capacity: number) {
    this.beams = new InstancePool(beamGeometry(), this.beamMat, capacity, { dynamic: true });
    this.tails = new InstancePool(tailGeometry(), this.tailMat, capacity, { dynamic: true });
    for (const p of [this.beams, this.tails]) {
      p.mesh.castShadow = p.mesh.receiveShadow = false;
      p.mesh.frustumCulled = false;
      p.mesh.raycast = () => {};
    }
  }

  reset(): void { this.beams.reset(); this.tails.reset(); }

  /**
   * One vehicle: its centre on the ground, yaw (its nose is local +x), how far
   * the lamps are ahead of the centre and behind it, the lamp height, and
   * whether it has a single lamp (a motorcycle).
   */
  push(x: number, y: number, z: number, yaw: number, nose: number, tail: number, lampY: number, single = false): void {
    if (this.strength <= .01) return;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const d = this.dummy;
    d.rotation.set(0, yaw, 0);
    d.position.set(x + c * (nose - .3), y + .03, z - s * (nose - .3));
    d.scale.set(BEAM_LENGTH * (single ? .8 : 1), 1, BEAM_WIDTH * (single ? .6 : 1));
    d.updateMatrix();
    this.beams.push(d.matrix);
    d.position.set(x - c * tail, y + lampY * .85, z + s * tail);
    d.scale.set(1, 1, single ? .01 : 1);
    d.updateMatrix();
    this.tails.push(d.matrix);
  }

  commit(): void {
    this.beams.commit(); this.tails.commit();
    this.beams.mesh.visible = this.tails.mesh.visible = this.strength > .01;
  }

  /** 0 by day .. 1 at night; `wet` brightens the beams (a wet road throws light back). */
  setStrength(strength: number, wet: number): void {
    this.strength = strength;
    this.beamMat.uniforms.strength.value = strength * (.4 + .45 * wet);
    this.tailMat.opacity = Math.min(1, strength * 1.2);
  }

  get meshes(): THREE.Object3D[] { return [this.beams.mesh, this.tails.mesh]; }

  dispose(): void {
    this.beams.dispose();
    this.tails.dispose();
  }
}
