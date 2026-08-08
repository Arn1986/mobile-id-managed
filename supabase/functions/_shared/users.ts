import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { HttpError } from './http.ts'

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'
export const DEFAULT_SITE_ID = '00000000-0000-0000-0000-000000000002'

function field(payload: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    if (payload[name] !== undefined) return payload[name]
  }
  return undefined
}

function text(value: unknown, label: string, required = true) {
  if (value === null || value === undefined) {
    if (required) throw new HttpError(400, 'validation_error', `${label} is required`)
    return null
  }
  const out = String(value).trim()
  if (!out && required) throw new HttpError(400, 'validation_error', `${label} is required`)
  return out || null
}

export function normalizeIdentifier(value: unknown): string {
  const identifier = text(value, 'identifierNumber')!.replace(/[\s:-]/g, '').toUpperCase()
  const valid =
    /^08[0-9A-F]{16}$/.test(identifier) ||
    /^10[0-9A-F]{32}$/.test(identifier) ||
    /^57[0-9A-F]{28}$/.test(identifier)
  if (!valid) {
    throw new HttpError(
      400,
      'invalid_identifier',
      'identifierNumber must be a documented Mobile ID Raw ID64, Raw ID128, or Wiegand identifier',
    )
  }
  return identifier
}

export function normalizeUserPayload(input: unknown, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'validation_error', 'JSON body must be an object')
  }
  const payload = input as Record<string, unknown>
  const result: Record<string, unknown> = {}

  const firstName = field(payload, 'firstName', 'firstname')
  const lastName = field(payload, 'lastName', 'lastname')
  const email = field(payload, 'email')
  const identifier = field(payload, 'identifierNumber', 'identifiernumber', 'idNumber', 'idnumber')
  const externalId = field(payload, 'externalId', 'externalid')
  const active = field(payload, 'active')
  const sendInvite = field(payload, 'sendInvite', 'sendinvite')
  const overwrite = field(payload, 'overwrite')

  if (!partial || firstName !== undefined) result.firstName = text(firstName, 'firstName')
  if (!partial || lastName !== undefined) result.lastName = text(lastName, 'lastName')
  if (!partial || email !== undefined) {
    const e = text(email, 'email')!.toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpError(400, 'invalid_email', 'email is invalid')
    result.email = e
  }
  if (!partial || identifier !== undefined) result.identifierNumber = normalizeIdentifier(identifier)
  if (externalId !== undefined) result.externalId = text(externalId, 'externalId', false)
  if (active !== undefined) result.active = Boolean(active)
  if (!partial) result.sendInvite = sendInvite === undefined ? true : Boolean(sendInvite)
  else if (sendInvite !== undefined) result.sendInvite = Boolean(sendInvite)
  if (overwrite !== undefined) result.overwrite = Boolean(overwrite)

  return result
}

export async function findProfile(admin: SupabaseClient, tenantId: string, ref: string) {
  const value = decodeURIComponent(ref).trim()
  let query = admin
    .from('profiles')
    .select('*')
    .eq('tenant_id', tenantId)

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    query = query.eq('id', value)
  } else {
    query = query.eq('external_id', value)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw new HttpError(500, 'profile_lookup_failed', 'Unable to load user')
  return data
}

async function logAudit(admin: SupabaseClient, entry: Record<string, unknown>) {
  const { error } = await admin.from('credential_audit').insert(entry)
  if (error) console.error('audit insert failed', error)
}

