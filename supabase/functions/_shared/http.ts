export class HttpError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function jsonResponse(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  const headers = new Headers(extraHeaders)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { status, headers })
}

export function errorResponse(error: unknown, extraHeaders: HeadersInit = {}) {
  if (error instanceof HttpError) {
    return jsonResponse(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      error.status,
      extraHeaders,
    )
  }

  console.error(error)
  return jsonResponse(
    { success: false, error: { code: 'internal_error', message: 'Internal server error' } },
    500,
    extraHeaders,
  )
}

export async function readJson(req: Request) {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'content_type', 'Content-Type must be application/json')
  }

  try {
    return await req.json()
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON')
  }
}

export function requestId(req: Request) {
  return req.headers.get('cf-ray') ?? req.headers.get('x-request-id') ?? crypto.randomUUID()
}
