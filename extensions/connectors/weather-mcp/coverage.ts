/** 期望日期键 × 实际返回的逐日核对：缺失、重复与 null 值如实报告，不填零。 */

import type { CoverageReport, DailyRecord, WeatherField } from './types.ts';

function toTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function expectedDates(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let cursor = toTime(start), last = toTime(end); cursor <= last; cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

export function checkCoverage(daily: DailyRecord[], start: string, end: string, fields: WeatherField[]): CoverageReport {
  const counts = new Map<string, number>();
  for (const record of daily) counts.set(record.date, (counts.get(record.date) ?? 0) + 1);
  const missingDates: string[] = [];
  const duplicateDates: string[] = [];
  for (const date of expectedDates(start, end)) {
    const count = counts.get(date) ?? 0;
    if (count === 0) missingDates.push(date);
    else if (count > 1) duplicateDates.push(date);
  }
  const nullValueDates: CoverageReport['nullValueDates'] = {};
  for (const field of fields) {
    const dates = daily.filter(record => record.values[field] === null).map(record => record.date);
    if (dates.length) nullValueDates[field] = dates;
  }
  return {
    expectedCount: expectedDates(start, end).length,
    actualCount: daily.length,
    coverage: missingDates.length || duplicateDates.length ? 'partial' : 'complete',
    missingDates,
    duplicateDates,
    nullValueDates,
  };
}
