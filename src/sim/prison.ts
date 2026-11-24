import type { Person, WorldState } from './types';
import { addMessage } from './events';
import { reestimateTeamOrders } from './api';
import { replaceLieutenant } from './execution';

/** In the hands of the law: under arrest, awaiting or on trial, or serving a sentence. */
export function inCustody(p: Person | undefined): boolean {
  return !!p && (p.status === 'arrested' || p.status === 'onTrial' || p.status === 'jailed');
}

/**
 * Hoods taken by the law leave their crew (or the pool) for the gang's prison
 * list (playtest, 21 November: a Prison tab beside Hoods); when they come
 * out, they come back to the pool to be given a crew again. A lieutenant
 * hands his crew to its first free hood and goes with them. Run every
 * minute of the week and after the week's trials.
 */
export function sortPrisoners(w: WorldState): void {
  for (const gang of Object.values(w.gangs)) {
    if (gang.eliminated) continue;
    let list = gang.prisonIds;
    for (const teamId of gang.teamIds) {
      const team = w.teams[teamId];
      if (!team) continue;
      // A lieutenant taken: the first free hood on the crew list takes the
      // crew over, and he is a hood again (playtest, 21 November), so he goes
      // to the prison list below and to the pool when he is out. With nobody
      // free to take over, the crew waits for him.
      if (inCustody(w.people[team.lieutenantId])) {
        const heir = team.memberIds.map(id => w.people[id]).find(p => p?.role === 'hood' && p.status === 'active');
        if (heir) replaceLieutenant(w, gang, team, heir);
      }
      const taken = team.memberIds.filter(id => w.people[id]?.role === 'hood' && inCustody(w.people[id]));
      if (!taken.length) continue;
      team.memberIds = team.memberIds.filter(id => !taken.includes(id));
      // A job that asked for one of them by name: the lieutenant picks another man.
      for (const oid of team.orderIds) {
        const o = w.orders[oid];
        if (o && o.opts.preferredHoodId != null && taken.includes(o.opts.preferredHoodId)) {
          o.results.push(`${w.people[o.opts.preferredHoodId]?.name ?? 'The man asked for'} is held by the law; the lieutenant sends somebody else.`);
          o.opts.preferredHoodId = null;
        }
      }
      for (const id of taken) {
        w.people[id].teamId = null;
        (list ??= gang.prisonIds = []).includes(id) || list.push(id);
      }
      reestimateTeamOrders(w, team);
    }
    if (gang.poolIds.some(id => inCustody(w.people[id]))) {
      for (const id of gang.poolIds) if (inCustody(w.people[id])) (list ??= gang.prisonIds = []).includes(id) || list.push(id);
      gang.poolIds = gang.poolIds.filter(id => !inCustody(w.people[id]));
    }
    if (!list?.length) continue;
    // Out again (released, bailed, acquitted), or gone for good.
    const kept: number[] = [];
    for (const id of list) {
      const p = w.people[id];
      if (!p || p.gangId !== gang.id || p.status === 'dead') continue;
      if (inCustody(p)) { kept.push(id); continue; }
      if (p.teamId == null && !gang.poolIds.includes(id)) gang.poolIds.push(id);
    }
    gang.prisonIds = kept;
  }
}

/** What a stretch inside does to a man (playtest, 21 November). */
export const PRISON_TOUGHENS = .5, PRISON_LOYALTY_COST = 15, PRISON_TALK_EVIDENCE = 8, PRISON_TALK_SUSPICION = 6;

function hash01(n: number): number {
  let x = Math.imul(n ^ 0x2c1b3c6d, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** The chance a man talked inside: the less loyal he went in, the likelier. */
export function talkChance(loyalty: number): number {
  return Math.max(0, Math.min(1, (100 - loyalty) / 150));
}

/**
 * A gang man out after serving his sentence: harder (fists and intimidation
 * half a star up), less loyal to the gang that let him rot, and perhaps he
 * talked to get through it, which the police now hold against the boss. Fixed
 * by the man and the week, so it draws nothing from the game's dice.
 */
export function backFromPrison(w: WorldState, p: Person): void {
  if (p.gangId == null) return;
  const gang = w.gangs[p.gangId];
  if (!gang || gang.eliminated || p.role === 'boss') return;
  const before = p.loyalty;
  p.skills.fists = Math.min(5, p.skills.fists + PRISON_TOUGHENS);
  p.skills.intimidation = Math.min(5, p.skills.intimidation + PRISON_TOUGHENS);
  p.loyalty = Math.max(0, p.loyalty - PRISON_LOYALTY_COST);
  const talked = hash01(p.id * 7919 + w.week) < talkChance(before);
  if (talked) {
    gang.evidence = Math.min(100, gang.evidence + PRISON_TALK_EVIDENCE);
    gang.suspicion = Math.min(100, gang.suspicion + PRISON_TALK_SUSPICION);
  }
  if (gang.isPlayer) addMessage(w, 'police', talked
    ? `${p.name} is out of prison, harder and less loyal, and word is he talked inside: the law knows more about you.`
    : `${p.name} is out of prison, harder and less loyal. He kept his mouth shut.`, p.pos, p.id);
}
