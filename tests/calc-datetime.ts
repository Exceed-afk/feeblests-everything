import assert from 'node:assert/strict'
import {
  dateDifference,
  addDateInterval,
  subtractDateInterval,
  calculateAgeDetailed,
  businessDaysBetween,
  addBusinessDays,
  parseDuration,
  formatDuration,
  durationArithmetic,
  timeZoneConvert
} from '../src/shared/calculator/modules/datetime'

let checks = 0
const ok = () => { checks++ }

// ---------- 1. Date Differences ----------
// Difference between 2024-01-01 and 2024-01-15 is 14 days
const diff1 = dateDifference('2024-01-01', '2024-01-15')
assert.equal(diff1.days, 14); ok()

// Across leap year: 2024-02-28 to 2024-03-01 is 2 days (leap year has Feb 29)
const diffLeap = dateDifference('2024-02-28', '2024-03-01')
assert.equal(diffLeap.days, 2); ok()

// Across non-leap year: 2023-02-28 to 2023-03-01 is 1 day
const diffNonLeap = dateDifference('2023-02-28', '2023-03-01')
assert.equal(diffNonLeap.days, 1); ok()

// Exact Y, M, D breakdown: 2020-01-15 to 2022-03-20 -> 2 years, 2 months, 5 days
const diffDetailed = dateDifference('2020-01-15', '2022-03-20')
assert.equal(diffDetailed.years, 2); ok()
assert.equal(diffDetailed.months, 2); ok()
assert.equal(diffDetailed.daysRemainder, 5); ok()

// ---------- 2. Add / Subtract Date Intervals ----------
// 2024-01-31 + 1 month -> 2024-02-29 (clamped to end of month)
assert.equal(addDateInterval('2024-01-31', { months: 1 }), '2024-02-29'); ok()

// 2024-03-15 - 10 days -> 2024-03-05
assert.equal(subtractDateInterval('2024-03-15', { days: 10 }), '2024-03-05'); ok()

// 2024-01-01 + 2 weeks -> 2024-01-15
assert.equal(addDateInterval('2024-01-01', { weeks: 2 }), '2024-01-15'); ok()

// ---------- 3. Business Days ----------
// Monday 2024-01-08 to Friday 2024-01-12 (Mon, Tue, Wed, Thu -> 4 working days span)
assert.equal(businessDaysBetween('2024-01-08', '2024-01-12'), 4); ok()

// Add 5 business days to Friday 2024-01-05 -> skips Sat/Sun -> Friday 2024-01-12
assert.equal(addBusinessDays('2024-01-05', 5), '2024-01-12'); ok()

// ---------- 4. Age Calculation ----------
// Born 2000-05-15, as of 2024-11-04 -> 24 years, 5 months, 20 days
const age = calculateAgeDetailed('2000-05-15', '2024-11-04')
assert.equal(age.years, 24); ok()
assert.equal(age.months, 5); ok()
assert.equal(age.days, 20); ok()

// ---------- 5. Duration Arithmetic ----------
// 2h 30m + 45m = 3h 15m (11700 seconds)
const durRes1 = durationArithmetic('2h 30m', '+', '45m')
assert.equal(durRes1.formatted, '3h 15m'); ok()
assert.equal(durRes1.totalSeconds, 11700); ok()

// 1d 4h - 10h = 18h (64800 seconds)
const durRes2 = durationArithmetic('1d 4h', '-', '10h')
assert.equal(durRes2.formatted, '18h'); ok()

// Parsing duration formats
assert.equal(parseDuration('1h 20m 10s'), 4810); ok()
assert.equal(parseDuration('90m'), 5400); ok()
assert.equal(formatDuration(4810), '1h 20m 10s'); ok()

// ---------- 6. Time Zone Conversion ----------
// 2024-11-04 12:00 in UTC -> UTC+3 is 15:00
const tzConverted = timeZoneConvert('2024-11-04 12:00', 0, 3)
assert.equal(tzConverted, '2024-11-04 15:00'); ok()

console.log(`ok   ${checks} datetime & duration tests passed`)
