import { createAdminClient } from '../_shared/db.ts'
import { requireApiClient } from '../_shared/auth.ts'
import { errorResponse, HttpError, jsonResponse, readJson, requestId } from '../_shared/http.ts'
import { createManagedUser, findProfile, publicUser, updateManagedUser } from '../_shared/users.ts'

function routePath(req: Request): string {
  const path = new URL(req.url).pathname
  const marker = '/api'
  const index = path.indexOf(marker)
  if (index < 0) return path
  const suffix = path.slice(index + marker.length)
  return suffix || '/'
}

function unauthorizedHeaders() {
  return { 'www-authenticate': 'Basic realm="Mobile ID Managed API", charset="UTF-8"' }
}

Deno.serve(async (req) => {
  const id = requestId(req)
  const headers = { 'x-request-id': id }

  try {
    const path = routePath(req)

    if (req.method === 'GET' && (path === '/' || path === '/health')) {
      return jsonResponse(
        {
          success: true,
          service: 'mobile-id-managed',
          status: 'ok',
          time: new Date().toISOString(),
        },
        200,
        headers,
      )
    }

    const apiClient = await requireApiClient(req)
    const admin = createAdminClient()
    const actor = `api:${apiClient.name}`

    if (path === '/user' && req.method === 'POST') {
      const body = await readJson(req)
      const profile = await createManagedUser(admin, apiClient.tenantId, body, actor, apiClient.id)
      return jsonResponse({ success: true, user: publicUser(profile) }, 201, headers)
    }

    const match = path.match(/^\/user\/([^/]+)$/)
    if (match) {
      const ref = match[1]

      if (req.method === 'GET') {
        const profile = await findProfile(admin, apiClient.tenantId, ref)
        if (!profile) throw new HttpError(404, 'user_not_found', 'User not found')
        return jsonResponse({ success: true, user: publicUser(profile) }, 200, headers)
      }

      if (req.method === 'PUT') {
        const body = await readJson(req)
        const profile = await updateManagedUser(admin, apiClient.tenantId, ref, body, actor, apiClient.id)
        return jsonResponse({ success: true, user: publicUser(profile) }, 200, headers)
      }

      if (req.method === 'DELETE') {
        const profile = await updateManagedUser(
          admin,
          apiClient.tenantId,
          ref,
          { active: false },
          actor,
          apiClient.id,
        )
        return jsonResponse({ success: true, user: publicUser(profile) }, 200, headers)
      }
    }

    throw new HttpError(404, 'not_found', 'API endpoint not found')
  } catch (error) {
    const responseHeaders: Record<string, string> = { 'x-request-id': id }
    if (error instanceof HttpError && error.status === 401) Object.assign(responseHeaders, unauthorizedHeaders())
    return errorResponse(error, responseHeaders)
  }
})
