// Bangladesh (Asia/Dhaka) is a fixed UTC+6 with no DST, so period math is done with a fixed offset.
// Timestamps are stored in UTC; these helpers convert Dhaka calendar periods to UTC ranges.
export const TIMEZONE = "Asia/Dhaka";
const OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Period {
  start: Date; // inclusive
  end: Date; // exclusive
  label: string;
}

/** Dhaka calendar date parts of an instant. */
export function dhakaParts(d: Date) {
  const shifted = new Date(d.getTime() + OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

/** UTC instant of 00:00 Dhaka time for the given Dhaka calendar date. */
export function dhakaHour(d: Date): number {
  return new Date(d.getTime() + OFFSET_MS).getUTCHours();
}

export function dhakaMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - OFFSET_MS);
}

export function startOfDhakaDay(d: Date): Date {
  const p = dhakaParts(d);
  return dhakaMidnight(p.year, p.month, p.day);
}

export function dayKey(d: Date): string {
  const p = dhakaParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function dayPeriod(d = new Date()): Period {
  const start = startOfDhakaDay(d);
  return { start, end: addDays(start, 1), label: dayKey(start) };
}

/** Seven days ending with (and including) the Dhaka day of `d`. */
export function last7DaysPeriod(d = new Date()): Period {
  const end = addDays(startOfDhakaDay(d), 1);
  const start = addDays(end, -7);
  return { start, end, label: `${dayKey(start)}..${dayKey(addDays(end, -1))}` };
}

export function monthPeriod(year: number, month: number): Period {
  const start = dhakaMidnight(year, month, 1);
  const end = month === 12 ? dhakaMidnight(year + 1, 1, 1) : dhakaMidnight(year, month + 1, 1);
  return { start, end, label: `${year}-${String(month).padStart(2, "0")}` };
}

export function currentMonthPeriod(d = new Date()): Period {
  const p = dhakaParts(d);
  return monthPeriod(p.year, p.month);
}

export function previousMonthPeriod(d = new Date()): Period {
  const p = dhakaParts(d);
  return p.month === 1 ? monthPeriod(p.year - 1, 12) : monthPeriod(p.year, p.month - 1);
}

/** The period of the same length immediately before `p`. */
export function precedingPeriod(p: Period): Period {
  const len = p.end.getTime() - p.start.getTime();
  const start = new Date(p.start.getTime() - len);
  return { start, end: p.start, label: `${dayKey(start)}..${dayKey(addDays(p.start, -1))}` };
}

export function eachDay(p: Period): string[] {
  const out: string[] = [];
  for (let t = p.start.getTime(); t < p.end.getTime(); t += DAY_MS) out.push(dayKey(new Date(t)));
  return out;
}
