import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_OPENPENCIL_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_OPENPENCIL_SUPABASE_ANON_KEY?.trim()

let client: SupabaseClient | null = null

export function isOpenPencilCloudConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey)
}

export function getOpenPencilSupabase(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('OpenPencil Cloud is not configured')
  }
  client ??= createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      storageKey: 'openpencil-cloud-auth'
    }
  })
  return client
}