export async function createManagedUser(
  admin: SupabaseClient,
  tenantId: string,
  input: unknown,
  actor: string,
  apiClientId?: string | null,
) {
  const payload = normalizeUserPayload(input, false)
  const email = payload.email as string
  const identifierNumber = payload.identifierNumber as string
  const externalId = (payload.externalId as string | null | undefined) ?? null
  const overwrite = Boolean(payload.overwrite)
  const sendInvite = payload.sendInvite !== false

  if (overwrite) {
    let existing = null
    if (externalId) {
      const { data } = await admin.from('profiles').select('*').eq('tenant_id', tenantId).eq('external_id', externalId).maybeSingle()
      existing = data
    }
    if (!existing) {
      const { data } = await admin.from('profiles').select('*').eq('tenant_id', tenantId).ilike('email', email).maybeSingle()
      existing = data
    }
    if (existing) return await updateManagedUser(admin, tenantId, existing.id, payload, actor, apiClientId)
  }

  const conflictChecks = [
    admin.from('profiles').select('id').eq('tenant_id', tenantId).eq('email', email).limit(1),
    admin.from('profiles').select('id').eq('tenant_id', tenantId).eq('identifier_number', identifierNumber).limit(1),
    ...(externalId
      ? [admin.from('profiles').select('id').eq('tenant_id', tenantId).eq('external_id', externalId).limit(1)]
      : []),
  ]
  for (const check of conflictChecks) {
    const { data: conflict, error: conflictError } = await check
    if (conflictError) throw new HttpError(500, 'conflict_check_failed', 'Unable to check for existing user')
    if (conflict && conflict.length) {
      throw new HttpError(409, 'user_conflict', 'A user already exists with this email, identifier, or externalId')
    }
  }

  const { data: site, error: siteError } = await admin
    .from('sites')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (siteError || !site) throw new HttpError(409, 'site_missing', 'No active site is configured for this tenant')

  let authUserId: string | null = null
  try {
    const metadata = {
      first_name: payload.firstName,
      last_name: payload.lastName,
      external_id: externalId,
    }

    if (sendInvite) {
      const redirectTo = Deno.env.get('USER_INVITE_REDIRECT_URL')?.trim() || 'https://mobileid-admin.nedapdemo.xyz/activate.html'
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: metadata,
        ...(redirectTo ? { redirectTo } : {}),
      })
      if (error || !data.user) throw error ?? new Error('Invite did not return a user')
      authUserId = data.user.id
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: false,
        user_metadata: metadata,
      })
      if (error || !data.user) throw error ?? new Error('Create user did not return a user')
      authUserId = data.user.id
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .insert({
        id: authUserId,
        tenant_id: tenantId,
        site_id: site.id,
        external_id: externalId,
        first_name: payload.firstName,
        last_name: payload.lastName,
        email,
        identifier_number: identifierNumber,
        role: 'user',
        active: true,
      })
      .select('*')
      .single()

    if (profileError) throw profileError

    await logAudit(admin, {
      tenant_id: tenantId,
      site_id: site.id,
      profile_id: profile.id,
      api_client_id: apiClientId ?? null,
      event_type: 'user_created',
      actor,
      metadata: { externalId, inviteRequested: sendInvite },
    })

    return profile
  } catch (error) {
    if (authUserId) {
      try {
        await admin.auth.admin.deleteUser(authUserId)
      } catch (cleanupError) {
        console.error('Failed to roll back Auth user', cleanupError)
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    if (message.toLowerCase().includes('already') || message.toLowerCase().includes('duplicate')) {
      throw new HttpError(409, 'user_conflict', 'A user with this email or identifier already exists')
    }
    if (sendInvite) {
      console.error('createManagedUser invitation failed', error)
      throw new HttpError(
        502,
        'activation_email_failed',
        'The user was not created because the activation email could not be sent. Check Supabase Auth email/SMTP configuration and rate limits.',
      )
    }
    console.error('createManagedUser failed', error)
    throw new HttpError(500, 'user_create_failed', 'Unable to create user')
  }
}

export async function updateManagedUser(
  admin: SupabaseClient,
  tenantId: string,
  ref: string,
  input: unknown,
  actor: string,
  apiClientId?: string | null,
) {
  const existing = await findProfile(admin, tenantId, ref)
  if (!existing) throw new HttpError(404, 'user_not_found', 'User not found')

  const payload = normalizeUserPayload(input, true)
  const patch: Record<string, unknown> = {}
  if (payload.firstName !== undefined) patch.first_name = payload.firstName
  if (payload.lastName !== undefined) patch.last_name = payload.lastName
  if (payload.email !== undefined) patch.email = payload.email
  if (payload.identifierNumber !== undefined) patch.identifier_number = payload.identifierNumber
  if (payload.externalId !== undefined) patch.external_id = payload.externalId
  if (payload.active !== undefined) patch.active = payload.active

  if (!Object.keys(patch).length) return existing

  const uniquenessChecks = []
  if (patch.email && patch.email !== existing.email) {
    uniquenessChecks.push(
      admin.from('profiles').select('id').eq('tenant_id', tenantId).eq('email', patch.email as string).neq('id', existing.id).limit(1),
    )
  }
  if (patch.identifier_number && patch.identifier_number !== existing.identifier_number) {
    uniquenessChecks.push(
      admin.from('profiles').select('id').eq('tenant_id', tenantId).eq('identifier_number', patch.identifier_number as string).neq('id', existing.id).limit(1),
    )
  }
  if (patch.external_id && patch.external_id !== existing.external_id) {
    uniquenessChecks.push(
      admin.from('profiles').select('id').eq('tenant_id', tenantId).eq('external_id', patch.external_id as string).neq('id', existing.id).limit(1),
    )
  }
  for (const check of uniquenessChecks) {
    const { data: conflict, error: conflictError } = await check
    if (conflictError) throw new HttpError(500, 'conflict_check_failed', 'Unable to check for conflicting user data')
    if (conflict && conflict.length) throw new HttpError(409, 'user_conflict', 'Email, identifier, or externalId is already assigned')
  }

  const emailChanged = Boolean(patch.email && patch.email !== existing.email)
  if (emailChanged) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { email: patch.email as string })
    if (error) {
      if (error.message.toLowerCase().includes('already')) throw new HttpError(409, 'email_conflict', 'Email is already in use')
      throw new HttpError(500, 'auth_update_failed', 'Unable to update login email')
    }
  }

  const { data, error } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', existing.id)
    .eq('tenant_id', tenantId)
    .select('*')
    .single()

  if (error) {
    if (emailChanged) {
      const rollback = await admin.auth.admin.updateUserById(existing.id, { email: existing.email })
      if (rollback.error) console.error('Failed to roll back Auth email after profile update failure', rollback.error)
    }
    if ((error as { code?: string }).code === '23505') {
      throw new HttpError(409, 'user_conflict', 'Email, identifier, or externalId is already assigned')
    }
    console.error('update profile failed', error)
    throw new HttpError(500, 'user_update_failed', 'Unable to update user')
  }

  await logAudit(admin, {
    tenant_id: tenantId,
    site_id: data.site_id,
    profile_id: data.id,
    api_client_id: apiClientId ?? null,
    event_type: data.active ? 'user_updated' : 'user_deactivated',
    actor,
    metadata: { changedFields: Object.keys(patch) },
  })

  return data
}

