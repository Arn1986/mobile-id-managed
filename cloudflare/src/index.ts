interface Env {
  SUPABASE_FUNCTION_BASE: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url)
    if (!incoming.pathname.startsWith('/api')) {
      return json({ success: false, error: { code: 'not_found', message: 'Not found' } }, 404)
    }

    const length = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(length) && length > 64 * 1024) {
      return json({ success: false, error: { code: 'request_too_large', message: 'Request body is too large' } }, 413)
    }

    const suffix = incoming.pathname.slice('/api'.length) || '/'
    const target = new URL(env.SUPABASE_FUNCTION_BASE.replace(/\/$/, '') + suffix)
    target.search = incoming.search

    const headers = new Headers(request.headers)
    headers.delete('host')
    const originalIp = request.headers.get('cf-connecting-ip')
    if (originalIp) headers.set('x-original-client-ip', originalIp)
    headers.set('x-api-gateway', 'cloudflare-worker')

    const upstream = new Request(target.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    })

    const response = await fetch(upstream)
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set('cache-control', 'no-store')
    responseHeaders.set('x-content-type-options', 'nosniff')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  },
}
