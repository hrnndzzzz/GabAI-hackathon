// Where the backend and Supabase live. The Android shell supplies these at runtime
// (from local.properties via BuildConfig), so one web bundle works for every
// environment; `npm run dev` reads VITE_* variables from web/.env.local instead.

export interface AppConfig {
  apiBaseUrl: string
  supabaseUrl: string
  supabasePublishableKey: string
}

let cached: AppConfig | null | undefined

export function getConfig(): AppConfig | null {
  if (cached !== undefined) return cached
  let native: Partial<AppConfig> = {}
  try {
    const raw = window.GabAINative?.getConfig?.()
    if (raw) native = JSON.parse(raw) as Partial<AppConfig>
  } catch {
    native = {}
  }
  const config = {
    apiBaseUrl: (native.apiBaseUrl || import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, ''),
    supabaseUrl: (native.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, ''),
    supabasePublishableKey: native.supabasePublishableKey || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
  }
  cached = config.apiBaseUrl && config.supabaseUrl && config.supabasePublishableKey ? config : null
  return cached
}
