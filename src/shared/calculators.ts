export type UnitCategory = 'length' | 'mass' | 'temperature' | 'volume' | 'area' | 'speed'

export const UNIT_OPTIONS: Record<UnitCategory, { id: string; label: string; factor?: number }[]> = {
  length: [
    { id: 'mm', label: 'Millimetres (mm)', factor: 0.001 },
    { id: 'cm', label: 'Centimetres (cm)', factor: 0.01 },
    { id: 'm', label: 'Metres (m)', factor: 1 },
    { id: 'km', label: 'Kilometres (km)', factor: 1000 },
    { id: 'in', label: 'Inches (in)', factor: 0.0254 },
    { id: 'ft', label: 'Feet (ft)', factor: 0.3048 },
    { id: 'yd', label: 'Yards (yd)', factor: 0.9144 },
    { id: 'mi', label: 'Miles (mi)', factor: 1609.344 }
  ],
  mass: [
    { id: 'mg', label: 'Milligrams (mg)', factor: 0.000001 },
    { id: 'g', label: 'Grams (g)', factor: 0.001 },
    { id: 'kg', label: 'Kilograms (kg)', factor: 1 },
    { id: 'oz', label: 'Ounces (oz)', factor: 0.028349523125 },
    { id: 'lb', label: 'Pounds (lb)', factor: 0.45359237 }
  ],
  temperature: [
    { id: 'c', label: 'Celsius (°C)' },
    { id: 'f', label: 'Fahrenheit (°F)' },
    { id: 'k', label: 'Kelvin (K)' }
  ],
  volume: [
    { id: 'ml', label: 'Millilitres (mL)', factor: 0.001 },
    { id: 'l', label: 'Litres (L)', factor: 1 },
    { id: 'm3', label: 'Cubic metres (m³)', factor: 1000 },
    { id: 'tsp', label: 'Teaspoons (US)', factor: 0.00492892159375 },
    { id: 'tbsp', label: 'Tablespoons (US)', factor: 0.01478676478125 },
    { id: 'cup', label: 'Cups (US)', factor: 0.2365882365 },
    { id: 'pt', label: 'Pints (US)', factor: 0.473176473 },
    { id: 'qt', label: 'Quarts (US)', factor: 0.946352946 },
    { id: 'gal', label: 'Gallons (US)', factor: 3.785411784 }
  ],
  area: [
    { id: 'm2', label: 'Square metres (m²)', factor: 1 },
    { id: 'km2', label: 'Square kilometres (km²)', factor: 1_000_000 },
    { id: 'ha', label: 'Hectares (ha)', factor: 10_000 },
    { id: 'ft2', label: 'Square feet (ft²)', factor: 0.09290304 },
    { id: 'acre', label: 'Acres', factor: 4046.8564224 }
  ],
  speed: [
    { id: 'mps', label: 'Metres per second (m/s)', factor: 1 },
    { id: 'kph', label: 'Kilometres per hour (km/h)', factor: 1 / 3.6 },
    { id: 'mph', label: 'Miles per hour (mph)', factor: 0.44704 }
  ]
}

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'THB', 'SGD', 'NZD'] as const
export type CurrencyCode = (typeof CURRENCIES)[number]

export function loanPayment(principal: number, annualRatePercent: number, termMonths: number): number | null {
  if (![principal, annualRatePercent, termMonths].every(Number.isFinite) || principal <= 0 ||
      annualRatePercent < 0 || termMonths <= 0 || !Number.isInteger(termMonths)) return null
  const monthlyRate = annualRatePercent / 1200
  if (monthlyRate === 0) return principal / termMonths
  const growth = (1 + monthlyRate) ** termMonths
  return principal * monthlyRate * growth / (growth - 1)
}

export function compoundInterest(principal: number, annualRatePercent: number, years: number, periodsPerYear: number): {
  total: number
  interest: number
} | null {
  if (![principal, annualRatePercent, years, periodsPerYear].every(Number.isFinite) ||
      principal < 0 || annualRatePercent < 0 || years < 0 || periodsPerYear <= 0) return null
  const total = principal * (1 + annualRatePercent / (100 * periodsPerYear)) ** (periodsPerYear * years)
  return Number.isFinite(total) ? { total, interest: total - principal } : null
}

