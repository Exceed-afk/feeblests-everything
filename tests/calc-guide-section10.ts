// docs/calculator-testing-guide.md — Section 10: Date and time.
// Run on its own:  npx tsx tests/calc-guide-section10.ts
import {
  dateDifference, addDateInterval, subtractDateInterval, calculateAgeDetailed,
  businessDaysBetween, addBusinessDays, parseDuration, formatDuration, durationArithmetic, timeZoneConvert
} from '../src/shared/calculator/modules/datetime'
import { GuideSuite, finish, expectText, expectError, GuideMismatch } from './calc-guide-common'

export const suite = new GuideSuite('Section 10: Date and time', 'Date & Time')

// ---------- Date differences and arithmetic ----------
suite.test('Days between 2023-01-01 and 2024-01-01', '2023-01-01 -> 2024-01-01', '365', () =>
  expectText(String(dateDifference('2023-01-01', '2024-01-01').days), '365'))
suite.test('Days between 2024-01-01 and 2025-01-01', '2024-01-01 -> 2025-01-01', '366 (leap year)', () =>
  expectText(String(dateDifference('2024-01-01', '2025-01-01').days), '366'))
suite.test('Days between 2024-01-01 and 2024-12-31', '2024-01-01 -> 2024-12-31', '365', () =>
  expectText(String(dateDifference('2024-01-01', '2024-12-31').days), '365'))
suite.test('2024-02-15 plus 30 days', '2024-02-15 + 30 days', '2024-03-16', () =>
  expectText(addDateInterval('2024-02-15', { days: 30 }), '2024-03-16'))
suite.test('2024-01-31 plus 1 month', '2024-01-31 + 1 month', '2024-02-29 (clamped to the month end)', () =>
  expectText(addDateInterval('2024-01-31', { months: 1 }), '2024-02-29'))
suite.test('2024-02-29 plus 1 year', '2024-02-29 + 1 year', '2025-02-28 (or 2025-03-01)', () => {
  const r = addDateInterval('2024-02-29', { years: 1 })
  if (r !== '2025-02-28' && r !== '2025-03-01') throw new GuideMismatch(r)
  return { actual: r }
})
suite.test('2024-03-31 minus 1 month', '2024-03-31 - 1 month', '2024-02-29', () =>
  expectText(subtractDateInterval('2024-03-31', { months: 1 }), '2024-02-29'))
suite.test('Friday plus 1 business day', '2024-01-12 (Fri) + 1', 'Following Monday (2024-01-15)', () =>
  expectText(addBusinessDays('2024-01-12', 1), '2024-01-15'))
suite.test('Monday plus 5 business days', '2024-01-15 (Mon) + 5', 'Next Monday (2024-01-22)', () =>
  expectText(addBusinessDays('2024-01-15', 5), '2024-01-22'))
suite.test('Business days between two dates', '2024-01-15 (Mon) -> 2024-01-22 (Mon)', '5', () =>
  expectText(String(businessDaysBetween('2024-01-15', '2024-01-22')), '5'))
suite.todo('Business days with a holiday list', 'holidays skipped', 'Holidays are skipped', 'No holiday calendar in the date module')

// ---------- Age ----------
suite.test('Born 1990-06-15, on 2026-06-14', '1990-06-15 @ 2026-06-14', '35', () =>
  expectText(String(calculateAgeDetailed('1990-06-15', '2026-06-14').years), '35'))
suite.test('Born 1990-06-15, on 2026-06-15', '1990-06-15 @ 2026-06-15', '36', () =>
  expectText(String(calculateAgeDetailed('1990-06-15', '2026-06-15').years), '36'))
suite.test('Born 2000-02-29 (leap day), on 2024-02-28', '2000-02-29 @ 2024-02-28', '23', () =>
  expectText(String(calculateAgeDetailed('2000-02-29', '2024-02-28').years), '23'))
suite.test('Born 2000-02-29 (leap day), on 2024-02-29', '2000-02-29 @ 2024-02-29', '24', () =>
  expectText(String(calculateAgeDetailed('2000-02-29', '2024-02-29').years), '24'))
