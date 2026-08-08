const SUPABASE_BASE = 'https://gcaqyryxzcphnovgqxhs.supabase.co';
const PROVISIONING_BASE = `${SUPABASE_BASE}/functions/v1/api`;
const CREDENTIAL_URL = `${SUPABASE_BASE}/functions/v1/mobile-credential`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function copyHeaders(request) {
  const headers = new Headers(request.headers);
  headers.delete('host');
  const originalIp = request.headers.get('cf-connecting-ip');
  if (originalIp) headers.set('x-original-client-ip', originalIp);
  headers.set('x-api-gateway', 'cloudflare-pages');
  return headers;
}

async function proxy(request, target) {
  const upstream = new Request(target.toString(), {
    method: request.method,
    headers: copyHeaders(request),
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });

  try {
    const response = await fetch(upstream);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('cache-control', 'no-store');
    responseHeaders.set('x-content-type-options', 'nosniff');
    responseHeaders.set('x-api-gateway', 'cloudflare-pages');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Upstream request failed', error);
    return json({ success: false, error: { code: 'upstream_unavailable', message: 'The upstream API could not be reached' } }, 502);
  }
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const length = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > 64 * 1024) {
      return json({ success: false, error: { code: 'request_too_large', message: 'Request body is too large' } }, 413);
    }

    // Managed Android authentication. Expose only password/refresh token issuance and logout,
    // rather than proxying the complete Supabase Auth API surface.
    if (incoming.pathname === '/auth/v1/token') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const grant = incoming.searchParams.get('grant_type');
      if (grant !== 'password' && grant !== 'refresh_token') {
        return json({ error: 'unsupported_grant_type' }, 400);
      }
      const target = new URL(`${SUPABASE_BASE}/auth/v1/token`);
      target.search = incoming.search;
      return proxy(request, target);
    }

    if (incoming.pathname === '/auth/v1/logout') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return proxy(request, new URL(`${SUPABASE_BASE}/auth/v1/logout`));
    }

    // Managed Android credential endpoint. The user's Bearer token is verified by Supabase
    // before the Edge Function derives and returns that user's KEYA.
    if (incoming.pathname === '/api/credential') {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return json({ success: false, error: { code: 'method_not_allowed', message: 'Use GET or POST' } }, 405);
      }
      const target = new URL(CREDENTIAL_URL);
      target.search = incoming.search;
      return proxy(request, target);
    }

    // Existing AEOS provisioning API, including /api/health and /api/user.
    if (incoming.pathname.startsWith('/api')) {
      const suffix = incoming.pathname.slice('/api'.length) || '/';
      const target = new URL(PROVISIONING_BASE + suffix);
      target.search = incoming.search;
      return proxy(request, target);
    }

    return env.ASSETS.fetch(request);
  },
};
