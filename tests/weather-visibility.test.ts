import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { defaultGameOptions } from '../src/app/newGame';
import { MINUTES_PER_DAY } from '../src/sim/constants';
import { darknessNow, rainNow, rainOnDay, visibilityNow, weatherWords } from '../src/sim/weather';
import { rainAt } from '../src/render/graphicsEffects';

function week(seed = 404) {
  const sim = new Sim({ ...defaultGameOptions(), seed });
  sim.launchWeek();
  return sim.world;
}

describe('weather and light in the simulation', () => {
  it('is dark through the night, and light again by morning', () => {
    const w = week();
    w.minute = Math.round(MINUTES_PER_DAY * .2); // about 1 pm
    expect(darknessNow(w)).toBe(0);
    w.minute = Math.round(MINUTES_PER_DAY * .7); // about 1 am
    expect(darknessNow(w)).toBeGreaterThan(.9);
    w.minute = Math.round(MINUTES_PER_DAY * .98); // half past seven in the morning
    expect(darknessNow(w)).toBe(0);
  });

  it('sees less in the dark and in the rain', () => {
    const w = week();
    // Find a dry noon and a wet one.
    let dry = -1, wet = -1;
    for (let m = 0; m < MINUTES_PER_DAY * 5; m += 10) {
      w.minute = m;
      if (darknessNow(w) > 0) continue;
      if (dry < 0 && rainNow(w) === 0) dry = m;
      if (wet < 0 && rainNow(w) > .5) wet = m;
    }
    w.minute = dry;
    expect(visibilityNow(w)).toBe(1);
    expect(weatherWords(w)).toBe('Dry');
    w.minute = Math.round(MINUTES_PER_DAY * .7); // about 1 am
    expect(visibilityNow(w)).toBeLessThan(.7);
    if (wet >= 0) {
      w.minute = wet;
      expect(visibilityNow(w)).toBeLessThan(.9);
      expect(weatherWords(w)).toMatch(/rain/i);
    }
  });

  it('gives each city its own weather, and the street view draws the same rain', () => {
    let differs = false;
    for (let d = 0; d < 30; d++) for (let k = 0; k < 10; k++)
      if (rainOnDay(d, k / 10, 1) !== rainOnDay(d, k / 10, 2)) differs = true;
    expect(differs).toBe(true);
    expect(rainAt('changing', 7, .5, 99)).toBe(rainOnDay(7, .5, 99));
  });
});
