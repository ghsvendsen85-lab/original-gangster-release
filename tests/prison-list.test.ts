import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { defaultGameOptions } from '../src/app/newGame';
import { sortPrisoners } from '../src/sim/prison';

function crew() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  return { w, gang, team };
}

describe('the prison list (playtest, 21 November)', () => {
  it('takes an arrested hood out of his crew, and back to the pool when released', () => {
    const { w, gang, team } = crew();
    const hood = w.people[team.memberIds[0]];
    hood.status = 'arrested';
    sortPrisoners(w);
    expect(team.memberIds).not.toContain(hood.id);
    expect(hood.teamId).toBeNull();
    expect(gang.prisonIds).toContain(hood.id);
    expect(gang.poolIds).not.toContain(hood.id);

    hood.status = 'jailed';
    sortPrisoners(w);
    expect(gang.prisonIds).toContain(hood.id);

    hood.status = 'active';
    sortPrisoners(w);
    expect(gang.prisonIds).not.toContain(hood.id);
    expect(gang.poolIds).toContain(hood.id);
  });

  it('hands an arrested lieutenant\'s crew to its first free hood, and makes him a hood', () => {
    const { w, gang, team } = crew();
    const lt = w.people[team.lieutenantId];
    const first = team.memberIds.map(id => w.people[id]).find(p => p.status === 'active')!;
    lt.status = 'onTrial';
    sortPrisoners(w);
    expect(team.lieutenantId).toBe(first.id);
    expect(first.role).toBe('lieutenant');
    expect(lt.role).toBe('hood');
    expect(team.memberIds).not.toContain(lt.id);
    expect(gang.prisonIds).toContain(lt.id);

    lt.status = 'active';
    sortPrisoners(w);
    expect(gang.poolIds).toContain(lt.id);
  });

  it('leaves a lieutenant with nobody free to take over at the head of his crew', () => {
    const { w, gang, team } = crew();
    const lt = w.people[team.lieutenantId];
    for (const id of team.memberIds) w.people[id].status = 'jailed';
    lt.status = 'arrested';
    sortPrisoners(w);
    expect(team.lieutenantId).toBe(lt.id);
    expect(lt.role).toBe('lieutenant');
    expect(team.memberIds).toHaveLength(0);
    expect(gang.prisonIds!.length).toBeGreaterThan(0);
  });
});