export async function resendManagedUserActivation(
  admin: SupabaseClient,
  tenantId: string,
  ref: string,
  actor: string,
) {
  const existing = await findProfile(admin, tenantId, ref)
  if (!existing) throw new HttpError(404, 'user_not_found', 'User not found')

  const { data: authData, error: authError } = await admin.auth.admin.getUserById(existing.id)
  if (authError || !authData.user) {
    throw new HttpError(500, 'auth_lookup_failed', 'Unable to load the user login account')
  }
  if (authData.user.email_confirmed_at) {
    throw new HttpError(409, 'already_activated', 'This user has already confirmed the account')
  }

  const redirectTo = Deno.env.get('USER_INVITE_REDIRECT_URL')?.trim() || 'https://mobileid-admin.nedapdemo.xyz/activate.html'
  const { error } = await admin.auth.admin.inviteUserByEmail(existing.email, {
    data: {
      first_name: existing.first_name,
      last_name: existing.last_name,
      external_id: existing.external_id,
    },
    redirectTo,
  })
  if (error) {
    console.error('resend invitation failed', error)
    throw new HttpError(
      502,
      'activation_email_failed',
      'Unable to send another activation email. For a legacy pre-invite account, recreate the user if Supabase refuses the invitation.',
    )
  }

  await logAudit(admin, {
    tenant_id: tenantId,
    site_id: existing.site_id,
    profile_id: existing.id,
    event_type: 'activation_invite_resent',
    actor,
    metadata: { email: existing.email },
  })

  return existing
}

export function publicUser(profile: Record<string, unknown>, authUser?: Record<string, unknown> | null) {
  return {
    id: profile.id,
    externalId: profile.external_id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    email: profile.email,
    identifierNumber: profile.identifier_number,
    role: profile.role,
    active: profile.active,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
    lastCredentialIssuedAt: profile.last_credential_issued_at,
    accountStatus: authUser ? (authUser.email_confirmed_at ? 'activated' : 'pending_activation') : undefined,
    emailConfirmedAt: authUser?.email_confirmed_at ?? undefined,
    lastSignInAt: authUser?.last_sign_in_at ?? undefined,
  }
}
