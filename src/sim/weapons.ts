import { WEAPONS } from './constants';
import type { ID, Person, WeaponId, WorldState } from './types';
import { peopleList } from './entityLists';
import { carriedGuns, syncArmoury } from './armoury';

export type Firearm = Exclude<WeaponId, 'explosives'>;
export type Loadout = ReadonlyMap<ID, Firearm>;
export const UNARMED = { name: 'Close combat', range: 2, damage: 10, accuracy: 0.65 };

/** Issued equipment is separate from whether it is currently drawn. */
export function serviceWeapon(p: Pick<Person, 'role' | 'skills'>): Firearm | undefined {
  if (p.role === 'fbi') return 'tommy';
  if (p.role === 'police') return p.skills.firearms > 3.5 ? 'tommy' : 'pistol';
  return undefined;
}

/**
 * Who has which gun this minute. The police have their service weapons; a
 * gang's man has the gun he carries (armoury.ts), which he took at an
 * armoury or picked up in the street. Without RNG.
 */
export function allocateWeapons(w: WorldState): Loadout {
  syncArmoury(w);
  const result = new Map<ID, Firearm>();
  for (const p of peopleList(w)) {
    if (p.status !== 'active') continue;
    if (p.role === 'police' || p.role === 'fbi') result.set(p.id, serviceWeapon(p)!);
  }
  for (const [id, [, g]] of carriedGuns(w)) {
    const p = w.people[id];
    if (p?.status === 'active' && p.gangId === g.gangId && p.role !== 'accountant' && p.role !== 'lawyer') result.set(id, g.kind as Firearm);
  }
  return result;
}

export function attackProfile(loadout: Loadout, person: Person) {
  const weapon = loadout.get(person.id);
  return { weapon, spec: weapon ? WEAPONS[weapon] : UNARMED,
    skill: weapon ? person.skills.firearms : person.skills.fists };
}
