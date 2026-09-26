/**
 * Calendar days for promotions, in Lagos time.
 *
 * A promotion is booked by the day ("runs 1–7 October") and the shop and
 * its buyers are in Nigeria, so a day here is a Lagos day whatever the
 * device clock says. West Africa Time is UTC+1 all year — no daylight
 * saving — so the conversion is a fixed hour, not a timezone database.
 *
 * Days are passed around as 'YYYY-MM-DD' strings (DayKey): comparable
 * with <, safe as React keys, and free of the UTC-midnight shift that
 * `new Date('2026-10-01')` introduces.
 */

export type DayKey = string;

const WAT_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function toKey(y: number, m: number, d: number): DayKey {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toISOString().slice(0, 10);
}

function parts(key: DayKey): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y, m, d];
}

/** Today's date in Lagos. */
export function todayKey(now = new Date()): DayKey {
  return new Date(now.getTime() + WAT_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = parts(key);
  return toKey(y, m, d + n);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: DayKey, b: DayKey): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/** 00:00 Lagos time on that day. */
export function startOfDay(key: DayKey): Date {
  const [y, m, d] = parts(key);
  return new Date(Date.UTC(y, m - 1, d) - WAT_OFFSET_MS);
}

/** The instant the day ends — 00:00 Lagos on the following day. */
export function endOfDay(key: DayKey): Date {
  return startOfDay(addDays(key, 1));
}

/**
 * When a deal booked to start on `key` goes live. Today means now — a
 * shop booking at 3pm wants it up at 3pm, not backdated to midnight
 * (which the database would refuse as "in the past").
 */
export function startsAtFor(key: DayKey, now = new Date()): Date {
  return key === todayKey(now) ? now : startOfDay(key);
}

/** "Fri 25 Sep" — weekday included, because shops plan by the week. */
export function formatDay(key: DayKey): string {
  return startOfDay(key).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Africa/Lagos',
  });
}

/** "25 Sep, 14:05" in Lagos time, for timestamps coming back from the database. */
export function formatInstant(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Lagos',
  });
}

/** The Lagos day an instant falls on. */
export function keyOf(iso: string): DayKey {
  return todayKey(new Date(iso));
}

/** Rows of a month grid, Monday first. Null cells pad the edges. */
export function monthGrid(year: number, month: number): (DayKey | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (DayKey | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(toKey(year, month, d));
  while (cells.length % 7) cells.push(null);
  const rows: (DayKey | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}
