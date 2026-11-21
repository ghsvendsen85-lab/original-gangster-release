import { rainOnDay } from '../sim/weather';

/**
 * Optional graphics effects (Options → Graphics effects). Each can be turned
 * off on its own; none changes the simulation.
 */

/** Rain: never, on some days (the weather changes from day to day), or all the time. */
export type RainMode = 'off' | 'changing' | 'always';

export interface GraphicsEffects {
  /** Rain, wet streets with puddles, and fog. */
  rain: RainMode;
  /** Headlight beams on the road and red tail lights after dusk. */
  headlights: boolean;
  /** River reflections (3D view), foam along the embankments. */
  water: boolean;
  /** Chimney smoke, steam from the street, exhaust, gun smoke, river mist. */
  smoke: boolean;
  /** Neon signs over clubs and shops, glowing onto the pavement. */
  neon: boolean;
  /** A 1920s film look: sepia grading, grain and a vignette. */
  film: boolean;
}

export const DEFAULT_EFFECTS: GraphicsEffects = {
  rain: 'changing', headlights: true, water: true, smoke: true, neon: true, film: false,
};

export const RAIN_MODES: readonly RainMode[] = ['off', 'changing', 'always'];

/** Fill in a stored (possibly partial or stale) value. */
export function normaliseEffects(raw: unknown): GraphicsEffects {
  const e = { ...DEFAULT_EFFECTS };
  if (!raw || typeof raw !== 'object') return e;
  const r = raw as Record<string, unknown>;
  if (RAIN_MODES.includes(r.rain as RainMode)) e.rain = r.rain as RainMode;
  for (const k of ['headlights', 'water', 'smoke', 'neon', 'film'] as const) if (typeof r[k] === 'boolean') e[k] = r[k] as boolean;
  return e;
}

/**
 * How hard it is raining (0..1) on `day` (any running count of days) at
 * `phase` (0..1 through the day). In 'changing' weather about one day in three
 * is wet: a shower that comes and goes, or a steady rain, at a time of its own.
 */
export function rainAt(mode: RainMode, day: number, phase: number, seed = 0): number {
  if (mode === 'off') return 0;
  if (mode === 'always') return .85;
  // The simulation's own weather (it changes what witnesses see): drawn as it is.
  return rainOnDay(day, phase, seed);
}

/** How wet the ground is: it follows the rain at once and dries off over a good part of the day. */
export function wetnessAt(mode: RainMode, day: number, phase: number, seed = 0): number {
  let wet = 0;
  // Look back over the last third of a day: wetness is the strongest recent rain, fading.
  for (let k = 0; k <= 12; k++) {
    const back = k * .03;
    let p = phase - back, dd = day;
    if (p < 0) { p += 1; dd -= 1; }
    wet = Math.max(wet, Math.min(1, rainAt(mode, dd, p, seed) * 1.6) * (1 - back / .36));
  }
  return wet;
}

/**
 * Rain on the ground: expanding rings from drops, as a surface slope (add it to
 * the normal's x/z). Needs `float fxHash(vec2)` (FX_HASH_GLSL).
 */
export const FX_HASH_GLSL = /* glsl */`
  float fxHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float fxNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), f.x), mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0)), f.x), f.y);
  }
  vec2 fxRipples(vec2 p, float t) {
    vec2 slope = vec2(0.0);
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      vec2 q = p * 1.7 + fk * vec2(17.31, 5.17);
      vec2 cell = floor(q), f = fract(q);
      float h = fxHash(cell + fk * 3.1);
      vec2 centre = vec2(fxHash(cell + 1.7), fxHash(cell + 5.3)) * .5 + .25;
      float age = fract(t * (.9 + h * .5) + h);
      vec2 d = f - centre;
      float r = length(d);
      float w = (r - age * .3) * 55.0;
      float a = (1.0 - age) * (1.0 - age) * exp(-w * w * .08);
      slope += d / max(r, 1e-3) * cos(w) * a * .35;
    }
    return slope;
  }`;
