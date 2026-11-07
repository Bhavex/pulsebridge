import { supabase } from "./supabase-config.js";
import { onAuth } from "./auth.js";
import { openSlip } from "./requests.js";
import { createElement, formatDate, formatDateTime, friendlyError, setBusy, setPanelMessage, showToast, statusPill } from "./ui.js";

const STATUSES = ["pending", "accepted", "declined", "cancelled", "expired", "reported", "completed"];

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}

async function blockUser(userId, button, reloadAll) {
  if (!userId) return;
  const reason = window.prompt("Reason for blocking this account?");
  if (reason === null) return;
  try {
    setBusy(button, true, "Blocking…");
    await rpc("admin_block_user", { p_user_id: userId, p_reason: reason });
    showToast("Account blocked. Their open requests were cancelled.", "success");
    reloadAll();
  } catch (error) {
    showToast(friendlyError(error), "error");
    setBusy(button, false);
  }
}

function fact(term, value) {
  const wrap = createElement("div");
  wrap.append(createElement("span", { className: "meta-label", text: term }), createElement("strong", { text: value || "—" }));
  return wrap;
}

function requestCard(r, reloadAll) {
  const card = createElement("article", { className: "request-card card-surface" });
  const head = createElement("div", { className: "request-head" });
  const title = createElement("div");
  title.append(createElement("p", { className: "eyebrow", text: `${r.urgency || "routine"} · ${formatDateTime(r.created_at)}` }), createElement("h3", { text: `${r.requester_name} → ${r.donor_name}` }));
  head.append(title, statusPill(r.status));
  const meta = createElement("div", { className: "request-meta" });
  meta.append(
    fact("Patient", `${r.patient_name || "—"} · ${r.blood_group_needed || "?"} · ${r.units_needed || "?"} unit(s)`),
    fact("Hospital", [r.hospital_name, r.hospital_city].filter(Boolean).join(", ")),
    fact("Needed by", formatDate(r.required_by)),
    fact("Requester", `${r.requester_phone} · ${r.requester_email}`),
    fact("Donor", `${r.donor_blood_group} · ${r.donor_phone || "—"}`),
    fact("Donor responded", r.donor_responded_at ? formatDateTime(r.donor_responded_at) : "—")
  );
  card.append(head, meta, createElement("p", { className: "request-message", text: r.message }));
  if (r.report_reason || r.status === "reported") card.append(createElement("p", { className: "request-message", text: `Report: ${r.report_reason || "No reason given"}` }));
  const actions = createElement("div", { className: "request-actions" });
  if (r.slip_path) {
    const slip = createElement("button", { className: "button button-small button-ghost", text: "View slip", attrs: { type: "button" } });
    slip.addEventListener("click", () => openSlip(r.slip_path, slip));
    actions.append(slip);
  }
  const select = createElement("select", { className: "status-select", attrs: { "aria-label": "Request status" } });
  STATUSES.forEach((status) => select.append(createElement("option", { text: status, attrs: { value: status, selected: status === r.status } })));
  select.addEventListener("change", async () => {
    select.disabled = true;
    try {
      await rpc("admin_set_request_status", { p_request_id: r.id, p_status: select.value });
      showToast("Status updated.", "success");
      reloadAll();
    } catch (error) {
      showToast(friendlyError(error), "error");
      select.disabled = false;
    }
  });
  const block = createElement("button", { className: "text-button text-button-danger", text: "Block requester", attrs: { type: "button" } });
  block.addEventListener("click", () => blockUser(r.requester_uid, block, reloadAll));
  actions.append(select, block);
  card.append(actions);
  return card;
}

async function loadRequests(reloadAll) {
  const list = document.querySelector("#admin-request-list");
  setPanelMessage(list, "Loading requests…", "loading");
  try {
    const data = await rpc("admin_list_requests");
    list.replaceChildren();
    if (!data?.length) return setPanelMessage(list, "No requests yet.", "empty");
    data.forEach((r) => list.append(requestCard(r, reloadAll)));
  } catch (error) {
    setPanelMessage(list, friendlyError(error, "Could not load requests."), "error");
  }
}

