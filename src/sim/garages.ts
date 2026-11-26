import { VEHICLES } from './constants';
import { parkedSpots } from './transport';
import { parkingSpot } from './vehicleNavigation';
import { streetLocation } from './cityLayout';
import { allBuildings, buildingDoor, dist, placeName } from './world';
import type { Building, FleetVehicle, Gang, ID, Team, Vec2, VehicleId, WorldState } from './types';

/**
 * Cars are always in the world (playtest, 26 November): every car a gang owns
 * is one vehicle with a place of its own, either put away in a garage or
 * standing on a street. The HQ, the offices and the warehouses each have a
 * garage for six; a car that finds them full is left at the kerb outside.
 * The crew sheets still say how many of each kind a crew holds; the fleet
 * keeps one vehicle for each of them (`syncFleet`).
 */
export const GARAGE_CAPACITY = 6;
/** A car stopped this near a garage door with room is driven in. */
export const GARAGE_REACH = 25;

const KINDS = Object.keys(VEHICLES) as VehicleId[];

export function isGarage(b: Building | undefined, gangId?: ID): b is Building {
  return !!b && b.ownerGangId != null && (gangId == null || b.ownerGangId === gangId) &&
    b.state !== 'destroyed' && (b.typeId === 'office' || b.typeId === 'warehouse');
}

export function gangGarages(w: WorldState, gangId: ID): Building[] {
  return allBuildings(w).filter(b => isGarage(b, gangId));
}

export function garagedVehicles(w: WorldState, buildingId: ID): FleetVehicle[] {
  return Object.values(w.vehicleFleet ?? {}).filter(v => v.garageId === buildingId);
}

/** The nearest of the gang's garages with a free bay. */
export function garageWithRoom(w: WorldState, gangId: ID, near: Vec2): Building | undefined {
  const used = new Map<ID, number>();
  for (const v of Object.values(w.vehicleFleet ?? {})) if (v.garageId != null) used.set(v.garageId, (used.get(v.garageId) ?? 0) + 1);
  return gangGarages(w, gangId).filter(b => (used.get(b.id) ?? 0) < GARAGE_CAPACITY)
    .sort((a, b) => dist(buildingDoor(w, a), near) - dist(buildingDoor(w, b), near) || a.id - b.id)[0];
}

/** Where a car is brought out to (or left, when the garage is full): the kerb by the door. */
export function garageKerb(w: WorldState, b: Building, exceptKey: string): Vec2 {
  return parkingSpot(w, buildingDoor(w, b), parkedSpots(w, exceptKey));
}

/** Drive it in: off the street, its seats and errand cleared. */
export function putInGarage(w: WorldState, v: FleetVehicle, b: Building): void {
  v.garageId = b.id;
  v.pos = parkingSpot(w, buildingDoor(w, b), []);
  v.destination = null; v.returning = false; v.boarding = false;
  delete v.idleSince; delete v.boardAfter;
}

/** Bring it out to the kerb, ready for the crew walking over to it. */
export function takeOutOfGarage(w: WorldState, key: string, v: FleetVehicle): void {
  const b = v.garageId == null ? undefined : w.buildings[v.garageId];
  delete v.garageId;
  if (b) v.pos = garageKerb(w, b, key);
}

/** Put away in the garage it stopped by, when that garage has a free bay. */
export function garageIfNear(w: WorldState, v: FleetVehicle): Building | undefined {
  const b = garageWithRoom(w, v.gangId, v.pos);
  if (!b || dist(buildingDoor(w, b), v.pos) > GARAGE_REACH) return undefined;
  putInGarage(w, v, b);
  return b;
}

/** Where a gang keeps a car it has just bought: the garage nearest its HQ, or the kerb outside when all are full. */
function homeFor(w: WorldState, gang: Gang): Building | undefined {
  return allBuildings(w).find(b => b.isHQ && b.ownerGangId === gang.id && b.state !== 'destroyed') ??
    allBuildings(w).find(b => b.typeId === 'office' && b.ownerGangId === gang.id && b.state !== 'destroyed');
}

