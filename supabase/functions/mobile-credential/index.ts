import { createAdminClient } from '../_shared/db.ts'
import { requireSignedInUser } from '../_shared/auth.ts'
import { errorResponse, HttpError, jsonResponse } from '../_shared/http.ts'
import { deriveKeyAHex } from '../_shared/mobileId.ts'

Deno.serve(async (req) => {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      throw new HttpError(405, 'method_not_allowed', 'Use GET or POST')
    }

    const user = await requireSignedInUser(req)
    const admin = createAdminClient()

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id,tenant_id,site_id,first_name,last_name,email,identifier_number,active')
      .eq('id', user.id)
      .maybeSingle()
    if (profileError) throw new HttpError(500, 'profile_lookup_failed', 'Unable to load credential profile')
    if (!profile || !profile.active) throw new HttpError(403, 'credential_inactive', 'This Mobile ID credential is inactive')
    if (!profile.identifier_number) throw new HttpError(409, 'identifier_missing', 'No Mobile ID identifier is assigned')

    const { data: site, error: siteError } = await admin
      .from('sites')
      .select('id,name,ble_reader_name,badge_color_start,badge_color_end,logo_path,credential_ttl_hours,config_version,active')
      .eq('id', profile.site_id)
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle()
    if (siteError) throw new HttpError(500, 'site_lookup_failed', 'Unable to load site configuration')
    if (!site || !site.active) throw new HttpError(403, 'site_inactive', 'This Mobile ID site is inactive')

    const mkey = Deno.env.get('MOBILE_ID_MKEY_HEX')?.trim().toUpperCase() ?? ''
    if (!/^[0-9A-F]{32}$/.test(mkey)) {
      throw new HttpError(503, 'mkey_not_configured', 'Mobile ID credential service is not configured')
    }

    const keyA = await deriveKeyAHex(mkey, profile.identifier_number)
    const expiresAt = new Date(Date.now() + Number(site.credential_ttl_hours) * 60 * 60 * 1000).toISOString()
    const logoUrl = site.logo_path
      ? admin.storage.from('badge-assets').getPublicUrl(site.logo_path).data.publicUrl
      : null

    await admin.from('profiles').update({ last_credential_issued_at: new Date().toISOString() }).eq('id', profile.id)
    await admin.from('credential_audit').insert({
      tenant_id: profile.tenant_id,
      site_id: profile.site_id,
      profile_id: profile.id,
      event_type: 'credential_issued',
      actor: `user:${profile.email}`,
      metadata: { expiresAt, configVersion: site.config_version },
    })

    return jsonResponse({
      success: true,
      user: {
        firstName: profile.first_name,
        lastName: profile.last_name,
        email: profile.email,
        identifierNumber: profile.identifier_number,
      },
      mobileId: {
        keyA,
        readerName: site.ble_reader_name,
      },
      badge: {
        logoUrl,
        colorStart: site.badge_color_start,
        colorEnd: site.badge_color_end,
      },
      configVersion: site.config_version,
      expiresAt,
    })
  } catch (error) {
    return errorResponse(error)
  }
})
