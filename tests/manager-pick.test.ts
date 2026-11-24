import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { defaultGameOptions } from '../src/app/newGame';
import { managerChoices, setManager } from '../src/sim/api';

function desk() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404 });
  const w = sim.world, gang = sim.playerGang;
  const b = Object.values(w.buildings).find(x => x.ownerGangId === gang.id && x.managerId != null && !x.isHQ)!;
  return { w, gang, b };
}

describe('choosing a manager at the planning desk (playtest, 23 November)', () => {
  it('hands a business to a crew hood, and sends the old manager to the pool', () => {
    const { w, gang, b } = desk();
    expect(w.phase).toBe('planning');
    const old = w.people[b.managerId!];
    const team = w.teams[gang.teamIds[0]];
    const hood = w.people[team.memberIds[0]];
    expect(managerChoices(w, gang.id)).toContain(hood);
    const r = setManager(w, gang.id, b.id, hood.id);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(b.managerId).toBe(hood.id);
    expect(hood.buildingId).toBe(b.id);
    expect(team.memberIds).not.toContain(hood.id);
    expect(old.buildingId).toBeNull();
    expect(gang.poolIds).toContain(old.id);
    expect(b.managerRecalledWeek).not.toBe(w.week);
    // Now a manager, he is no longer a free choice.
    expect(managerChoices(w, gang.id)).not.toContain(hood);
  });

  it('will not take a man the law holds, or work mid-week', () => {
    const { w, gang, b } = desk();
    const hood = w.people[w.teams[gang.teamIds[0]].memberIds[0]];
    hood.status = 'jailed';
    expect(setManager(w, gang.id, b.id, hood.id).ok).toBe(false);
    hood.status = 'active';
    w.phase = 'week';
    expect(setManager(w, gang.id, b.id, hood.id).ok).toBe(false);
  });
});

import { crewSizeBonus } from '../src/sim/execution';
describe('numbers tell, by skill (playtest, 23 November)', () => {
  it('adds up to five points for each skilled man past the leader, fifteen at most: four five-star men are the best crew', () => {
    expect(crewSizeBonus([5])).toBe(0);
    expect(crewSizeBonus([5, 5])).toBeCloseTo(.05);
    expect(crewSizeBonus([5, 5, 5, 5])).toBeCloseTo(.15);
    expect(crewSizeBonus([5, 5, 5])).toBeLessThan(.15);
    expect(crewSizeBonus([5, .5])).toBeLessThan(.005);
    expect(crewSizeBonus([1, 3])).toBeCloseTo(crewSizeBonus([3, 1]));
    expect(crewSizeBonus([5, 3])).toBeGreaterThan(crewSizeBonus([5, 1]));
    expect(crewSizeBonus([5, 5, 5, 5, 5, 5])).toBeCloseTo(.15);
  });
});
