import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { defaultGameOptions } from '../src/app/newGame';
import { INCIDENT_HOSTILITY, provoke } from '../src/sim/aiStance';
import { MINUTES_PER_DAY } from '../src/sim/constants';
import { hasOrder, MID_WEEK_AI_EVERY, tickMidWeekAi } from '../src/sim/midWeekAi';
import { takeWrongs } from '../src/sim/recentWrongs';
import { teamsOf } from '../src/sim/world';

function weekCity() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404 });
  sim.launchWeek();
  const w = sim.world;
  const rival = Object.values(w.gangs).find(g => !g.isPlayer && !g.eliminated)!;
  return { sim, w, player: sim.playerGang, rival };
}

describe('rival gangs during the working week', () => {
  it('note a wrong done to them only while the week runs', () => {
    const { w, player, rival } = weekCity();
    provoke(w, rival.id, player.id, INCIDENT_HOSTILITY.kill);
    expect(takeWrongs(w).length).toBe(1);
    w.phase = 'planning';
    provoke(w, rival.id, player.id, INCIDENT_HOSTILITY.kill);
    expect(takeWrongs(w).length).toBe(0);
  });

  it('answer a killing with an urgent hit on the gang that did it', () => {
    const { w, player, rival } = weekCity();
    rival.personality = 'aggressive';
    // They know who the player's people are.
    const victim = w.people[w.teams[player.teamIds[0]].lieutenantId];
    rival.knownPeople = [...new Set([...rival.knownPeople, victim.id])];
    for (const b of Object.values(w.buildings)) if (b.ownerGangId === player.id) b.knowledge[rival.id] = 0;
    const before = Object.keys(w.orders).length;
    w.minute = MID_WEEK_AI_EVERY * 4;
    provoke(w, rival.id, player.id, INCIDENT_HOSTILITY.kill);
    tickMidWeekAi(w);
    const fresh = Object.values(w.orders).filter(o => o.gangId === rival.id).slice(-1)[0];
    expect(Object.keys(w.orders).length).toBeGreaterThan(before);
    expect(['kill', 'assault', 'raid', 'smashUp', 'torch']).toContain(fresh.type);
    expect(fresh.opts.urgent).toBe(true);
  });

  it('find idle crews work in the morning', () => {
    const { w, rival } = weekCity();
    for (const team of teamsOf(w, rival)) { for (const id of team.orderIds) delete w.orders[id]; team.orderIds = []; team.timeUsed = 0; }
    w.minute = MINUTES_PER_DAY;
    tickMidWeekAi(w);
    expect(['extort', 'collectProtection', 'patrol'].some(t => hasOrder(w, rival.id, t as 'extort'))).toBe(true);
  });

  it('does nothing between its looks at the street', () => {
    const { w, rival } = weekCity();
    for (const team of teamsOf(w, rival)) { for (const id of team.orderIds) delete w.orders[id]; team.orderIds = []; }
    w.minute = MINUTES_PER_DAY + 1;
    tickMidWeekAi(w);
    expect(teamsOf(w, rival).every(t => t.orderIds.length === 0)).toBe(true);
  });
});
