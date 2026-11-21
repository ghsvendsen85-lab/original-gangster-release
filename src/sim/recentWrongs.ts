import type { ID, WorldState } from './types';

/**
 * Wrongs done to the computer's gangs during the working week, for them to
 * answer before the week is out (midWeekAi.ts). Transient, like the
 * presentation events: a reload forgets the unanswered ones, and the weekly
 * stance machine still books every wrong through `provoke` as before.
 */
export interface Wrong { wronged: ID; by: ID; amount: number; minute: number }

const books = new WeakMap<WorldState, Wrong[]>();

export function noteWrong(w: WorldState, wronged: ID, by: ID, amount: number): void {
  if (w.phase !== 'week' || amount <= 0) return;
  let list = books.get(w);
  if (!list) books.set(w, list = []);
  list.push({ wronged, by, amount, minute: w.minute });
  if (list.length > 64) list.splice(0, list.length - 64);
}

/** Take the wrongs noted so far (each is answered once). */
export function takeWrongs(w: WorldState): Wrong[] {
  const list = books.get(w) ?? [];
  books.set(w, []);
  return list;
}
