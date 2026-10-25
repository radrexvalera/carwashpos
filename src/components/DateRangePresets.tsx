import { Button } from '@/components/ui/button'
import { DATE_RANGE_PRESETS, getDateRangeForPreset } from '@/lib/date'

interface DateRangePresetsProps {
  onSelect: (range: { from: string; to: string }) => void
}

// Picking a preset just sets from/to the same as typing in the date inputs would -- the caller
// decides what happens next (both current callers reload immediately on selection).
export function DateRangePresets({ onSelect }: DateRangePresetsProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DATE_RANGE_PRESETS.map((preset) => (
        <Button
          key={preset.value}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onSelect(getDateRangeForPreset(preset.value))}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  )
}
