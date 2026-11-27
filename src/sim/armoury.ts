import { WEAPONS } from './constants';
import { peopleList } from './entityLists';
import { allBuildings, buildingDoor, dist, placeName } from './world';
import type { Building, Gang, Gun, ID, Person, Team, Vec2, WeaponId, WorldState } from './types';

/**
 * Weapons are things in the world (playtest, 26 November). Every gun and
 * explosive a gang owns is either carried by one of its men or kept in an
 * armoury: the HQ, the offices and the warehouses each have one, without
 * limit. Each man has three places to carry them: one large gun (shotgun,
 * rifle, Tommy gun, B.A.R.), one small gun (pistol, twin pistols) and one
 * explosive. He fills an empty place, or swaps for something better, when he
 * calls at an armoury (at the start of the week the crews arm up from any of
 * them); a man who falls drops what he carries in the street, where anyone
 * passing can pick it up, and the police keep what a man they take carried.
 * The crew sheets still count how many of each kind a crew and the cache
 * hold: `syncArmoury` keeps one weapon in the world for each.
 */

/** A man this near an armoury door (or inside the building) can arm himself there. */
/** A name closing a sentence, without doubling the full stop of "B.A.R." */
const sentenceEnd = (name: string) => name.endsWith('.') ? name : `${name}.`;

export const ARMOURY_REACH = 25;
/** A man passing this near a dropped weapon picks it up. */
export const LOOSE_REACH = 4;

/** Best first: the order in which guns are handed to the best shots. */
export const GUN_RANK: WeaponId[] = ['twinPistols', 'bar', 'tommy', 'rifle', 'shotgun', 'pistol', 'explosives'];
const rank = (kind: WeaponId) => { const i = GUN_RANK.indexOf(kind); return i < 0 ? GUN_RANK.length : i; };
/** Better first. */
const better = (a: WeaponId, b: WeaponId) => rank(a) - rank(b);
const KINDS = Object.keys(WEAPONS) as WeaponId[];
const isFirearm = (kind: WeaponId) => kind !== 'explosives';

/** The three places a man carries a weapon. */
export type GunSlot = 'large' | 'small' | 'explosive';
export const GUN_SLOTS: GunSlot[] = ['large', 'small', 'explosive'];
export const SLOT_LABEL: Record<GunSlot, string> = { large: 'Large gun', small: 'Small gun', explosive: 'Explosive' };
export function slotOf(kind: WeaponId): GunSlot {
  return kind === 'explosives' ? 'explosive' : kind === 'pistol' || kind === 'twinPistols' ? 'small' : 'large';
}

export function isArmoury(b: Building | undefined, gangId?: ID): b is Building {
  return !!b && b.ownerGangId != null && (gangId == null || b.ownerGangId === gangId) &&
    b.state !== 'destroyed' && (b.typeId === 'office' || b.typeId === 'warehouse');
}

export function gangArmouries(w: WorldState, gangId: ID): Building[] {
  return allBuildings(w).filter(b => isArmoury(b, gangId));
}

/** Where a gang keeps a weapon it has just bought: the HQ, else the armoury nearest it. */
export function homeArmoury(w: WorldState, gangId: ID, near?: Vec2): Building | undefined {
  const all = gangArmouries(w, gangId);
  if (!all.length) return undefined;
  const hq = all.find(b => b.isHQ);
  if (hq && !near) return hq;
  const from = near ?? buildingDoor(w, all[0]);
  return [...all].sort((a, b) => dist(buildingDoor(w, a), from) - dist(buildingDoor(w, b), from) || a.id - b.id)[0];
}

/** Can carry weapons for the gang: an active man of it, not the accountant or the lawyer. */
export function fightingMan(p: Person | undefined, gangId?: ID): p is Person {
  return !!p && p.status === 'active' && p.gangId != null && (gangId == null || p.gangId === gangId) &&
    (p.role === 'boss' || p.role === 'lieutenant' || p.role === 'hood');
}

/** The crew whose weapons a man carries, or null for the gang's own (a stale crew gives none). */
export function gunTeamOf(w: WorldState, p: Person): ID | null {
  const team = p.teamId == null ? undefined : w.teams[p.teamId];
  return team && team.gangId === p.gangId && (team.lieutenantId === p.id || team.memberIds.includes(p.id)) ? team.id : null;
}

