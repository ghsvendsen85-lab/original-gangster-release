import type { Person, WorldState } from './types';
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
