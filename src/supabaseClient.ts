import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export function getSiteUrl() {
  return import.meta.env.VITE_SITE_URL || window.location.origin;
}