export function tipSplit(bill: number, tipPercent: number, people: number): {
  tip: number
  total: number
  perPerson: number
} | null {
  if (![bill, tipPercent, people].every(Number.isFinite) || bill < 0 || tipPercent < 0 ||
      people < 1 || !Number.isInteger(people)) return null
  const tip = bill * tipPercent / 100
  return { tip, total: bill + tip, perPerson: (bill + tip) / people }
}

export function percentOf(value: number, percent: number): number | null {
  if (![value, percent].every(Number.isFinite)) return null
  return value * percent / 100
}

export function percentChange(from: number, to: number): number | null {
  if (![from, to].every(Number.isFinite) || from === 0) return null
  return (to - from) / Math.abs(from) * 100
}

export function asPercentage(part: number, whole: number): number | null {
  if (![part, whole].every(Number.isFinite) || whole === 0) return null
  return part / whole * 100
}

function temperatureToCelsius(value: number, unit: string): number {
  if (unit === 'f') return (value - 32) * 5 / 9
  if (unit === 'k') return value - 273.15
  return value
}

function celsiusToTemperature(value: number, unit: string): number {
  if (unit === 'f') return value * 9 / 5 + 32
  if (unit === 'k') return value + 273.15
  return value
}

export function convertUnit(value: number, category: UnitCategory, from: string, to: string): number | null {
  if (!Number.isFinite(value)) return null
  const units = UNIT_OPTIONS[category]
  const source = units.find((unit) => unit.id === from)
  const target = units.find((unit) => unit.id === to)
  if (!source || !target) return null
  if (category === 'temperature') {
    const celsius = temperatureToCelsius(value, from)
    if (from === 'k' && value < 0) return null
    const converted = celsiusToTemperature(celsius, to)
    return to === 'k' && converted < 0 ? null : converted
  }
  if (source.factor === undefined || target.factor === undefined) return null
  return value * source.factor / target.factor
}

export function convertCurrency(amount: number, rate: number): number | null {
  if (![amount, rate].every(Number.isFinite) || amount < 0 || rate <= 0) return null
  return amount * rate
}

function dateParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 &&
    date.getUTCDate() === parts[2] ? parts : null
}

function utcDay(parts: [number, number, number]): number {
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86_400_000
}

export function dateDifferenceDays(first: string, second: string): number | null {
  const a = dateParts(first)
  const b = dateParts(second)
  return a && b ? Math.abs(utcDay(a) - utcDay(b)) : null
}

export function calculateAge(birthDate: string, asOfDate: string): { years: number; months: number; days: number } | null {
  const birth = dateParts(birthDate)
  const asOf = dateParts(asOfDate)
  if (!birth || !asOf || utcDay(asOf) < utcDay(birth)) return null

  const [birthYear, birthMonth, birthDay] = birth
  const [asOfYear, asOfMonth, asOfDay] = asOf
  let years = asOfYear - birthYear
  const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()
  const birthdayThisYear = Math.min(birthDay, daysInMonth(asOfYear, birthMonth))
  if (asOfMonth < birthMonth || (asOfMonth === birthMonth && asOfDay < birthdayThisYear)) years--

  const anniversaryYear = birthYear + years
  const anniversaryDay = Math.min(birthDay, daysInMonth(anniversaryYear, birthMonth))
  let months = (asOfYear - anniversaryYear) * 12 + asOfMonth - birthMonth
  let monthYear = anniversaryYear + Math.floor((birthMonth - 1 + months) / 12)
  let month = (birthMonth - 1 + months) % 12 + 1
  let monthDay = Math.min(birthDay, daysInMonth(monthYear, month))
  if (asOfDay < monthDay) {
    months--
    monthYear = anniversaryYear + Math.floor((birthMonth - 1 + months) / 12)
    month = (birthMonth - 1 + months) % 12 + 1
    monthDay = Math.min(birthDay, daysInMonth(monthYear, month))
  }
  const days = utcDay(asOf) - utcDay([monthYear, month, monthDay])
  return { years, months, days }
}
