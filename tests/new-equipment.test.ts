import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { buyVehicle, buyWeapon } from '../src/sim/api';
import { VEHICLES, VEHICLE_ORDER, WEAPONS, WEAPON_ORDER } from '../src/sim/constants';
import { fireRate, originalFireOdds, ORIGINAL_CELL_METRES } from '../src/sim/fireRoll';
import { validateSaveWorld } from '../src/sim/saveSchema';
import { Sim } from '../src/sim/sim';
import { transportPlan } from '../src/sim/transport';
import type { Person } from '../src/sim/types';
import { allocateWeapons } from '../src/sim/weapons';
import { MOTORCYCLE_SEAT, VEHICLE_PROFILE, vehicleGeometry } from '../src/render/vehicles';
import { longGun } from '../src/render/weaponHandling';
import { staffFirstCrew } from './helpers/crew';

function game() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startHoods: 10, startMoney: 200000 });
  staffFirstCrew(sim);
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  return { sim, w, gang, team };
}

describe('the B.A.R.', () => {
  const shooter = { role: 'hood', skills: { firearms: 3, stealth: 3 } } as unknown as Person;
  const anyHit = (hit: number, shots: number) => 1 - (1 - hit) ** shots;

  it('is on sale as a two-round long gun', () => {
    expect(WEAPON_ORDER).toContain('bar');
    expect(WEAPONS.bar.cost).toBeGreaterThan(WEAPONS.tommy.cost);
    expect(fireRate('bar')).toBe(2);
    expect(longGun('bar')).toBe(true);
  });

  it('out-shoots a rifle at every range the rifle reaches', () => {
    for (let band = 0; band < 7; band++) {
      const metres = (band + .5) * ORIGINAL_CELL_METRES;
      const rifle = originalFireOdds(shooter, shooter, 'rifle', metres).hit;
      const bar = anyHit(originalFireOdds(shooter, shooter, 'bar', metres).hit, fireRate('bar'));
      expect(bar, `band ${band}`).toBeGreaterThan(rifle);
    }
  });

  it('can be bought and is handed out before a Tommy gun', () => {
    const { w, gang, team } = game();
    for (const key of WEAPON_ORDER) team.weapons[key] = 0;
    expect(buyWeapon(w, gang.id, 'bar', team.id).ok).toBe(true);
    team.weapons.tommy = 1;
    const loadout = allocateWeapons(w);
    const crew = [team.lieutenantId, ...team.memberIds];
    expect(crew.filter(id => loadout.get(id) === 'bar')).toHaveLength(1);
  });
});

describe('the motorcycle', () => {
  it('is on sale: fastest on the road, one seat', () => {
    expect(VEHICLE_ORDER).toContain('motorcycle');
    expect(VEHICLES.motorcycle.capacity).toBe(1);
    for (const kind of VEHICLE_ORDER) if (kind !== 'motorcycle') expect(VEHICLES.motorcycle.speed).toBeGreaterThan(VEHICLES[kind].speed);
  });

  it('carries one man and leaves the rest of the crew to the cars', () => {
    const { w, gang, team } = game();
    for (const key of VEHICLE_ORDER) team.vehicles[key] = 0;
    expect(buyVehicle(w, gang.id, 'motorcycle', team.id).ok).toBe(true);
    team.vehicles.coupe = 1;
    const people = team.memberIds.slice(0, 3).map(id => w.people[id]);
    const plan = transportPlan(w, team, people, 'extort');
    const bike = plan.cars.find(c => c.kind === 'motorcycle');
    expect(bike?.riders).toHaveLength(1);
    expect(plan.cars.find(c => c.kind === 'coupe')?.riders).toHaveLength(2);
  });

  it('has a model that fits its picking envelope', () => {
    const geometry = vehicleGeometry('motorcycle');
    const box = geometry.boundingBox!, profile = VEHICLE_PROFILE.motorcycle;
    expect(box.min.y).toBeGreaterThanOrEqual(-.01);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(profile.length);
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(profile.width);
    expect(MOTORCYCLE_SEAT.back).toBeLessThan(profile.length / 2);
    geometry.dispose();
  });
});

describe('saves made before the B.A.R. and the motorcycle', () => {
  it('load with none of either in stock', () => {
    const { w } = game();
    const old = JSON.parse(JSON.stringify(w));
    for (const holder of [...Object.values(old.gangs), ...Object.values(old.teams)] as { weapons: Record<string, number>; vehicles: Record<string, number> }[]) {
      delete holder.weapons.bar;
      delete holder.vehicles.motorcycle;
    }
    expect(() => validateSaveWorld(old)).not.toThrow();
    for (const gang of Object.values(old.gangs) as { weapons: Record<string, number>; vehicles: Record<string, number> }[]) {
      expect(gang.weapons.bar).toBe(0);
      expect(gang.vehicles.motorcycle).toBe(0);
    }
  });
});
