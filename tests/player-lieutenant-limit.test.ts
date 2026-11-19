import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { promote } from '../src/sim/api';
import { MAX_PLAYER_TEAMS } from '../src/sim/constants';
import { Sim } from '../src/sim/sim';

describe('the player\'s lieutenant limit', () => {
  it('lets the player run more than eight crews, up to the raised limit', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 77, citySize: 10, startHoods: 30, startMoney: 200000 });
    const w = sim.world, gang = sim.playerGang;
    // Enlist enough townsfolk into the pool to promote a full set of lieutenants.
    const recruits = Object.values(w.people).filter((p) => p.gangId == null && p.status === 'active' && p.role !== 'police').slice(0, MAX_PLAYER_TEAMS + 2);
    for (const p of recruits) { p.gangId = gang.id; p.role = 'hood'; p.teamId = null; gang.poolIds.push(p.id); }
    const hoods = () => [...gang.poolIds, ...gang.teamIds.flatMap((id) => w.teams[id].memberIds)];
    while (gang.teamIds.length < MAX_PLAYER_TEAMS) {
      const next = hoods()[0];
      expect(next, 'enough hoods to promote').toBeDefined();
      expect(promote(w, gang.id, next).ok).toBe(true);
    }
    expect(gang.teamIds.length).toBe(MAX_PLAYER_TEAMS);
    const refused = promote(w, gang.id, hoods()[0]);
    expect(refused.ok).toBe(false);
    expect(gang.teamIds.length).toBe(MAX_PLAYER_TEAMS);
  });
});
