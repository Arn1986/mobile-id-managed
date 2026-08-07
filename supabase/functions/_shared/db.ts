import { createClient } from 'npm:@supabase/supabase-js@2'
import { getSupabasePublishableKey, getSupabaseSecretKey, getSupabaseUrl } from './env.ts'

const serverAuth = {
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false,
}

export function createAdminClient() {
  return createClient(getSupabaseUrl(), getSupabaseSecretKey(), { auth: serverAuth })
}

export function createUserClient(authorization: string) {
  return createClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: serverAuth,
    global: { headers: { Authorization: authorization } },
  })
}
