import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { defaultGameOptions } from '../src/app/newGame';
import { cancelOrder, issueOrder, previewOrder } from '../src/sim/api';
import type { Rng } from '../src/sim/rng';
import { activeBlocks } from '../src/sim/cityLayout';
import { MINUTES_PER_WEEK } from '../src/sim/constants';
import { crewPeople } from '../src/sim/orderStaffing';
import { fitsWeek, tickOrders, WEEK_BUDGET } from '../src/sim/execution';
import type { Order } from '../src/sim/types';

/** A city a little way into its working week, with the player's first crew. */
function midWeek(minute: number) {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404 });
  sim.launchWeek();
  const w = sim.world, g = sim.playerGang, team = w.teams[g.teamIds[0]];
  w.minute = minute;
  return { sim, w, g, team };
}

const extortInput = (teamId: number, blockIds: number[], manpower = 1) =>
  ({ teamId, type: 'extort' as const, blockIds, buildingIds: [], opts: { manpower } as Order['opts'] });

describe('orders given during the working week', () => {
  it('queues a new order behind the crew’s other jobs', () => {
    const { w, g, team } = midWeek(600);
    const before = team.orderIds.length;
    const res = issueOrder(w, g.id, extortInput(team.id, [activeBlocks(w)[0].id]));
    expect(res.ok).toBe(true);
    expect(team.orderIds.length).toBe(before + 1);
    expect(w.orders[team.orderIds.at(-1)!].state).toBe('queued');
  });

  it('counts the crew’s week from now: the time already gone cannot be used', () => {
    const { w, team, g } = midWeek(MINUTES_PER_WEEK - 200);
    const order = previewOrder(w, g.id, extortInput(team.id, activeBlocks(w).slice(0, 1).map(b => b.id)))!;
    order.estimatedMinutes = 300;
    // Fits an empty Monday, not the last 200 minutes of Friday.
    expect(fitsWeek({ ...w, phase: 'planning' }, team, order, 0)).toBe(true);
    expect(fitsWeek(w, team, order, 0)).toBe(false);
    order.estimatedMinutes = 150;
    expect(fitsWeek(w, team, order, 0)).toBe(true);
  });

  it('refuses a job that will not fit what is left of the week', () => {
    const { w, g, team } = midWeek(Math.floor(WEEK_BUDGET) - 5);
    const res = issueOrder(w, g.id, extortInput(team.id, activeBlocks(w).slice(0, 6).map(b => b.id)));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error ?? '').toMatch(/time/);
  });

  it('charges the crew from now, not from Monday', () => {
    const { w, g, team } = midWeek(1000);
    team.timeUsed = 200;
    expect(issueOrder(w, g.id, extortInput(team.id, [activeBlocks(w)[0].id])).ok).toBe(true);
    expect(team.timeUsed).toBeGreaterThan(1000);
  });

  it('starts an urgent order at once, taking the crew off its current job, which it goes back to afterwards', () => {
    const { sim, w, g, team } = midWeek(300);
    const crew = crewPeople(w, team).filter(p => p.status === 'active');
    expect(crew.length).toBeGreaterThan(0);
    // The whole crew is busy on an ordinary job.
    const busy = issueOrder(w, g.id, extortInput(team.id, [activeBlocks(w)[1].id], crew.length));
    expect(busy.ok).toBe(true);
    const current = w.orders[team.orderIds.at(-1)!];
    current.state = 'travelling';
    current.assignedIds = crew.map(p => p.id);
    for (const p of crew) p.orderId = current.id;

    const res = issueOrder(w, g.id, { ...extortInput(team.id, [activeBlocks(w)[2].id]), opts: { manpower: 1, urgent: true } as Order['opts'] });
    expect(res.ok).toBe(true);
    const urgent = w.orders[team.orderIds.at(-1)!];
    expect(urgent.state).toBe('travelling');
    expect(urgent.assignedIds.length).toBe(1);
    const taken = w.people[urgent.assignedIds[0]];
    expect(taken.orderId).toBe(urgent.id);
    expect(taken.resumeOrderId).toBe(current.id);
    // The rest of the crew carry on with the job they were on.
    for (const p of crew.filter(p => p.id !== taken.id)) expect(p.orderId).toBe(current.id);

    // When the urgent job is over, he goes back to the one he was taken off.
    expect(cancelOrder(w, urgent.id).ok).toBe(true);
    tickOrders(w, (sim as unknown as { rng: Rng }).rng, 1);
    expect(taken.orderId).toBe(current.id);
    expect(taken.resumeOrderId).toBeUndefined();
  });

  it('leaves a non-urgent order queued while the crew is busy', () => {
    const { w, g, team } = midWeek(300);
    const crew = crewPeople(w, team).filter(p => p.status === 'active');
    for (const p of crew) p.orderId = -99;
    expect(issueOrder(w, g.id, extortInput(team.id, [activeBlocks(w)[2].id])).ok).toBe(true);
    const order = w.orders[team.orderIds.at(-1)!];
    expect(order.state).toBe('queued');
    for (const p of crew) expect(p.orderId).toBe(-99);
  });
});
