import { useEffect, useRef, useState } from 'react';
import { act, useGame } from '../../app/store';
import {
  assignVehicle,
  equipWeapon,
  passWeapon,
  unequipWeapon,
  sellGun,
  sellFleetVehicle,
  buyVehicle,
  buyWeapon,
  hireRecruit,
  killMember,
  moveToPool,
  outOfReach,
  moveToTeam,
  promote,
  sackPerson,
  sellVehicle,
  setPay,
  transferVehicle,
  type VehicleHolder,
} from '../../sim/api';
import { availableSpecialist } from '../../sim/specialists';
import { GANG_COLORS, ORDERS, ORDER_GROUPS, VEHICLES, VEHICLE_ORDER, WEAPONS, WEAPON_ORDER, clockMinutes, type OrderDef } from '../../sim/constants';
import { SKILLS, SKILL_LABELS, type Building, type Gang, type ID, type OrderType, type Person, type Skill, type VehicleId, type WeaponId, type WorldState } from '../../sim/types';
import { buildingName, money, placeName } from '../../sim/world';
import { orderSkillText } from '../../sim/orderSkills';
import { buildingMapIntel } from '../../sim/mapIntel';
import { ConfirmDialog, Empty, Hint, Icon, Kicker, Rivets, SkillList, Stamp, Stars } from '../common';

/** Roles that have an engraved glyph of their own. */
const ROLE_ICON = new Set(['police', 'policeChief', 'fbi', 'fbiHead', 'judge', 'da', 'mayor', 'reporter', 'clergy', 'snitch', 'accountant', 'lawyer', 'citizen']);
import { Portrait } from '../Portrait';
import { RECRUIT_TABS, STAFF_SKILLS, isStaffRole, recruitsOnTab, staffHireLabel, type RecruitTabId } from './recruitTabs';
import { handleMapHit } from '../mapClick';
import { selectableOrderPerson, selectableOrderSite, selectedOrderSites } from '../../app/orderSelection';
import { resourceDragProps, useResourceDrop } from '../resourceDrag';

import { inCustody } from '../../sim/prison';
import { hoursLabel, hoursOf, openNow } from '../../sim/cityHours';
import { buildingList } from '../../sim/entityLists';
import { GARAGE_CAPACITY, garageGroups, type FleetRow } from '../../sim/garages';
import { GUN_SLOTS, SLOT_LABEL, armouryGroups, slotOf, type ArmouryGroup, type GunSlot, type RackRow } from '../../sim/armoury';
/** A length of crew time as the clock counts it (a twelve-hour day: constants.ts clockMinutes). */
export function hours(simMinutes: number): string {
  const minutes = clockMinutes(simMinutes);
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = minutes / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

/** What an order promises in time: per site, or the whole week. */
export function orderCost(def: OrderDef): string {
  if (def.wholeWeek) return 'all week';
  const per = def.target === 'area' || def.target === 'building' ? ' / site' : '';
  let s = `~${hours(def.minutesPerTarget)}${per}`;
  if (def.supportsRepeat) s += ' · repeats';
  return s;
}

export const ABSENT: Record<string, string> = {
  arrested: 'Arrested',
  onTrial: 'On trial',
  jailed: 'In prison',
  kidnapped: 'Kidnapped',
  dead: 'Dead',
};

/**
 * The original's money roll: how much this person is paid, how much you have,
 * and buttons to turn it either way.
 */
export function PayRoll({ person, onClose }: { person: Person; onClose?: () => void }) {
  const sim = useGame((s) => s.sim)!;
  const notify = useGame((s) => s.notify);
  useGame((s) => s.version);
  const step = Math.max(5, Math.round(person.payDemand * 0.08));
  return (
    <div className="pay-roll">
      <div style={{ flex: 1 }}>
        Paying <b>{money(person.pay)}</b> a week
        <div className="tiny muted">
          wants {money(person.payDemand)} · {money(sim.playerGang.cash)} in the safe
        </div>
      </div>
      <button className="btn sm" title="Decrease pay — they will not thank you" onClick={() => notify(act((s) => setPay(s.world, person.id, person.pay - step))!)}>
        −
      </button>
      <button className="btn sm" title="Increase pay" onClick={() => notify(act((s) => setPay(s.world, person.id, person.pay + step))!)}>
        +
      </button>
      {person.pay < person.payDemand && (
        <button className="btn sm brass" onClick={() => notify(act((s) => setPay(s.world, person.id, person.payDemand))!)}>
          Meet
        </button>
      )}
      {onClose && (
        <button className="btn sm quiet" onClick={onClose}>
          Done
        </button>
      )}
    </div>
  );
}

/**
 * The original's Right Panel: whatever the page needs beside it — the orders
 * of one group, the hoods' pool, the black market, the motor cars, the people
 * willing to work, one hood's skills, or the clipboard.
 */
export function RightSheet() {
  const sim = useGame((s) => s.sim)!;
  const sheet = useGame((s) => s.sheet);
  const setSheet = useGame((s) => s.setSheet);
  const jobCard = useGame((s) => s.jobCard);
  const selectedTeamId = useGame((s) => s.selectedTeamId);
  useGame((s) => s.version);

  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sheet) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [sheet]);
  if (!sheet) return null;
  const w = sim.world;
  const gang = sim.playerGang;
  const team = (selectedTeamId != null ? w.teams[selectedTeamId] : undefined) ?? w.teams[gang.teamIds[0]];

  let title = '';
  let kicker = 'Right panel';
  let body: React.ReactNode = null;

  switch (sheet.kind) {
    case 'orders': {
      const group = ORDER_GROUPS.find((g) => g.id === sheet.group);
      title = group?.name ?? 'Orders';
      kicker = team ? `Orders for ${w.people[team.lieutenantId]?.name ?? team.name}` : 'Orders';
      body = <OrderListSheet group={sheet.group} teamId={team?.id ?? null} />;
      break;
    }
    case 'hoods':
      title = 'The Pool';
      kicker = 'Resource details · hoods';
      body = <PoolSheet teamId={team?.id} />;
      break;
    case 'prison':
      title = 'Prison';
      kicker = 'Resource details · held by the law';
      body = <PrisonSheet />;
      break;
    case 'businesses':
      title = 'Businesses';
      kicker = 'Resource details · the rackets and the fronts';
      body = <BusinessesSheet />;
      break;
    case 'weapons':
      title = 'Weapons';
      kicker = 'Resource details · black market';
      body = team ? <WeaponsSheet teamId={team.id} /> : <Empty>Promote a lieutenant first.</Empty>;
      break;
    case 'vehicles':
      title = 'Motor Cars';
      kicker = 'Resource details · vehicles';
      body = team ? <VehiclesSheet teamId={team.id} /> : <Empty>Promote a lieutenant first.</Empty>;
      break;
    case 'recruits':
      title = 'Recruitment';
      kicker = 'Character selection · willing to work';
      body = <RecruitsSheet teamId={team?.id ?? null} />;
      break;
    case 'person': {
      const p = w.people[sheet.id];
      if (!p) return null;
      title = p.name;
      kicker = 'Skill panel';
      body = <PersonSheet person={p} teamId={team?.id} />;
      break;
    }
    case 'clipboard':
      title = 'Clipboard';
      kicker = jobCard ? 'Pick a target for the job card' : 'People and places you know';
      body = <ClipboardSheet />;
      break;
  }

  return (
    <div ref={panel} role="region" aria-label={title} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setSheet(null); } }} className="brass right-sheet">
      <div className="paper">
        <Rivets />
        <div className="brass-face rs-head">
          <div>
            <Kicker className="dark">{kicker}</Kicker>
            <h4>{title}</h4>
          </div>
          <button className="sheet-close" onClick={() => setSheet(null)} aria-label="Close">
            ×
          </button>
        </div>
        <div className="rs-body">{body}</div>
      </div>
    </div>
  );
}

