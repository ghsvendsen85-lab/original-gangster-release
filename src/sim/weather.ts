import { DAYS_PER_WEEK, MINUTES_PER_DAY, clockHour } from './constants';
import type { WorldState } from './types';

/**
 * The city's weather and light, as the simulation sees them. Rain comes and
 * goes by the day (about one day in three is wet), fixed by the game's seed so
 * a city's week always has the same weather; the street view draws the same
 * rain (graphicsEffects.ts). Darkness follows the clock: dusk comes on from
 * late afternoon and the last hours of the day are night.
 */

function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How hard it rains (0..1) on a running `day` count at `phase` (0..1 through it), for a city's `seed`. */
export function rainOnDay(day: number, phase: number, seed = 0): number {
  const d = Math.floor(day) + Math.imul(seed | 0, 7919);
  if (hash(d * 7 + 1) > .36) return 0;
  const start = hash(d * 7 + 2) * .75, length = .18 + hash(d * 7 + 3) * .5;
  const heavy = .55 + hash(d * 7 + 4) * .45;
  const ramp = .05;
  return heavy * smooth(start - ramp, start, phase) * (1 - smooth(start + length, start + length + ramp, phase));
}

/** The working week's day count and how far through the day it is. */
export function dayAndPhase(w: WorldState): { day: number; phase: number } {
  const minute = w.phase === 'week' ? Math.max(0, w.minute) : 0;
  return { day: w.week * DAYS_PER_WEEK + Math.floor(minute / MINUTES_PER_DAY), phase: (minute % MINUTES_PER_DAY) / MINUTES_PER_DAY };
}

/** Rain now (0..1). */
export function rainNow(w: WorldState): number {
  const { day, phase } = dayAndPhase(w);
  return rainOnDay(day, phase, w.options?.seed ?? 0);
}

/**
 * The light over a 24-hour clock (`hour` 0..24): the sun's height (noon,
 * up from six to half past seven), the golden light of dusk and dawn, night,
 * windows lit, and darkness as the street sees it. Evening comes on from late
 * afternoon and is full by eight; the dark lifts from about five.
 */
export function daylight(hour: number): { noon: number; dusk: number; night: number; lightUp: number; dark: number } {
  const h = ((hour % 24) + 24) % 24, evening = h >= 12;
  const ramp = (a: number, b: number, c: number, d: number) => evening ? smooth(a, b, h) : 1 - smooth(c, d, h);
  return {
    noon: h > 6 && h < 19.5 ? Math.sin(Math.PI * (h - 6) / 13.5) : 0,
    dusk: ramp(16.4, 19.3, 5.0, 7.2),
    night: ramp(18.1, 20.0, 4.6, 6.3),
    lightUp: ramp(16.2, 19.0, 5.2, 7.4),
    dark: ramp(16.9, 19.5, 4.8, 6.8),
  };
}

/** Darkness now: 0 by day, rising through dusk to 1 at night, lifting at dawn. */
export function darknessNow(w: WorldState): number {
  if (w.phase !== 'week') return 0;
  return daylight(clockHour(dayAndPhase(w).phase)).dark;
}

/**
 * How well the street can see (1 a clear day): the dark and the rain both cut
 * it, and hoods use them. Witnesses are fewer, and those there notice less.
 */
export function visibilityNow(w: WorldState): number {
  return (1 - .4 * darknessNow(w)) * (1 - .3 * rainNow(w));
}

/** In words, for the week bar. */
export function weatherWords(w: WorldState): string {
  const rain = rainNow(w), dark = darknessNow(w);
  const sky = rain > .6 ? 'Heavy rain' : rain > .1 ? 'Rain' : dark > .5 ? 'Clear night' : 'Dry';
  return dark > .5 ? (rain > .1 ? `${sky} · night` : sky) : sky;
}