function newVehicle(w: WorldState, key: string, gang: Gang, kind: VehicleId, teamId: ID | null, staffId: ID | null, slot: number): FleetVehicle | undefined {
  const home = homeFor(w, gang);
  if (!home) return undefined; // no premises at all: the car is found when it is first needed (transport.ts)
  const v: FleetVehicle = { kind, gangId: gang.id, teamId, staffId, slot, pos: buildingDoor(w, home),
    driverId: null, occupantIds: [], orderId: null, destination: null, boarding: false, returning: false };
  const garage = garageWithRoom(w, gang.id, buildingDoor(w, home));
  (w.vehicleFleet ??= {})[key] = v;
  if (garage) putInGarage(w, v, garage); else v.pos = garageKerb(w, home, key);
  return v;
}

const teamKey = (t: Team, kind: VehicleId, slot: number) => `team:${t.id}:${kind}:${slot}`;
const cacheKey = (gangId: ID, kind: VehicleId, slot: number) => `cache:${gangId}:${kind}:${slot}`;
export const ownerKeyPrefix = (owner: Team | Gang): string => 'lieutenantId' in owner ? `team:${owner.id}` : `cache:${owner.id}`;

/**
 * One vehicle for every car on the books: a car bought, or one in an old save
 * kept as a count, is delivered to a garage; one that is no longer on any
 * books is gone. Garages that are lost or destroyed leave their cars at the kerb.
 */
export function syncFleet(w: WorldState): void {
  const expected = new Set<string>();
  const missing: [string, Gang, VehicleId, ID | null, ID | null, number][] = [];
  const want = (key: string, gang: Gang, kind: VehicleId, teamId: ID | null, staffId: ID | null, slot: number) => {
    expected.add(key);
    if (!w.vehicleFleet?.[key]) missing.push([key, gang, kind, teamId, staffId, slot]);
  };
  for (const gang of Object.values(w.gangs)) {
    for (const kind of KINDS) for (let i = 0; i < (gang.vehicles[kind] ?? 0); i++) want(cacheKey(gang.id, kind, i), gang, kind, null, null, i);
    for (const t of Object.values(w.teams)) if (t.gangId === gang.id)
      for (const kind of KINDS) for (let i = 0; i < (t.vehicles[kind] ?? 0); i++) want(teamKey(t, kind, i), gang, kind, t.id, null, i);
    for (const role of ['accountant', 'lawyer'] as const) {
      const kind = gang.staffVehicles?.[role], id = role === 'accountant' ? gang.accountantId : gang.lawyerId;
      const p = id == null ? undefined : w.people[id];
      if (kind && p && p.gangId === gang.id && p.role === role) want(`staff:${p.id}`, gang, kind, null, p.id, 0);
    }
  }
  for (const [key, v] of Object.entries(w.vehicleFleet ?? {})) {
    if (!expected.has(key)) {
      for (const id of v.occupantIds) { const p = w.people[id]; if (p?.vehicleKey === key) { delete p.vehicleKey; p.inVehicle = false; } }
      delete w.vehicleFleet![key];
      continue;
    }
    if (v.garageId != null && (!isGarage(w.buildings[v.garageId], v.gangId) || v.occupantIds.length)) delete v.garageId;
  }
  for (const [key, gang, kind, teamId, staffId, slot] of missing) newVehicle(w, key, gang, kind, teamId, staffId, slot);
  numberFleet(w);
  if (w.vehicleFleet && !Object.keys(w.vehicleFleet).length) delete w.vehicleFleet;
}

/** Give every car without one the next number of its gang and kind. */
function numberFleet(w: WorldState): void {
  const top = new Map<string, number>(), cars = Object.values(w.vehicleFleet ?? {});
  for (const v of cars) if (v.no != null) top.set(`${v.gangId}:${v.kind}`, Math.max(top.get(`${v.gangId}:${v.kind}`) ?? 0, v.no));
  for (const v of cars) if (v.no == null) {
    const k = `${v.gangId}:${v.kind}`, n = (top.get(k) ?? 0) + 1;
    v.no = n; top.set(k, n);
  }
}