function books(w: WorldState, gangId: ID, teamId: ID | null): Record<WeaponId, number> | undefined {
  return teamId != null ? w.teams[teamId]?.weapons : w.gangs[gangId]?.weapons;
}
function bump(w: WorldState, gangId: ID, teamId: ID | null, kind: WeaponId, delta: number): void {
  const b = books(w, gangId, teamId);
  if (b) b[kind] = Math.max(0, (Number.isFinite(b[kind]) ? b[kind] : 0) + delta);
}
const wanted = (n: number | undefined) => Number.isFinite(n) ? Math.max(0, Math.floor(n!)) : 0;

function newGun(w: WorldState, gun: Gun): string {
  const n = w.nextGunNo ?? 1;
  w.nextGunNo = n + 1;
  const key = `g${n}`;
  (w.guns ??= {})[key] = gun;
  return key;
}

/** Into the armoury: off the man, kept in this building. */
function stash(g: Gun, b: Building | undefined): void {
  delete g.carrierId;
  if (b) g.armouryId = b.id; else delete g.armouryId;
}
function hand(g: Gun, p: Person): void {
  delete g.armouryId; delete g.reservedFor;
  g.carrierId = p.id;
}

/** A weapon bought, delivered to the armoury at the HQ (or the nearest one). */
export function stockGun(w: WorldState, gangId: ID, kind: WeaponId, teamId: ID | null): void {
  bump(w, gangId, teamId, kind, 1);
  const b = homeArmoury(w, gangId);
  if (b) newGun(w, { kind, gangId, teamId, armouryId: b.id });
  // Without premises it is found by syncArmoury (handed to a man).
}

/** A man drops what he carries: in the street where he stands. */
function dropAt(w: WorldState, key: string, g: Gun, pos: Vec2 | undefined): void {
  bump(w, g.gangId, g.teamId, g.kind, -1);
  delete w.guns![key];
  if (pos) (w.looseGuns ??= []).push({ kind: g.kind, pos: { ...pos } });
}
function lose(w: WorldState, key: string, g: Gun): void {
  bump(w, g.gangId, g.teamId, g.kind, -1);
  delete w.guns![key];
}

/** Working hoods, then the best shots: who gets the first pick. */
function armingOrder(w: WorldState) {
  const priority = (p: Person) => p.orderId != null && w.orders[p.orderId]?.opts.priority ? 1 : 0;
  const working = (p: Person) => p.orderId != null || p.streetOrder != null ? 1 : 0;
  return (a: Person, b: Person) => priority(b) - priority(a) || working(b) - working(a) ||
    b.skills.firearms - a.skills.firearms || a.id - b.id;
}

/**
 * One weapon for every one on the books, each where it is: what the fallen
 * carried is dropped, what men taken by the law carried is kept by the
 * police, a man moved to another crew takes his with him, and an armoury lost
 * to a rival is lost with what is in it.
 */
