import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const cloudEnabled = isOpenPencilCloudOptedIn(import.meta.env.VITE_OPENPENCIL_CLOUD_ENABLED)
const supabaseUrl = import.meta.env.VITE_OPENPENCIL_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_OPENPENCIL_SUPABASE_ANON_KEY?.trim()

let client: SupabaseClient | null = null

export function isOpenPencilCloudOptedIn(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true'
}

export function isOpenPencilCloudConfigured(): boolean {
  return Boolean(cloudEnabled && supabaseUrl && supabaseAnonKey)
}

export function getOpenPencilSupabase(): SupabaseClient {
  if (!cloudEnabled || !supabaseUrl || !supabaseAnonKey) {
    throw new Error('OpenPencil Cloud is disabled or not configured')
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
