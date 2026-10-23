// Lets an admin add a new staff login (cashier, manager, admin, etc.) directly from the app.
// Creating another person's password-protected account needs the service-role key, which must
// never reach the browser -- this function is the one place that key is used, and only after
// verifying (via the CALLER's own JWT, respecting RLS) that they're allowed to do this.
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

  // Runs AS the caller (their JWT, RLS applies) -- used only to verify who they are and whether
  // they're allowed to do this. Never used for the privileged writes below.
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })

  const { data: userRes, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !userRes.user) return json({ error: 'Not authenticated' }, 401)

  const { data: tenantId } = await callerClient.rpc('current_tenant_id')
  if (!tenantId) return json({ error: 'No active tenant' }, 403)

  const { data: allowed } = await callerClient.rpc('has_permission', { perm_key: 'can_manage_employees' })
  if (!allowed) return json({ error: 'Not authorized to add users' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const fullName = String(body.fullName ?? '').trim()
  const roleIds = Array.isArray(body.roleIds) ? body.roleIds.map(String) : []
  const employeeId = body.employeeId ? String(body.employeeId) : null
  const nickname = body.nickname ? String(body.nickname) : null
  const mobile = body.mobile ? String(body.mobile) : null
  const employeeCode = body.employeeCode ? String(body.employeeCode) : null
  const hireDate = body.hireDate ? String(body.hireDate) : null
  const salaryRate = typeof body.salaryRate === 'number' ? body.salaryRate : null
  const salaryRateType = body.salaryRateType ? String(body.salaryRateType) : null

  if (!email || !password || !fullName || roleIds.length === 0) {
    return json({ error: 'email, password, fullName, and at least one role are required' }, 400)
  }
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400)

  // Privileged client -- service role, bypasses RLS. Only used from here on, and only after the
  // permission check above passed.
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: roles, error: rolesErr } = await adminClient
    .from('roles')
    .select('id, key')
    .eq('tenant_id', tenantId)
    .in('id', roleIds)
  if (rolesErr || !roles || roles.length !== roleIds.length) {
    return json({ error: 'One or more roles were not found' }, 400)
  }
  // The legacy user_profiles.role column (check-constrained to admin/manager/cashier) still gates
  // a handful of pre-RBAC tables (locations, user_profiles itself). The real permission set comes
  // from employee_roles/role_permissions below regardless of this value.
  const roleKeys = roles.map((r) => r.key)
  const legacyRole = roleKeys.includes('admin') ? 'admin' : roleKeys.includes('manager') ? 'manager' : 'cashier'

  if (employeeId) {
    const { data: existing, error: existingErr } = await adminClient
      .from('employees')
      .select('id, user_id')
      .eq('id', employeeId)
      .eq('tenant_id', tenantId)
      .single()
    if (existingErr || !existing) return json({ error: 'Employee not found' }, 400)
    if (existing.user_id) return json({ error: 'This employee already has a login' }, 400)
  }

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr || !created.user) return json({ error: createErr?.message ?? 'Failed to create user' }, 400)
  const newUserId = created.user.id

  try {
    const { error: profileErr } = await adminClient
      .from('user_profiles')
      .insert({ id: newUserId, tenant_id: tenantId, role: legacyRole, full_name: fullName })
    if (profileErr) throw profileErr

    let finalEmployeeId = employeeId
    if (finalEmployeeId) {
      const { error: linkErr } = await adminClient
        .from('employees')
        .update({ user_id: newUserId })
        .eq('id', finalEmployeeId)
        .eq('tenant_id', tenantId)
      if (linkErr) throw linkErr
    } else {
      const { data: emp, error: empErr } = await adminClient
        .from('employees')
        .insert({
          tenant_id: tenantId,
          user_id: newUserId,
          full_name: fullName,
          nickname,
          mobile,
          employee_code: employeeCode,
          hire_date: hireDate,
          salary_rate: salaryRate,
          salary_rate_type: salaryRateType,
        })
        .select('id')
        .single()
      if (empErr) throw empErr
      finalEmployeeId = emp.id
    }

    const { error: roleLinkErr } = await adminClient
      .from('employee_roles')
      .insert(roleIds.map((roleId) => ({ employee_id: finalEmployeeId, role_id: roleId })))
    if (roleLinkErr) throw roleLinkErr

    return json({ userId: newUserId, employeeId: finalEmployeeId })
  } catch (inner) {
    // Roll back the auth user so a failed setup doesn't leave an orphaned login with no profile.
    await adminClient.auth.admin.deleteUser(newUserId)
    const message = inner instanceof Error ? inner.message : 'Failed to finish setting up the user'
    return json({ error: message }, 500)
  }
})
