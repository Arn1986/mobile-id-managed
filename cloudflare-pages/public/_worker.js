const DEFAULT_SUPABASE_FUNCTION_BASE =
  'https://gcaqyryxzcphnovgqxhs.supabase.co/functions/v1/api';

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

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);

    if (!incoming.pathname.startsWith('/api')) {
      return env.ASSETS.fetch(request);
    }

    const length = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > 64 * 1024) {
      return json(
        {
          success: false,
          error: {
            code: 'request_too_large',
            message: 'Request body is too large',
          },
        },
        413,
      );
    }

    const base = (env.SUPABASE_FUNCTION_BASE || DEFAULT_SUPABASE_FUNCTION_BASE).replace(/\/$/, '');
    const suffix = incoming.pathname.slice('/api'.length) || '/';
    const target = new URL(base + suffix);
    target.search = incoming.search;

    const headers = new Headers(request.headers);
    headers.delete('host');

    const originalIp = request.headers.get('cf-connecting-ip');
    if (originalIp) headers.set('x-original-client-ip', originalIp);
    headers.set('x-api-gateway', 'cloudflare-pages');

    const upstream = new Request(target.toString(), {
      method: request.method,
      headers,
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
      return json(
        {
          success: false,
          error: {
            code: 'upstream_unavailable',
            message: 'The upstream API could not be reached',
          },
        },
        502,
      );
    }
  },
};
