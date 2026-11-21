import type { Material } from 'three';

/** Pavement top, where walls meet the ground, and how dark their foot is. */
const KERB_TOP = .34, CONTACT_SHADE = .58;

/** One photographic flat-roof tile covers the same six metres on every mass. */
export const FLAT_ROOF_TILE_METRES = 6;

/**
 * Life behind the lit windows at night (Options → Window life): the facade
 * art lights the same windows on every building, so each window is varied
 * here by its place in the art's 4 × 4 bay grid and its building — some
 * households out or abed, blinds drawn part way down, a figure against the
 * light, a lamp or a fire that flickers, warmer and whiter bulbs. Shared by
 * every facade material; the street view sets the clock and the amount.
 */
export const windowLife = { time: { value: 0 }, amount: { value: 1 } };

/** Keep window bays at the same world width on front and side elevations. */
export function patchInstancedUv(mat: Material, facade = false): void {
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aUvXform;' + (facade ? '\nvarying float vWallHeight;\nvarying float vWinSeed;' : ''))
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec2 instanceUvScale = aUvXform.xy;
        ${facade ? `
        #ifdef USE_INSTANCING
          vWinSeed = fract(dot(instanceMatrix[3].xz, vec2(.01373, .02917)));
        #else
          vWinSeed = 0.0;
        #endif
        #ifdef USE_INSTANCING
          // X-facing shell walls run along local Z. The supplied scale uses
          // local X width, so account for depth without stretching the bays.
          float frontWidth = max(length(instanceMatrix[0].xyz), 0.0001);
          float sideWidth = length(instanceMatrix[2].xyz);
          instanceUvScale.x *= mix(1.0, sideWidth / frontWidth, step(0.5, abs(normal.x)));
        #endif` : ''}
        #ifdef USE_MAP
          vMapUv = vMapUv * instanceUvScale + aUvXform.zw;
        #endif
        #ifdef USE_EMISSIVEMAP
          vEmissiveMapUv = vEmissiveMapUv * instanceUvScale + aUvXform.zw;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = vNormalMapUv * instanceUvScale + aUvXform.zw;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = vRoughnessMapUv * instanceUvScale + aUvXform.zw;
        #endif`);
    if (facade) {
      // Ground contact: a wall darkens over its lowest metre and a half, where
      // the street's bounce light cannot reach, so a building sits on the
      // pavement instead of floating above it.
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wallWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wallWorld = instanceMatrix * wallWorld;
        #endif
        vWallHeight = (modelMatrix * wallWorld).y;`);
      shader.uniforms.windowTime = windowLife.time;
      shader.uniforms.windowLife = windowLife.amount;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vWallHeight;
          varying float vWinSeed;
          uniform float windowTime;
          uniform float windowLife;
          float winHash(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * .1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
          }`)
        .replace('#include <emissivemap_fragment>', `
          #ifdef USE_EMISSIVEMAP
            vec3 winLight = texture2D(emissiveMap, vEmissiveMapUv).rgb;
            if (windowLife > 0.0) {
              // The art's bays: four across and four up each tile; a window
              // stands from v .13 (sill) to .69 (head) in its bay.
              vec2 bayUv = vEmissiveMapUv * 4.0;
              vec2 bay = floor(bayUv) + vec2(vWinSeed * 97.0, vWinSeed * 31.0);
              vec2 at = fract(bayUv);
              float h1 = winHash(bay), h2 = winHash(bay * 1.7 + 3.1), h3 = winHash(bay * 2.3 + 7.7);
              float home = step(.26, h1);
              float sill = .13, head = .69;
              // Blinds drawn down to a height, their slats catching the light.
              float drawn = step(.58, h2) * step(mix(sill, head, .3 + .45 * h3), at.y);
              float blind = mix(1.0, .2 + .1 * (.5 + .5 * sin(at.y * 230.0)), drawn);
              // Somebody standing at the window, dark against the lamp.
              float figure = 0.0;
              if (h3 > .8) {
                vec2 foot = vec2(.535 + (h2 - .5) * .1, sill);
                float headShape = 1.0 - smoothstep(.042, .052, length((at - foot - vec2(0.0, .3)) * vec2(1.0, .85)));
                vec2 body = abs(at - foot - vec2(0.0, .12)) - vec2(.07, .13);
                float torso = 1.0 - smoothstep(0.0, .012, length(max(body, 0.0)));
                figure = max(headShape, torso);
              }
              float flicker = 1.0 + (h2 > .86 ? .2 : .035) * sin(windowTime * (4.0 + h1 * 9.0) + h3 * 40.0) * sin(windowTime * 2.3 + h1 * 17.0);
              vec3 bulb = mix(vec3(1.0, .8, .6), vec3(1.0, .97, .9), h2);
              winLight *= mix(vec3(1.0), home * blind * flicker * (1.0 - .88 * figure) * bulb, windowLife);
            }
            totalEmissiveRadiance *= winLight;
          #endif`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb *= mix(${CONTACT_SHADE.toFixed(2)}, 1.0, smoothstep(${KERB_TOP.toFixed(2)}, ${(KERB_TOP + 1.6).toFixed(2)}, vWallHeight));`);
    }
  };
  mat.customProgramCacheKey = () => `og-instanced-uv-v5-${facade ? 'facade' : 'frontage'}`;
}

/** Unit shell-roof UVs become metre-based rather than repeating per building. */
export function patchRoofUv(mat: Material): void {
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aUvXform;\nvarying vec4 vRoofFace;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #if defined(USE_MAP) && defined(USE_INSTANCING)
          vec2 roofSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
          vRoofFace = vec4(vMapUv, roofSize);
          vMapUv = vMapUv * roofSize / ${FLAT_ROOF_TILE_METRES.toFixed(1)} + aUvXform.zw;
        #else
          vRoofFace = vec4(0.5, 0.5, 100.0, 100.0);
        #endif`);
    // A flat roof read as one flat tone from the air. Shade it as built: the
    // tar darkens toward the parapet, the parapet's coping catches the light,
    // and the felt is patched in large, faint rectangles.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vRoofFace;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 roofAt = vRoofFace.xy * vRoofFace.zw;
        vec2 toEdge = min(roofAt, vRoofFace.zw - roofAt);
        float edge = min(toEdge.x, toEdge.y);
        float gutter = mix(0.74, 1.0, smoothstep(0.35, 2.4, edge));
        float coping = 1.0 + 0.32 * (1.0 - smoothstep(0.12, 0.34, edge));
        vec2 patchCell = floor(roofAt / vec2(3.7, 2.9));
        float patchTone = fract(sin(dot(patchCell, vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb *= gutter * coping * (0.93 + 0.12 * patchTone);`);
  };
  mat.customProgramCacheKey = () => 'og-roof-world-uv-v2';
}