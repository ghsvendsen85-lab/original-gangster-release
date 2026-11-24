import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { defaultGameOptions } from '../src/app/newGame';
import { weekDebrief } from '../src/sim/debrief';

describe('end-of-week debriefing (playtest, 23 November)', () => {
  it('has nothing to compare before the first week is run', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404 });
    const d = weekDebrief(sim.world, sim.playerGang);
    expect(d.orders).toEqual({ done: 0, failed: 0, failures: [] });
    expect(d.events).toEqual([]);
  });

  it('reports the finished week: money, changes, orders and events', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404 });
    const w = sim.world, gang = sim.playerGang;
    sim.launchWeek();
    while (w.phase === 'week') sim.finishWeekSlice(1000);
    expect(w.phase).toBe('planning');
    const d = weekDebrief(w, gang);
    expect(d.week).toBe(w.week - 1);
    expect(d.money).not.toBeNull();
    expect(d.money!.closing).toBe(gang.lastFinanceReport!.closingCash);
    expect(d.money!.opening + d.money!.income - d.money!.costs - d.money!.tax).toBeCloseTo(d.money!.closing, 0);
    expect(d.changes.map(c => c.key)).toEqual(['territory', 'manpower', 'loyalty', 'suspicion', 'power']);
    expect(d.events).toEqual(w.weekLog);
    const mine = w.lastWeekOrders.filter(o => o.gangId === gang.id);
    expect(d.orders.done + d.orders.failed).toBe(mine.length);
    for (const b of d.businesses.best) expect(b.profit).toBeGreaterThan(0);
    for (const b of d.businesses.worst) expect(b.profit).toBeLessThan(0);
  }, 120_000);
});