suite.test('Birth date in the future', '2030-01-01 @ 2026-01-01', 'A clear error', () =>
  expectError(() => calculateAgeDetailed('2030-01-01', '2026-01-01'), /future|after/i),
  'dateDifference takes the absolute difference, so a future birth date silently gives a positive age')

// ---------- Duration arithmetic ----------
suite.test('2h 30m + 45m', '2h 30m + 45m', '3h 15m', () => expectText(durationArithmetic('2h 30m', '+', '45m').formatted, '3h 15m'))
suite.test('90m', '90m', '1h 30m', () => expectText(formatDuration(parseDuration('90m')), '1h 30m'))
suite.test('1h 45m * 2', '1h 45m * 2', '3h 30m', () => expectText(formatDuration(parseDuration('1h 45m') * 2), '3h 30m'))
suite.test('1h - 90m', '1h - 90m', '-30m (or a clear rule)', () => expectText(durationArithmetic('1h', '-', '90m').formatted, '-30m'))
suite.test('24h', '24h', '1 day (or 24h)', () => {
  const r = formatDuration(parseDuration('24h'))
  if (r !== '1d' && r !== '24h') throw new GuideMismatch(r)
  return { actual: r }
})

// ---------- Time zones and daylight saving ----------
suite.test('12:00 UTC in New York in July', '2024-07-15 12:00 UTC -> UTC-4', '08:00', () =>
  expectText(timeZoneConvert('2024-07-15 12:00', 0, -4), '2024-07-15 08:00'))
suite.test('12:00 UTC in New York in January', '2024-01-15 12:00 UTC -> UTC-5', '07:00', () =>
  expectText(timeZoneConvert('2024-01-15 12:00', 0, -5), '2024-01-15 07:00'))
suite.test('12:00 UTC in Tokyo', '2024-01-15 12:00 UTC -> UTC+9', '21:00', () =>
  expectText(timeZoneConvert('2024-01-15 12:00', 0, 9), '2024-01-15 21:00'))
suite.test('12:00 UTC in London in July', '2024-07-15 12:00 UTC -> UTC+1', '13:00', () =>
  expectText(timeZoneConvert('2024-07-15 12:00', 0, 1), '2024-07-15 13:00'))
suite.test('12:00 UTC in London in January', '2024-01-15 12:00 UTC -> UTC+0', '12:00', () =>
  expectText(timeZoneConvert('2024-01-15 12:00', 0, 0), '2024-01-15 12:00'))
suite.todo('US DST start day: 01:30 New York + 1 hour = 03:30', '2024-03-10 01:30 NY + 1h', '03:30', 'timeZoneConvert takes fixed offsets, not IANA zone transitions')
suite.test('Date at midnight conversions do not shift the date', '2024-01-15 00:00 UTC -> UTC', '2024-01-15 00:00', () =>
  expectText(timeZoneConvert('2024-01-15 00:00', 0, 0), '2024-01-15 00:00'))

// ---------- Countdown and today ----------
suite.test('Countdown to a date next month', '2026-11-06 -> 2026-12-06', '30 days', () =>
  expectText(String(dateDifference('2026-11-06', '2026-12-06').days), '30'))
suite.skip('"Today" matches the computer\'s date', 'Today button', 'Matches the system date', 'Needs the running app')
suite.test('Invalid date: 2024-02-30', '2024-02-30', 'A clear error', () =>
  expectError(() => dateDifference('2024-02-30', '2024-03-01'), /not a real calendar date/i))
suite.test('Invalid date: 2024-13-01', '2024-13-01', 'A clear error', () =>
  expectError(() => dateDifference('2024-13-01', '2024-03-01'), /not a real calendar date/i))
suite.test('Other date formats are rejected, not guessed', '03/05/2024', 'A clear error (no silent day/month mix-up)', () =>
  expectError(() => dateDifference('03/05/2024', '2024-03-06'), /YYYY-MM-DD/i))

finish(suite)
