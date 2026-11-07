import { supabase, supabaseReady } from "./supabase-config.js";
import { friendlyError } from "./ui.js";

async function init() {
  const title = document.querySelector("#confirm-title");
  const copy = document.querySelector("#confirm-copy");
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("t") || "";
  const available = params.get("a") !== "no";
  window.history.replaceState(null, "", window.location.pathname);
  if (!/^[0-9a-f]{64}$/.test(token) || !supabaseReady) {
    title.textContent = "This link isn't valid.";
    copy.textContent = "Please sign in and update your availability from your donor page.";
    return;
  }
  try {
    const { data, error } = await supabase.rpc("confirm_availability_token", { p_token: token, p_available: available });
    if (error) throw error;
    title.textContent = available ? `Thank you, ${data}!` : `Got it, ${data}.`;
    copy.textContent = available
      ? "You're confirmed as available for another month. People who need your blood group can keep finding you."
      : "You're now paused and won't appear in search. You can turn availability back on from your donor page any time.";
  } catch (error) {
    title.textContent = "We couldn't confirm this link.";
    copy.textContent = friendlyError(error, "Please sign in and update your availability from your donor page.");
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
