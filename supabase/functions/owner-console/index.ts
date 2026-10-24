// Cross-tenant subscriber management for the SaaS owner (trial status, extend/clear trial_ends_at)
// -- deliberately NOT a page inside the normal tenant app, since every other screen there is
// scoped by RLS to the caller's own tenant. This needs to see and edit every tenant's row, which
// means it needs the service-role key, which must never reach the browser. The REAL security
// boundary is the email allowlist check below (OWNER_CONSOLE_EMAILS), done under the caller's own
// JWT before the privileged client is ever created -- the frontend route being unlisted in the nav
// is just obscurity, not the actual gate.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const allowedEmails = (Deno.env.get('OWNER_CONSOLE_EMAILS') ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  // Runs AS the caller (their JWT) -- used only to find out who they are. Never used for the
  // privileged reads/writes below.
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userRes, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !userRes.user?.email) return json({ error: 'Not authenticated' }, 401)

  const callerEmail = userRes.user.email.toLowerCase()
  if (allowedEmails.length === 0 || !allowedEmails.includes(callerEmail)) {
    return json({ error: 'Not authorized' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const action = String(body.action ?? '')

  // Privileged client -- service role, bypasses RLS. Only used from here on, and only after the
  // allowlist check above passed.
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  if (action === 'list') {
    const { data: tenants, error: tenantsErr } = await adminClient
      .from('tenants')
      .select('id, name, created_at, trial_ends_at')
      .order('created_at', { ascending: false })
    if (tenantsErr) return json({ error: tenantsErr.message }, 500)

    const { data: profiles, error: profilesErr } = await adminClient
      .from('user_profiles')
      .select('id, tenant_id, created_at')
      .eq('role', 'admin')
      .order('created_at', { ascending: true })
    if (profilesErr) return json({ error: profilesErr.message }, 500)

    // auth.users isn't exposed via the normal table API -- this is the Admin API's listUsers(),
    // which the service role is allowed to call. Paginated at 1000/page; fine at this product's
    // current scale, would need to loop pages if the user base ever gets much larger than that.
    const { data: usersPage, error: usersErr } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
    if (usersErr) return json({ error: usersErr.message }, 500)
    const emailById = new Map(usersPage.users.map((u) => [u.id, u.email ?? null]))

    // First admin user_profiles row per tenant (by created_at) stands in for "the owner's login" --
    // a tenant can have more than one admin, but this is just an identifying label, not a security
    // check, so the earliest one is a reasonable, stable pick.
    const adminEmailByTenant = new Map<string, string>()
    for (const p of profiles ?? []) {
      if (adminEmailByTenant.has(p.tenant_id)) continue
      const email = emailById.get(p.id)
      if (email) adminEmailByTenant.set(p.tenant_id, email)
    }

    const rows = (tenants ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.created_at,
      trialEndsAt: t.trial_ends_at,
      adminEmail: adminEmailByTenant.get(t.id) ?? null,
    }))

    return json({ tenants: rows })
  }

  if (action === 'update_trial') {
    const tenantId = String(body.tenantId ?? '')
    if (!tenantId) return json({ error: 'tenantId is required' }, 400)

    const trialEndsAtRaw = body.trialEndsAt
    let trialEndsAt: string | null
    if (trialEndsAtRaw === null || trialEndsAtRaw === undefined || trialEndsAtRaw === '') {
      trialEndsAt = null
    } else {
      const parsed = new Date(String(trialEndsAtRaw))
      if (Number.isNaN(parsed.getTime())) return json({ error: 'Invalid trialEndsAt date' }, 400)
      trialEndsAt = parsed.toISOString()
    }

    const { error: updateErr } = await adminClient.from('tenants').update({ trial_ends_at: trialEndsAt }).eq('id', tenantId)
    if (updateErr) return json({ error: updateErr.message }, 500)

    return json({ id: tenantId, trialEndsAt })
  }

  return json({ error: `Unknown action "${action}"` }, 400)
})
