import { supabase, supabaseReady } from "./supabase-config.js";
import { onAuth } from "./auth.js";
import { createElement, friendlyError, readSession, setBusy, setPanelMessage, writeSession } from "./ui.js";

const SEARCH_KEY = "pb-last-search";
let lastResults = [];
let lastQuery = null;

export async function searchDonors(filters) {
  if (!supabaseReady || !supabase) throw new Error("Search is not available right now.");
  const { data, error } = await supabase.rpc("search_donors", {
    p_blood_group: filters.bloodGroup || null,
    p_include_compatible: Boolean(filters.bloodGroup && filters.compatible),
    p_city: filters.city || null,
    p_state: filters.state || null,
    p_hospital: filters.hospital || null,
    p_sort: filters.sort || "best"
  });
  if (error) throw error;
  return data || [];
}

function sortResults(donors, sort) {
  const list = [...donors];
  const text = (value) => String(value || "").toLowerCase();
  if (sort === "hospital") list.sort((a, b) => text(a.hospital).localeCompare(text(b.hospital)) || text(a.city).localeCompare(text(b.city)));
  else if (sort === "city") list.sort((a, b) => text(a.city).localeCompare(text(b.city)) || text(a.hospital).localeCompare(text(b.hospital)));
  else if (sort === "recent") list.sort((a, b) => a.confirmed_days_ago - b.confirmed_days_ago);
  else if (sort === "age") list.sort((a, b) => a.age - b.age);
  else list.sort((a, b) => Number(b.exact_match) - Number(a.exact_match) || Number(b.eligible_now) - Number(a.eligible_now) || a.confirmed_days_ago - b.confirmed_days_ago);
  return list;
}

function activeLabel(days) {
  if (days <= 0) return "Confirmed available today";
  if (days === 1) return "Confirmed available yesterday";
  return `Confirmed available ${days} days ago`;
}

function donorCard(donor, query) {
  const card = createElement("article", { className: "donor-card" });
  const header = createElement("div", { className: "donor-card-header" });
  const identity = createElement("div", { className: "donor-identity" });
  const nameBlock = createElement("div");
  nameBlock.append(createElement("h3", { text: donor.display_name || "Donor" }), createElement("small", { text: `${donor.age} years · ${activeLabel(donor.confirmed_days_ago)}` }));
  identity.append(createElement("span", { className: "blood-badge", text: donor.blood_group }), nameBlock);
  const eligibility = donor.eligible_now
    ? createElement("span", { className: "chip chip-ok", text: "Eligible to donate" })
    : createElement("span", { className: "chip chip-warn", text: "Donated recently" });
  header.append(identity, eligibility);
  const details = createElement("dl", { className: "donor-details donor-details-3" });
  [["Nearby hospital", donor.hospital || "—"], ["City", [donor.city, donor.state].filter(Boolean).join(", ") || "—"], ["Last donated", donor.last_donated || "Not shared"]].forEach(([term, value]) => {
    const wrapper = createElement("div");
    wrapper.append(createElement("dt", { text: term }), createElement("dd", { text: value }));
    details.append(wrapper);
  });
  const chips = createElement("div", { className: "chip-row" });
  if (query.bloodGroup) chips.append(createElement("span", { className: donor.exact_match ? "chip chip-red" : "chip", text: donor.exact_match ? "Exact blood group" : `Compatible with ${query.bloodGroup}` }));
  const action = createElement("button", { className: "button button-small", text: "Request this donor", attrs: { type: "button" } });
  action.addEventListener("click", () => {
    writeSession("pb-selected-donor", { ...donor, needed: query.bloodGroup || donor.blood_group, city: donor.city });
    window.location.href = `contact-request.html?donorId=${encodeURIComponent(donor.id)}`;
  });
  card.append(header, chips, details, action);
  return card;
}

function render(results, resultCount, query) {
  const sort = document.querySelector("#result-sort")?.value || "best";
  const eligibleOnly = document.querySelector("#eligible-only")?.checked;
  const list = sortResults(lastResults.filter((donor) => !eligibleOnly || donor.eligible_now), sort);
  results.replaceChildren();
  if (resultCount) resultCount.textContent = `${list.length} potential ${list.length === 1 ? "match" : "matches"}`;
  if (!list.length) {
    setPanelMessage(results, lastResults.length ? "No donors match these extra filters. Try turning off “Eligible now only”." : "No available donors found. Try including compatible blood groups, or leave city or hospital blank.", "empty");
    return;
  }
  list.forEach((donor) => results.append(donorCard(donor, query)));
}

function initSearchPage() {
  const form = document.querySelector("#donor-search-form");
  const results = document.querySelector("#donor-results");
  const resultCount = document.querySelector("#donor-result-count");
  if (!form || !results) return;
  const saved = readSession(SEARCH_KEY);
  if (saved) {
    ["bloodGroup", "city", "state", "hospital"].forEach((field) => { if (saved[field]) form.elements[field].value = saved[field]; });
    form.elements.compatible.checked = saved.compatible !== false;
    if (saved.sort) document.querySelector("#result-sort").value = saved.sort;
  }
  const runSearch = async () => {
    const submit = form.querySelector("button[type=submit]");
    const query = {
      bloodGroup: form.elements.bloodGroup.value,
      compatible: form.elements.compatible.checked,
      city: form.elements.city.value.trim(),
      state: form.elements.state.value.trim(),
      hospital: form.elements.hospital.value.trim(),
      sort: document.querySelector("#result-sort").value
    };
    writeSession(SEARCH_KEY, query);
    setBusy(submit, true, "Searching…");
    setPanelMessage(results, "Looking for available donors…", "loading");
    try {
      lastResults = await searchDonors(query);
      lastQuery = query;
      render(results, resultCount, query);
    } catch (error) {
      console.error(error);
      setPanelMessage(results, friendlyError(error, "We could not search right now. Please try again."), "error");
      if (resultCount) resultCount.textContent = "Search unavailable";
    } finally {
      setBusy(submit, false);
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch();
  });
  document.querySelector("#result-sort")?.addEventListener("change", () => {
    if (lastQuery) {
      writeSession(SEARCH_KEY, { ...lastQuery, sort: document.querySelector("#result-sort").value });
      render(results, resultCount, lastQuery);
    }
  });
  document.querySelector("#eligible-only")?.addEventListener("change", () => { if (lastQuery) render(results, resultCount, lastQuery); });
  let started = false;
  onAuth((user) => {
    if (user && !started) {
      started = true;
      if (saved) runSearch();
      else setPanelMessage(results, "Choose the blood group you need and search. Including compatible groups usually finds more donors.", "empty");
    }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSearchPage);
else initSearchPage();
