import { clockHour } from './constants';
import { dayAndPhase } from './weather';
import type { Building, Person, WorldState } from './types';

/**
 * The city by the hour (playtest, 21 November: the 24-hour day should change
 * the game). Shops keep shop hours, the speakeasies and card rooms open as
 * the shops close, and after midnight most townsfolk are at home in bed:
 * the streets empty, and there are fewer eyes about.
 */

/** The clock hour now (0..24): the planning phase is about noon. */
export function hourNow(w: WorldState): number {
  if (w.phase !== 'week') return 12;
  return clockHour(dayAndPhase(w).phase);
}

export interface Hours { open: number; close: number }

/** Always open: homes, depots, presses, and the places that never close. */
export const ALWAYS: Hours = { open: 0, close: 24 };
/** Ordinary shop hours. */
const SHOP: Hours = { open: 8, close: 18 };

/** The night trade: drink, cards, dice and the rest, from evening to the small hours. */
export const NIGHT_VENUES = new Set(['speakeasy', 'casino', 'cardGames', 'diceGame', 'gamblingDen', 'prizeFight', 'whorehouse', 'poolHall']);

const HOURS: Record<string, Hours> = {
  // Night trade.
  speakeasy: { open: 18, close: 4 }, casino: { open: 19, close: 4 }, cardGames: { open: 19, close: 3 },
  diceGame: { open: 19, close: 3 }, gamblingDen: { open: 18, close: 4 }, prizeFight: { open: 20, close: 2 },
  whorehouse: { open: 20, close: 5 }, poolHall: { open: 14, close: 2 },
  // Late trade.
  restaurant: { open: 11, close: 23 }, milkBar: { open: 9, close: 21 }, massageParlor: { open: 12, close: 24 },
  gym: { open: 6, close: 21 }, healthCenter: { open: 8, close: 20 }, danceStudio: { open: 10, close: 22 },
  loanShark: { open: 10, close: 22 }, grifters: { open: 10, close: 22 }, numbersRacket: { open: 8, close: 20 },
  // Early trade.
  cafe: { open: 6, close: 16 }, breakfastBar: { open: 5, close: 13 }, bakers: { open: 5, close: 14 },
  // Office hours.
  bankSmall: { open: 9, close: 15 }, bankLarge: { open: 9, close: 15 }, lawFirm: { open: 9, close: 17 },
  accountancy: { open: 9, close: 17 }, financeCompany: { open: 9, close: 17 }, insiderTrading: { open: 9, close: 16 },
  // Works and yards.
  foundry: { open: 6, close: 18 }, mill: { open: 6, close: 18 }, cannery: { open: 6, close: 18 },
  garageDepot: { open: 6, close: 18 }, tradeUnion: { open: 7, close: 19 }, teamsters: { open: 6, close: 18 },
  // Never shut.
  hotelSmall: ALWAYS, hotelLarge: ALWAYS, docks: ALWAYS, railroad: ALWAYS, newspaper: ALWAYS, radioStation: ALWAYS,
  warehouse: ALWAYS, office: ALWAYS, moonshineStill: ALWAYS, counterfeitPress: ALWAYS,
};

/** A business's opening hours. */
export function hoursOf(b: Pick<Building, 'typeId' | 'cls'>): Hours {
  const h = HOURS[b.typeId];
  if (h) return h;
  return b.cls === 'commercial' ? SHOP : ALWAYS;
}

/** Open at `hour` (0..24)? */
export function openAt(hours: Hours, hour: number): boolean {
  if (hours.open === 0 && hours.close === 24) return true;
  const h = ((hour % 24) + 24) % 24;
  return hours.open < hours.close ? h >= hours.open && h < hours.close : h >= hours.open || h < hours.close;
}

/** Trading, and open for custom at this hour. */
export function openNow(w: WorldState, b: Building): boolean {
  return b.state === 'trading' && openAt(hoursOf(b), hourNow(w));
}

const clock = (h: number) => h === 0 || h === 24 ? 'midnight' : h === 12 ? 'noon' : `${h % 12} ${h < 12 ? 'am' : 'pm'}`;

/** "Open 6 pm – 4 am", or "Open all hours". */
export function hoursLabel(hours: Hours): string {
  return hours.open === 0 && hours.close === 24 ? 'Open all hours' : `Open ${clock(hours.open)} – ${clock(hours.close)}`;
}

/** Evening: the night trade draws the crowd (six in the evening to two in the morning). */
export function eveningCrowd(hour: number): boolean {
  return hour >= 18 || hour < 2;
}

/** Night beat: the police walk farther and faster from eight at night to six in the morning. */
export function nightBeat(hour: number): boolean {
  return hour >= 20 || hour < 6;
}

/** How many townsfolk are at home in bed (0..1): none before midnight, most by three, all up again by six. */
export function bedtimeShare(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 6) return 0;
  if (h < 3) return .75 * h / 3;
  if (h < 4.5) return .75;
  return .75 * (6 - h) / 1.5;
}

function hash01(n: number): number {
  let x = Math.imul(n ^ 0x51ed270b, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * At home asleep: an ordinary citizen, at this hour, among the share in bed
 * (each the same night after night, so they go one by one and come back the
 * same way). Not on the street to walk, to see a crime, or to be drawn.
 */
export function atHomeAsleep(w: WorldState, p: Person, hour = hourNow(w)): boolean {
  if (p.role !== 'citizen' || p.status !== 'active') return false;
  const share = bedtimeShare(hour);
  return share > 0 && hash01(p.id) < share;
}
