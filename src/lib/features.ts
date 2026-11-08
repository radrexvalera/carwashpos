import type { Json } from '@/lib/supabase/types'

// settings.features is a Json blob (e.g. {"repaint": true}) set only via the Owner Console --
// see 0095_tenant_feature_flags.sql. A tenant admin can't write it through the normal settings
// update path, so this is the single place the frontend should read a feature gate from. Anything
// missing, false, or malformed defaults to off.
export function hasFeature(features: Json | null | undefined, key: string): boolean {
  if (!features || typeof features !== 'object' || Array.isArray(features)) return false
  return features[key] === true
}
