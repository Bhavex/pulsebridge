import { supabase, supabaseReady } from "./supabase-config.js";
import { onAuth, displayName } from "./auth.js";
import { openSlip, revealContact } from "./requests.js";
import { confirmDialog, createElement, formatDate, formatDateTime, friendlyError, isValidPhone, mapsLink, promptDialog, setBusy, setPanelMessage, showToast, statusPill, todayISO } from "./ui.js";

const CONFIRM_DAYS = 30;
const HIDE_DAYS = 37;
let profile = null;

function daysSince(value) {
  return Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
}

function fillForm(form, data) {
  form.elements.name.value = data.name || "";
  form.elements.age.value = data.age || "";
  form.elements.bloodGroup.value = data.blood_group || "";
  form.elements.phone.value = data.phone || "";
  form.elements.city.value = data.city || "";
  form.elements.state.value = data.state || "";
  form.elements.hospital.value = data.hospital || "";
  form.elements.lastDonation.value = data.last_donation_date || "";
  form.elements.registrationNumber.value = data.registration_number || "";
  form.elements.consent.checked = true;
}

function renderStatus() {
  const card = document.querySelector("#donor-status");
  const facts = document.querySelector("#donor-facts");
  if (!card || !profile) return;
  const age = daysSince(profile.availability_confirmed_at);
  const left = Math.max(0, HIDE_DAYS - age);
  const visible = profile.available && left > 0;
  card.querySelector("[data-status-title]").textContent = visible ? "You're visible to people who need blood." : profile.available ? "You're hidden until you confirm." : "You're paused.";
  card.querySelector("[data-status-copy]").textContent = visible
    ? age >= CONFIRM_DAYS
      ? `Please confirm you're still available. You'll be hidden from search in ${left} day${left === 1 ? "" : "s"}.`
      : `Last confirmed ${formatDate(profile.availability_confirmed_at)}. We'll ask again in about ${CONFIRM_DAYS - age} days.`
    : profile.available
      ? "It's been over a month since you confirmed. Tap the button below to show up in search again."
      : "Recipients can't find you while you're paused. Turn availability back on any time.";
  const meter = card.querySelector(".meter");
  meter.classList.toggle("is-low", age >= CONFIRM_DAYS || !visible);
  meter.querySelector("span").style.width = `${visible ? Math.round((left / HIDE_DAYS) * 100) : 0}%`;
  const toggle = card.querySelector("#availability-toggle");
  toggle.checked = Boolean(profile.available);
  card.querySelector("#confirm-available").hidden = !(profile.available && age >= 1);
  facts.replaceChildren();
  [["Name", profile.name], ["Blood group", profile.blood_group], ["Age", `${profile.age} years`], ["Phone (private)", profile.phone], ["Nearby hospital", profile.hospital], ["City", [profile.city, profile.state].filter(Boolean).join(", ")], ["Last donation", profile.last_donation_date ? formatDate(profile.last_donation_date) : "Not shared"], ["Donation registration no.", profile.registration_number || "Not shared"]].forEach(([term, value]) => {
    const wrap = createElement("div");
    wrap.append(createElement("dt", { text: term }), createElement("dd", { text: value || "—" }));
    facts.append(wrap);
  });
}

