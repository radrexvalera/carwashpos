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

export type DateRangePreset = 'today' | 'last7Days' | 'thisMonth' | 'thisYear'

export const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last7Days', label: 'Last 7 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'thisYear', label: 'This Year' },
]

// All built from local Date fields (see localDateString's own note) -- never UTC-derived, so these
// stay correct right up to midnight local time regardless of the server/browser's own timezone.
export function getDateRangeForPreset(preset: DateRangePreset): { from: string; to: string } {
  const now = new Date()
  const to = localDateString(now)
  switch (preset) {
    case 'today':
      return { from: to, to }
    case 'last7Days': {
      const from = new Date(now)
      from.setDate(from.getDate() - 6)
      return { from: localDateString(from), to }
    }
    case 'thisMonth':
      return { from: localDateString(new Date(now.getFullYear(), now.getMonth(), 1)), to }
    case 'thisYear':
      return { from: localDateString(new Date(now.getFullYear(), 0, 1)), to }
  }
}
