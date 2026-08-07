import { createAdminClient } from '../_shared/db.ts'
import { requirePowerUser } from '../_shared/auth.ts'
import { errorResponse, HttpError, jsonResponse, readJson } from '../_shared/http.ts'
import { createManagedUser, publicUser, updateManagedUser } from '../_shared/users.ts'

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? ''
  const defaults = [
    'https://admin.mobileid.nedapdemo.xyz',
    'https://arn1986.github.io',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]
  const configured = (Deno.env.get('ADMIN_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const allowed = new Set([...defaults, ...configured])
  const allowOrigin = allowed.has(origin) ? origin : defaults[0]
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  }
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST')
    const { profile: adminProfile } = await requirePowerUser(req)
    const body = await readJson(req) as Record<string, unknown>
    const action = String(body.action ?? '')
    const admin = createAdminClient()
    const actor = `admin:${adminProfile.email}`

    if (action === 'bootstrap') {
      const { data: site, error: siteError } = await admin.from('sites').select('*').eq('id', adminProfile.site_id).single()
      if (siteError) throw new HttpError(500, 'site_lookup_failed', 'Unable to load site')
      return jsonResponse(
        {
          success: true,
          me: publicUser(adminProfile as unknown as Record<string, unknown>),
          site,
        },
        200,
        cors,
      )
    }

    if (action === 'listUsers') {
      const search = String(body.search ?? '').trim()
      let query = admin
        .from('profiles')
        .select('*')
        .eq('tenant_id', adminProfile.tenant_id)
        .order('created_at', { ascending: false })
        .limit(500)

      if (search) {
        const safe = search.replace(/[,%()]/g, ' ')
        query = query.or(
          `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,email.ilike.%${safe}%,external_id.ilike.%${safe}%,identifier_number.ilike.%${safe}%`,
        )
      }

      const { data, error } = await query
      if (error) throw new HttpError(500, 'user_list_failed', 'Unable to load users')
      return jsonResponse({ success: true, users: (data ?? []).map(publicUser) }, 200, cors)
    }

    if (action === 'createUser') {
      const profile = await createManagedUser(
        admin,
        adminProfile.tenant_id,
        body.user,
        actor,
        null,
      )
      return jsonResponse({ success: true, user: publicUser(profile) }, 201, cors)
    }

    if (action === 'updateUser') {
      const id = String(body.id ?? '')
      if (!id) throw new HttpError(400, 'validation_error', 'id is required')
      const profile = await updateManagedUser(
        admin,
        adminProfile.tenant_id,
        id,
        body.user,
        actor,
        null,
      )
      return jsonResponse({ success: true, user: publicUser(profile) }, 200, cors)
    }

    if (action === 'updateSite') {
      const input = (body.site ?? {}) as Record<string, unknown>
      const patch: Record<string, unknown> = {}

      if (input.bleReaderName !== undefined) {
        const name = String(input.bleReaderName).trim()
        if (!name) throw new HttpError(400, 'validation_error', 'BLE reader name cannot be empty')
        patch.ble_reader_name = name
      }
      for (const [incoming, column] of [
        ['badgeColorStart', 'badge_color_start'],
        ['badgeColorEnd', 'badge_color_end'],
      ] as const) {
        if (input[incoming] !== undefined) {
          const color = String(input[incoming]).trim().toUpperCase()
          if (!/^#[0-9A-F]{6}$/.test(color)) throw new HttpError(400, 'validation_error', `${incoming} must be #RRGGBB`)
          patch[column] = color
        }
      }
      if (input.logoPath !== undefined) patch.logo_path = input.logoPath ? String(input.logoPath) : null
      if (input.credentialTtlHours !== undefined) {
        const ttl = Number(input.credentialTtlHours)
        if (!Number.isInteger(ttl) || ttl < 1 || ttl > 720) {
          throw new HttpError(400, 'validation_error', 'credentialTtlHours must be an integer from 1 to 720')
        }
        patch.credential_ttl_hours = ttl
      }

      if (!Object.keys(patch).length) throw new HttpError(400, 'validation_error', 'No site changes were supplied')
      patch.config_version = Number((body.currentConfigVersion as number | undefined) ?? 0) + 1

      const { data: existing, error: existingError } = await admin
        .from('sites')
        .select('config_version')
        .eq('id', adminProfile.site_id)
        .eq('tenant_id', adminProfile.tenant_id)
        .single()
      if (existingError) throw new HttpError(500, 'site_lookup_failed', 'Unable to load site')
      patch.config_version = Number(existing.config_version) + 1

      const { data, error } = await admin
        .from('sites')
        .update(patch)
        .eq('id', adminProfile.site_id)
        .eq('tenant_id', adminProfile.tenant_id)
        .select('*')
        .single()
      if (error) throw new HttpError(500, 'site_update_failed', 'Unable to update site')

      await admin.from('credential_audit').insert({
        tenant_id: adminProfile.tenant_id,
        site_id: adminProfile.site_id,
        event_type: 'site_config_updated',
        actor,
        metadata: { changedFields: Object.keys(patch).filter((k) => k !== 'config_version') },
      })

      return jsonResponse({ success: true, site: data }, 200, cors)
    }

    if (action === 'audit') {
      const { data, error } = await admin
        .from('credential_audit')
        .select('id,event_type,actor,metadata,created_at,profile_id,api_client_id')
        .eq('tenant_id', adminProfile.tenant_id)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw new HttpError(500, 'audit_lookup_failed', 'Unable to load audit log')
      return jsonResponse({ success: true, events: data ?? [] }, 200, cors)
    }

    throw new HttpError(400, 'unknown_action', 'Unknown admin action')
  } catch (error) {
    return errorResponse(error, cors)
  }
})