export function syncArmoury(w: WorldState): void {
  const guns = w.guns ?? {};
  for (const [key, g] of Object.entries(guns)) {
    if (!w.gangs[g.gangId]) { delete guns[key]; continue; }
    // A crew broken up: its stock went to the cache (execution.ts disbandTeam).
    if (g.teamId != null && w.teams[g.teamId]?.gangId !== g.gangId) g.teamId = null;
    if (g.carrierId != null) {
      const p = w.people[g.carrierId];
      if (!p || p.status === 'dead') { dropAt(w, key, g, p?.pos); continue; }
      if (p.status === 'arrested' || p.status === 'onTrial' || p.status === 'jailed' || p.status === 'kidnapped') { lose(w, key, g); continue; }
      if (p.status === 'beaten') continue; // laid up, still his
      if (!fightingMan(p, g.gangId)) {
        // Left the gang, or became its accountant: it goes back to the gang.
        stash(g, homeArmoury(w, g.gangId, w.people[g.carrierId].pos));
        continue;
      }
    } else if (g.armouryId != null && !isArmoury(w.buildings[g.armouryId], g.gangId)) {
      const b = w.buildings[g.armouryId];
      if (isArmoury(b)) {
        // Taken over with what was in it.
        lose(w, key, g);
        g.gangId = b.ownerGangId!; g.teamId = null; delete g.reservedFor;
        bump(w, g.gangId, null, g.kind, 1);
        guns[key] = g;
      } else lose(w, key, g); // burnt or blown up with the building, or sold off
      continue;
    } else if (g.armouryId == null) {
      stash(g, homeArmoury(w, g.gangId)); // bought with no premises: put away once there is one
    }
    if (g.reservedFor != null) {
      const p = w.people[g.reservedFor];
      if (!p || !fightingMan(p, g.gangId) || gunTeamOf(w, p) !== g.teamId) delete g.reservedFor;
    }
  }
  // Never two in one place on a man: the worse goes back on the rack.
  const worn = new Map<string, Gun>();
  for (const g of Object.values(guns)) {
    if (g.carrierId == null) continue;
    const k = `${g.carrierId}:${slotOf(g.kind)}`, had = worn.get(k);
    if (!had) { worn.set(k, g); continue; }
    const [keep, put] = better(g.kind, had.kind) < 0 ? [g, had] : [had, g];
    const at = w.people[put.carrierId!]?.pos;
    worn.set(k, keep);
    stash(put, homeArmoury(w, put.gangId, at));
  }
  reconcile(w);
  // A man moved to another crew takes his weapons with him (after the books
  // are squared, so one no longer on them is not moved onto another's).
  for (const g of Object.values(w.guns ?? {})) {
    const p = g.carrierId == null ? undefined : w.people[g.carrierId];
    if (!p || !fightingMan(p, g.gangId)) continue;
    const team = gunTeamOf(w, p);
    if (team !== g.teamId) { bump(w, g.gangId, g.teamId, g.kind, -1); g.teamId = team; bump(w, g.gangId, team, g.kind, 1); }
  }
  if (w.guns && !Object.keys(w.guns).length) delete w.guns;
  if (w.looseGuns && !w.looseGuns.length) delete w.looseGuns;
}

/** As many of each kind with each crew and in each cache as the books say. */
function reconcile(w: WorldState): void {
  const have = new Map<string, [string, Gun][]>();
  const bucket = (gangId: ID, teamId: ID | null, kind: WeaponId) => `${gangId}:${teamId ?? 'c'}:${kind}`;
  for (const entry of Object.entries(w.guns ?? {})) {
    const k = bucket(entry[1].gangId, entry[1].teamId, entry[1].kind);
    const list = have.get(k); if (list) list.push(entry); else have.set(k, [entry]);
  }
  // Removed first: the unplaced, then those in an armoury, then those carried.
  const keepOrder = (g: Gun) => g.carrierId != null ? 3 : g.reservedFor != null ? 2 : g.armouryId != null ? 1 : 0;
  for (const gang of Object.values(w.gangs)) {
    const owners: [ID | null, Record<WeaponId, number>][] = [[null, gang.weapons]];
    for (const t of Object.values(w.teams)) if (t.gangId === gang.id) owners.push([t.id, t.weapons]);
    for (const [teamId, stock] of owners) {
      const missing: WeaponId[] = [];
      for (const kind of KINDS) {
        const list = have.get(bucket(gang.id, teamId, kind)) ?? [];
        const want = wanted(stock?.[kind]);
        if (list.length > want) {
          list.sort((a, b) => keepOrder(a[1]) - keepOrder(b[1]));
          for (const [key] of list.slice(0, list.length - want)) delete w.guns![key];
        }
        for (let i = list.length; i < want; i++) missing.push(kind);
      }
      if (missing.length) placeMissing(w, gang, teamId, missing);
    }
  }
}

/**
 * Hand out weapons to men who have room for them, without taking anything
 * from anyone: first a gun to every man without one, the best to the best
 * shots (one gun each arms the most men), then the empty places filled.
 * Returns what nobody took.
 */
