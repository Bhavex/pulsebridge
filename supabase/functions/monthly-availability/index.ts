import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "PulseBridge <onboarding@resend.dev>";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://bhavex.github.io/pulsebridge").replace(/\/$/, "");
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c] as string));
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function emailHtml(name: string, token: string) {
  const yes = `${SITE_URL}/confirm.html#t=${token}`;
  const no = `${SITE_URL}/confirm.html#t=${token}&a=no`;
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#202124">
  <h2 style="color:#c62828">Hi ${escapeHtml(name)}, are you still available to donate blood?</h2>
  <p>Once a month we check with every PulseBridge donor, so people in need only see donors who can really help.</p>
  <p><a href="${yes}" style="display:inline-block;background:#c62828;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Yes, I'm still available</a></p>
  <p><a href="${no}" style="color:#c62828">No, pause me for now</a></p>
  <p style="color:#737980;font-size:12px">If you don't reply within a week, you'll be hidden from search until you confirm on your donor page. This link works once and expires in 14 days.</p>
</div>`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!CRON_SECRET || !timingSafeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_API_KEY) {
    return new Response("Missing configuration", { status: 500 });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("issue_availability_reminders", { p_limit: 200 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0;
  const failures: string[] = [];
  for (const row of data ?? []) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [row.email],
        subject: "PulseBridge: are you still available to donate?",
        html: emailHtml(row.first_name || "there", row.token),
      }),
    });
    if (res.ok) sent++;
    else failures.push(String(row.donor_id));
  }
  return new Response(JSON.stringify({ due: (data ?? []).length, sent, failed: failures.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
