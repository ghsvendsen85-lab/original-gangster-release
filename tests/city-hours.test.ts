import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { defaultGameOptions } from '../src/app/newGame';
import { atHomeAsleep, bedtimeShare, hourNow, hoursLabel, hoursOf, openAt } from '../src/sim/cityHours';
import { witnessesNear } from '../src/sim/events';
import { backFromPrison, talkChance, PRISON_LOYALTY_COST } from '../src/sim/prison';
import { MINUTES_PER_DAY } from '../src/sim/constants';

/** The minute of the first day at clock `hour` (the day starts at 8 am). */
const at = (hour: number) => Math.round((((hour - 8) + 24) % 24) / 24 * MINUTES_PER_DAY);

function city() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404 });
  const w = sim.world;
  w.phase = 'week';
  return { sim, w };
}

describe('the city by the hour (playtest, 21 November)', () => {
  it('keeps shop hours by day and the night trade by night', () => {
    const shop = hoursOf({ typeId: 'grocers', cls: 'commercial' });
    const speak = hoursOf({ typeId: 'speakeasy', cls: 'illegal' });
    expect(openAt(shop, 10)).toBe(true);
    expect(openAt(shop, 22)).toBe(false);
    expect(openAt(speak, 23)).toBe(true);
    expect(openAt(speak, 2)).toBe(true);
    expect(openAt(speak, 12)).toBe(false);
    expect(hoursLabel(speak)).toBe('Open 6 pm – 4 am');
    expect(hoursLabel(hoursOf({ typeId: 'warehouse', cls: 'industrial' }))).toBe('Open all hours');
  });

  it('reads the hour from the week clock', () => {
    const { w } = city();
    w.minute = at(14);
    expect(Math.round(hourNow(w))).toBe(14);
    w.minute = at(2);
    expect(Math.round(hourNow(w))).toBe(2);
  });

  it('sends most townsfolk home after midnight, and nobody by day', () => {
    expect(bedtimeShare(15)).toBe(0);
    expect(bedtimeShare(23)).toBe(0);
    expect(bedtimeShare(3.5)).toBeGreaterThan(.7);
    expect(bedtimeShare(7)).toBe(0);
    const { w } = city();
    const citizens = Object.values(w.people).filter(p => p.role === 'citizen' && p.status === 'active');
    expect(citizens.length).toBeGreaterThan(20);
    const abed = (h: number) => citizens.filter(p => atHomeAsleep(w, p, h)).length / citizens.length;
    expect(abed(13)).toBe(0);
    expect(abed(3.5)).toBeGreaterThan(.55);
    expect(abed(3.5)).toBeLessThan(.95);
    // The same people go to bed every night.
    const first = citizens.filter(p => atHomeAsleep(w, p, 1)).map(p => p.id);
    expect(citizens.filter(p => atHomeAsleep(w, p, 1)).map(p => p.id)).toEqual(first);
  });

  it('leaves fewer people to witness a crime at three in the morning', () => {
    const { w } = city();
    const somebody = Object.values(w.people).find(p => p.role === 'citizen' && p.status === 'active')!;
    w.minute = at(13);
    const day = witnessesNear(w, somebody.pos, 400, []).filter(p => p.role === 'citizen').length;
    w.minute = at(3.5);
    const night = witnessesNear(w, somebody.pos, 400, []).filter(p => p.role === 'citizen').length;
    expect(night).toBeLessThan(day * .5);
  });
});

describe('back from prison (playtest, 21 November)', () => {
  it('comes out harder and less loyal, and the disloyal talk', () => {
    const { sim, w } = city();
    const gang = sim.playerGang;
    const hood = Object.values(w.people).find(p => p.gangId === gang.id && p.role === 'hood')!;
    hood.skills.fists = 2; hood.skills.intimidation = 4.8; hood.loyalty = 60;
    backFromPrison(w, hood);
    expect(hood.skills.fists).toBe(2.5);
    expect(hood.skills.intimidation).toBe(5);
    expect(hood.loyalty).toBe(60 - PRISON_LOYALTY_COST);
    expect(talkChance(100)).toBe(0);
    expect(talkChance(10)).toBeGreaterThan(talkChance(60));
  });

  it('adds to the case against the gang when a man talked', () => {
    let talked = 0, kept = 0;
    for (let week = 1; week <= 40; week++) {
      const { sim, w } = city();
      w.week = week;
      const gang = sim.playerGang;
      const hood = Object.values(w.people).find(p => p.gangId === gang.id && p.role === 'hood')!;
      hood.loyalty = 0;
      const before = gang.evidence;
      backFromPrison(w, hood);
      if (gang.evidence > before) talked++; else kept++;
    }
    // Two in three of the least loyal talk.
    expect(talked).toBeGreaterThan(15);
    expect(kept).toBeGreaterThan(3);
  });
});