function deal(w: WorldState, men: Person[], stock: [string, Gun][], firearmsOnly = false): [string, Gun][] {
  const inv = inventories(w);
  const left = [...stock].sort((a, b) => better(a[1].kind, b[1].kind));
  const give = (i: number, p: Person) => {
    const [entry] = left.splice(i, 1);
    hand(entry[1], p);
    const mine = inv.get(p.id) ?? {};
    mine[slotOf(entry[1].kind)] = entry;
    inv.set(p.id, mine);
  };
  for (const p of men) {
    const mine = inv.get(p.id) ?? {};
    if (mine.large || mine.small) continue;
    const i = left.findIndex(([, g]) => isFirearm(g.kind));
    if (i >= 0) give(i, p);
  }
  for (const slot of GUN_SLOTS) {
    if (firearmsOnly && slot === 'explosive') continue;
    for (const p of men) {
      if (inv.get(p.id)?.[slot]) continue;
      const i = left.findIndex(([, g]) => slotOf(g.kind) === slot);
      if (i >= 0) give(i, p);
    }
  }
  return left;
}

/**
 * Weapons on the books that are not yet in the world (an old save, a new
 * game, a crew given guns by the rules): a crew's guns go to its men with
 * room for them; the rest, explosives and the cache are put in the armoury
 * (with no armoury at all, the cache's guns go to the men in no crew).
 */
function placeMissing(w: WorldState, gang: Gang, teamId: ID | null, missing: WeaponId[]): void {
  const home = homeArmoury(w, gang.id);
  const made: [string, Gun][] = missing.map(kind => {
    const g: Gun = { kind, gangId: gang.id, teamId };
    return [newGun(w, g), g];
  });
  let left = made;
  if (teamId != null || !home) {
    const men = peopleList(w).filter(p => fightingMan(p, gang.id) && gunTeamOf(w, p) === teamId).sort(armingOrder(w));
    left = deal(w, men, made.filter(([, g]) => isFirearm(g.kind)), true);
    left.push(...made.filter(([, g]) => !isFirearm(g.kind)));
  }
  for (const [, g] of left) if (g.carrierId == null) stash(g, home);
}

export type Inventory = Partial<Record<GunSlot, [string, Gun]>>;

/** What each man carries, in each of his three places. */
export function inventories(w: WorldState): Map<ID, Inventory> {
  const result = new Map<ID, Inventory>();
  for (const entry of Object.entries(w.guns ?? {})) {
    const id = entry[1].carrierId;
    if (id == null) continue;
    const inv = result.get(id) ?? {};
    const slot = slotOf(entry[1].kind), had = inv[slot];
    if (!had || better(entry[1].kind, had[1].kind) < 0) inv[slot] = entry;
    result.set(id, inv);
  }
  return result;
}

/** The gun each man fights with: the better of his large and small guns. */
export function carriedGuns(w: WorldState): Map<ID, [string, Gun]> {
  const result = new Map<ID, [string, Gun]>();
  for (const entry of Object.entries(w.guns ?? {})) {
    const id = entry[1].carrierId;
    if (id == null || !isFirearm(entry[1].kind)) continue;
    const had = result.get(id);
    if (!had || better(entry[1].kind, had[1].kind) < 0) result.set(id, entry);
  }
  return result;
}

/** The best weapon for this place in this armoury he may take: one kept for him, else his crew's (or the cache's, for a man in no crew). */
function bestFor(w: WorldState, p: Person, stored: [string, Gun][], slot: GunSlot): [string, Gun] | undefined {
  const team = gunTeamOf(w, p);
  const fits = stored.filter(([, g]) => slotOf(g.kind) === slot);
  const mine = fits.filter(([, g]) => g.reservedFor === p.id);
  if (mine.length) return mine.sort((a, b) => better(a[1].kind, b[1].kind))[0];
  // His crew's own first, then the gang's unassigned stock, which any of its men may take.
  const free = fits.filter(([, g]) => g.reservedFor == null);
  const best = (list: [string, Gun][]) => list.sort((a, b) => better(a[1].kind, b[1].kind))[0];
  return best(free.filter(([, g]) => g.teamId === team && team != null)) ?? best(free.filter(([, g]) => g.teamId == null));
}

/** Take it; what he carried in that place goes on the rack instead. */
function arm(p: Person, b: Building, pick: [string, Gun], had: [string, Gun] | undefined, stored: [string, Gun][]): boolean {
  if (had && pick[1].reservedFor !== p.id && better(pick[1].kind, had[1].kind) >= 0) return false;
  stored.splice(stored.indexOf(pick), 1);
  hand(pick[1], p);
  if (had) { stash(had[1], b); stored.push(had); }
  return true;
}

