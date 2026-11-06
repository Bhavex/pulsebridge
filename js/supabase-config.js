import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

export const SUPABASE_URL = "https://pjzvhztpixivjotpltwt.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_tLbI8SpoZBKiTmZEL6dq1w_Qa5wa4SV";

export const supabaseReady = SUPABASE_URL.startsWith("https://") && SUPABASE_PUBLISHABLE_KEY.length > 20;

export const supabase = createClient(
  supabaseReady ? SUPABASE_URL : "https://placeholder.supabase.co",
  supabaseReady ? SUPABASE_PUBLISHABLE_KEY : "placeholder",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } }
);
