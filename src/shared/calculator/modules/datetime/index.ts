import { CalcError } from '../../errors'
import { toDecimalInput, toIntegerInput, toStringInput } from '../../inputs'

export interface DateDifferenceResult {
  days: number
  years: number
  months: number
  daysRemainder: number
}

export interface DateInterval {
  days?: number
  weeks?: number
  months?: number
  years?: number
}

/** Date ranges beyond 1,000 years are meaningless here and would take long to walk day by day. */
const MAX_DATE_RANGE_DAYS = 366_000
/** Business-day arithmetic is a loop; cap the count so a typo cannot freeze the UI. */
const MAX_BUSINESS_DAYS = 100_000
/** Offsets beyond +/- 14h do not exist on Earth. */
const MAX_OFFSET_HOURS = 14

/**
 * Strict YYYY-MM-DD gate: right shape, real calendar date. "2024-13-45" or "abc"
 * would otherwise become Invalid Date and silently produce NaN results.
 */
function parseYMD(dateStr: unknown, what = 'date'): Date {
  const text = toStringInput(dateStr, what)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim())
  if (!match) throw new CalcError(`${what} must be in YYYY-MM-DD form (got "${text}")`)
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  // Use UTC to prevent local daylight saving shift
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new CalcError(`${what} "${text}" is not a real calendar date`)
  }
  return date
}

function formatYMD(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Interval fields: optional whole numbers, bounded, so a bad value is caught before setUTCMonth. */
function intervalInput(interval: unknown): Required<DateInterval> {
  if (interval === null || typeof interval !== 'object') {
    throw new CalcError('interval must be an object like { days: 7 }')
  }
  const get = (key: keyof DateInterval): number => {
    const raw = (interval as DateInterval)[key]
    if (raw === undefined || raw === null) return 0
    return toIntegerInput(raw, `interval.${key}`, { min: -MAX_DATE_RANGE_DAYS, max: MAX_DATE_RANGE_DAYS })
  }
  return { days: get('days'), weeks: get('weeks'), months: get('months'), years: get('years') }
}

function offsetHours(value: unknown, what: string): number {
  const d = toDecimalInput(value, what)
  const n = d.toNumber()
  if (n < -MAX_OFFSET_HOURS || n > MAX_OFFSET_HOURS) {
    throw new CalcError(`${what} must be between -${MAX_OFFSET_HOURS} and ${MAX_OFFSET_HOURS} hours`)
  }
  return n
}

export function dateDifference(startDate: string, endDate: string): DateDifferenceResult {
  const d1 = parseYMD(startDate, 'start date')
  const d2 = parseYMD(endDate, 'end date')

  const diffMs = Math.abs(d2.getTime() - d1.getTime())
  const totalDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (totalDays > MAX_DATE_RANGE_DAYS) {
    throw new CalcError(`Date range is limited to ${MAX_DATE_RANGE_DAYS.toLocaleString('en-US')} days`)
  }

  const earlier = d1 <= d2 ? d1 : d2
  const later = d1 <= d2 ? d2 : d1

  let years = later.getUTCFullYear() - earlier.getUTCFullYear()
  let months = later.getUTCMonth() - earlier.getUTCMonth()
  let days = later.getUTCDate() - earlier.getUTCDate()

  if (days < 0) {
    months -= 1
    // Days in previous month
    const prevMonthDays = new Date(Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), 0)).getUTCDate()
    days += prevMonthDays
  }

  if (months < 0) {
    years -= 1
    months += 12
  }

  return {
    days: totalDays,
    years,
    months,
    daysRemainder: days
  }
}

export function addDateInterval(dateStr: string, interval: DateInterval): string {
  const d = parseYMD(dateStr)
  const { years, months, weeks, days } = intervalInput(interval)

  if (years) {
    d.setUTCFullYear(d.getUTCFullYear() + years)
  }
  if (months) {
    const origDay = d.getUTCDate()
    d.setUTCMonth(d.getUTCMonth() + months)
    // Month overflow clamping (e.g. Jan 31 + 1 month -> Feb 28/29)
    if (d.getUTCDate() < origDay) {
      d.setUTCDate(0)
    }
  }
  if (weeks) {
    d.setUTCDate(d.getUTCDate() + weeks * 7)
  }
  if (days) {
    d.setUTCDate(d.getUTCDate() + days)
  }

  return formatYMD(d)
}

export function subtractDateInterval(dateStr: string, interval: DateInterval): string {
  const { years, months, weeks, days } = intervalInput(interval)
  return addDateInterval(dateStr, { years: -years, months: -months, weeks: -weeks, days: -days })
}

export function calculateAgeDetailed(birthDate: string, asOfDate: string): { years: number; months: number; days: number } {
  const diff = dateDifference(birthDate, asOfDate)
  return {
    years: diff.years,
    months: diff.months,
    days: diff.daysRemainder
  }
}