function incomingCard(request, reload) {
  const card = createElement("article", { className: "request-card card-surface" });
  const head = createElement("div", { className: "request-head" });
  const title = createElement("div");
  title.append(
    createElement("p", { className: "eyebrow", text: `${request.urgency === "urgent" ? "Urgent · " : request.urgency === "soon" ? "Soon · " : ""}${request.blood_group_needed} needed · ${request.units_needed} unit${request.units_needed > 1 ? "s" : ""}` }),
    createElement("h3", { text: `${request.requester_name} is asking for help` })
  );
  head.append(title, statusPill(request.status, { pending: "Needs your answer" }));
  const meta = createElement("div", { className: "request-meta" });
  [["Patient", request.patient_name], ["Hospital", [request.hospital_name, request.hospital_city].filter(Boolean).join(", ")], ["Needed by", formatDate(request.required_by)]].forEach(([term, value]) => {
    const wrap = createElement("div");
    wrap.append(createElement("span", { className: "meta-label", text: term }), createElement("strong", { text: value || "—" }));
    meta.append(wrap);
  });
  card.append(head, meta, createElement("p", { className: "request-message", text: request.message }), mapsLink([request.hospital_name, request.hospital_city], "Hospital directions"));
  const actions = createElement("div", { className: "request-actions" });
  if (request.slip_path) {
    const slip = createElement("button", { className: "button button-small button-ghost", text: "View hospital slip", attrs: { type: "button" } });
    slip.addEventListener("click", () => openSlip(request.slip_path, slip));
    actions.append(slip);
  }
  if (request.status === "pending") {
    const accept = createElement("button", { className: "button button-small", text: "Accept and share my number", attrs: { type: "button" } });
    const decline = createElement("button", { className: "button button-small button-outline", text: "I can't help", attrs: { type: "button" } });
    const report = createElement("button", { className: "text-button text-button-danger", text: "Report as fake", attrs: { type: "button" } });
    accept.addEventListener("click", () => respond(request.id, true, accept, reload));
    decline.addEventListener("click", () => respond(request.id, false, decline, reload));
    report.addEventListener("click", () => reportRequest(request.id, report, reload));
    actions.append(accept, decline, report);
    card.append(createElement("p", { className: "form-note", text: `Received ${formatDateTime(request.created_at)}. Check the hospital slip before accepting. Your number is shared only if you accept.` }));
  } else if (request.status === "accepted") {
    const reveal = createElement("button", { className: "button button-small", text: "Show recipient's phone number", attrs: { type: "button" } });
    reveal.addEventListener("click", () => revealContact(request.id, card, reveal, "Recipient"));
    const report = createElement("button", { className: "text-button text-button-danger", text: "Report a problem", attrs: { type: "button" } });
    report.addEventListener("click", () => reportRequest(request.id, report, reload));
    actions.append(reveal, report);
  }
  if (actions.childElementCount) card.append(actions);
  return card;
}

async function respond(id, accept, button, reload) {
  if (accept && !(await confirmDialog({ title: "Share your number?", message: "Accepting shares your phone number with this person so they can call you, and you will see theirs.", confirmLabel: "Accept and share" }))) return;
  try {
    setBusy(button, true, accept ? "Accepting…" : "Declining…");
    const { error } = await supabase.rpc("respond_to_request", { p_request_id: id, p_accept: accept });
    if (error) throw error;
    showToast(accept ? "Accepted. They can now see your number, and you can see theirs." : "Declined. Thank you for letting them know.", "success");
    reload();
  } catch (error) {
    showToast(friendlyError(error), "error");
    setBusy(button, false);
  }
}

async function reportRequest(id, button, reload) {
  const reason = await promptDialog({ title: "Report this request", message: "What looks wrong? For example: fake slip, asking for money.", confirmLabel: "Report", danger: true, input: { multiline: true, maxLength: 300, placeholder: "Tell the PulseBridge team what happened" } });
  if (reason === null) return;
  try {
    setBusy(button, true, "Reporting…");
    const { error } = await supabase.rpc("report_request", { p_request_id: id, p_reason: reason });
    if (error) throw error;
    showToast("Reported. The PulseBridge team will review it.", "success");
    reload();
  } catch (error) {
    showToast(friendlyError(error), "error");
    setBusy(button, false);
  }
}

async function loadIncoming() {
  const list = document.querySelector("#incoming-list");
  if (!list) return;
  setPanelMessage(list, "Loading requests…", "loading");
  try {
    const { data, error } = await supabase.rpc("incoming_requests");
    if (error) throw error;
    list.replaceChildren();
    if (!data?.length) {
      setPanelMessage(list, "No requests yet. When someone needs your blood group near you, their request will appear here.", "empty");
      return;
    }
    data.forEach((request) => list.append(incomingCard(request, loadIncoming)));
  } catch (error) {
    setPanelMessage(list, friendlyError(error, "We could not load your requests."), "error");
  }
}

