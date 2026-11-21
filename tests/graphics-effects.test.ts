import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFECTS, normaliseEffects, rainAt, wetnessAt } from '../src/render/graphicsEffects';
import { NEON_WORDS, neonWordFor } from '../src/render/neonSigns';

describe('graphics effects settings', () => {
  it('fills in missing or bad stored values with the defaults', () => {
    expect(normaliseEffects(null)).toEqual(DEFAULT_EFFECTS);
    expect(normaliseEffects({ rain: 'hail', film: true, smoke: 'yes' })).toEqual({ ...DEFAULT_EFFECTS, film: true });
    expect(normaliseEffects({ rain: 'always', neon: false })).toEqual({ ...DEFAULT_EFFECTS, rain: 'always', neon: false });
  });
});

describe('weather', () => {
  it('never rains when rain is off, and always does when it is on', () => {
    for (let d = 0; d < 20; d++) for (let p = 0; p < 1; p += .1) {
      expect(rainAt('off', d, p)).toBe(0);
      expect(rainAt('always', d, p)).toBeGreaterThan(.5);
    }
  });

  it('rains on some days but not most in changing weather', () => {
    let wet = 0;
    const days = 300;
    for (let d = 0; d < days; d++) if ([...Array(20)].some((_, k) => rainAt('changing', d, k / 20) > .1)) wet++;
    expect(wet / days).toBeGreaterThan(.2);
    expect(wet / days).toBeLessThan(.5);
  });

  it('is the same for the same day and time', () => {
    expect(rainAt('changing', 17, .4)).toBe(rainAt('changing', 17, .4));
  });

  it('leaves the ground wet for a while after the rain stops', () => {
    // Find a shower that ends during the day, and look just after it.
    for (let d = 0; d < 200; d++) {
      for (let k = 1; k < 100; k++) {
        const p = k / 100;
        if (rainAt('changing', d, p - .01) > .3 && rainAt('changing', d, p) < .3 && p + .06 < 1) {
          expect(rainAt('changing', d, p + .06)).toBeLessThan(.05);
          expect(wetnessAt('changing', d, p + .06)).toBeGreaterThan(.3);
          return;
        }
      }
    }
    throw new Error('no shower found');
  });
});

describe('neon signs', () => {
  it('always gives cafés a sign, never trades without one', () => {
    expect(neonWordFor('cafe', 1)?.word).toBe('CAFE');
    expect(neonWordFor('speakeasy', 1)).toBeNull();
    expect(neonWordFor('warehouse', 1)).toBeNull();
  });

  it('gives the optional trades a sign about half the time', () => {
    const optional = Object.keys(NEON_WORDS).find(k => !NEON_WORDS[k].always)!;
    let n = 0;
    for (let id = 0; id < 1000; id++) if (neonWordFor(optional, id)) n++;
    expect(n).toBeGreaterThan(300);
    expect(n).toBeLessThan(700);
  });

  it('keeps every word short enough to fit down the blade', () => {
    for (const { word } of Object.values(NEON_WORDS)) expect(word.length).toBeLessThanOrEqual(7);
  });
});