export function businessDaysBetween(startDate: string, endDate: string): number {
  const d1 = parseYMD(startDate, 'start date')
  const d2 = parseYMD(endDate, 'end date')
  const span = Math.abs(d2.getTime() - d1.getTime()) / 86_400_000
  if (span > MAX_DATE_RANGE_DAYS) {
    throw new CalcError(`Date range is limited to ${MAX_DATE_RANGE_DAYS.toLocaleString('en-US')} days`)
  }
  const [from, to] = d1 <= d2 ? [d1, d2] : [d2, d1]
  const cur = new Date(from)
  let count = 0

  while (cur < to) {
    const day = cur.getUTCDay()
    if (day !== 0 && day !== 6) {
      count++
    }
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  return count
}

export function addBusinessDays(startDate: string, daysToAdd: number | string): string {
  const cur = parseYMD(startDate, 'start date')
  const target = toIntegerInput(daysToAdd, 'daysToAdd', { min: -MAX_BUSINESS_DAYS, max: MAX_BUSINESS_DAYS })
  const direction = target < 0 ? -1 : 1
  let added = 0

  while (added < Math.abs(target)) {
    cur.setUTCDate(cur.getUTCDate() + direction)
    const day = cur.getUTCDay()
    if (day !== 0 && day !== 6) {
      added++
    }
  }

  return formatYMD(cur)
}

// ---------- Duration Arithmetic ----------

/** Longest duration string: "1d 2h 3m 4s" repeated hundreds of times is still not a duration. */
const MAX_DURATION_LENGTH = 200

export function parseDuration(durStr: string): number {
  const text = toStringInput(durStr, 'duration')
  if (text.length > MAX_DURATION_LENGTH) {
    throw new CalcError(`Duration text is limited to ${MAX_DURATION_LENGTH} characters`)
  }
  let totalSec = 0
  const matches = text.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)
  let matched = false
  for (const m of matches) {
    matched = true
    const val = parseFloat(m[1])
    const unit = m[2].toLowerCase()
    switch (unit) {
      case 'd':
        totalSec += val * 86400
        break
      case 'h':
        totalSec += val * 3600
        break
      case 'm':
        totalSec += val * 60
        break
      case 's':
        totalSec += val
        break
    }
  }
  if (!matched && text.replace(/\s/g, '').length > 0) {
    throw new CalcError(`Duration "${text.slice(0, 24)}" must look like 2h 30m or 45s`)
  }
  if (!Number.isFinite(totalSec)) throw new CalcError(`Duration "${text.slice(0, 24)}" is too large`)
  return totalSec
}

export function formatDuration(totalSeconds: number | string): string {
  const total = toDecimalInput(totalSeconds, 'totalSeconds').toNumber()
  if (!Number.isFinite(total)) throw new CalcError('totalSeconds is too large')
  const sign = total < 0 ? '-' : ''
  let sec = Math.abs(total)

  const d = Math.floor(sec / 86400)
  sec %= 86400
  const h = Math.floor(sec / 3600)
  sec %= 3600
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)

  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0 || parts.length === 0) parts.push(`${s}s`)

  return sign + parts.join(' ')
}

export function durationArithmetic(
  dur1: string,
  op: '+' | '-',
  dur2: string
): { totalSeconds: number; formatted: string } {
  if (op !== '+' && op !== '-') throw new CalcError(`Operator must be + or - (got "${String(op)}")`)
  const s1 = parseDuration(dur1)
  const s2 = parseDuration(dur2)
  const total = op === '+' ? s1 + s2 : s1 - s2
  return { totalSeconds: total, formatted: formatDuration(total) }
}

// ---------- Time Zone Conversion ----------

export function timeZoneConvert(dateTimeStr: string, fromOffsetHours: number, toOffsetHours: number): string {
  const text = toStringInput(dateTimeStr, 'date and time')
  const from = offsetHours(fromOffsetHours, 'fromOffsetHours')
  const to = offsetHours(toOffsetHours, 'toOffsetHours')

  const [datePart, timePart = '00:00'] = text.trim().split(' ')
  const date = parseYMD(datePart, 'date')
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timePart)
  if (!timeMatch) throw new CalcError(`Time must be HH:MM (got "${timePart}")`)
  const hh = Number(timeMatch[1])
  const mm = Number(timeMatch[2])
  if (hh > 23 || mm > 59) throw new CalcError(`Time "${timePart}" is not a valid time of day`)

  date.setUTCHours(hh, mm)
  const shiftHours = to - from
  date.setUTCHours(date.getUTCHours() + shiftHours)

  const resY = date.getUTCFullYear()
  const resM = String(date.getUTCMonth() + 1).padStart(2, '0')
  const resD = String(date.getUTCDate()).padStart(2, '0')
  const resH = String(date.getUTCHours()).padStart(2, '0')
  const resMin = String(date.getUTCMinutes()).padStart(2, '0')

  return `${resY}-${resM}-${resD} ${resH}:${resMin}`
}