async function loadDonors(reloadAll) {
  const body = document.querySelector("#admin-donor-rows");
  body.replaceChildren(createElement("tr", { children: [createElement("td", { className: "table-message", text: "Loading donors…", attrs: { colspan: 8 } })] }));
  try {
    const data = await rpc("admin_list_donors");
    body.replaceChildren();
    if (!data?.length) {
      body.append(createElement("tr", { children: [createElement("td", { className: "table-message", text: "No donors yet.", attrs: { colspan: 8 } })] }));
      return;
    }
    data.forEach((d) => {
      const days = Math.floor((Date.now() - new Date(d.availability_confirmed_at).getTime()) / 86400000);
      const state = !d.available ? "Paused" : days > 37 ? "Hidden (not confirmed)" : "Visible";
      const actions = createElement("td", { className: "table-actions" });
      const del = createElement("button", { className: "text-button text-button-danger", text: "Delete", attrs: { type: "button" } });
      del.addEventListener("click", async () => {
        if (!window.confirm(`Permanently delete donor ${d.name}?`)) return;
        try {
          await rpc("admin_delete_donor", { p_id: d.id });
          showToast("Donor deleted.", "success");
          reloadAll();
        } catch (error) {
          showToast(friendlyError(error), "error");
        }
      });
      if (d.user_id) {
        const block = createElement("button", { className: "text-button text-button-danger", text: "Block", attrs: { type: "button" } });
        block.addEventListener("click", () => blockUser(d.user_id, block, reloadAll));
        actions.append(block);
      }
      actions.append(del);
      const row = createElement("tr");
      [d.name, d.blood_group, `${d.age}`, [d.city, d.state].filter(Boolean).join(", "), d.hospital || "—", `${d.phone || "—"}${d.registration_number ? ` · Reg ${d.registration_number}` : ""}`, `${state} · confirmed ${formatDate(d.availability_confirmed_at)}`].forEach((value) => row.append(createElement("td", { text: value })));
      row.append(actions);
      body.append(row);
    });
  } catch (error) {
    body.replaceChildren(createElement("tr", { children: [createElement("td", { className: "table-message", text: friendlyError(error, "Could not load donors."), attrs: { colspan: 8 } })] }));
  }
}

async function loadBlocked(reloadAll) {
  const list = document.querySelector("#admin-blocked-list");
  try {
    const data = await rpc("admin_list_blocked");
    list.replaceChildren();
    if (!data?.length) return setPanelMessage(list, "No blocked accounts.", "empty");
    data.forEach((b) => {
      const row = createElement("div", { className: "danger-zone" });
      const unblock = createElement("button", { className: "button button-small button-ghost", text: "Unblock", attrs: { type: "button" } });
      unblock.addEventListener("click", async () => {
        try {
          await rpc("admin_unblock_user", { p_user_id: b.user_id });
          showToast("Account unblocked.", "success");
          reloadAll();
        } catch (error) {
          showToast(friendlyError(error), "error");
        }
      });
      row.append(createElement("p", { text: `${b.user_id} · ${b.reason || "No reason"} · ${formatDate(b.created_at)}` }), unblock);
      list.append(row);
    });
  } catch (error) {
    setPanelMessage(list, friendlyError(error, "Could not load blocked accounts."), "error");
  }
}

function init() {
  if (!document.querySelector("#admin-request-list")) return;
  const reloadAll = () => {
    loadRequests(reloadAll);
    loadDonors(reloadAll);
    loadBlocked(reloadAll);
  };
  let started = false;
  onAuth((user) => {
    if (user && window.PulseBridgeAuth?.isAdmin?.(user) && !started) {
      started = true;
      reloadAll();
    }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
