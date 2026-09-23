import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getVehicle, updateVehicle } from './api/vehiclesApi'

interface EditVehicleDialogProps {
  vehicleId: string | null
  sizes: { id: string; name: string }[]
  onOpenChange: (open: boolean) => void
  onSaved: (updated: { plateNumber: string; make: string | null; model: string | null; color: string | null; vehicleSizeId: string | null }) => void
}

// Fetches the full vehicle row itself rather than taking one as a prop -- Register and
// Appointments hold two different partial local shapes for a selected vehicle (a full Dexie
// VehicleRow vs. a narrow search-result type with no make/model/color), so refetching here avoids
// coupling this dialog to either page's specific type.
export function EditVehicleDialog({ vehicleId, sizes, onOpenChange, onSaved }: EditVehicleDialogProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [plateNumber, setPlateNumber] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [color, setColor] = useState('')
  const [vehicleSizeId, setVehicleSizeId] = useState('')

  useEffect(() => {
    if (!vehicleId) return
    setLoading(true)
    getVehicle(vehicleId)
      .then((v) => {
        setPlateNumber(v.plate_number)
        setMake(v.make ?? '')
        setModel(v.model ?? '')
        setColor(v.color ?? '')
        setVehicleSizeId(v.vehicle_size_id ?? '')
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load vehicle'))
      .finally(() => setLoading(false))
  }, [vehicleId])

  async function handleSave() {
    if (!vehicleId || !plateNumber.trim()) return
    setSaving(true)
    try {
      const input = {
        plateNumber: plateNumber.trim().toUpperCase(),
        make: make.trim() || null,
        model: model.trim() || null,
        color: color.trim() || null,
        vehicleSizeId: vehicleSizeId || null,
      }
      await updateVehicle(vehicleId, input)
      onSaved(input)
      toast.success('Vehicle updated')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update vehicle')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!vehicleId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit vehicle</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label>Plate</Label>
              <Input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Color</Label>
              <Input value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Make</Label>
              <Input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Model</Label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Fortuner" />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Vehicle size</Label>
              <Select value={vehicleSizeId} onValueChange={setVehicleSizeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select size" />
                </SelectTrigger>
                <SelectContent>
                  {sizes.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || loading || !plateNumber.trim()} onClick={handleSave}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
