import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { bureauGaugesShown } from '../src/app/store';
import { crewsAlreadySent, issueOrder } from '../src/sim/api';
import { MINUTES_PER_DAY, MINUTES_PER_WEEK, ORDERS, clockMinutes } from '../src/sim/constants';
import { isValidAreaTarget } from '../src/sim/execution';
import { knownShopkeeper } from '../src/sim/mapIntel';
import { crewOrderSkill, orderSkill, orderSkillText } from '../src/sim/orderSkills';
import { MINUTES_PER_SECOND, Sim } from '../src/sim/sim';
import { SKILLS, type Person } from '../src/sim/types';
import { allBuildings, buildingDoor, clockLabel, dist } from '../src/sim/world';
import { staffFirstCrew } from './helpers/crew';

describe('issue 17 items 3 and 3.1: the Bureau gauges are chosen with the game', () => {
  it('leaves them off in a new game, and keeps what a game was set up with', () => {
    expect(defaultGameOptions().bureauGauges).toBe(false);
    expect(newCampaignOptions().bureauGauges).toBe(false);
    expect(bureauGaugesShown({ ...defaultGameOptions(), bureauGauges: true })).toBe(true);
    expect(bureauGaugesShown({ ...defaultGameOptions(), bureauGauges: false })).toBe(false);
    // A game begun before the choice existed keeps the old switch, which showed them.
    const old = defaultGameOptions();
    delete old.bureauGauges;
    expect(bureauGaugesShown(old)).toBe(true);
  });
});

describe('issue 17 item 14, playtest 21 November: the clock shows the whole day and night', () => {
  it('runs from 8 am round to 8 am over the same working day', () => {
    expect(clockMinutes(MINUTES_PER_DAY)).toBe(24 * 60);
    expect(clockLabel(0)).toBe('Monday 8:00am');
    expect(clockLabel(MINUTES_PER_DAY / 6)).toBe('Monday 12:00pm');
    expect(clockLabel(MINUTES_PER_DAY / 2)).toBe('Monday 8:00pm');
    // Past midnight it is the next day's small hours.
    expect(clockLabel(MINUTES_PER_DAY * 2 / 3)).toBe('Tuesday 12:00am');
    expect(clockLabel(MINUTES_PER_DAY - 1)).toBe('Tuesday 7:57am');
    expect(clockLabel(MINUTES_PER_DAY)).toBe('Tuesday 8:00am');
    // The week itself is no longer or shorter than it was.
    expect(MINUTES_PER_WEEK).toBe(2400);
  });
});

describe('issue 17 item 28: the skill an order is done with', () => {
  const skilled = (p: Person, over: Partial<Person['skills']>): Person =>
    ({ ...p, skills: { ...Object.fromEntries(SKILLS.map(k => [k, 1])) as Person['skills'], ...over } });
  const hood = () => Object.values(new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 }).world.people).find(q => q.role === 'hood')!;

  it('names the skills the report asked for', () => {
    const skills = (type: keyof typeof ORDERS) => [ORDERS[type].skills, ORDERS[type].armedSkills];
    expect(skills('intimidate')).toEqual([['intimidation', 'fists'], undefined]);
    expect(skills('extort')).toEqual([['intimidation'], undefined]);
    expect(skills('raid')).toEqual([['fists'], ['firearms']]);
    expect(skills('kidnap')).toEqual([['intimidation', 'fists'], ['intimidation', 'firearms']]);
    expect(skills('smashUp')).toEqual([['fists'], undefined]);
    expect(skills('assault')).toEqual([['fists'], undefined]);
    expect(skills('torch')).toEqual([['arson'], undefined]);
    expect(skills('bomb')).toEqual([['explosives'], undefined]);
    expect(skills('kill')).toEqual([['knives'], ['firearms']]);
    expect(skills('ambush')).toEqual([['fists'], ['firearms']]);
    expect(orderSkillText(ORDERS.raid)).toBe('Fists, or Firearms with a gun');
    expect(orderSkillText(ORDERS.torch)).toBe('Arson');
  });

  it('lets a man with a gun use it, and leaves a man without one his fists or knife', () => {
    const p = hood();
    const gunman = skilled(p, { firearms: 5 }), brawler = skilled(p, { fists: 4 });
    // Unarmed, a crack shot raids on his fists; armed, on his shooting.
    expect(orderSkill(gunman, ORDERS.raid, false)).toBe(1);
    expect(orderSkill(gunman, ORDERS.raid, true)).toBe(5);
    // A gun does not make a brawler worse: he does the job the way he is better at.
    expect(orderSkill(brawler, ORDERS.raid, true)).toBe(4);
    expect(orderSkill(skilled(p, { knives: 4, firearms: 2 }), ORDERS.kill, true)).toBe(4);
    // Stealth and intelligence no longer move a smash-up, a fire or a bomb.
    for (const type of ['smashUp', 'torch', 'bomb'] as const)
      expect(orderSkill(skilled(p, { stealth: 5, intelligence: 5 }), ORDERS[type], true)).toBe(1);
    // The crew goes by who is armed, man by man.
    expect(crewOrderSkill([gunman, brawler], ORDERS.raid, q => q === gunman)).toBeCloseTo(5 * .7 + 4.5 * .3);
    expect(crewOrderSkill([gunman, brawler], ORDERS.raid, () => false)).toBeCloseTo(4 * .7 + 2.5 * .3);
  });
});