async function loadProfile() {
  const loading = document.querySelector("#donor-loading");
  const register = document.querySelector("#donor-register");
  const dashboard = document.querySelector("#donor-dashboard");
  const form = document.querySelector("#donor-form");
  try {
    const { data, error } = await supabase.rpc("get_my_donor_profile");
    if (error) throw error;
    profile = data?.[0] || null;
    loading.hidden = true;
    if (profile) {
      register.hidden = true;
      dashboard.hidden = false;
      renderStatus();
      loadIncoming();
    } else {
      dashboard.hidden = true;
      register.hidden = false;
      form.dataset.mode = "create";
    }
  } catch (error) {
    setPanelMessage(loading, friendlyError(error, "We could not load your donor profile."), "error");
  }
}

function initDonorPage() {
  const form = document.querySelector("#donor-form");
  if (!form) return;
  form.elements.lastDonation.max = todayISO();
  const register = document.querySelector("#donor-register");
  const dashboard = document.querySelector("#donor-dashboard");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    const values = Object.fromEntries(new FormData(form).entries());
    if (!isValidPhone(values.phone)) {
      showToast("Please enter a valid phone number, for example 98765 43210.", "error");
      form.elements.phone.focus();
      return;
    }
    if (!supabaseReady) return;
    try {
      setBusy(submit, true, "Saving…");
      const { error } = await supabase.rpc("save_my_donor_profile", {
        p_name: values.name.trim(),
        p_age: Number(values.age),
        p_blood_group: values.bloodGroup,
        p_phone: values.phone.trim(),
        p_city: values.city.trim(),
        p_state: values.state.trim(),
        p_hospital: values.hospital.trim(),
        p_last_donation_date: values.lastDonation || null,
        p_registration_number: values.registrationNumber.trim(),
        p_consent: form.elements.consent.checked
      });
      if (error) throw error;
      showToast(form.dataset.mode === "edit" ? "Your details are updated." : "Thank you for registering as a donor!", "success");
      await loadProfile();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      showToast(friendlyError(error, "We could not save your details."), "error");
    } finally {
      setBusy(submit, false);
    }
  });

  document.querySelector("#cancel-edit")?.addEventListener("click", () => {
    if (!profile) return;
    register.hidden = true;
    dashboard.hidden = false;
  });

  document.querySelector("#edit-profile")?.addEventListener("click", () => {
    if (!profile) return;
    fillForm(form, profile);
    form.dataset.mode = "edit";
    document.querySelector("#donor-form-title").textContent = "Update your details";
    document.querySelector("#cancel-edit").hidden = false;
    dashboard.hidden = true;
    register.hidden = false;
    register.scrollIntoView({ behavior: "smooth" });
  });

  document.querySelector("#availability-toggle")?.addEventListener("change", async (event) => {
    const toggle = event.target;
    toggle.disabled = true;
    try {
      const { error } = await supabase.rpc("set_my_availability", { p_available: toggle.checked });
      if (error) throw error;
      showToast(toggle.checked ? "You're available again." : "Paused. You won't appear in search.", "success");
      await loadProfile();
    } catch (error) {
      toggle.checked = !toggle.checked;
      showToast(friendlyError(error), "error");
    } finally {
      toggle.disabled = false;
    }
  });

  document.querySelector("#confirm-available")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      setBusy(button, true, "Confirming…");
      const { error } = await supabase.rpc("set_my_availability", { p_available: true });
      if (error) throw error;
      showToast("Thanks! You're confirmed for another month.", "success");
      await loadProfile();
    } catch (error) {
      showToast(friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  });

  document.querySelector("#delete-profile")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!(await confirmDialog({ title: "Delete your donor profile?", message: "Your details and any requests sent to you will be permanently removed. This cannot be undone.", confirmLabel: "Delete permanently", danger: true }))) return;
    try {
      setBusy(button, true, "Deleting…");
      const { error } = await supabase.rpc("delete_my_donor_profile");
      if (error) throw error;
      showToast("Your donor profile has been deleted.", "success");
      profile = null;
      form.reset();
      await loadProfile();
    } catch (error) {
      showToast(friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  });

  let started = false;
  onAuth((user) => {
    if (user && !started) {
      started = true;
      const name = displayName(user);
      if (name && !name.includes("@")) form.elements.name.value = name;
      loadProfile();
    }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initDonorPage);
else initDonorPage();
