import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ReorderButtons({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  return (
    <div className="flex gap-1">
      <Button size="icon" variant="ghost" className="size-6" disabled={!canMoveUp} onClick={onMoveUp}>
        <ChevronUp className="size-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="size-6" disabled={!canMoveDown} onClick={onMoveDown}>
        <ChevronDown className="size-3.5" />
      </Button>
    </div>
  )
}