/** The tabs over the right-hand window: the city plan, or one of the gang's resources. */
const RESOURCE_TABS = [
  { id: 'map', label: 'City Map', icon: 'tabs/maps', key: '' },
  { id: 'hoods', label: 'Hoods', icon: 'groups/personnel', key: 'H' },
  { id: 'prison', label: 'Prison', icon: 'status/jailed', key: '' },
  { id: 'businesses', label: 'Businesses', icon: 'groups/business', key: '' },
  { id: 'weapons', label: 'Weapons', icon: 'weapons/pistol', key: 'W' },
  { id: 'vehicles', label: 'Vehicles', icon: 'vehicles/coupe', key: 'V' },
  { id: 'recruits', label: 'Recruitment', icon: 'orders/recruit', key: '' },
] as const;
type ResourceTabId = (typeof RESOURCE_TABS)[number]['id'];

/**
 * The right-hand window of the planning desk: a row of tabs that switches
 * between the city plan (drawn behind, showing through) and the resource sheets.
 */
export function ResourceWindow() {
  const sim = useGame((s) => s.sim)!;
  const sheet = useGame((s) => s.sheet);
  const setSheet = useGame((s) => s.setSheet);
  const setPlanningView = useGame((s) => s.setPlanningView);
  useGame((s) => s.version);
  const gang = sim.playerGang;
  // Other sheets (orders, a person, the clipboard) open here too, with no tab of their own.
  const active: ResourceTabId | null = !sheet ? 'map' : RESOURCE_TABS.some((t) => t.id === sheet.kind) ? (sheet.kind as ResourceTabId) : null;
  const open = (id: ResourceTabId) => {
    if (id === 'map') { setSheet(null); setPlanningView('plan'); }
    else setSheet({ kind: id });
  };
  const count = (id: ResourceTabId) => id === 'hoods' ? ` · ${gang.poolIds.filter((pid) => !inCustody(sim.world.people[pid])).length}` : id === 'recruits' ? ` · ${gang.recruitIds.length}`
    : id === 'prison' ? (n => n ? ` · ${n}` : '')(prisoners(sim.world, gang).length)
    : id === 'businesses' ? (n => n ? ` · ${n}` : '')(gangBusinesses(sim.world, gang).length) : '';
  return (
    <div className="resource-window">
      <div className="resource-tabs" role="tablist" aria-label="Map and resources">
        {RESOURCE_TABS.map((t, i) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} tabIndex={active === t.id || (active == null && i === 0) ? 0 : -1}
            className={`jtab${active === t.id ? ' on' : ''}`} title={t.key ? `${t.label} (${t.key})` : t.label}
            onClick={() => open(t.id)}
            onKeyDown={(e) => {
              const next = e.key === 'ArrowRight' ? (i + 1) % RESOURCE_TABS.length : e.key === 'ArrowLeft' ? (i + RESOURCE_TABS.length - 1) % RESOURCE_TABS.length : -1;
              if (next < 0) return;
              e.preventDefault();
              open(RESOURCE_TABS[next].id);
              (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
            }}>
            <span className="label"><Icon name={t.icon} size={14} /> {t.label}{count(t.id)}</span>
          </button>
        ))}
      </div>
      <RightSheet />
    </div>
  );
}

/** Promote a hood, then open the Lieutenants page on his new crew's tab,
 * keeping the Hoods tab open beside it to staff the crew. */
function promoteAndShow(personId: ID): boolean {
  const { notify, selectTeam, setTab, setSheet } = useGame.getState();
  const result = act((s) => promote(s.world, s.playerGang.id, personId));
  if (!result) return false;
  notify(result);
  if (!result.ok) return false;
  const teamId = useGame.getState().sim?.world.people[personId]?.teamId;
  // Changing page closes the right-hand sheet, so the Hoods tab is reopened after.
  if (teamId != null) { selectTeam(teamId); setTab('lieutenants'); }
  setSheet({ kind: 'hoods' });
  return true;
}

// ---------------------------------------------------------------- sheets

function OrderListSheet({ group, teamId }: { group: OrderDef['group']; teamId: ID | null }) {
  const beginOrder = useGame((s) => s.beginOrder);
  const notify = useGame((s) => s.notify);
  const list = Object.values(ORDERS).filter((o) => o.group === group);
  return (
    <>
      {list.map((o) => (
        <button
          key={o.type}
          className="order-row"
          onClick={() => {
            if (teamId == null) {
              notify('Promote a lieutenant before giving orders.');
              return;
            }
            beginOrder(o.type as OrderType, teamId);
          }}
        >
          <span className={`order-ico tone-${o.group}`}>
            <Icon name={`orders/${o.type}`} size={26} />
          </span>
          <span className="order-text">
            <b>{o.name}</b>
            <span className="cost">{orderCost(o)}</span>
            {orderSkillText(o) && <span className="order-skill">Skill used: {orderSkillText(o)}</span>}
            <span className="desc">{o.desc}</span>
          </span>
        </button>
      ))}
    </>
  );
}

function PoolSheet({ teamId }: { teamId?: ID }) {
  const sim = useGame((s) => s.sim)!;
  const notify = useGame((s) => s.notify);
  const setSheet = useGame((s) => s.setSheet);
  const [sortBy, setSortBy] = useState<keyof Person['skills']>('intelligence');
  const [dropProps, dropOver] = useResourceDrop({ kind: 'pool' });
  const w = sim.world;
  const gang = sim.playerGang;
  // Anyone the law holds is on the Prison tab, not here.
  const pool = gang.poolIds
    .map((id) => w.people[id])
    .filter((p) => p && !inCustody(p))
    .sort((a, b) => b.skills[sortBy] - a.skills[sortBy]);

  return (
    <div {...dropProps} className={`resource-drop${dropOver ? ' drop-over' : ''}`} aria-label="The pool: drag a crew member here to stand him down">
      <div className="row wrap tiny" style={{ gap: 3, marginBottom: 8 }}>
        <span className="muted">Sort:</span>
        {SKILLS.map((k) => (
          <button key={k} aria-pressed={sortBy === k} className={`btn sm${sortBy === k ? ' on' : ''}`} title={`Best at ${SKILL_LABELS[k].toLowerCase()} first`} onClick={() => setSortBy(k)}>
            {k.slice(0, 5)}
          </button>
        ))}
      </div>
      {pool.length === 0 ? (
        <Empty>Nobody is sitting idle.</Empty>
      ) : (
        pool.map((p) => (
          <div key={p.id} className="person-row" {...resourceDragProps({ kind: 'hood', id: p.id })} title="Drag onto a lieutenant to give him this hood">
            <div className="avatar">
              <Portrait person={p} gang={gang} size={34} />
            </div>
            <button className="name" style={{ textAlign: 'left' }} onClick={() => setSheet({ kind: 'person', id: p.id })}>
              {p.name}
            </button>
            <Stars value={p.skills[sortBy]} />
            {teamId != null && (
              <button className="btn sm" onClick={() => notify(act((s) => moveToTeam(s.world, gang.id, p.id, teamId))!)}>
                → Team
              </button>
            )}
            {/* Reachable even with no crews at all — otherwise losing your
                last lieutenant would leave the game unwinnable. */}
            <button className="btn sm" title="Make this hood a lieutenant with a team of his own" onClick={() => promoteAndShow(p.id)}>
              Promote
            </button>
          </div>
        ))
      )}
    </div>
  );
}

