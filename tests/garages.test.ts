import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { assignStaffVehicle, assignVehicle, buyVehicle, issueOrder, sellFleetVehicle, sellVehicle, transferVehicle } from '../src/sim/api';
import { tickOrders } from '../src/sim/execution';
import { GARAGE_CAPACITY, garageGroups, garagedVehicles, isGarage } from '../src/sim/garages';
import { resetWeekTransport } from '../src/sim/transport';
import { buildingDoor, dist } from '../src/sim/world';
import { staffFirstCrew } from './helpers/crew';

/** Cars always in the world, kept in garages (playtest, 26 November). */
function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startHoods: 10, startMoney: 500000 });
  staffFirstCrew(sim);
  const w = sim.world, g = sim.playerGang, t = w.teams[g.teamIds[0]];
  w.orders = {}; for (const team of Object.values(w.teams)) { team.orderIds = []; team.timeUsed = 0; }
  for (const p of t.memberIds.map(id => w.people[id])) p.skills.driving = 3;
  const hq = Object.values(w.buildings).find(b => b.isHQ && b.ownerGangId === g.id)!;
  return { sim, w, g, t, hq };
}
const fleetOf = (s: ReturnType<typeof fixture>) => Object.values(s.w.vehicleFleet ?? {}).filter(v => v.gangId === s.g.id);
const owned = (s: ReturnType<typeof fixture>) =>
  Object.values(s.g.vehicles).reduce((a, b) => a + b, 0) +
  s.g.teamIds.reduce((n, id) => n + Object.values(s.w.teams[id].vehicles).reduce((a, b) => a + b, 0), 0) +
  (s.g.staffVehicles?.accountant ? 1 : 0) + (s.g.staffVehicles?.lawyer ? 1 : 0);

