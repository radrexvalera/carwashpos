import { supabase } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

export type VehicleInspection = Database['public']['Tables']['vehicle_inspections']['Row']

const BUCKET = 'vehicle-inspection-photos'

export interface InspectionPhoto {
  id: string
  storagePath: string
  caption: string | null
  url: string | null
}

export interface InspectionWithPhotos extends VehicleInspection {
  photos: InspectionPhoto[]
}

// Bucket is private -- every read resolves a fresh signed URL rather than a public one.
export async function getInspectionForJob(jobId: string): Promise<InspectionWithPhotos | null> {
  const { data: inspection, error } = await supabase.from('vehicle_inspections').select('*').eq('job_id', jobId).maybeSingle()
  if (error) throw error
  if (!inspection) return null

  const { data: photos, error: photosError } = await supabase
    .from('vehicle_inspection_photos')
    .select('*')
    .eq('inspection_id', inspection.id)
    .order('created_at', { ascending: true })
  if (photosError) throw photosError

  const resolved = await Promise.all(
    (photos ?? []).map(async (p) => {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(p.storage_path, 3600)
      return { id: p.id, storagePath: p.storage_path, caption: p.caption, url: signed?.signedUrl ?? null }
    }),
  )

  return { ...inspection, photos: resolved }
}

// Inserts the header row only if one doesn't already exist for this job (unique(job_id) backs
// this up server-side too) -- same "insert once, reuse thereafter" shape as any other feature
// where a dialog can be reopened on the same record.
export async function getOrCreateInspection(tenantId: string, jobId: string) {
  const { data: existing, error: existingError } = await supabase
    .from('vehicle_inspections')
    .select('id')
    .eq('job_id', jobId)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) return existing.id as string

  const { data, error } = await supabase
    .from('vehicle_inspections')
    .insert({ tenant_id: tenantId, job_id: jobId })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function updateInspectionNotes(inspectionId: string, notes: string) {
  const { error } = await supabase.from('vehicle_inspections').update({ notes: notes || null }).eq('id', inspectionId)
  if (error) throw error
}

export async function uploadInspectionPhoto(tenantId: string, jobId: string, inspectionId: string, file: File) {
  const path = `${tenantId}/${jobId}/${crypto.randomUUID()}-${file.name}`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type })
  if (uploadError) throw uploadError

  const { error: insertError } = await supabase
    .from('vehicle_inspection_photos')
    .insert({ tenant_id: tenantId, inspection_id: inspectionId, storage_path: path })
  if (insertError) throw insertError
}
