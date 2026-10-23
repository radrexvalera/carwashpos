// Returns the LOCAL calendar date as YYYY-MM-DD. Never build this via
// `date.toISOString().slice(0, 10)` -- toISOString() converts to UTC first, which silently
// shifts the date back by one day for roughly the first N hours of each local day in any
// timezone ahead of UTC (e.g. Philippines, UTC+8, for midnight-8am local time). That bug made
// every "today" date-picker default in this app actually default to yesterday during that
// window -- this is the one correct way to do it instead.
export function localDateString(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