/**
 * The minute's arming: men at an armoury fill their empty places (or swap for
 * something better), men passing a dropped weapon pick it up when they have
 * room for it, and the police take any they come across.
 */
export function tickArmoury(w: WorldState): void {
  syncArmoury(w);
  const racks = new Map<ID, [string, Gun][]>();
  for (const entry of Object.entries(w.guns ?? {})) {
    const id = entry[1].armouryId;
    if (id == null || entry[1].carrierId != null) continue;
    const list = racks.get(id); if (list) list.push(entry); else racks.set(id, [entry]);
  }
  const loose = w.looseGuns ?? [];
  if (!racks.size && !loose.length) return;
  const carried = inventories(w);
  const armouries = [...racks.keys()].map(id => w.buildings[id]).filter((b): b is Building => !!b)
    .map(b => ({ b, door: buildingDoor(w, b), stored: racks.get(b.id)! }));
  for (const p of peopleList(w)) {
    if (p.status !== 'active' || p.inVehicle) continue;
    if (fightingMan(p)) {
      for (const a of armouries) {
        if (a.b.ownerGangId !== p.gangId || !a.stored.length) continue;
        if (p.buildingId !== a.b.id && dist(p.pos, a.door) > ARMOURY_REACH) continue;
        const inv = carried.get(p.id) ?? {};
        for (const slot of GUN_SLOTS) {
          const pick = bestFor(w, p, a.stored, slot);
          if (pick && arm(p, a.b, pick, inv[slot], a.stored)) inv[slot] = pick;
        }
        carried.set(p.id, inv);
      }
    }
    if (!loose.length) continue;
    const police = p.role === 'police' || p.role === 'fbi' || p.role === 'policeChief';
    if (!police && !fightingMan(p)) continue;
    const inv = carried.get(p.id) ?? {};
    // He picks up what he has room for; the police take everything.
    for (let i = loose.length - 1; i >= 0; i--) {
      const found = loose[i];
      if (dist(found.pos, p.pos) > LOOSE_REACH) continue;
      const slot = slotOf(found.kind);
      if (!police && inv[slot]) continue;
      loose.splice(i, 1);
      if (police) continue; // taken in as evidence
      const teamId = gunTeamOf(w, p);
      bump(w, p.gangId!, teamId, found.kind, 1);
      const g: Gun = { kind: found.kind, gangId: p.gangId!, teamId, carrierId: p.id };
      inv[slot] = [newGun(w, g), g];
    }
    carried.set(p.id, inv);
  }
  if (w.looseGuns && !w.looseGuns.length) delete w.looseGuns;
}

/**
 * The start of the week: the streets have been swept of dropped weapons, and
 * the crews arm up from any of the gang's armouries. A weapon kept for a man
 * goes to him (what he had in that place goes back on its rack); then the
 * empty places are filled, a gun for every man first and the best to the
 * best shots. Nobody gives up what he carries.
 */
export function armForTheWeek(w: WorldState): void {
  delete w.looseGuns;
  syncArmoury(w);
  const stored = Object.entries(w.guns ?? {}).filter(([, g]) => g.carrierId == null && g.armouryId != null);
  const inv = inventories(w);
  for (const [key, g] of stored) {
    const p = g.reservedFor == null ? undefined : w.people[g.reservedFor];
    if (!fightingMan(p, g.gangId)) continue;
    const had = inv.get(p.id)?.[slotOf(g.kind)];
    const rack = w.buildings[g.armouryId!];
    hand(g, p);
    if (had) stash(had[1], rack);
    const mine = inv.get(p.id) ?? {}; mine[slotOf(g.kind)] = [key, g]; inv.set(p.id, mine);
  }
  const byOwner = new Map<string, [string, Gun][]>();
  for (const entry of stored) {
    const g = entry[1];
    if (g.carrierId != null || g.reservedFor != null) continue;
    const k = `${g.gangId}:${g.teamId ?? 'c'}`;
    const list = byOwner.get(k); if (list) list.push(entry); else byOwner.set(k, [entry]);
  }
  const men = new Map<string, Person[]>();
  for (const p of peopleList(w)) if (fightingMan(p)) {
    const k = `${p.gangId}:${gunTeamOf(w, p) ?? 'c'}`;
    const list = men.get(k); if (list) list.push(p); else men.set(k, [p]);
  }
  const byShot = (a: Person, b: Person) => b.skills.firearms - a.skills.firearms || a.id - b.id;
  for (const [k, pool] of byOwner) {
    if (k.endsWith(':c')) continue;
    const crew = (men.get(k) ?? []).sort(byShot);
    if (crew.length) deal(w, crew, pool);
  }
  // The unassigned stock goes to whoever of the gang still has room, crews and all.
  for (const [k, pool] of byOwner) {
    if (!k.endsWith(':c')) continue;
    const gangId = k.slice(0, -2);
    const all = [...men].filter(([mk]) => mk.startsWith(gangId + ':')).flatMap(([, list]) => list).sort(byShot);
    if (all.length) deal(w, all, pool);
  }
}

