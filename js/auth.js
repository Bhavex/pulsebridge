import { supabase, supabaseReady } from "./supabase-config.js";
import { showToast, setBusy } from "./ui.js";

let currentUser = null;
let adminFlag = false;
let authResolved = false;
let lastKey = null;

export function isAdmin(user = currentUser) {
  return Boolean(user && currentUser && user.id === currentUser.id && adminFlag);
}

export function displayName(user) {
  const meta = user?.user_metadata || {};
  return meta.full_name || meta.name || user?.email || "";
}

function destinationFor(user) {
  return isAdmin(user) ? "admin.html" : "find-donors.html";
}

export function onAuth(callback) {
  if (authResolved) callback(currentUser);
  window.addEventListener("pulsebridge:auth", (event) => callback(event.detail?.user || null));
}

function safeNextPath(user) {
  const rawNext = new URLSearchParams(window.location.search).get("next");
  if (!rawNext) return "";
  try {
    const candidate = new URL(rawNext, window.location.href);
    const page = candidate.pathname.split("/").pop();
    const allowedPages = ["find-donors.html", "contact-request.html", "donate.html", "my-requests.html"];
    if (isAdmin(user)) allowedPages.push("admin.html");
    if (candidate.origin !== window.location.origin || !allowedPages.includes(page)) return "";
    return `${page}${candidate.search}`;
  } catch {
    return "";
  }
}

export async function signInWithGoogle(button) {
  if (!supabaseReady || !supabase) {
    showToast("Sign-in is not available right now. Please refresh and try again.", "error");
    return;
  }
  try {
    setBusy(button, true, "Opening Google…");
    const redirectTo = new URL(window.location.href);
    redirectTo.hash = "";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo.toString(), queryParams: { prompt: "select_account" } }
    });
    if (error) throw error;
  } catch (error) {
    console.error(error);
    showToast("We could not sign you in. Please try again.", "error");
    setBusy(button, false);
  }
}

export async function signOutUser(button) {
  try {
    setBusy(button, true, "Signing out…");
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    showToast("You are signed out.", "success");
    window.setTimeout(() => { window.location.href = "index.html"; }, 500);
  } catch (error) {
    console.error(error);
    showToast("We could not sign you out. Please try again.", "error");
    setBusy(button, false);
  }
}

function updateAuthLabels(user) {
  document.querySelectorAll("[data-auth-user]").forEach((node) => {
    node.textContent = displayName(user) || "signed-in user";
  });
  document.querySelectorAll("[data-auth-email]").forEach((node) => {
    node.textContent = user?.email || "—";
  });
}

function applyRouteGuard(user) {
  const guard = document.body.dataset.guard;
  const adminOnly = document.body.dataset.adminOnly === "true";
  const gatedContent = document.querySelector("[data-gated-content]");
  const guardMessage = document.querySelector("[data-guard-message]");
  if (guard === "signed-in" && !user) {
    const page = window.location.pathname.split("/").pop() || "find-donors.html";
    const next = encodeURIComponent(`${page}${window.location.search}`);
    if (guardMessage) guardMessage.hidden = false;
    if (gatedContent) gatedContent.hidden = true;
    window.setTimeout(() => { window.location.href = `login.html?next=${next}`; }, 650);
    return;
  }
  if (adminOnly && user && !isAdmin(user)) {
    if (guardMessage) guardMessage.hidden = false;
    if (gatedContent) gatedContent.hidden = true;
    return;
  }
  if (guardMessage) guardMessage.hidden = true;
  if (gatedContent) gatedContent.hidden = false;
}

function bindAuthButtons() {
  document.querySelectorAll("[data-action=google-sign-in]").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => signInWithGoogle(button));
  });
  document.querySelectorAll("[data-action=sign-out]").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => signOutUser(button));
  });
}

async function checkAdmin(user) {
  if (!user || !supabaseReady) return false;
  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    console.error(error);
    return false;
  }
  return data === true;
}

async function handleSession(session) {
  const user = session?.user || null;
  const key = user ? user.id : "signed-out";
  if (authResolved && key === lastKey) return;
  lastKey = key;
  currentUser = user;
  adminFlag = await checkAdmin(user);
  authResolved = true;
  window.PulseBridgeAuth = { isAdmin, currentUser: () => currentUser, authReady: () => authResolved, displayName };
  updateAuthLabels(user);
  applyRouteGuard(user);
  bindAuthButtons();
  const status = document.querySelector("[data-login-status]");
  const signedOutPanel = document.querySelector("[data-signed-out-panel]");
  const signedInPanel = document.querySelector("[data-signed-in-panel]");
  if (status) status.textContent = user ? `Signed in as ${displayName(user) || "your Google account"}.` : "You are not signed in.";
  if (signedOutPanel) signedOutPanel.hidden = Boolean(user);
  if (signedInPanel) signedInPanel.hidden = !user;
  window.dispatchEvent(new CustomEvent("pulsebridge:auth", { detail: { user } }));
  if (user && document.body.dataset.page === "login") {
    const params = new URLSearchParams(window.location.search);
    if (params.has("code") || params.has("next")) {
      window.location.href = safeNextPath(user) || destinationFor(user);
    }
  }
}

async function init() {
  bindAuthButtons();
  if (!supabaseReady || !supabase) {
    await handleSession(null);
    return;
  }
  const { data } = await supabase.auth.getSession();
  await handleSession(data.session);
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => handleSession(session), 0);
  });
}

window.addEventListener("pulsebridge:nav", bindAuthButtons);

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
