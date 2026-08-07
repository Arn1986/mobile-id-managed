export function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function firstStringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    for (const candidate of Object.values(value as Record<string, unknown>)) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
  }
  return null
}

export function getSupabaseUrl(): string {
  return requireEnv('SUPABASE_URL')
}

export function getSupabaseSecretKey(): string {
  const plural = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (plural) {
    try {
      const parsed = JSON.parse(plural) as Record<string, unknown>
      const preferred = firstStringValue(parsed.default) ?? firstStringValue(parsed)
      if (preferred) return preferred
    } catch {
      // Fall through to legacy/singular variables.
    }
  }

  const singular = Deno.env.get('SUPABASE_SECRET_KEY')?.trim()
  if (singular) return singular

  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (legacy) return legacy

  throw new Error('No Supabase server-side secret key is available')
}

export function getSupabasePublishableKey(): string {
  const plural = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  if (plural) {
    try {
      const parsed = JSON.parse(plural) as Record<string, unknown>
      const preferred = firstStringValue(parsed.default) ?? firstStringValue(parsed)
      if (preferred) return preferred
    } catch {
      // Fall through to legacy/singular variables.
    }
  }

  const singular = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')?.trim()
  if (singular) return singular

  const legacy = Deno.env.get('SUPABASE_ANON_KEY')?.trim()
  if (legacy) return legacy

  throw new Error('No Supabase publishable key is available')
}