/** What a weapon is called: just its kind ("Tommy Gun"), however many there are. */
export function gunLabel(g: Gun): string {
  return WEAPONS[g.kind].name;
}

/** Weapons of one kind and one holder on one rack, counted together. */
export interface RackRow {
  kind: WeaponId;
  name: string;
  /** A crew id, or 'cache'. */
  holderKey: string;
  holder: string;
  count: number;
  /** Their keys, the first being the one handed over or sold next. */
  keys: string[];
}

export interface ArmouryGroup {
  id: ID;
  name: string;
  isHQ: boolean;
  door: Vec2;
  rows: RackRow[];
  total: number;
}

/** The gang's armouries (HQ first) with what is on each rack, counted by kind and holder. */
export function armouryGroups(w: WorldState, gang: Gang): { armouries: ArmouryGroup[]; carried: number; loose: number } {
  const racks = new Map<ID, Map<string, RackRow>>();
  let carried = 0;
  for (const [key, g] of Object.entries(w.guns ?? {})) {
    if (g.gangId !== gang.id) continue;
    if (g.carrierId != null) { carried++; continue; }
    if (g.armouryId == null) continue;
    const team = g.teamId == null ? undefined : w.teams[g.teamId];
    const holderKey = team ? String(team.id) : 'cache';
    const rack = racks.get(g.armouryId) ?? new Map<string, RackRow>();
    racks.set(g.armouryId, rack);
    const k = `${g.kind}:${holderKey}`;
    const row = rack.get(k) ?? { kind: g.kind, name: gunLabel(g), holderKey, holder: team ? team.name : 'Unassigned', count: 0, keys: [] };
    rack.set(k, row);
    row.count++;
    // One kept for a man is handed over or sold last.
    if (g.reservedFor != null) row.keys.push(key); else row.keys.unshift(key);
  }
  const armouries = gangArmouries(w, gang.id)
    .sort((a, b) => Number(!!b.isHQ) - Number(!!a.isHQ) || Number(b.typeId === 'office') - Number(a.typeId === 'office') || a.id - b.id)
    .map(b => {
      const rows = [...(racks.get(b.id)?.values() ?? [])]
        .sort((x, y) => better(x.kind, y.kind) || Number(x.holderKey === 'cache') - Number(y.holderKey === 'cache') || x.holder.localeCompare(y.holder));
      return { id: b.id, name: placeName(w, b), isHQ: !!b.isHQ, door: buildingDoor(w, b), rows, total: rows.reduce((n, r) => n + r.count, 0) };
    });
  return { armouries, carried, loose: (w.looseGuns ?? []).length };
}

export interface CrewKit {
  id: ID;
  name: string;
  isLieutenant: boolean;
  pos: Vec2;
  slots: Record<GunSlot, WeaponId | null>;
}

/** Each man of a crew (the lieutenant first) with what he carries in his three places. */
export function crewInventory(w: WorldState, team: Team): CrewKit[] {
  const inv = inventories(w);
  return [team.lieutenantId, ...team.memberIds].map(id => w.people[id]).filter((p): p is Person => !!p && p.status !== 'dead')
    .map(p => {
      const mine = inv.get(p.id) ?? {};
      return { id: p.id, name: p.name, isLieutenant: p.id === team.lieutenantId, pos: { ...p.pos },
        slots: { large: mine.large?.[1].kind ?? null, small: mine.small?.[1].kind ?? null, explosive: mine.explosive?.[1].kind ?? null } };
    });
}

