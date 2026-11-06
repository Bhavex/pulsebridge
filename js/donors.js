import { supabase, supabaseReady } from "./supabase-config.js";
import { createElement, normalize, setBusy, setPanelMessage, showToast } from "./ui.js";

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const STATUS_LABELS = { true: "Available now", false: "Currently unavailable" };
const DIRECTORY_FIELDS = "id, name, age, blood_group, city, state, available, created_at";

export async function searchDonors(filters = {}) {
  if (!supabaseReady) throw new Error("Supabase is not configured yet.");
  let request = supabase.from("donor_directory").select(DIRECTORY_FIELDS).order("name", { ascending: true }).limit(200);
  const bloodGroup = String(filters.bloodGroup || "").trim();
  const cityLower = normalize(filters.city);
  const stateLower = normalize(filters.state);
  if (bloodGroup) request = request.eq("blood_group", bloodGroup);
  if (cityLower) request = request.eq("city_lower", cityLower);
  if (stateLower) request = request.eq("state_lower", stateLower);
  const { data, error } = await request;
  if (error) throw error;
  return data || [];
}

function donorCard(donor) {
  const card = createElement("article", { className: "donor-card" });
  const header = createElement("div", { className: "donor-card-header" });
  const identity = createElement("div");
  identity.append(createElement("span", { className: "eyebrow", text: donor.blood_group || "Blood group" }), createElement("h3", { text: donor.name || "Unnamed donor" }));
  const availability = createElement("span", { className: `availability ${donor.available ? "is-available" : "is-away"}`, text: STATUS_LABELS[String(Boolean(donor.available))] });
  header.append(identity, availability);
  const details = createElement("dl", { className: "donor-details" });
  [["Age", `${donor.age || "—"} years`], ["Location", [donor.city, donor.state].filter(Boolean).join(", ") || "—"]].forEach(([term, value]) => {
    const wrapper = createElement("div");
    wrapper.append(createElement("dt", { text: term }), createElement("dd", { text: value }));
    details.append(wrapper);
  });
  const action = createElement("a", { className: "button button-small", text: "Request contact", attrs: { href: `contact-request.html?donorId=${encodeURIComponent(donor.id)}` } });
  card.append(header, details, action);
  return card;
}

function initSearchPage() {
  const form = document.querySelector("#donor-search-form");
  const results = document.querySelector("#donor-results");
  const resultCount = document.querySelector("#donor-result-count");
  if (!form || !results) return;
  const runSearch = async () => {
    const submit = form.querySelector("button[type=submit]");
    setBusy(submit, true, "Searching…");
    setPanelMessage(results, "Looking through the donor directory…", "loading");
    try {
      const donors = await searchDonors({
        bloodGroup: form.elements.bloodGroup.value,
        city: form.elements.city.value,
        state: form.elements.state.value
      });
      results.replaceChildren();
      if (!donors.length) {
        setPanelMessage(results, "No donors found for these filters. Try a nearby city or leave one field blank.", "empty");
        if (resultCount) resultCount.textContent = "0 potential matches";
        return;
      }
      donors.forEach((donor) => results.append(donorCard(donor)));
      if (resultCount) resultCount.textContent = `${donors.length} potential match${donors.length === 1 ? "" : "es"}`;
    } catch (error) {
      console.error(error);
      setPanelMessage(results, "We could not load the donor directory. Please try again.", "error");
      showToast(String(error.message || "").includes("not configured") ? error.message : "Donor search is temporarily unavailable.", "error");
    } finally {
      setBusy(submit, false);
    }
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); runSearch(); });
  setPanelMessage(results, "Choose a blood group, city, or state to begin a private donor search.", "empty");
}

let adminDonors = [];

function messageRow(tableBody, text) {
  const row = createElement("tr");
  const cell = createElement("td", { className: "table-message", text });
  cell.colSpan = 7;
  row.append(cell);
  tableBody.replaceChildren(row);
}

async function loadAdminDonors() {
  const tableBody = document.querySelector("#admin-donor-rows");
  if (!tableBody) return;
  messageRow(tableBody, "Loading donors…");
  try {
    if (!supabaseReady) throw new Error("Supabase is not configured yet.");
    const { data, error } = await supabase
      .from("donor_directory")
      .select(`${DIRECTORY_FIELDS}, donor_private (phone, email, consent_given, consent_date)`)
      .order("name", { ascending: true });
    if (error) throw error;
    adminDonors = (data || []).map((donor) => {
      const privateData = Array.isArray(donor.donor_private) ? donor.donor_private[0] || {} : donor.donor_private || {};
      return { ...donor, phone: privateData.phone || "", email: privateData.email || "", consent_given: Boolean(privateData.consent_given) };
    });
    renderAdminDonors(tableBody);
  } catch (error) {
    console.error(error);
    messageRow(tableBody, "Could not load donors. Confirm that your account is listed as an admin.");
  }
}