describe('issue 17 items 30 and 31: backup crews, and what a refusal teaches', () => {
  const fixture = (seed = 404) => {
    const sim = new Sim({ ...defaultGameOptions(), seed, citySize: 10, startMoney: 100_000, startHoods: 8 });
    staffFirstCrew(sim);
    const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
    w.orders = {};
    for (const t of Object.values(w.teams)) { t.orderIds = []; t.timeUsed = 0; }
    return { sim, w, gang, team };
  };
  const runWeek = (sim: Sim, done: () => boolean) => {
    sim.launchWeek();
    for (let i = 0; i < MINUTES_PER_WEEK && sim.world.phase === 'week' && !done(); i++) sim.advance(1 / MINUTES_PER_SECOND, 1);
  };

  it('lets a second crew be sent to raid the same place, says so, and has it stand down once the job is done', () => {
    const { sim, w, gang, team } = fixture(406); // a city where the first crew's raid comes off (its odds are about 82%)
    const door = buildingDoor(w, allBuildings(w).find(b => b.isHQ && b.ownerGangId === gang.id)!);
    const shop = allBuildings(w).filter(b => b.ownerGangId == null && b.cls === 'commercial' && b.state === 'trading')
      .sort((a, b) => dist(buildingDoor(w, a), door) - dist(buildingDoor(w, b), door))[0];
    // Certain of the job: the first crew will not fail.
    for (const id of [team.lieutenantId, ...team.memberIds]) for (const k of SKILLS) w.people[id].skills[k] = 5;
    const send = () => issueOrder(w, gang.id, { teamId: team.id, type: 'raid', buildingIds: [shop.id], opts: { manpower: 1 } });
    expect(send().ok).toBe(true);
    expect(crewsAlreadySent(w, gang.id, 'raid', { buildingId: shop.id })).toEqual([{ crew: team.name, men: 1 }]);
    expect(send().ok).toBe(true);
    const raids = Object.values(w.orders).filter(o => o.gangId === gang.id && o.type === 'raid');
    expect(raids).toHaveLength(2);
    runWeek(sim, () => raids.every(o => o.state === 'done' || o.state === 'failed'));
    const lines = raids.flatMap(o => o.results);
    // One haul, not two: whichever crew came second found the job done.
    expect(lines.filter(l => l.startsWith('Raided ')).length, lines.join(' | ')).toBe(1);
    expect(lines.some(l => /already done the job/.test(l)), lines.join(' | ')).toBe(true);
    expect(raids.map(o => o.state)).toEqual(['done', 'done']);
  }, 300_000);

  it('learns whose place it is from an owner who refuses to pay', () => {
    const { sim, w, gang, team } = fixture();
    // Men no shopkeeper is afraid of, and shopkeepers who cannot stand them.
    for (const id of [team.lieutenantId, ...team.memberIds]) for (const k of SKILLS) w.people[id].skills[k] = .5;
    const door = buildingDoor(w, allBuildings(w).find(b => b.isHQ && b.ownerGangId === gang.id)!);
    const shops = allBuildings(w).filter(b => isValidAreaTarget(w, gang.id, 'extort', b) && b.ownerPersonId != null && !(b.knowledge[gang.id] >= 2))
      .sort((a, b) => dist(buildingDoor(w, a), door) - dist(buildingDoor(w, b), door)).slice(0, 4);
    for (const b of shops) { w.people[b.ownerPersonId!].opinion[gang.id] = -100; expect(knownShopkeeper(w, b, gang.id)).toBeNull(); }
    expect(issueOrder(w, gang.id, { teamId: team.id, type: 'extort', buildingIds: shops.map(b => b.id), opts: { manpower: 1 } }).ok).toBe(true);
    const order = Object.values(w.orders).find(o => o.gangId === gang.id && o.type === 'extort')!;
    runWeek(sim, () => order.state === 'done' || order.state === 'failed');
    expect(order.refusals?.length ?? 0, order.results.join(' | ')).toBeGreaterThan(0);
    for (const { buildingId } of order.refusals!) {
      const b = w.buildings[buildingId];
      expect(b.protection).toBeNull();
      expect(b.knowledge[gang.id]).toBeGreaterThanOrEqual(2);
      expect(knownShopkeeper(w, b, gang.id)?.id).toBe(b.ownerPersonId);
    }
  }, 300_000);
});