export type GunHolder = { teamId: ID } | 'cache' | { personId: ID };

/** Hand a weapon on the rack to a crew, to the cache, or keep it for one man. */
export function assignGun(w: WorldState, gangId: ID, key: string, to: GunHolder): string | null {
  const g = w.guns?.[key];
  if (!g || g.gangId !== gangId) return 'No such weapon.';
  if (g.carrierId != null) return 'A man is carrying it: only a weapon in an armoury can change hands.';
  let teamId: ID | null = null, keep: ID | undefined;
  if (to === 'cache') teamId = null;
  else if ('teamId' in to) {
    if (w.teams[to.teamId]?.gangId !== gangId) return 'No such crew.';
    teamId = to.teamId;
  } else {
    const p = w.people[to.personId];
    if (!fightingMan(p, gangId)) return 'He cannot carry it.';
    teamId = gunTeamOf(w, p); keep = p.id;
  }
  if (teamId !== g.teamId) { bump(w, gangId, g.teamId, g.kind, -1); g.teamId = teamId; bump(w, gangId, teamId, g.kind, 1); }
  if (keep != null) g.reservedFor = keep; else delete g.reservedFor;
  return null;
}

/** A weapon on the rack of this crew (or the cache), for a transfer or a sale: one kept for nobody first. */
export function gunInStore(w: WorldState, gangId: ID, teamId: ID | null, kind: WeaponId): [string, Gun] | undefined {
  syncArmoury(w);
  return Object.entries(w.guns ?? {})
    .filter(([, g]) => g.gangId === gangId && g.teamId === teamId && g.kind === kind && g.carrierId == null)
    .sort((a, b) => Number(a[1].reservedFor != null) - Number(b[1].reservedFor != null))[0];
}

/**
 * A bomb is laid: the explosive one of the men on the job carries goes first,
 * then one of the crew's, then the gang's. False if there is none.
 */
export function spendExplosive(w: WorldState, gangId: ID, teamId: ID, actorIds: readonly ID[]): boolean {
  syncArmoury(w);
  const all = Object.entries(w.guns ?? {}).filter(([, g]) => g.gangId === gangId && g.kind === 'explosives');
  const pick = all.find(([, g]) => g.carrierId != null && actorIds.includes(g.carrierId)) ??
    all.find(([, g]) => g.teamId === teamId) ?? all.find(([, g]) => g.teamId == null);
  if (pick) { lose(w, pick[0], pick[1]); return true; }
  const team = w.teams[teamId], gang = w.gangs[gangId];
  if ((team?.weapons.explosives ?? 0) > 0) { team.weapons.explosives--; return true; }
  if ((gang?.weapons.explosives ?? 0) > 0) { gang.weapons.explosives--; return true; }
  return false;
}

/** Off the books and out of the world (a sale). */
export function removeGun(w: WorldState, key: string): void {
  const g = w.guns?.[key];
  if (g) lose(w, key, g);
}

// ---------------------------------------------------------------- the inventory grid

/** Whether a man can take from or put on this rack right now: between weeks always, in the week only standing there. */
function atRack(w: WorldState, p: Person, b: Building): boolean {
  return w.phase !== 'week' || (!p.inVehicle && (p.buildingId === b.id || dist(p.pos, buildingDoor(w, b)) <= ARMOURY_REACH));
}

/** The armoury a man is standing at (in the week), or any of the gang's between weeks (the nearest). */
export function rackAt(w: WorldState, p: Person): Building | undefined {
  const all = p.gangId == null ? [] : gangArmouries(w, p.gangId);
  const near = all.filter(b => atRack(w, p, b))
    .sort((a, b) => dist(buildingDoor(w, a), p.pos) - dist(buildingDoor(w, b), p.pos) || a.id - b.id);
  return near[0];
}

