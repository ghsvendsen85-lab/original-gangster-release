import { INCIDENT_HOSTILITY } from './aiStance';
import { issueOrder } from './api';
import { MINUTES_PER_DAY, MINUTES_PER_WEEK } from './constants';
import { peopleList } from './entityLists';
import { isValidAreaTarget } from './execution';
import { r01 } from './hash';
import { buildingMapIntel } from './mapIntel';
import { takeWrongs, type Wrong } from './recentWrongs';
import type { Gang, ID, Order, OrderType, Team, WorldState } from './types';
import { allBuildings, buildingsOfBlock, protectedBuildings, teamsOf, territoryBlocks } from './world';

/**
 * The computer's gangs during the working week. They planned on Monday like
 * the player; now they also act while the week runs, as the player can:
 *  - a gang that is hit answers it (the more aggressive, the more surely),
 *    with an urgent order against the gang that did it, and
 *  - each morning a crew left with nothing to do is given work near home.
 * Chance comes from a hash of the week, the minute and the gang, not the
 * simulation's random stream, so the rest of the week plays as it would.
 */

/** How often the gangs look over the street, in game minutes. */
export const MID_WEEK_AI_EVERY = 30;

const aggression = (g: Gang) => g.personality === 'aggressive' ? 1 : g.personality === 'normal' ? .6 : .25;
const ACTIVE: ReadonlySet<Order['state']> = new Set(['queued', 'travelling', 'waiting', 'executing']);

function roll(w: WorldState, gang: Gang, salt: number): number {
  return r01(w.week * 100_003 + w.minute * 31 + gang.id * 7_919, salt);
}

function workingTeams(w: WorldState, gang: Gang): Team[] {
  return teamsOf(w, gang).filter(t => {
    const lt = w.people[t.lieutenantId];
    return lt && lt.status !== 'dead' && lt.status !== 'jailed' && lt.status !== 'kidnapped';
  });
}

const activeOrders = (w: WorldState, team: Team) => team.orderIds.filter(id => ACTIVE.has(w.orders[id]?.state as Order['state'])).length;

/** Answer the gang that wronged this one: its premises if the gang knows of any, else one of its people. */
function retaliate(w: WorldState, gang: Gang, wrong: Wrong): boolean {
  const enemy = w.gangs[wrong.by];
  if (!enemy || enemy.eliminated) return false;
  const teams = workingTeams(w, gang).sort((a, b) => activeOrders(w, a) - activeOrders(w, b));
  if (!teams.length) return false;
  const serious = wrong.amount >= INCIDENT_HOSTILITY.kill;
  const sites = allBuildings(w).filter(b => b.ownerGangId === enemy.id && !b.isHQ && b.state === 'trading'
    && buildingMapIntel(b, gang.id).ownerGangId === enemy.id);
  const people = peopleList(w).filter(p => p.gangId === enemy.id && p.status === 'active' && gang.knownPeople.includes(p.id) && p.role !== 'boss');
  for (const team of teams) {
    const crew = Math.max(1, Math.min(2, team.memberIds.length + 1));
    let res;
    if (sites.length && (roll(w, gang, 11) < .65 || !people.length)) {
      const site = sites[Math.floor(roll(w, gang, 12) * sites.length)];
      const type: OrderType = serious && roll(w, gang, 13) < .4 ? 'torch' : roll(w, gang, 14) < .5 ? 'raid' : 'smashUp';
      res = issueOrder(w, gang.id, { teamId: team.id, type, buildingIds: [site.id], opts: { manpower: crew, urgent: serious } });
    } else if (people.length) {
      const target = people[Math.floor(roll(w, gang, 15) * people.length)];
      res = issueOrder(w, gang.id, { teamId: team.id, type: serious ? 'kill' : 'assault', personId: target.id, opts: { manpower: crew, urgent: serious } });
    } else return false;
    if (res.ok) return true;
  }
  return false;
}

/** A crew with nothing left to do this week is sent to collect, extort or patrol near home. */
function keepBusy(w: WorldState, gang: Gang): void {
  const owed = protectedBuildings(w, gang.id).filter(b => b.state === 'trading');
  const turf = territoryBlocks(w, gang.id);
  const extortable = turf.flatMap(b => buildingsOfBlock(w, b)).filter(b => b.state === 'trading' && isValidAreaTarget(w, gang.id, 'extort', b));
  workingTeams(w, gang).forEach((team, k) => {
    if (activeOrders(w, team) > 0) return;
    const crew = Math.max(1, Math.min(2, team.memberIds.length + 1));
    const tries: Parameters<typeof issueOrder>[2][] = [];
    if (extortable.length) tries.push({ teamId: team.id, type: 'extort', buildingIds: extortable.slice(k * 4, k * 4 + 4).map(b => b.id), opts: { manpower: crew } });
    if (owed.length) tries.push({ teamId: team.id, type: 'collectProtection', buildingIds: owed.slice(k * 10, k * 10 + 10).map(b => b.id), opts: { manpower: crew } });
    if (turf.length) tries.push({ teamId: team.id, type: 'patrol', blockIds: turf.slice(0, 4).map(b => b.id), opts: { manpower: 1 } });
    for (const input of tries) {
      if ((input.buildingIds?.length ?? 0) === 0 && !(input.blockIds?.length)) continue;
      if (issueOrder(w, gang.id, input).ok) break;
    }
  });
}

/** Once a game minute in the working week (does nothing on most minutes). */
export function tickMidWeekAi(w: WorldState): void {
  if (w.phase !== 'week' || w.minute % MID_WEEK_AI_EVERY !== 0) return;
  // Nothing new is started in the week's last hour.
  if (w.minute > MINUTES_PER_WEEK - 60) { takeWrongs(w); return; }
  const answered = new Set<string>();
  for (const wrong of takeWrongs(w)) {
    const gang = w.gangs[wrong.wronged];
    if (!gang || gang.isPlayer || gang.eliminated) continue;
    const key = `${wrong.wronged}:${wrong.by}`;
    if (answered.has(key)) continue;
    const odds = aggression(gang) * (wrong.amount >= INCIDENT_HOSTILITY.kill ? 1 : .55);
    if (roll(w, gang, wrong.by + 1) >= odds) continue;
    if (retaliate(w, gang, wrong)) answered.add(key);
  }
  // Each morning, idle crews are found work.
  if (w.minute > 0 && w.minute % MINUTES_PER_DAY === 0)
    for (const gang of Object.values(w.gangs)) if (!gang.isPlayer && !gang.eliminated) keepBusy(w, gang);
}

/** For tests: whether a gang has an order of this kind in hand. */
export function hasOrder(w: WorldState, gangId: ID, type: OrderType): boolean {
  return Object.values(w.orders).some(o => o.gangId === gangId && o.type === type && ACTIVE.has(o.state));
}
