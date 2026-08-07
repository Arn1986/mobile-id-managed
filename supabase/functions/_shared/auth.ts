import { createAdminClient, createUserClient } from './db.ts'
import { HttpError } from './http.ts'

export async function requireApiClient(req: Request) {
  const header = req.headers.get('authorization') ?? ''
  if (!header.toLowerCase().startsWith('basic ')) {
    throw new HttpError(401, 'basic_auth_required', 'Basic authentication is required')
  }

  let decoded = ''
  try {
    decoded = atob(header.slice(6).trim())
  } catch {
    throw new HttpError(401, 'invalid_basic_auth', 'Invalid Basic authentication header')
  }

  const separator = decoded.indexOf(':')
  if (separator < 1) {
    throw new HttpError(401, 'invalid_basic_auth', 'Invalid Basic authentication credentials')
  }

  const username = decoded.slice(0, separator)
  const password = decoded.slice(separator + 1)
  if (!password) throw new HttpError(401, 'invalid_basic_auth', 'Invalid Basic authentication credentials')

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('verify_api_client', {
    p_username: username,
    p_password: password,
  })

  if (error) {
    console.error('verify_api_client failed', error)
    throw new HttpError(500, 'auth_backend_error', 'Unable to verify API client')
  }

  const client = Array.isArray(data) ? data[0] : null
  if (!client) throw new HttpError(401, 'invalid_credentials', 'Invalid API credentials')

  return {
    id: client.api_client_id as string,
    tenantId: client.tenant_id as string,
    name: client.client_name as string,
  }
}

export async function requireSignedInUser(req: Request) {
  const authorization = req.headers.get('authorization') ?? ''
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'authentication_required', 'A signed-in user is required')
  }

  const userClient = createUserClient(authorization)
  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) {
    throw new HttpError(401, 'invalid_session', 'The login session is invalid or expired')
  }

  return data.user
}

export async function requirePowerUser(req: Request) {
  const user = await requireSignedInUser(req)
  const admin = createAdminClient()
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, tenant_id, site_id, email, first_name, last_name, role, active')
    .eq('id', user.id)
    .maybeSingle()

  if (error) throw new HttpError(500, 'profile_lookup_failed', 'Unable to load administrator profile')
  if (!profile || !profile.active || !['power_user', 'admin'].includes(profile.role)) {
    throw new HttpError(403, 'power_user_required', 'Power-user access is required')
  }

  return { user, profile }
}