/**
 * Put a weapon from a rack in a man's hands (dragged onto his slot). What he
 * carried in that place goes back on the rack. Between weeks, or standing at
 * that armoury, it is done at once; otherwise it is kept for him until he
 * next calls there. A weapon of another crew's changes hands to his.
 */
export function equipGun(w: WorldState, gangId: ID, key: string, personId: ID): { ok: boolean; message: string } {
  syncArmoury(w);
  const g = w.guns?.[key], p = w.people[personId];
  if (!g || g.gangId !== gangId) return { ok: false, message: 'No such weapon.' };
  if (g.carrierId != null) return { ok: false, message: 'Someone is carrying it already.' };
  if (!fightingMan(p, gangId)) return { ok: false, message: 'He cannot carry it.' };
  const b = g.armouryId == null ? undefined : w.buildings[g.armouryId];
  if (!b) return { ok: false, message: 'It is not in an armoury.' };
  const team = gunTeamOf(w, p);
  if (team !== g.teamId) { bump(w, gangId, g.teamId, g.kind, -1); g.teamId = team; bump(w, gangId, team, g.kind, 1); }
  if (!atRack(w, p, b)) {
    g.reservedFor = p.id;
    return { ok: true, message: `The ${WEAPONS[g.kind].name} is kept for ${p.name} at ${placeName(w, b)}; he takes it when he next calls there.` };
  }
  const had = inventories(w).get(p.id)?.[slotOf(g.kind)];
  hand(g, p);
  if (had) stash(had[1], b);
  return { ok: true, message: had ? `${p.name} swaps his ${WEAPONS[had[1].kind].name} for the ${sentenceEnd(WEAPONS[g.kind].name)}` : `${p.name} takes the ${sentenceEnd(WEAPONS[g.kind].name)}` };
}

/**
 * Take a weapon off a man and put it on a rack (dragged out of his slot onto
 * an armoury). Between weeks onto the chosen rack; in the week only at the
 * armoury he is standing at.
 */
export function unequipGun(w: WorldState, gangId: ID, personId: ID, slot: GunSlot, armouryId?: ID): { ok: boolean; message: string } {
  syncArmoury(w);
  const p = w.people[personId];
  if (!fightingMan(p, gangId)) return { ok: false, message: 'He is not one of your men.' };
  const had = inventories(w).get(p.id)?.[slot];
  if (!had) return { ok: false, message: 'He carries nothing there.' };
  const chosen = armouryId == null ? undefined : w.buildings[armouryId];
  const b = chosen && isArmoury(chosen, gangId) && atRack(w, p, chosen) ? chosen : w.phase === 'week' ? rackAt(w, p) : homeArmoury(w, gangId, p.pos);
  if (!b) return { ok: false, message: `${p.name} can only hand it in at an armoury.` };
  stash(had[1], b);
  return { ok: true, message: `${p.name} leaves his ${WEAPONS[had[1].kind].name} at ${placeName(w, b)}.` };
}

/**
 * One man hands a weapon to another (dragged from one man's slot to
 * another's): between weeks, or standing together. Whatever the other had in
 * that place goes back the other way.
 */
export function passGun(w: WorldState, gangId: ID, fromId: ID, slot: GunSlot, toId: ID): { ok: boolean; message: string } {
  syncArmoury(w);
  const from = w.people[fromId], to = w.people[toId];
  if (!fightingMan(from, gangId) || !fightingMan(to, gangId)) return { ok: false, message: 'Only your own men can swap weapons.' };
  if (fromId === toId) return { ok: false, message: 'He has it already.' };
  if (w.phase === 'week' && (from.inVehicle || to.inVehicle || dist(from.pos, to.pos) > LOOSE_REACH * 2))
    return { ok: false, message: `${from.name} and ${to.name} are not together. They swap weapons between weeks, or when they meet.` };
  const inv = inventories(w);
  const give = inv.get(from.id)?.[slot];
  if (!give) return { ok: false, message: `${from.name} carries nothing there.` };
  const back = inv.get(to.id)?.[slot];
  hand(give[1], to);
  if (back) hand(back[1], from);
  syncArmoury(w); // the books follow each man's crew
  return { ok: true, message: back ? `${from.name} and ${to.name} swap weapons.` : `${from.name} hands his ${WEAPONS[give[1].kind].name} to ${to.name}.` };
}
