export const SUPABASE_URL = "https://pjzvhztpixivjotpltwt.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_tLbI8SpoZBKiTmZEL6dq1w_Qa5wa4SV";
export const SLIP_BUCKET = "requisition-slips";

const library = window.supabase;

export const supabaseReady = Boolean(library?.createClient) && SUPABASE_URL.startsWith("https://") && SUPABASE_PUBLISHABLE_KEY.length > 20;

export const supabase = library?.createClient
  ? library.createClient(
      supabaseReady ? SUPABASE_URL : "https://placeholder.supabase.co",
      supabaseReady ? SUPABASE_PUBLISHABLE_KEY : "placeholder",
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } }
    )
  : null;
