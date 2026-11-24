import { ORDERS } from './constants';
import { buildingList } from './entityLists';
import { financeNet } from './finances';
import type { Gang, GangWeekStat, ID, WorldState } from './types';
import { placeName } from './world';

/**
 * Everything the boss wants to know once the week is done (playtest,
 * 23 November): the money, what moved, how the orders went, which businesses
 * paid and which did not, and the week's events. Built from what settlement
 * already keeps, so it needs nothing new in the save.
 */
export interface WeekDebrief {
  week: number;
  money: {
    opening: number;
    closing: number;
    income: number;
    costs: number;
    tax: number;
    net: number;
    /** The finance report started before its ledger existed (older saves). */
    partial: boolean;
  } | null;
  changes: { key: 'territory' | 'manpower' | 'loyalty' | 'suspicion' | 'power'; label: string; now: number; delta: number | null }[];
  orders: { done: number; failed: number; failures: { name: string; reason: string }[] };
  businesses: { best: DebriefBusiness[]; worst: DebriefBusiness[] };
  events: string[];
}

export interface DebriefBusiness { id: ID; name: string; profit: number }

const CHANGE_LABELS: [WeekDebrief['changes'][number]['key'], string][] = [
  ['territory', 'Territory'],
  ['manpower', 'Men'],
  ['loyalty', 'Loyalty'],
  ['suspicion', 'Heat'],
  ['power', 'Power'],
];

export function weekDebrief(w: WorldState, gang: Gang): WeekDebrief {
  const history = gang.history;
  const now: GangWeekStat | undefined = history.at(-1);
  const before: GangWeekStat | undefined = history.at(-2);
  const report = gang.lastFinanceReport;
  const income = report ? Object.values(report.income).reduce((a, b) => a + b, 0) : 0;
  const tax = report?.costs.tax ?? 0;
  const costs = report ? Object.values(report.costs).reduce((a, b) => a + b, 0) - tax : 0;

  const mine = w.lastWeekOrders.filter(o => o.gangId === gang.id);
  const failed = mine.filter(o => o.state === 'failed');

  const businesses = buildingList(w)
    .filter(b => b.ownerGangId === gang.id && !b.isHQ && b.cls !== 'empty' && b.cls !== 'residential' && b.state !== 'destroyed' && b.typeId !== 'office')
    .map(b => ({ id: b.id, name: placeName(w, b), profit: Math.round(b.lastProfit ?? 0) }))
    .sort((a, b) => b.profit - a.profit);
  const best = businesses.filter(b => b.profit > 0).slice(0, 3);
  const worst = businesses.filter(b => b.profit < 0).slice(-3).reverse();

  return {
    week: now?.week ?? report?.week ?? Math.max(1, w.week - 1),
    money: report ? {
      opening: report.openingCash,
      closing: report.closingCash,
      income,
      costs,
      tax,
      net: financeNet(report),
      partial: report.partial,
    } : null,
    changes: now ? CHANGE_LABELS.map(([key, label]) => ({
      key, label, now: now[key], delta: before ? now[key] - before[key] : null,
    })) : [],
    orders: {
      done: mine.filter(o => o.state === 'done').length,
      failed: failed.length,
      failures: failed.slice(0, 6).map(o => ({ name: ORDERS[o.type].name, reason: o.failReason ?? o.results.at(-1) ?? 'No reason given.' })),
    },
    businesses: { best, worst },
    events: [...w.weekLog],
  };
}