function renderAdminDonors(tableBody) {
  if (!adminDonors.length) {
    messageRow(tableBody, "No donors have been added yet.");
    return;
  }
  tableBody.replaceChildren();
  adminDonors.forEach((donor) => {
    const row = createElement("tr");
    [donor.name, donor.blood_group, `${donor.city}, ${donor.state}`, `${donor.age} yrs`, donor.available ? "Available" : "Unavailable", donor.phone || "—"].forEach((value) => row.append(createElement("td", { text: value })));
    const actions = createElement("td", { className: "table-actions" });
    const edit = createElement("button", { className: "text-button", text: "Edit", attrs: { type: "button" } });
    edit.addEventListener("click", () => fillDonorForm(donor));
    const remove = createElement("button", { className: "text-button text-button-danger", text: "Delete", attrs: { type: "button" } });
    remove.addEventListener("click", () => deleteDonor(donor));
    actions.append(edit, remove);
    row.append(actions);
    tableBody.append(row);
  });
}

function fillDonorForm(donor) {
  const form = document.querySelector("#donor-form");
  if (!form) return;
  form.elements.donorId.value = donor.id;
  form.elements.name.value = donor.name || "";
  form.elements.age.value = donor.age || "";
  form.elements.bloodGroup.value = donor.blood_group || "";
  form.elements.city.value = donor.city || "";
  form.elements.state.value = donor.state || "";
  form.elements.phone.value = donor.phone || "";
  form.elements.email.value = donor.email || "";
  form.elements.available.checked = Boolean(donor.available);
  form.elements.consentGiven.checked = Boolean(donor.consent_given);
  document.querySelector("#donor-form-title").textContent = "Edit donor record";
  document.querySelector("#donor-form-helper").textContent = "Update only what has changed, then save the public and private records together.";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetDonorForm() {
  const form = document.querySelector("#donor-form");
  if (!form) return;
  form.reset();
  form.elements.donorId.value = "";
  document.querySelector("#donor-form-title").textContent = "Add a donor";
  document.querySelector("#donor-form-helper").textContent = "Only donors aged 18+ who have explicitly consented can be listed.";
}

async function saveDonor(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type=submit]");
  const age = Number(form.elements.age.value);
  const bloodGroup = form.elements.bloodGroup.value;
  const name = form.elements.name.value.trim();
  const city = form.elements.city.value.trim();
  const state = form.elements.state.value.trim();
  const phone = form.elements.phone.value.trim();
  const email = form.elements.email.value.trim();
  if (!name || !Number.isInteger(age) || age < 18 || age > 120 || !BLOOD_GROUPS.includes(bloodGroup) || !city || !state || !phone || !form.elements.consentGiven.checked) {
    showToast("Add a name, valid age (18+), blood group, location, phone, and consent before saving.", "error");
    return;
  }
  setBusy(submit, true, "Saving donor…");
  try {
    if (!supabaseReady) throw new Error("Supabase is not configured yet.");
    const { error } = await supabase.rpc("admin_save_donor", {
      p_id: form.elements.donorId.value || null,
      p_name: name,
      p_age: age,
      p_blood_group: bloodGroup,
      p_city: city,
      p_state: state,
      p_available: form.elements.available.checked,
      p_phone: phone,
      p_email: email,
      p_consent_given: true
    });
    if (error) throw error;
    showToast("Donor record saved.", "success");
    resetDonorForm();
    await loadAdminDonors();
  } catch (error) {
    console.error(error);
    showToast(String(error.message || "").includes("not configured") ? error.message : "We could not save this donor record.", "error");
  } finally {
    setBusy(submit, false);
  }
}

async function deleteDonor(donor) {
  if (!window.confirm(`Delete ${donor.name || "this donor"} from the directory?`)) return;
  try {
    if (!supabaseReady) throw new Error("Supabase is not configured yet.");
    const { error } = await supabase.rpc("admin_delete_donor", { p_id: donor.id });
    if (error) throw error;
    showToast("Donor removed.", "success");
    await loadAdminDonors();
  } catch (error) {
    console.error(error);
    showToast("We could not delete this donor record.", "error");
  }
}

function initAdminDonors() {
  const form = document.querySelector("#donor-form");
  if (!form) return;
  let loaded = false;
  const loadOnce = () => {
    if (loaded || !window.PulseBridgeAuth?.isAdmin?.()) return;
    loaded = true;
    loadAdminDonors();
  };
  form.addEventListener("submit", saveDonor);
  document.querySelector("#cancel-donor-edit")?.addEventListener("click", resetDonorForm);
  window.addEventListener("pulsebridge:auth", loadOnce);
  loadOnce();
}

function init() {
  initSearchPage();
  initAdminDonors();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