/** Re-key a vehicle to a new owner without moving it: the same car, where it stands. */
export function rekeyVehicle(w: WorldState, oldKey: string, newKey: string, owner: { teamId: ID | null; staffId: ID | null; slot: number }): void {
  const v = w.vehicleFleet?.[oldKey];
  if (!v) return;
  delete w.vehicleFleet![oldKey];
  v.teamId = owner.teamId; v.staffId = owner.staffId; v.slot = owner.slot;
  w.vehicleFleet![newKey] = v;
  for (const id of v.occupantIds) if (w.people[id]) w.people[id].vehicleKey = newKey;
  for (const o of Object.values(w.orders)) if (o.exportDelivery?.vehicleKeys)
    o.exportDelivery.vehicleKeys = o.exportDelivery.vehicleKeys.map(k => k === oldKey ? newKey : k);
}

/** A readable name for one car: "Coupe 2" of the crew or the cache. */
export function vehicleLabel(v: FleetVehicle): string {
  return `${VEHICLES[v.kind].name} ${v.no ?? v.slot + 1}`;
}

export interface FleetRow {
  key: string;
  kind: VehicleId;
  name: string;
  /** Who has the keys: a crew, the accountant, the lawyer or the cache. */
  holder: string;
  /** The same holder as a value for the 'Give to' choice: a crew id, or cache / accountant / lawyer. */
  holderKey: string;
  /** Out on a job, carrying goods or with someone aboard: it cannot change hands now. */
  busy: boolean;
  /** Where it is now, as the boss would be told. */
  where: string;
  state: 'garage' | 'parked' | 'driving' | 'boarding' | 'cargo';
  pos: Vec2;
  /** The garage it stands in, if any. */
  garageId: ID | null;
}

/** Every car the gang owns, for the vehicle list: holder first, then kind and number. */
export function fleetRows(w: WorldState, gang: Gang): FleetRow[] {
  const rows: FleetRow[] = [];
  for (const [key, v] of Object.entries(w.vehicleFleet ?? {})) {
    if (v.gangId !== gang.id) continue;
    const team = v.teamId == null ? undefined : w.teams[v.teamId];
    const staff = v.staffId == null ? undefined : w.people[v.staffId];
    const holder = team ? team.name : staff ? (staff.role === 'lawyer' ? 'The lawyer' : 'The accountant') : 'Unassigned';
    const holderKey = team ? String(team.id) : staff ? staff.role : 'cache';
    const busy = !!v.cargo || v.orderId != null || v.occupantIds.length > 0;
    const garage = v.garageId == null ? undefined : w.buildings[v.garageId];
    const driving = v.occupantIds.some(id => w.people[id]?.inVehicle);
    const state: FleetRow['state'] = garage ? 'garage' : v.cargo ? 'cargo' : driving ? 'driving' : v.boarding ? 'boarding' : 'parked';
    const street = streetLocation(w, v.pos);
    const where = garage ? `In the garage at ${placeName(w, garage)}`
      : state === 'cargo' ? `Carrying goods · ${street}`
      : state === 'driving' ? `On the road · ${street}`
      : state === 'boarding' ? `Crew walking to it · ${street}`
      : `Parked · ${street}`;
    rows.push({ key, kind: v.kind, name: vehicleLabel(v), holder, holderKey, busy, where, state, pos: { ...v.pos }, garageId: garage?.id ?? null });
  }
  const order = (r: FleetRow) => r.holder === 'Unassigned' ? 1 : r.holder.startsWith('The ') ? 2 : 0;
  return rows.sort((a, b) => order(a) - order(b) || a.holder.localeCompare(b.holder) ||
    a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export interface GarageGroup {
  id: ID;
  name: string;
  isHQ: boolean;
  door: Vec2;
  cars: FleetRow[];
}

/** The gang's garages (HQ first) with the cars in each, and the cars out in the city. */
export function garageGroups(w: WorldState, gang: Gang): { garages: GarageGroup[]; outside: FleetRow[] } {
  const rows = fleetRows(w, gang);
  const garages = gangGarages(w, gang.id)
    .sort((a, b) => Number(!!b.isHQ) - Number(!!a.isHQ) || Number(b.typeId === 'office') - Number(a.typeId === 'office') || a.id - b.id)
    .map(b => ({ id: b.id, name: placeName(w, b), isHQ: !!b.isHQ, door: buildingDoor(w, b), cars: rows.filter(r => r.garageId === b.id) }));
  return { garages, outside: rows.filter(r => r.garageId == null) };
}