/** Everyone of the gang the law holds: hoods (out of their crews), lieutenants, staff, the boss. */
function prisoners(w: WorldState, gang: Gang): Person[] {
  const held = new Set(gang.prisonIds ?? []);
  for (const p of Object.values(w.people) as Person[]) if (p.gangId === gang.id && inCustody(p)) held.add(p.id);
  return [...held].map(id => w.people[id]).filter((p): p is Person => inCustody(p));
}

const ROLE_WORD: Partial<Record<Person['role'], string>> = { boss: 'Boss', lieutenant: 'Lieutenant', hood: 'Hood', accountant: 'Accountant', lawyer: 'Lawyer' };

/** The gang's people in the hands of the law, with how long each has left. */
function PrisonSheet() {
  const sim = useGame((s) => s.sim)!;
  const setSheet = useGame((s) => s.setSheet);
  const w = sim.world, gang = sim.playerGang;
  const held = prisoners(w, gang);
  const order = { jailed: 0, onTrial: 1, arrested: 2 } as Record<string, number>;
  held.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.name.localeCompare(b.name));
  const caseOf = (p: Person) => Object.values(w.cases).find(c => c.defendantId === p.id && (c.status === 'awaiting' || c.status === 'onTrial'));
  const when = (p: Person) => {
    if (p.status === 'jailed') return p.jailWeeks >= 999 ? 'for life' : `${p.jailWeeks} ${p.jailWeeks === 1 ? 'week' : 'weeks'} left`;
    const c = caseOf(p);
    if (c) return `${c.crime}; verdict ${c.weeksToTrial <= 0 ? 'this week' : `in ${c.weeksToTrial} ${c.weeksToTrial === 1 ? 'week' : 'weeks'}`}`;
    return 'held for questioning';
  };
  return (
    <div>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        Hoods held by the law leave their crews and wait here; when they are released they come back to the pool. A lieutenant taken hands his crew to its first free hood and comes back as a hood. Your lawyer can work on their cases.
      </p>
      {held.length === 0 ? (
        <Empty>Nobody of yours is behind bars.</Empty>
      ) : (
        held.map((p) => {
          const team = p.teamId != null ? w.teams[p.teamId] : undefined;
          return (
            <div key={p.id} className="person-row">
              <div className="avatar">
                <Portrait person={p} gang={gang} size={34} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <button className="name" style={{ textAlign: 'left' }} onClick={() => setSheet({ kind: 'person', id: p.id })}>
                  {p.name}
                </button>
                <div className="tiny muted">{ROLE_WORD[p.role] ?? p.role}{team && p.role === 'lieutenant' ? ` · ${team.name}` : ''} · {when(p)}</div>
              </div>
              <span className="tag bad" title={ABSENT[p.status] ?? p.status}>
                <Icon name={`status/${p.status}`} size={12} /> {ABSENT[p.status] ?? p.status}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

/** The gang's own businesses: everything it owns that trades or makes goods. */
function gangBusinesses(w: WorldState, gang: Gang): Building[] {
  return buildingList(w).filter(b => b.ownerGangId === gang.id && !b.isHQ && b.cls !== 'empty' && b.cls !== 'residential' && b.state !== 'destroyed'
    && b.typeId !== 'office');
}

const STATE_WORD: Record<Building['state'], string> = { trading: 'Trading', ceased: 'Closed down', damaged: 'Damaged', destroyed: 'Rubble', empty: 'Empty' };

/**
 * Every business the gang owns in one list (playtest, 21 November): what it
 * took last week, its hours and whether it is open now, the manager, the
 * front it hides behind, and the goods in stock. Clicking one shows it.
 */
function BusinessesSheet() {
  const sim = useGame((s) => s.sim)!;
  const selectBuilding = useGame((s) => s.selectBuilding);
  const setSheet = useGame((s) => s.setSheet);
  const w = sim.world, gang = sim.playerGang;
  const list = gangBusinesses(w, gang).sort((a, b) =>
    Number(b.cls === 'illegal') - Number(a.cls === 'illegal') || b.lastProfit - a.lastProfit || a.id - b.id);
  const total = list.reduce((n, b) => n + b.lastProfit, 0);
  return (
    <div className="business-list">
      <p className="tiny muted" style={{ marginTop: 0 }}>
        Last week's takings, after what the managers kept back. Raids on a shut place meet nobody but find a thin till; protection from a shut shop is paid short.
      </p>
      {list.length === 0 ? (
        <Empty>You own no businesses yet. Buy premises and set one up.</Empty>
      ) : (
        <>
          <div className="kv"><span>{list.length} {list.length === 1 ? 'business' : 'businesses'}</span><b style={{ color: total >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(total)} last week</b></div>
          {list.map((b) => {
            const manager = b.managerId != null ? w.people[b.managerId] : undefined;
            const front = b.frontId != null ? w.buildings[b.frontId] : undefined;
            const hrs = hoursOf(b), open = openNow(w, b), allHours = hrs.open === 0 && hrs.close === 24;
            const goods = (['liquor', 'stolen', 'counterfeit'] as const).filter(k => b.stock[k] > 0);
            return (
              <div key={b.id} className="person-row business-row" role="button" tabIndex={0} title={`Inspect ${placeName(w, b)}`}
                onClick={() => { setSheet(null); selectBuilding(b.id); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet(null); selectBuilding(b.id); } }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className="name">{placeName(w, b)}</span>
                  <div className="tiny muted">
                    {manager ? `Run by ${manager.name}` : 'No manager'}
                    {front ? ` · behind ${placeName(w, front)}` : b.cls === 'illegal' ? ' · no front' : ''}
                    {b.cls === 'illegal' && b.discovered ? ' · known to the FBI' : ''}
                  </div>
                  <div className="tiny muted">
                    {b.state === 'trading' ? hoursLabel(hrs) : STATE_WORD[b.state]}
                    {b.state === 'trading' && !allHours && <> · <span style={{ color: open ? 'var(--green)' : 'var(--red)' }}>{open ? 'open now' : 'shut now'}</span></>}
                    {goods.map(k => <span key={k} title={k}> · <Icon name={`goods/${k}`} size={11} /> {b.stock[k]}</span>)}
                  </div>
                </div>
                <b className="business-take" style={{ color: b.lastProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(b.lastProfit)}</b>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/** How many are in the gang's cache and with the selected lieutenant, large enough to read at a glance.
 * Clicking a count moves one away from that side, over to the other. */
function StockCounts({ cache, crew, cost, toCache, toCrew, buy, cacheLabel = 'Cache' }:
  { cache: number; crew: number; cost: number; toCache: () => void; toCrew: () => void; buy: () => void; cacheLabel?: string }) {
  return (
    <div className="stock-counts">
      <button type="button" className="stock" onClick={toCache}
        title={crew ? (cacheLabel === 'Cache' ? 'Click to move one from the lieutenant to the cache' : 'Click to take one from the lieutenant (it becomes unassigned)') : 'The lieutenant has none to send back'}>
        <span className="label">Lieutenant</span><b>{crew}</b>
      </button>
      <button type="button" className="stock" onClick={toCrew}
        title={cache ? (cacheLabel === 'Cache' ? 'Click to move one from the cache to the lieutenant' : 'Click to give an unassigned one to the lieutenant') : (cacheLabel === 'Cache' ? 'None in the cache to hand over' : 'None unassigned to hand over')}>
        <span className="label">{cacheLabel}</span><b>{cache}</b>
      </button>
      <button type="button" className="stock buy" onClick={buy} title="Buy one for the lieutenant">
        <span className="label">Buy</span><b>{money(cost)}</b>
      </button>    </div>
  );
}

function WeaponsSheet({ teamId }: { teamId: ID }) {
  const sim = useGame((s) => s.sim)!;
  const notify = useGame((s) => s.notify);
  const gang = sim.playerGang;
  const team = sim.world.teams[teamId];
  if (!team) return null;
  /** Bought guns go unassigned onto the HQ rack, for any of the gang's men to take. */
  const buy = (id: WeaponId) => notify(act((s) => buyWeapon(s.world, gang.id, id))!);
  return (
    <>
      <Kicker>Buy · delivered to the HQ armoury</Kicker>
      <div className="weapon-buy">
        {WEAPON_ORDER.map((id: WeaponId) => (
          <button key={id} type="button" className="weapon-buy-btn" onClick={() => buy(id)} disabled={gang.cash < WEAPONS[id].cost}
            title={`${WEAPONS[id].name}: ${WEAPONS[id].desc}`}>
            <Icon name={`weapons/${id}`} size={22} />
            <span className="tiny">{WEAPONS[id].name}</span>
            <b className="mono tiny">{money(WEAPONS[id].cost)}</b>
          </button>
        ))}
      </div>
      <ArmouryList />
    </>
  );
}

function VehiclesSheet({ teamId }: { teamId: ID }) {
  const sim = useGame((s) => s.sim)!;
  const notify = useGame((s) => s.notify);
  const gang = sim.playerGang;
  const team = sim.world.teams[teamId];
  if (!team) return null;
  const sell = (id: VehicleId, fromTeam: boolean) => notify(act((s) => sellVehicle(s.world, gang.id, id, fromTeam ? teamId : undefined))!);
  /** A vehicle bought for a crew whose cars already seat every man (lieutenant included) goes into the cache instead. */
  const buyForCrewOrCache = (id: VehicleId) => {
    const crewSize = 1 + team.memberIds.length;
    const seats = VEHICLE_ORDER.reduce((n, k) => n + (team.vehicles[k] ?? 0) * VEHICLES[k].capacity, 0);
    const toCache = seats >= crewSize;
    const result = act((s) => buyVehicle(s.world, gang.id, id, toCache ? undefined : teamId));
    if (!result) return;
    notify(result.ok && toCache ? { ...result, message: `${result.message} The crew already has a seat for every man, so it is unassigned.` } : result);
  };
  return (
    <>
      {VEHICLE_ORDER.map((id: VehicleId) => (
        <div key={id} style={{ padding: '7px 0', borderBottom: '1px dotted var(--dots)' }}
          {...(gang.vehicles[id] ? { ...resourceDragProps({ kind: 'vehicle', id }), title: 'Drag onto a lieutenant to hand over an unassigned one' } : {})}>
          <div className="row between">
            <b style={{ fontWeight: 500 }}>
              <Icon name={`vehicles/${id}`} size={18} /> {VEHICLES[id].name}
            </b>
            <span className="mono">{money(VEHICLES[id].cost)}</span>
          </div>
          <div className="muted" style={{ margin: '2px 0 5px' }}>
            {VEHICLES[id].desc}
            <div className="tiny">Seats {VEHICLES[id].capacity} · cargo {VEHICLES[id].cargo} cases</div>
          </div>
          <StockCounts cache={gang.vehicles[id] ?? 0} crew={team.vehicles[id] ?? 0} cost={VEHICLES[id].cost} cacheLabel="Unassigned"
            toCrew={() => notify(act((s) => transferVehicle(s.world, gang.id, id, teamId, true))!)}
            toCache={() => notify(act((s) => transferVehicle(s.world, gang.id, id, teamId, false))!)}
            buy={() => buyForCrewOrCache(id)} />
          <div className="row wrap" style={{ gap: 4 }}>
            <button className="btn sm" disabled={!team.vehicles[id]} onClick={() => sell(id, true)}>
              Sell from Lieutenant
            </button>
            <button className="btn sm" disabled={!gang.vehicles[id]} onClick={() => sell(id, false)}>
              Sell unassigned
            </button>
          </div>
        </div>
      ))}
      <FleetList />
    </>
  );
}

const FLEET_STATE_LABEL = { garage: 'Garage', parked: 'Parked', driving: 'Driving', boarding: 'Fetching', cargo: 'Loaded' } as const;

/**
 * The gang's garages and the cars in each, then the cars out in the city
 * (playtest, 26 November). Each car can change hands, and a car in a garage
 * can be sold.
 */
function FleetList() {
  const sim = useGame((s) => s.sim)!;
  const requestCamera = useGame((s) => s.requestCamera);
  useGame((s) => s.version);
  const notify = useGame((s) => s.notify);
  const w = sim.world, gang = sim.playerGang;
  const { garages, outside } = garageGroups(w, gang);
  const total = outside.length + garages.reduce((n, g) => n + g.cars.length, 0);
  const crews = gang.teamIds.map(id => w.teams[id]).filter(Boolean);
  const staff = (['accountant', 'lawyer'] as const).filter(role => availableSpecialist(w, gang, role));
  const giveTo = (key: string, value: string) => {
    const to: VehicleHolder = value === 'cache' || value === 'accountant' || value === 'lawyer' ? value : { teamId: Number(value) };
    const result = act((s) => assignVehicle(s.world, gang.id, key, to));
    if (result) notify(result);
  };
  const sell = (key: string) => {
    const result = act((s) => sellFleetVehicle(s.world, gang.id, key));
    if (result) notify(result);
  };
  const row = (r: FleetRow) => (
    <div key={r.key} className="fleet-row">
      <button type="button" className="fleet-show" title="Show it on the map" onClick={() => requestCamera({ ...r.pos })}>
        <Icon name={`vehicles/${r.kind}`} size={18} />
        <span className="fleet-name"><b>{r.name}</b>{r.garageId == null && <span className="fleet-where tiny">{r.where}</span>}</span>
        {r.garageId == null && <span className={`fleet-state tiny ${r.state}`}>{FLEET_STATE_LABEL[r.state]}</span>}
      </button>
      <label className="fleet-give tiny">
        <span className="muted">Keys:</span>
        <select value={r.holderKey} disabled={r.busy} title={r.busy ? 'Out with a crew or carrying goods: bring it back first' : 'Give this car to'}
          onChange={(e) => giveTo(r.key, e.target.value)}>
          {crews.map(t => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
          <option value="cache">Unassigned</option>
          {staff.map(role => <option key={role} value={role}>{role === 'lawyer' ? 'The lawyer' : 'The accountant'}</option>)}
        </select>
      </label>
      <button type="button" className="btn sm" disabled={r.garageId == null || r.busy}
        title={r.garageId == null ? 'Only a car in a garage can be sold' : `Sell for ${money(Math.round(VEHICLES[r.kind].cost * 0.5))}`}
        onClick={() => sell(r.key)}>
        Sell
      </button>
    </div>
  );
  return (
    <div className="fleet-list">
      <Kicker>Your vehicles ({total})</Kicker>
      {!garages.length && <Empty>You have no garage: the HQ, offices and warehouses each have one.</Empty>}
      {garages.map(g => (
        <section key={g.id} className="fleet-garage">
          <button type="button" className="fleet-garage-head" title="Show it on the map" onClick={() => requestCamera({ ...g.door })}>
            <b>{g.isHQ ? 'HQ · ' : ''}{g.name}</b>
            <span className={`fleet-bays tiny${g.cars.length >= GARAGE_CAPACITY ? ' full' : ''}`}>{g.cars.length}/{GARAGE_CAPACITY} bays</span>
          </button>
          {g.cars.length ? g.cars.map(row) : <div className="muted tiny fleet-empty">Empty</div>}
        </section>
      ))}
      <section className="fleet-garage">
        <div className="fleet-garage-head"><b>Out in the city</b><span className="fleet-bays tiny">{outside.length}</span></div>
        {outside.length ? outside.map(row) : <div className="muted tiny fleet-empty">Every car is in a garage.</div>}
      </section>
      <div className="muted tiny">Only a car in a garage can be sold. A car that finds every garage full is left at the kerb. A crew far from its own car takes a nearer unassigned one of the same kind.</div>
    </div>
  );
}

/** A weapon being dragged in the inventory grid: off a rack, or out of a man's slot. */
type GunDrag = { from: 'rack'; key: string; kind: WeaponId } | { from: 'man'; personId: ID; slot: GunSlot; kind: WeaponId };
const GUN_MIME = 'application/x-og-gun';
/** The slot it fits, readable while dragging (the data itself is not, until the drop). */
const gunSlotMime = (slot: GunSlot) => `application/x-og-gun-${slot}`;
const SLOT_GHOST: Record<GunSlot, WeaponId> = { large: 'rifle', small: 'pistol', explosive: 'explosives' };

function startGunDrag(e: React.DragEvent, item: GunDrag) {
  e.dataTransfer.setData(GUN_MIME, JSON.stringify(item));
  e.dataTransfer.setData(gunSlotMime(slotOf(item.kind)), '1');
  e.dataTransfer.effectAllowed = 'move';
  e.stopPropagation();
}
function readGunDrag(e: React.DragEvent): GunDrag | null {
  try { return JSON.parse(e.dataTransfer.getData(GUN_MIME)) as GunDrag; } catch { return null; }
}

/** Drop-target props for the inventory grid, and whether something that fits is over it. */
function useGunDrop(accepts: (types: readonly string[]) => boolean, onDrop: (item: GunDrag) => void): [Record<string, unknown>, boolean] {
  const [over, setOver] = useState(false);
  return [{
    onDragOver: (e: React.DragEvent) => {
      if (!accepts(e.dataTransfer.types)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!over) setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !(e.currentTarget as Node).contains(next)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      const item = readGunDrag(e);
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      onDrop(item);
    },
  }, over];
}

/** One of a man's three places: a wide one for a large gun, square ones for a small gun and an explosive. */
function InvSlot({ personId, place, kind, compact }: { personId: ID; place: GunSlot; kind: WeaponId | null; compact?: boolean }) {
  const sim = useGame((s) => s.sim)!;
  const notify = useGame((s) => s.notify);
  const gangId = sim.playerGang.id;
  const [drop, over] = useGunDrop(types => types.includes(gunSlotMime(place)), (item) => {
    if (slotOf(item.kind) !== place) return;
    const result = item.from === 'rack'
      ? act((s) => equipWeapon(s.world, gangId, item.key, personId))
      : act((s) => passWeapon(s.world, gangId, item.personId, item.slot, personId));
    if (result) notify(result);
  });
  const ghost = SLOT_GHOST[place];
  return (
    <div className={`inv-slot ${place}${kind ? '' : ' empty'}${over ? ' over' : ''}${compact ? ' compact' : ''}`} {...drop}
      onClick={(e) => e.stopPropagation()}
      draggable={!!kind}
      onDragStart={kind ? (e) => startGunDrag(e, { from: 'man', personId, slot: place, kind }) : undefined}
      title={kind ? `${WEAPONS[kind].name}: drag onto an armoury to leave it there, or onto another man to hand it over` : `${SLOT_LABEL[place]}: empty. Drag one here from an armoury.`}>
      <Icon name={`weapons/${kind ?? ghost}`} size={compact ? (place === 'large' ? 24 : 18) : place === 'large' ? 40 : 30} className={kind ? 'inv-icon' : 'inv-ghost'} />
      {!compact && <span className="inv-name tiny">{kind ? WEAPONS[kind].name : SLOT_LABEL[place]}</span>}
    </div>
  );
}

/** A man's three slots, small, for the crew list in the lieutenant window. */
export function KitSlots({ personId, slots }: { personId: ID; slots: Record<GunSlot, WeaponId | null> }) {
  return <div className="inv-grid compact">{GUN_SLOTS.map(place => <InvSlot key={place} personId={personId} place={place} kind={slots[place]} compact />)}</div>;
}

/** One rack: its weapons, each kind an icon to drag onto a man; a man's weapon dropped here is left on it. */
function ArmouryRack({ a }: { a: ArmouryGroup }) {
  const sim = useGame((s) => s.sim)!;
  const notify = useGame((s) => s.notify);
  const requestCamera = useGame((s) => s.requestCamera);
  const gangId = sim.playerGang.id;
  const [drop, over] = useGunDrop(types => types.includes(GUN_MIME), (item) => {
    if (item.from !== 'man') return;
    const result = act((s) => unequipWeapon(s.world, gangId, item.personId, item.slot, a.id));
    if (result) notify(result);
  });
  // One line per kind, whoever's stock it is.
  const rows = [...a.rows.reduce((m, r) => {
    const had = m.get(r.kind);
    m.set(r.kind, had ? { ...had, count: had.count + r.count, keys: [...had.keys, ...r.keys] } : r);
    return m;
  }, new Map<WeaponId, RackRow>()).values()];
  const sellOne = (key: string) => {
    const result = act((s) => sellGun(s.world, gangId, key));
    if (result) notify(result);
  };
  return (
    <section className={`fleet-garage armoury-rack${over ? ' over' : ''}`} {...drop}>
      <button type="button" className="fleet-garage-head" title="Show it on the map" onClick={() => requestCamera({ ...a.door })}>
        <b>{a.isHQ ? 'HQ · ' : ''}{a.name}</b>
        <span className="fleet-bays tiny">{a.total} on the rack</span>
      </button>
      {rows.length ? rows.map(r => (
        <div key={r.kind} className="fleet-row">
          <span className="fleet-show rack-item" draggable onDragStart={(e) => startGunDrag(e, { from: 'rack', key: r.keys[0], kind: r.kind })}
            title={`Drag onto a man's ${SLOT_LABEL[slotOf(r.kind)].toLowerCase()} slot in the crew list to equip him`}>
            <span className="rack-icon"><Icon name={`weapons/${r.kind}`} size={26} /></span>
            <span className="fleet-name"><b>{r.name} ×{r.count}</b></span>
          </span>
          <button type="button" className="btn sm" title={`Sell one for ${money(Math.round(WEAPONS[r.kind].cost * 0.5))}`} onClick={() => sellOne(r.keys[0])}>
            Sell one
          </button>
        </div>
      )) : <div className="muted tiny fleet-empty">Empty. Drag a man's weapon here to leave it.</div>}
    </section>
  );
}

/**
 * The armouries (playtest, 26 November): what is on each rack (the men's
 * slots are in the crew list of the lieutenant window), counted by kind.
 */
function ArmouryList() {
  const sim = useGame((s) => s.sim)!;
  useGame((s) => s.version);
  const w = sim.world, gang = sim.playerGang;
  const { armouries, loose } = armouryGroups(w, gang);
  return (
    <div className="fleet-list">
      <Kicker>Armouries</Kicker>
      {!armouries.length && <Empty>You have no armoury: the HQ, offices and warehouses each have one.</Empty>}
      {armouries.map(a => <ArmouryRack key={a.id} a={a} />)}
      <div className="muted tiny">
        Drag a weapon onto a man's slot in the crew list of the lieutenant window to equip him (what he had goes back on
        the rack), or from his slot onto a rack to leave it there. Between weeks it is done at once; in the week he takes
        it when he next calls at that armoury. Any of your men passing an armoury fills an empty slot from it.
        {loose > 0 && ` ${loose === 1 ? 'One weapon is' : `${loose} weapons are`} lying in the street where men fell.`}
      </div>
    </div>
  );
}

/** The sheet unmounts when it closes; this brings the player back to the same tab. */
let lastRecruitTab: RecruitTabId = 'hood';
/** ...and to the same ordering of the recruits ('' = as they were found). */
let lastRecruitSort: Skill | '' = '';

function RecruitsSheet({ teamId }: { teamId: ID | null }) {
  const sim = useGame((s) => s.sim)!;
  const notify = useGame((s) => s.notify);
  const [tab, setTab] = useState(lastRecruitTab);
  const [sortBy, setSortByState] = useState<Skill | ''>(lastRecruitSort);
  const setSortBy = (k: Skill | '') => { lastRecruitSort = k; setSortByState(k); };
  const w = sim.world;
  const gang = sim.playerGang;
  const recruits = gang.recruitIds.map((id) => w.people[id]).filter(Boolean);
  // As they were found, unless a skill is chosen: then the best at it first.
  const onTab = recruitsOnTab(recruits, tab);
  const shown = sortBy ? [...onTab].sort((a, b) => b.skills[sortBy] - a.skills[sortBy]) : onTab;
  const openTab = (id: RecruitTabId, list: HTMLElement | null) => {
    lastRecruitTab = id;
    setTab(id);
    list?.scrollTo({ top: 0 });
  };
  return (
    <>
      <div className="sub-tabs recruit-tabs">
        {RECRUIT_TABS.map((t) => (
          <button key={t.id} aria-pressed={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={(e) => openTab(t.id, e.currentTarget.closest('.rs-body'))}>
            {t.label} · {recruitsOnTab(recruits, t.id).length}
          </button>
        ))}
      </div>
      {onTab.length > 1 && (
        <label className="row tiny recruit-sort" style={{ gap: 6, margin: '8px 0 2px' }}>
          <span className="muted">Best first at</span>
          <select aria-label="Order recruits by skill" className="text-input" style={{ flex: 1 }} value={sortBy} onChange={(e) => setSortBy(e.target.value as Skill | '')}>
            <option value="">no skill: as they were found</option>
            {(tab === 'hood' ? SKILLS : STAFF_SKILLS).map((k) => <option key={k} value={k}>{SKILL_LABELS[k]}</option>)}
          </select>
        </label>
      )}
      {shown.length === 0 ? (
        <Empty>{RECRUIT_TABS.find((t) => t.id === tab)!.empty}</Empty>
      ) : (
        shown.map((p) => (
          <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px dotted var(--dots)' }}>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="avatar">
                <Portrait person={p} size={64} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="row between">
                  <b style={{ fontWeight: 500, fontSize: 15 }}>{p.name}</b>
                  <span className="muted">
                    {sortBy && <><Stars value={p.skills[sortBy]} /> · </>}{p.role} · wants {money(p.payDemand)}/week
                  </span>
                </div>
                <div style={{ margin: '5px 0' }}>
                  <SkillList skills={p.skills} columns={2} only={isStaffRole(p.role) ? STAFF_SKILLS : undefined} />
                </div>
              </div>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {isStaffRole(p.role) ? (
                // A specialist has one post to fill, wherever the button says they are going.
                <button className="btn sm brass" onClick={() => notify(act((s) => hireRecruit(s.world, gang.id, p.id, 'pool'))!)}>
                  {staffHireLabel(p.role, w.people[(p.role === 'lawyer' ? gang.lawyerId : gang.accountantId) ?? -1]?.name)}
                </button>
              ) : (
                <>
                  {teamId != null && (
                    <button className="btn sm brass" onClick={() => notify(act((s) => hireRecruit(s.world, gang.id, p.id, 'team', teamId))!)}>
                      Hire to team
                    </button>
                  )}
                  <button className="btn sm" onClick={() => notify(act((s) => hireRecruit(s.world, gang.id, p.id, 'pool'))!)}>
                    Hire to pool
                  </button>
                  {p.role === 'hood' && (
                    <button className="btn sm" onClick={() => notify(act((s) => hireRecruit(s.world, gang.id, p.id, 'lieutenant'))!)}>
                      As lieutenant (+$50)
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))
      )}
      <div className="muted" style={{ marginTop: 8 }}>
        Managers currently running your businesses:{' '}
        {Object.values(w.buildings)
          .filter((b) => b.ownerGangId === gang.id && b.managerId != null)
          .map((b) => `${w.people[b.managerId!]?.name} (${buildingName(w, b.id)})`)
          .join(', ') || 'none'}
      </div>
    </>
  );
}

/** The original showed a hood's face and full details when his name was clicked. */
function PersonSheet({ person, teamId }: { person: Person; teamId?: ID }) {
  const sim = useGame((s) => s.sim)!;
  const notify = useGame((s) => s.notify);
  const setSheet = useGame((s) => s.setSheet);
  const [payOpen, setPayOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ text: string; go: () => void } | null>(null);
  const gang = sim.playerGang;
  const absent = ABSENT[person.status];

  return (
    <>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start', position: 'relative' }}>
        {person.wanted >= 50 && <Stamp kind="wanted" />}
        <div className="avatar">
          <Portrait person={person} gang={person.gangId === gang.id ? gang : undefined} size={96} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Kicker>
            {ROLE_ICON.has(person.role) && <Icon name={`roles/${person.role}`} size={12} />} {person.role} ·{' '}
            {absent ? (
              <>
                <Icon name={`status/${person.status}`} size={12} /> {absent}
              </>
            ) : (
              'active'
            )}
          </Kicker>
          <div className="row between" style={{ marginTop: 6 }}>
            <span className={`tag ${person.loyalty > 60 ? 'good' : person.loyalty > 30 ? 'warn' : 'bad'}`}>Loyalty {Math.round(person.loyalty)}</span>
            <span className="tag">Wanted {Math.round(person.wanted)}</span>
          </div>
          <div className={`pay-lines${person.pay < person.payDemand ? ' unhappy' : ''}`} style={{ textAlign: 'left', marginTop: 8 }}>
            <Kicker>Wants {money(person.payDemand)}</Kicker>
            <b>Pay {money(person.pay)}</b>
          </div>
        </div>
      </div>
      {absent && (
        <Hint>
          {person.status === 'kidnapped'
            ? 'Held tied to a chair somewhere in the city. He will be back when they let him go — or when you get him out.'
            : person.status === 'arrested' || person.status === 'onTrial'
              ? 'Behind bars, awaiting trial. A lawyer improves his chances.'
              : `${absent}.`}
        </Hint>
      )}
      <div style={{ margin: '12px 0' }}>
        <SkillList skills={person.skills} columns={2} only={isStaffRole(person.role) ? STAFF_SKILLS : undefined} />
      </div>
      {payOpen && <PayRoll person={person} onClose={() => setPayOpen(false)} />}
      <div className="team-buttons">
        {person.role === 'hood' && person.gangId === gang.id && person.teamId != null && (
          <button className="btn" onClick={() => notify(act((s) => moveToPool(s.world, gang.id, person.id))!)}>
            Send to pool
          </button>
        )}
        {gang.poolIds.includes(person.id) && teamId != null && person.gangId === gang.id && (
          <button className="btn" onClick={() => notify(act((s) => moveToTeam(s.world, gang.id, person.id, teamId))!)}>
            Send to team
          </button>
        )}
        <button className="btn" onClick={() => setConfirm({ text: `Sack ${person.name}? He goes back on the street, and he will not forget it.`, go: () => notify(act((s) => sackPerson(s.world, gang.id, person.id))!) })}>
          Sack
        </button>
        <button className="btn danger" disabled={!!outOfReach(person)} title={outOfReach(person) ? `${person.name} is ${outOfReach(person)}: nobody of yours can get at him there` : undefined}
          onClick={() => setConfirm({ text: `Have ${person.name} killed? The police will not investigate, but the rest of the gang will notice.`, go: () => notify(act((s) => killMember(s.world, gang.id, person.id))!) })}>
          Kill
        </button>
        {person.role === 'hood' && person.gangId === gang.id && (person.teamId != null || gang.poolIds.includes(person.id)) && <button
          className="btn"
          title="Make this hood a lieutenant, if one of the eight tabs is free"
          onClick={() => {
            promoteAndShow(person.id);
          }}
        >
          Promote
        </button>}
        <button className={`btn${payOpen ? ' on' : ''}`} onClick={() => setPayOpen(!payOpen)}>
          Pay
        </button>
      </div>
      {confirm && (
        <ConfirmDialog
          text={confirm.text}
          onYes={() => {
            confirm.go();
            setConfirm(null);
            setSheet(null);
          }}
          onNo={() => setConfirm(null)}
        />
      )}
    </>
  );
}

/** The three skills a person is best at, for a one-line summary. */
function topSkills(p: Person, n = 3): string {
  return SKILLS.map((k) => [k, p.skills[k]] as const).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => `${SKILL_LABELS[k]} ${v}`).join(' · ');
}

/** The clipboard's sections stay as the player left them while the sheet is closed. */
const clipboardOpen = new Set<string>();

/** One collapsible category of the clipboard: closed until the player opens it. */
function ClipSection({ id, title, count, color, forceOpen, children }: {
  id: string; title: string; count: number; color?: string; forceOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => clipboardOpen.has(id));
  const shown = open || !!forceOpen;
  return (
    <details className="clip-section" open={shown} onToggle={(e) => {
      const next = e.currentTarget.open;
      if (next) clipboardOpen.add(id); else clipboardOpen.delete(id);
      setOpen(next);
    }}>
      <summary>
        {color && <i className="clip-swatch" style={{ background: color }} />}
        <span className="clip-title" style={color ? { color } : undefined}>{title}</span>
        <span className="clip-count">{count}</span>
      </summary>
      {shown && (count === 0 ? <Empty>Nobody and nothing here yet.</Empty> : children)}
    </details>
  );
}

/**
 * The clipboard: everybody and everywhere you know of, to pick a job card's
 * target from without hunting for it on the map. As in the original it is a
 * set of categories (the city's officials, the police, each gang's known
 * members, the businesses you hold) that open one at a time.
 */
function ClipboardSheet() {
  const sim = useGame((s) => s.sim)!;
  const jobCard = useGame((s) => s.jobCard);
  const requestCamera = useGame((s) => s.requestCamera);
  const centreOnPerson = useGame((s) => s.centreOnPerson);
  const selectBuilding = useGame((s) => s.selectBuilding);
  const notify = useGame((s) => s.notify);
  const w = sim.world;
  const gang = sim.playerGang;
  const def = jobCard ? ORDERS[jobCard.type] : null;
  const pickingPerson = !!jobCard && def?.target === 'person';
  const pickingSite = !!jobCard && (def?.target === 'building' || def?.target === 'area');
  const selected = new Set(jobCard ? selectedOrderSites(w, gang.id, jobCard) : []);
  const eligiblePerson = (p: Person) => !pickingPerson || selectableOrderPerson(w, gang.id, jobCard!.type, p);
  const alive = Object.values(w.people).filter((p) => p.status !== 'dead');
  const byRole = (...roles: string[]) => alive.filter((p) => roles.includes(p.role) && eligiblePerson(p));

  const known = gang.knownPeople.map((id) => w.people[id]).filter((p): p is Person => !!p && p.status !== 'dead' && p.gangId !== gang.id && eligiblePerson(p));
  const rivals = Object.values(w.gangs).filter((g) => g.id !== gang.id);
  const unattached = known.filter((p) => p.gangId == null && (p.role === 'hood' || p.role === 'lieutenant'));
  // Your own people the gang cannot reach: the cells, the courthouse, prison, a rival's back room.
  const held = alive.filter((p) => p.gangId === gang.id && ['arrested', 'onTrial', 'jailed', 'kidnapped'].includes(p.status));
  const snitches = w.snitchIds.map((id) => w.people[id]).filter((p): p is Person => !!p && p.status !== 'dead' && eligiblePerson(p));

  const siteOk = (b: Building) => !pickingSite || selectableOrderSite(w, gang.id, jobCard!, b);
  const sites = buildingList(w).filter((b) => b.state !== 'destroyed' && siteOk(b));
  const owned = sites.filter((b) => b.ownerGangId === gang.id);
  const paying = sites.filter((b) => b.protection?.gangId === gang.id && !b.protection.refusing);
  // Shops that turned down your protection or stopped paying: where Intimidate goes next.
  const refusers = sites.filter((b) => b.ownerGangId == null && (b.protection?.gangId === gang.id ? b.protection.refusing : !b.protection && !!b.extortRefusedBy?.includes(gang.id)));

  const pickPerson = (id: ID) => {
    const p = w.people[id];
    if (!p) return;
    if (pickingPerson) {
      handleMapHit({ personId: id, buildingId: null, blockId: null, point: p.pos });
      notify(`${p.name} is the target.`);
    } else centreOnPerson(id);
  };
  const pickSite = (id: ID) => {
    const b = w.buildings[id];
    if (!b) return;
    if (def?.target === 'building') {
      handleMapHit({ personId: null, buildingId: id, blockId: b.blockId, point: w.lots[b.lotId].center }, { site: true });
      notify(`${buildingName(w, id)} is the target.`);
    } else if (def?.target === 'area') {
      handleMapHit({ personId: null, buildingId: id, blockId: b.blockId, point: w.lots[b.lotId].center }, { site: true });
    } else {
      const lot = w.lots[b.lotId];
      if (!jobCard) selectBuilding(id);
      requestCamera({ x: lot.center.x, y: lot.center.y });
    }
  };

  const personRow = (p: Person, note: string, opts: { color?: string; skills?: boolean } = {}) => (
    <button key={p.id} className={`list-row clip-row${jobCard?.personId === p.id ? ' on' : ''}`} onClick={() => pickPerson(p.id)}
      title={pickingPerson ? 'Make this person the target' : 'Show on the map'}>
      <span className="name" style={opts.color ? { color: opts.color } : undefined}>
        <span>{ROLE_ICON.has(p.role) && <Icon name={`roles/${p.role}`} size={13} />} {p.name}</span>
        {opts.skills && <span className="clip-skills">{topSkills(p)}</span>}
      </span>
      <span className="muted">{note}</span>
    </button>
  );
  const official = (p: Person, label: string) => personRow(p, `${label}${p.bribedBy === gang.id ? ' · on your payroll' : p.employedBy === gang.id ? ' · on your payroll' : ''}`);
  const siteRow = (b: Building, note: string) => (
    <button key={b.id} className={`list-row clip-row${selected.has(b.id) ? ' on' : ''}`} onClick={() => pickSite(b.id)}
      title={pickingSite ? 'Make this site a target' : 'Show on the map'}>
      <span className="name">{placeName(w, b)}</span>
      <span className="muted">{note}</span>
    </button>
  );
  const absent = (p: Person) => p.status === 'kidnapped' ? 'held by another gang' : p.status === 'jailed' ? `in prison${p.jailWeeks > 0 ? ` · ${p.jailWeeks} wk` : ''}` : p.status === 'onTrial' ? 'on trial' : 'awaiting trial';

  const mayor = byRole('mayor'), das = byRole('da'), judges = byRole('judge');
  const chief = byRole('policeChief'), officers = byRole('police');
  const bureau = byRole('fbiHead'), press = byRole('reporter'), clergy = byRole('clergy');
  // With a card looking for a target, the categories that hold one start open.
  const want = (n: number, kind: 'person' | 'site') => n > 0 && n <= 12 && (kind === 'person' ? pickingPerson : pickingSite);

  return (
    <div className="clipboard">
      <div className="muted tiny" style={{ marginBottom: 8 }}>
        {jobCard ? 'Only what this order can target is listed. Open a category and click a name.' : 'Open a category; click a name to find it on the map.'}
      </div>

      {(!jobCard || pickingPerson) && <>
        <Kicker style={{ margin: '4px 0 4px' }}>The city</Kicker>
        <ClipSection id="cityHall" title="City Hall" count={mayor.length} forceOpen={want(mayor.length, 'person')}>
          {mayor.map((p) => official(p, 'Mayor'))}
        </ClipSection>
        <ClipSection id="courts" title="District Attorneys and Judges" count={das.length + judges.length} forceOpen={want(das.length + judges.length, 'person')}>
          {das.map((p) => official(p, 'District Attorney'))}
          {judges.map((p) => official(p, 'Judge'))}
        </ClipSection>
        <ClipSection id="police" title="Police" count={chief.length + officers.length}>
          {chief.map((p) => official(p, 'Chief of Police'))}
          {officers.map((p) => official(p, 'Officer'))}
        </ClipSection>
        <ClipSection id="bureau" title="The Bureau" count={bureau.length}>
          {bureau.map((p) => official(p, 'Bureau chief'))}
        </ClipSection>
        <ClipSection id="press" title="Journalists" count={press.length}>
          {press.map((p) => official(p, 'Reporter'))}
        </ClipSection>
        <ClipSection id="clergy" title="Churches and charities" count={clergy.length}>
          {clergy.map((p) => official(p, 'Clergy'))}
        </ClipSection>
        <ClipSection id="snitches" title="Informers" count={snitches.length}>
          {snitches.map((p) => personRow(p, 'Snitch'))}
        </ClipSection>

        <Kicker style={{ margin: '12px 0 4px' }}>Gang members you know</Kicker>
        {rivals.map((r) => {
          // The boss heads his gang's list, as the Chief of Police heads the police.
          const members = known.filter((p) => p.gangId === r.id).sort((a, b) => Number(b.id === r.bossId) - Number(a.id === r.bossId));
          // The whole city knows a boss by name. Until he has been identified
          // that is all there is: no skills, nowhere to find him, nobody to target.
          const boss = w.people[r.bossId];
          const named = boss && boss.status !== 'dead' && !r.eliminated && !members.some((p) => p.id === boss.id) ? boss : null;
          return (
            <ClipSection key={r.id} id={`gang${r.id}`} title={`${r.name}${r.eliminated ? ' · wiped out' : ''}`} count={members.length + (named ? 1 : 0)}
              color={GANG_COLORS[r.color].hex} forceOpen={want(members.length, 'person')}>
              {named && (
                <div className="list-row clip-row" title="Known by name only: identify him to learn more">
                  <span className="name" style={{ color: GANG_COLORS[r.color].hex }}><span>{named.name}</span></span>
                  <span className="muted">boss · whereabouts unknown</span>
                </div>
              )}
              {members.map((p) => personRow(p, p.id === r.bossId ? 'boss' : p.role, { color: GANG_COLORS[r.color].hex, skills: true }))}
            </ClipSection>
          );
        })}
        <ClipSection id="unattached" title="Unaffiliated hoods" count={unattached.length}>
          {unattached.map((p) => personRow(p, gang.recruitIds.includes(p.id) ? 'willing to work' : 'works for nobody', { skills: true }))}
        </ClipSection>
        {!jobCard && <ClipSection id="held" title="Your people behind bars or held" count={held.length} color={GANG_COLORS[gang.color].hex}>
          {held.map((p) => personRow(p, absent(p), { color: GANG_COLORS[gang.color].hex }))}
        </ClipSection>}
      </>}

      {(!jobCard || pickingSite) && <>
        <Kicker style={{ margin: '12px 0 4px' }}>Businesses</Kicker>
        <ClipSection id="owned" title="Owned by you" count={owned.length} color={GANG_COLORS[gang.color].hex} forceOpen={want(owned.length, 'site')}>
          {owned.map((b) => siteRow(b, b.managerId != null ? `run by ${w.people[b.managerId]?.name ?? 'a manager'}` : b.cls === 'empty' ? 'empty land' : 'no manager'))}
        </ClipSection>
        <ClipSection id="paying" title="Paying you protection" count={paying.length} forceOpen={want(paying.length, 'site')}>
          {paying.map((b) => siteRow(b, `${money(b.protection?.weekly ?? 0)}/wk`))}
        </ClipSection>
        <ClipSection id="refusers" title="Refusing you" count={refusers.length} forceOpen={want(refusers.length, 'site')}>
          {refusers.map((b) => siteRow(b, b.protection ? 'stopped paying' : 'turned you down'))}
        </ClipSection>
        {pickingSite && (() => {
          // Everything else the order could go to, nearest your territory first is the map's job; here by name.
          const others = sites.filter((b) => !owned.includes(b) && !paying.includes(b) && !refusers.includes(b));
          return <ClipSection id="others" title="Other valid targets" count={others.length}>
            {others.slice(0, 120).map((b) => siteRow(b, w.gangs[buildingMapIntel(b, gang.id).ownerGangId ?? -1]?.name ?? ''))}
          </ClipSection>;
        })()}
      </>}
    </div>
  );
}
