import type { Json } from '@/lib/supabase/types'

// settings.features is a Json blob (e.g. {"repaint": true}) set only via the Owner Console --
// see 0095_tenant_feature_flags.sql. A tenant admin can't write it through the normal settings
// update path, so this is the single place the frontend should read a feature gate from. Anything
// missing, false, or malformed defaults to off.
export function hasFeature(features: Json | null | undefined, key: string): boolean {
  if (!features || typeof features !== 'object' || Array.isArray(features)) return false
  return features[key] === true
}

export interface CategoryGroup {
  key: string
  label: string
  // Exact service_categories.name this group matches -- mirrors the SQL side's
  // job_has_manual_commission_line() registry in 0098_tint_ppf_manual_commission.sql. Keep the two
  // in sync: adding a group here without adding it there means Collect Payment will show the
  // manual-commission UI for a job create_sale() then rejects.
  categoryName: string
  // Loose match for the Expenses page's expense_categories.name -- those are free-text tenant
  // admin input, not the structured service catalog, so (unlike categoryName) this stays a regex.
  expenseNamePattern: RegExp
}

// Business-specific service-category groups that get their own Sales Report / Expenses tab and
// manual commission, gated per-tenant by the matching settings.features key (see RoleGuard/
// OwnerConsolePage's KNOWN_FEATURES). Adding a new one is just a new entry here plus a matching row
// in job_has_manual_commission_line()'s SQL registry -- no other file needs a near-duplicate copy
// of the repaint/tint_ppf plumbing.
export const CATEGORY_GROUPS: CategoryGroup[] = [
  { key: 'repaint', label: 'Repaint', categoryName: 'Repaint', expenseNamePattern: /repaint/i },
  { key: 'tint_ppf', label: 'Ceramic Tint & PPF', categoryName: 'Tint & PPF', expenseNamePattern: /tint|ppf/i },
]

export function enabledCategoryGroups(features: Json | null | undefined): CategoryGroup[] {
  return CATEGORY_GROUPS.filter((g) => hasFeature(features, g.key))
}
