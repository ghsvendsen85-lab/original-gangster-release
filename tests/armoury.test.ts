import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { assignWeapon, buyWeapon, equipWeapon, passWeapon, sellGun, sellWeapon, transferWeapon, unequipWeapon } from '../src/sim/api';
import { GUN_SLOTS, armForTheWeek, armouryGroups, carriedGuns, crewInventory, isArmoury, slotOf, spendExplosive, syncArmoury, tickArmoury } from '../src/sim/armoury';
import { allocateWeapons } from '../src/sim/weapons';
import { buildingDoor } from '../src/sim/world';
import type { WeaponId } from '../src/sim/types';
import { validateSaveWorld } from '../src/sim/saveSchema';
import { staffFirstCrew } from './helpers/crew';

/** Guns are things in the world (playtest, 26 November). */
function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startHoods: 10, startMoney: 500000 });
  staffFirstCrew(sim);
  const w = sim.world, g = sim.playerGang, t = w.teams[g.teamIds[0]];
  const hq = Object.values(w.buildings).find(b => b.isHQ && b.ownerGangId === g.id)!;
  syncArmoury(w);
  return { sim, w, g, t, hq };
}
type S = ReturnType<typeof fixture>;
const gunsOf = (s: S) => Object.entries(s.w.guns ?? {}).filter(([, g]) => g.gangId === s.g.id);
const books = (r: Record<WeaponId, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const owned = (s: S) => books(s.g.weapons) + s.g.teamIds.reduce((n, id) => n + books(s.w.teams[id].weapons), 0);
const crew = (s: S) => [s.t.lieutenantId, ...s.t.memberIds].map(id => s.w.people[id]);
/** Everyone in the crew away from the armouries. */
const sendAway = (s: S) => { crew(s).forEach((p, i) => { p.buildingId = null; p.inVehicle = false; p.pos = { x: -500 - 40 * i, y: -500 }; }); };

describe('armouries', () => {
  it('keeps one gun in the world for every gun on the books, each with a man or in an armoury', () => {
    const s = fixture();
    for (const gang of Object.values(s.w.gangs)) {
      const guns = Object.values(s.w.guns ?? {}).filter(g => g.gangId === gang.id);
      const want = books(gang.weapons) + gang.teamIds.reduce((n, id) => n + books(s.w.teams[id].weapons), 0);
      expect(guns).toHaveLength(want);
      for (const g of guns) expect(g.carrierId != null || isArmoury(s.w.buildings[g.armouryId!], gang.id)).toBe(true);
    }
  });

  it('delivers a gun bought to the HQ armoury, where a man calling there takes it', () => {
    const s = fixture();
    sendAway(s);
    const man = crew(s).find(p => !carriedGuns(s.w).has(p.id)) ?? crew(s)[0];
    for (const [, g] of gunsOf(s)) if (g.carrierId === man.id) { delete g.carrierId; g.armouryId = s.hq.id; g.teamId = null; s.t.weapons[g.kind]--; s.g.weapons[g.kind]++; }
    expect(buyWeapon(s.w, s.g.id, 'tommy', s.t.id).ok).toBe(true);
    const bought = gunsOf(s).find(([, g]) => g.kind === 'tommy' && g.teamId === s.t.id && g.carrierId == null)!;
    expect(bought[1].armouryId).toBe(s.hq.id);
    tickArmoury(s.w);
    expect(allocateWeapons(s.w).get(man.id)).not.toBe('tommy');
    man.pos = { ...buildingDoor(s.w, s.hq) };
    tickArmoury(s.w);
    expect(allocateWeapons(s.w).get(man.id)).toBe('tommy');
    expect(s.w.guns![bought[0]].carrierId).toBe(man.id);
  });

  it('drops the gun of a man who falls, and another man passing picks it up for his crew', () => {
    const s = fixture();
    sendAway(s);
    const [a, b] = crew(s);
    const theirs = gunsOf(s).find(([, g]) => g.carrierId === a.id) ?? (() => {
      expect(buyWeapon(s.w, s.g.id, 'rifle', s.t.id).ok).toBe(true);
      const g = gunsOf(s).find(([, x]) => x.kind === 'rifle' && x.carrierId == null)!;
      delete g[1].armouryId; g[1].carrierId = a.id; return g;
    })();
    for (const [, g] of gunsOf(s)) if (g.carrierId === b.id) { g.carrierId = undefined; g.armouryId = s.hq.id; }
    const kind = theirs[1].kind;
    const before = s.t.weapons[kind];
    a.status = 'dead';
    tickArmoury(s.w);
    expect(s.w.guns?.[theirs[0]]).toBeUndefined();
    expect(s.t.weapons[kind]).toBe(before - 1);
    expect(s.w.looseGuns).toEqual([{ kind, pos: a.pos }]);
    b.pos = { x: a.pos.x + 1, y: a.pos.y };
    tickArmoury(s.w);
    expect(s.w.looseGuns).toBeUndefined();
    expect(allocateWeapons(s.w).get(b.id)).toBe(kind);
    expect(s.t.weapons[kind]).toBe(before);
  });

  it('lets the police keep the gun of a man they take, and any gun they come across', () => {
    const s = fixture();
    const [a] = crew(s);
    const theirs = gunsOf(s).find(([, g]) => g.carrierId === a.id);
    if (theirs) {
      const before = owned(s);
      a.status = 'arrested';
      tickArmoury(s.w);
      expect(s.w.guns?.[theirs[0]]).toBeUndefined();
      expect(owned(s)).toBe(before - 1);
      expect(s.w.looseGuns ?? []).toHaveLength(0);
    }
    const cop = Object.values(s.w.people).find(p => p.role === 'police' && p.status === 'active')!;
    s.w.looseGuns = [{ kind: 'pistol', pos: { ...cop.pos } }];
    cop.inVehicle = false;
    tickArmoury(s.w);
    expect(s.w.looseGuns).toBeUndefined();
  });

  it('only sells or hands over a gun on a rack, and keeps a gun for one man', () => {
    const s = fixture();
    sendAway(s);
    expect(buyWeapon(s.w, s.g.id, 'shotgun').ok).toBe(true);
    const [key] = gunsOf(s).find(([, g]) => g.kind === 'shotgun' && g.teamId == null && g.carrierId == null)!;
    const man = crew(s)[1];
    const cache = s.g.weapons.shotgun, team = s.t.weapons.shotgun;
    expect(assignWeapon(s.w, s.g.id, key, { personId: man.id }).ok).toBe(true);
    expect(s.w.guns![key].reservedFor).toBe(man.id);
    expect(s.g.weapons.shotgun).toBe(cache - 1);
    expect(s.t.weapons.shotgun).toBe(team + 1);
    // Nobody else takes a gun kept for him.
    const other = crew(s)[2];
    other.pos = { ...buildingDoor(s.w, s.hq) };
    tickArmoury(s.w);
    expect(s.w.guns![key].carrierId).toBeUndefined();
    man.pos = { ...buildingDoor(s.w, s.hq) };
    tickArmoury(s.w);
    expect(s.w.guns![key].carrierId).toBe(man.id);
    expect(allocateWeapons(s.w).get(man.id)).toBe('shotgun');
    expect(sellGun(s.w, s.g.id, key).ok).toBe(false);
    expect(assignWeapon(s.w, s.g.id, key, 'cache').ok).toBe(false);
    // With every one of a kind carried, the crew sheet cannot sell or move one either.
    for (const [, g] of gunsOf(s)) if (g.teamId === s.t.id && g.kind === 'shotgun' && g.carrierId == null) { g.carrierId = crew(s)[3].id; delete g.armouryId; }
    expect(sellWeapon(s.w, s.g.id, 'shotgun', s.t.id).ok).toBe(false);
    expect(transferWeapon(s.w, s.g.id, 'shotgun', s.t.id, false).ok).toBe(false);
  });

  it('sells a gun on a rack for half its price', () => {
    const s = fixture();
    expect(buyWeapon(s.w, s.g.id, 'rifle').ok).toBe(true);
    const [key] = gunsOf(s).find(([, g]) => g.kind === 'rifle' && g.teamId == null && g.carrierId == null)!;
    const cash = s.g.cash, n = s.g.weapons.rifle;
    expect(sellGun(s.w, s.g.id, key).ok).toBe(true);
    expect(s.g.cash).toBe(cash + 375);
    expect(s.g.weapons.rifle).toBe(n - 1);
    expect(s.w.guns?.[key]).toBeUndefined();
  });

  it('arms the crews for the week from any armoury, the best guns to the best shots', () => {
    const s = fixture();
    sendAway(s);
    for (const [, g] of gunsOf(s)) if (g.teamId === s.t.id) { delete g.carrierId; g.armouryId = s.hq.id; }
    expect(buyWeapon(s.w, s.g.id, 'tommy', s.t.id).ok).toBe(true);
    const best = [...crew(s)].sort((a, b) => b.skills.firearms - a.skills.firearms || a.id - b.id)[0];
    armForTheWeek(s.w);
    expect(allocateWeapons(s.w).get(best.id)).toBe(s.t.weapons.twinPistols || s.t.weapons.bar ? expect.anything() : 'tommy');
    for (const place of GUN_SLOTS) {
      const carried = gunsOf(s).filter(([, g]) => g.teamId === s.t.id && g.carrierId != null && slotOf(g.kind) === place);
      const stock = Object.entries(s.t.weapons).reduce((n, [k, c]) => n + (slotOf(k as WeaponId) === place ? c : 0), 0);
      expect(carried).toHaveLength(Math.min(stock, crew(s).length));
    }
  });

  it('lists the armouries with their racks counted by kind and holder, and what each man carries', () => {
    const s = fixture();
    for (let i = 0; i < 3; i++) expect(buyWeapon(s.w, s.g.id, 'pistol').ok).toBe(true);
    const { armouries, carried } = armouryGroups(s.w, s.g);
    expect(armouries[0].isHQ).toBe(true);
    const row = armouries[0].rows.find(r => r.kind === 'pistol' && r.holder === 'Unassigned')!;
    expect(row.name).toBe('Pistol');
    expect(row.count).toBeGreaterThanOrEqual(3);
    expect(row.keys).toHaveLength(row.count);
    expect(carried + armouries.reduce((n, a) => n + a.total, 0)).toBe(gunsOf(s).length);
    const kit = crewInventory(s.w, s.t);
    expect(kit[0].isLieutenant).toBe(true);
    expect(kit).toHaveLength(crew(s).length);
  });

  it('carries one large gun, one small gun and one explosive, and fights with the better gun', () => {
    const s = fixture();
    sendAway(s);
    const man = crew(s)[0];
    for (const [, g] of gunsOf(s)) if (g.carrierId === man.id) { delete g.carrierId; g.armouryId = s.hq.id; }
    for (const kind of ['rifle', 'tommy', 'pistol', 'twinPistols', 'explosives', 'explosives'] as WeaponId[]) expect(buyWeapon(s.w, s.g.id, kind, s.t.id).ok).toBe(true);
    man.pos = { ...buildingDoor(s.w, s.hq) };
    tickArmoury(s.w);
    const kit = crewInventory(s.w, s.t).find(k => k.id === man.id)!;
    expect(kit.slots).toEqual({ large: 'tommy', small: 'twinPistols', explosive: 'explosives' });
    expect(gunsOf(s).filter(([, g]) => g.carrierId === man.id)).toHaveLength(3);
    expect(allocateWeapons(s.w).get(man.id)).toBe('twinPistols');
    // He falls: all three lie in the street.
    man.status = 'dead';
    tickArmoury(s.w);
    expect((s.w.looseGuns ?? []).map(l => l.kind).sort()).toEqual(['explosives', 'tommy', 'twinPistols']);
  });

  it('lays a bomb with the explosive a man on the job carries', () => {
    const s = fixture();
    sendAway(s);
    const [a, b] = crew(s);
    expect(buyWeapon(s.w, s.g.id, 'explosives', s.t.id).ok).toBe(true);
    expect(buyWeapon(s.w, s.g.id, 'explosives', s.t.id).ok).toBe(true);
    const [carriedKey, carried] = gunsOf(s).filter(([, g]) => g.kind === 'explosives')[0];
    delete carried.armouryId; carried.carrierId = b.id;
    expect(spendExplosive(s.w, s.g.id, s.t.id, [a.id, b.id])).toBe(true);
    expect(s.w.guns?.[carriedKey]).toBeUndefined();
    expect(s.t.weapons.explosives).toBe(1);
    expect(spendExplosive(s.w, s.g.id, s.t.id, [a.id])).toBe(true);
    expect(spendExplosive(s.w, s.g.id, s.t.id, [a.id])).toBe(s.g.weapons.explosives > 0);
  });

  it('equips, unequips and passes weapons by hand: at once between weeks, at the armoury in the week', () => {
    const s = fixture();
    sendAway(s);
    const [a, b] = crew(s);
    expect(buyWeapon(s.w, s.g.id, 'tommy').ok).toBe(true);
    const [key] = gunsOf(s).find(([, g]) => g.kind === 'tommy' && g.carrierId == null)!;
    // In the week, away from the armoury: kept for him.
    s.w.phase = 'week';
    expect(equipWeapon(s.w, s.g.id, key, a.id).ok).toBe(true);
    expect(s.w.guns![key].reservedFor).toBe(a.id);
    expect(s.w.guns![key].teamId).toBe(s.t.id);
    expect(unequipWeapon(s.w, s.g.id, a.id, 'small').ok).toBe(false);
    // Between weeks: at once.
    s.w.phase = 'planning';
    expect(equipWeapon(s.w, s.g.id, key, a.id).ok).toBe(true);
    expect(s.w.guns![key].carrierId).toBe(a.id);
    expect(crewInventory(s.w, s.t).find(k => k.id === a.id)!.slots.large).toBe('tommy');
    expect(passWeapon(s.w, s.g.id, a.id, 'large', b.id).ok).toBe(true);
    expect(s.w.guns![key].carrierId).toBe(b.id);
    expect(unequipWeapon(s.w, s.g.id, b.id, 'large', s.hq.id).ok).toBe(true);
    expect(s.w.guns![key]).toMatchObject({ armouryId: s.hq.id });
    expect(s.w.guns![key].carrierId).toBeUndefined();
    // In the week, only standing together.
    s.w.phase = 'week';
    expect(equipWeapon(s.w, s.g.id, key, a.id).ok).toBe(true);
    a.pos = { ...buildingDoor(s.w, s.hq) };
    tickArmoury(s.w);
    expect(s.w.guns![key].carrierId).toBe(a.id);
    expect(passWeapon(s.w, s.g.id, a.id, 'large', b.id).ok).toBe(false);
  });

  it('survives a save and load', () => {
    const s = fixture();
    expect(buyWeapon(s.w, s.g.id, 'bar').ok).toBe(true);
    s.w.looseGuns = [{ kind: 'pistol', pos: { x: 3, y: 4 } }];
    const copy = JSON.parse(JSON.stringify(s.w));
    expect(() => validateSaveWorld(copy)).not.toThrow();
    expect(copy.guns).toEqual(s.w.guns);
    expect(copy.looseGuns).toEqual(s.w.looseGuns);
    copy.guns[Object.keys(copy.guns)[0]].kind = "musket";
    expect(() => validateSaveWorld(copy)).toThrow(/gun/);
  });
});
