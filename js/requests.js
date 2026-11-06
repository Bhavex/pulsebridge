import { supabase, supabaseReady } from "./supabase-config.js";
import { createElement, formatDate, setBusy, setPanelMessage, showToast } from "./ui.js";

const URGENCY_LABELS = { routine: "Routine", soon: "Soon", urgent: "Urgent" };
const REQUEST_STATUSES = ["pending", "contacted", "completed", "rejected"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadRequestedDonor() {
  const donorId = new URLSearchParams(window.location.search).get("donorId") || "";
  const donorSummary = document.querySelector("#requested-donor-summary");
  const hiddenId = document.querySelector("#request-donor-id");
  if (hiddenId) hiddenId.value = donorId;
  if (!donorSummary) return;
  if (!UUID_PATTERN.test(donorId)) {
    setPanelMessage(donorSummary, "Choose a donor from the search page first.", "error");
    return;
  }
  try {
    if (!supabaseReady) throw new Error("Supabase is not configured yet.");
    const { data, error } = await supabase.from("donor_directory").select("name, blood_group, city, state").eq("id", donorId).maybeSingle();
    if (error) throw error;
    if (!data) {
      setPanelMessage(donorSummary, "This donor listing is no longer available.", "error");
      return;
    }
    donorSummary.replaceChildren(
      createElement("span", { className: "eyebrow", text: data.blood_group || "Donor" }),
      createElement("strong", { text: data.name || "Selected donor" }),
      createElement("span", { text: [data.city, data.state].filter(Boolean).join(", ") || "Location not listed" })
    );
  } catch (error) {
    console.error(error);
    setPanelMessage(donorSummary, "We could not load this donor listing.", "error");
  }
}

async function createContactRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const user = window.PulseBridgeAuth?.currentUser?.();
  const donorId = form.elements.donorId.value;
  const submit = form.querySelector("button[type=submit]");
  if (!user) {
    showToast("Please sign in before sending a contact request.", "error");
    window.location.href = `login.html?next=${encodeURIComponent(`contact-request.html?donorId=${donorId}`)}`;
    return;
  }
  const urgency = form.elements.urgency.value;
  const requesterName = form.elements.requesterName.value.trim();
  const requesterPhone = form.elements.requesterPhone.value.trim();
  const message = form.elements.message.value.trim();
  if (!UUID_PATTERN.test(donorId) || !requesterName || !requesterPhone || !message || !Object.hasOwn(URGENCY_LABELS, urgency)) {
    showToast("Please complete your name, phone, and message.", "error");
    return;
  }
  setBusy(submit, true, "Sending request…");
  try {
    if (!supabaseReady) throw new Error("Supabase is not configured yet.");
    const { error } = await supabase.from("contact_requests").insert({ donor_id: donorId, requester_name: requesterName, requester_phone: requesterPhone, message, urgency });
    if (error) throw error;
    form.hidden = true;
    document.querySelector("#request-success").hidden = false;
    showToast("Your request was sent to the PulseBridge admin team.", "success");
  } catch (error) {
    console.error(error);
    const text = String(error.message || "");
    showToast(text.includes("not configured") || text.includes("Too many") ? text : "We could not send this request. Please try again.", "error");
  } finally {
    setBusy(submit, false);
  }
}

async function loadAdminRequests() {
  const container = document.querySelector("#admin-request-list");
  if (!container) return;
  setPanelMessage(container, "Loading contact requests…", "loading");
  try {
    if (!supabaseReady) throw new Error("Supabase is not configured yet.");
    const { data, error } = await supabase
      .from("contact_requests")
      .select("id, donor_id, requester_name, requester_email, requester_phone, message, urgency, status, created_at, donor_directory (name, donor_private (phone, email))")
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!data?.length) {
      setPanelMessage(container, "No contact requests yet. New requests will appear here for manual follow-up.", "empty");
      return;
    }
    container.replaceChildren(...data.map(requestCard));
  } catch (error) {
    console.error(error);
    setPanelMessage(container, "Could not load requests. Confirm that your account is listed as an admin.", "error");
  }
}

function requestCard(request) {
  const donor = request.donor_directory || {};
  const privateDonor = (Array.isArray(donor.donor_private) ? donor.donor_private[0] : donor.donor_private) || {};
  const card = createElement("article", { className: "request-card" });
  const header = createElement("div", { className: "request-card-header" });
  const title = createElement("div");
  title.append(createElement("span", { className: "eyebrow", text: `For ${donor.name || "unknown donor"}` }), createElement("h3", { text: request.requester_name || "Unnamed requester" }));
  const status = createElement("select", { className: "status-select", attrs: { "aria-label": "Request status" } });
  REQUEST_STATUSES.forEach((value) => status.append(createElement("option", { text: value[0].toUpperCase() + value.slice(1), attrs: { value } })));
  status.value = request.status || "pending";
  status.addEventListener("change", async () => {
    try {
      const { error } = await supabase.from("contact_requests").update({ status: status.value }).eq("id", request.id);
      if (error) throw error;
      showToast("Request status updated.", "success");
    } catch (error) {
      console.error(error);
      status.value = request.status || "pending";
      showToast("Could not update the request status.", "error");
    }
  });
  header.append(title, status);
  const meta = createElement("div", { className: "request-meta" });
  [["Requester phone", request.requester_phone || "—"], ["Requester email", request.requester_email || "—"], ["Donor phone", privateDonor.phone || "—"], ["Donor email", privateDonor.email || "—"], ["Urgency", URGENCY_LABELS[request.urgency] || "—"], ["Received", formatDate(request.created_at)]].forEach(([label, value]) => {
    const item = createElement("div");
    item.append(createElement("span", { className: "meta-label", text: label }), createElement("strong", { text: value }));
    meta.append(item);
  });
  const message = createElement("p", { className: "request-message", text: `“${request.message || "No message provided."}”` });
  const footer = createElement("div", { className: "request-card-footer" });
  const deleteButton = createElement("button", { className: "text-button text-button-danger", text: "Delete request", attrs: { type: "button" } });
  deleteButton.addEventListener("click", async () => {
    if (!window.confirm("Delete this contact request?")) return;
    try {
      const { error } = await supabase.from("contact_requests").delete().eq("id", request.id);
      if (error) throw error;
      showToast("Request deleted.", "success");
      await loadAdminRequests();
    } catch (error) {
      console.error(error);
      showToast("Could not delete the request.", "error");
    }
  });
  footer.append(deleteButton);
  card.append(header, meta, message, footer);
  return card;
}

function init() {
  const requestForm = document.querySelector("#contact-request-form");
  if (requestForm) {
    requestForm.addEventListener("submit", createContactRequest);
    let donorLoaded = false;
    const loadDonorOnce = () => {
      if (donorLoaded || !window.PulseBridgeAuth?.currentUser?.()) return;
      donorLoaded = true;
      loadRequestedDonor();
    };
    window.addEventListener("pulsebridge:auth", loadDonorOnce);
    loadDonorOnce();
  }
  if (document.querySelector("#admin-request-list")) {
    let loaded = false;
    const loadOnce = () => {
      if (loaded || !window.PulseBridgeAuth?.isAdmin?.()) return;
      loaded = true;
      loadAdminRequests();
    };
    window.addEventListener("pulsebridge:auth", loadOnce);
    loadOnce();
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