describe('garages', () => {
  it('starts every gang with its cars as vehicles in its own garages', () => {
    const s = fixture();
    for (const gang of Object.values(s.w.gangs)) {
      const cars = Object.values(s.w.vehicleFleet ?? {}).filter(v => v.gangId === gang.id);
      const books = gang.teamIds.reduce((n, id) => n + Object.values(s.w.teams[id].vehicles).reduce((a, b) => a + b, 0), 0) +
        Object.values(gang.vehicles).reduce((a, b) => a + b, 0);
      expect(cars).toHaveLength(books);
      for (const v of cars) expect(isGarage(s.w.buildings[v.garageId!], gang.id)).toBe(true);
    }
  });

  it('keeps six to a garage and leaves the rest at the kerb or in another garage', () => {
    const s = fixture();
    for (let i = 0; i < 9; i++) expect(buyVehicle(s.w, s.g.id, 'coupe').ok).toBe(true);
    expect(fleetOf(s)).toHaveLength(owned(s));
    expect(garagedVehicles(s.w, s.hq.id)).toHaveLength(GARAGE_CAPACITY);
    for (const b of Object.values(s.w.buildings)) expect(garagedVehicles(s.w, b.id).length).toBeLessThanOrEqual(GARAGE_CAPACITY);
    const outside = fleetOf(s).filter(v => v.garageId == null);
    for (const v of outside) expect(dist(v.pos, buildingDoor(s.w, s.hq))).toBeLessThan(60);
  });

  it('hands over the same car, where it stands, between the cache, a crew and the lawyer', () => {
    const s = fixture();
    expect(buyVehicle(s.w, s.g.id, 'speedster').ok).toBe(true);
    const car = fleetOf(s).find(v => v.kind === 'speedster')!;
    car.pos = { ...car.pos, x: car.pos.x + 1 };
    expect(transferVehicle(s.w, s.g.id, 'speedster', s.t.id, true).ok).toBe(true);
    expect(s.w.vehicleFleet![`team:${s.t.id}:speedster:0`]).toBe(car);
    expect(transferVehicle(s.w, s.g.id, 'speedster', s.t.id, false).ok).toBe(true);
    expect(s.w.vehicleFleet![`cache:${s.g.id}:speedster:0`]).toBe(car);
    if (s.g.lawyerId != null) {
      expect(assignStaffVehicle(s.w, s.g.id, 'lawyer', 'speedster').ok).toBe(true);
      expect(s.w.vehicleFleet![`staff:${s.g.lawyerId}`]).toBe(car);
      expect(assignStaffVehicle(s.w, s.g.id, 'lawyer', null).ok).toBe(true);
      expect(s.w.vehicleFleet![`cache:${s.g.id}:speedster:0`]).toBe(car);
    }
    expect(sellVehicle(s.w, s.g.id, 'speedster').ok).toBe(true);
    expect(Object.values(s.w.vehicleFleet ?? {})).not.toContain(car);
    expect(fleetOf(s)).toHaveLength(owned(s));
  });

  it('takes a car out of the garage for a job, and the weekend keeps it in the world', () => {
    const s = fixture();
    s.t.vehicles = { coupe: 1, truck: 0, speedster: 0, motorcycle: 0 };
    s.sim.launchWeek();
    const key = `team:${s.t.id}:coupe:0`;
    const car = s.w.vehicleFleet![key];
    expect(car.garageId).toBeDefined();
    const target = Object.values(s.w.buildings).find(b => b.ownerGangId == null && b.cls === 'commercial' &&
      dist(buildingDoor(s.w, b), buildingDoor(s.w, s.hq)) > 220)!;
    expect(issueOrder(s.w, s.g.id, { teamId: s.t.id, type: 'extort', buildingIds: [target.id], opts: { manpower: 2, priority: true } }).ok).toBe(true);
    s.w.orders[s.t.orderIds[0]].state = 'queued';
    s.sim.launchWeek();
    for (let i = 0; i < 5 && car.orderId == null; i++) { s.w.minute++; tickOrders(s.w, s.sim.rng, 1); }
    expect(car.orderId).not.toBeNull();
    expect(car.garageId).toBeUndefined();
    // Out on the street at the end of the week: still a car next week, and home in its garage.
    resetWeekTransport(s.w);
    expect(s.w.vehicleFleet![key]).toBe(car);
    expect(isGarage(s.w.buildings[car.garageId!], s.g.id)).toBe(true);
  });

  it('gives one particular car to a crew, the cache or the lawyer, keeping the books in step', () => {
    const s = fixture();
    for (let i = 0; i < 3; i++) expect(buyVehicle(s.w, s.g.id, 'coupe').ok).toBe(true);
    const cacheCars = () => Object.entries(s.w.vehicleFleet!).filter(([k]) => k.startsWith(`cache:${s.g.id}:coupe:`));
    const [key, car] = cacheCars()[0];
    const crewBefore = s.t.vehicles.coupe, cacheBefore = s.g.vehicles.coupe;
    expect(assignVehicle(s.w, s.g.id, key, { teamId: s.t.id }).ok).toBe(true);
    expect(s.t.vehicles.coupe).toBe(crewBefore + 1);
    expect(s.g.vehicles.coupe).toBe(cacheBefore - 1);
    expect(car.teamId).toBe(s.t.id);
    expect(s.w.vehicleFleet![`team:${s.t.id}:coupe:${crewBefore}`]).toBe(car);
    // The cache's other cars keep dense keys, and nothing was lost or doubled.
    expect(cacheCars().map(([k]) => k).sort()).toEqual(Array.from({ length: cacheBefore - 1 }, (_, i) => `cache:${s.g.id}:coupe:${i}`).sort());
    expect(fleetOf(s)).toHaveLength(owned(s));
    if (s.g.lawyerId != null) {
      const crewKey = Object.entries(s.w.vehicleFleet!).find(([, v]) => v === car)![0];
      expect(assignVehicle(s.w, s.g.id, crewKey, 'lawyer').ok).toBe(true);
      expect(s.w.vehicleFleet![`staff:${s.g.lawyerId}`]).toBe(car);
      expect(s.g.staffVehicles?.lawyer).toBe('coupe');
      expect(s.t.vehicles.coupe).toBe(crewBefore);
      expect(fleetOf(s)).toHaveLength(owned(s));
    }
    const nowKey = Object.entries(s.w.vehicleFleet!).find(([, v]) => v === car)![0];
    expect(assignVehicle(s.w, s.g.id, nowKey, 'cache').ok).toBe(true);
    expect(car.teamId).toBeNull(); expect(car.staffId).toBeNull();
    expect(fleetOf(s)).toHaveLength(owned(s));
    // A car out on a job cannot change hands.
    car.orderId = 999;
    expect(assignVehicle(s.w, s.g.id, Object.entries(s.w.vehicleFleet!).find(([, v]) => v === car)![0], { teamId: s.t.id }).ok).toBe(false);
  });

  it('swaps a crew\'s far car for a nearer unassigned one of the same kind', () => {
    const s = fixture();
    s.t.vehicles = { coupe: 1, truck: 0, speedster: 0, motorcycle: 0 };
    s.g.vehicles = { coupe: 0, truck: 0, speedster: 0, motorcycle: 0 };
    expect(buyVehicle(s.w, s.g.id, 'coupe').ok).toBe(true); // unassigned, in the HQ garage
    s.sim.launchWeek();
    const own = s.w.vehicleFleet![`team:${s.t.id}:coupe:0`], near = s.w.vehicleFleet![`cache:${s.g.id}:coupe:0`];
    expect(near.garageId).toBe(s.hq.id);
    // The crew's own car was left across town.
    const far = Object.values(s.w.buildings).sort((a, b) => dist(buildingDoor(s.w, b), buildingDoor(s.w, s.hq)) - dist(buildingDoor(s.w, a), buildingDoor(s.w, s.hq)))[0];
    delete own.garageId; own.pos = { ...buildingDoor(s.w, far) };
    const target = Object.values(s.w.buildings).find(b => b.ownerGangId == null && b.cls === 'commercial' &&
      dist(buildingDoor(s.w, b), buildingDoor(s.w, s.hq)) > 220 && dist(buildingDoor(s.w, b), own.pos) > 220)!;
    expect(issueOrder(s.w, s.g.id, { teamId: s.t.id, type: 'extort', buildingIds: [target.id], opts: { manpower: 2, priority: true } }).ok).toBe(true);
    const order = s.w.orders[s.t.orderIds.at(-1)!];
    order.state = 'queued';
    s.sim.launchWeek();
    for (let i = 0; i < 5 && near.orderId == null; i++) { s.w.minute++; tickOrders(s.w, s.sim.rng, 1); }
    expect(s.w.vehicleFleet![`team:${s.t.id}:coupe:0`]).toBe(near);
    expect(s.w.vehicleFleet![`cache:${s.g.id}:coupe:0`]).toBe(own);
    expect(near.orderId).toBe(order.id);
    expect(own.teamId).toBeNull();
    expect(order.results.join(' ')).toMatch(/now unassigned/);
  });

  it('sells only cars standing in a garage', () => {
    const s = fixture();
    s.g.vehicles = { coupe: 0, truck: 0, speedster: 0, motorcycle: 0 };
    expect(buyVehicle(s.w, s.g.id, 'truck').ok).toBe(true);
    const key = `cache:${s.g.id}:truck:0`, truck = s.w.vehicleFleet![key];
    expect(truck.garageId).toBe(s.hq.id);
    delete truck.garageId; // left out at the kerb
    const cash = s.g.cash;
    expect(sellVehicle(s.w, s.g.id, 'truck').ok).toBe(false);
    expect(sellFleetVehicle(s.w, s.g.id, key).ok).toBe(false);
    expect(s.g.vehicles.truck).toBe(1);
    truck.garageId = s.hq.id;
    expect(sellFleetVehicle(s.w, s.g.id, key).ok).toBe(true);
    expect(s.g.vehicles.truck).toBe(0);
    expect(s.w.vehicleFleet?.[key]).toBeUndefined();
    expect(s.g.cash).toBeGreaterThan(cash);
    const groups = garageGroups(s.w, s.g);
    expect(groups.garages[0].isHQ).toBe(true);
    expect(groups.garages.reduce((n, g) => n + g.cars.length, 0) + groups.outside.length).toBe(fleetOf(s).length);
  });

  it('turns an old save\'s counted cars into vehicles in the garage on loading', () => {
    const s = fixture();
    s.t.vehicles.truck = 2;
    const save = JSON.parse(JSON.stringify(s.w));
    delete save.vehicleFleet;
    const loaded = Sim.fromSave(save);
    const trucks = Object.values(loaded.world.vehicleFleet ?? {}).filter(v => v.teamId === s.t.id && v.kind === 'truck');
    expect(trucks).toHaveLength(2);
    for (const v of trucks) expect(v.garageId).toBeDefined();
  });
});
