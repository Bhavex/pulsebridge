import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

export const SUPABASE_URL = "https://jvsemmrbyvdzsllukhmh.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nNuehqQDpyI9iZG6G2a7vg_uxxRgH8E";

export const supabaseReady = SUPABASE_URL.startsWith("https://") && SUPABASE_PUBLISHABLE_KEY.length > 20;

export const supabase = createClient(
  supabaseReady ? SUPABASE_URL : "https://placeholder.supabase.co",
  supabaseReady ? SUPABASE_PUBLISHABLE_KEY : "placeholder",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } }
);
