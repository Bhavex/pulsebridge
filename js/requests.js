import { supabase, supabaseReady, SLIP_BUCKET } from "./supabase-config.js";
import { onAuth, displayName } from "./auth.js";
import { contactButtons, createElement, formatDate, formatDateTime, friendlyError, isValidPhone, readSession, setBusy, setPanelMessage, showToast, statusPill, todayISO } from "./ui.js";

const MAX_BYTES = 5 * 1024 * 1024;

async function imageToJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("We could not read that image. Please try a different photo.");
  return blob;
}

export async function uploadSlip(file, userId) {
  if (!file) throw new Error("Please attach the hospital requisition slip.");
  const isPdf = file.type === "application/pdf";
  const isImage = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  if (!isPdf && !isImage) throw new Error("Please upload a photo (JPG, PNG, WEBP) or a PDF of the slip.");
  let body = file;
  let contentType = file.type;
  let ext = "pdf";
  if (!isPdf) {
    body = await imageToJpeg(file);
    contentType = "image/jpeg";
    ext = "jpg";
  }
  if (body.size > MAX_BYTES) throw new Error("That file is too large. Please use a file under 5 MB.");
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(SLIP_BUCKET).upload(path, body, { contentType, upsert: false, cacheControl: "0" });
  if (error) throw error;
  return path;
}

export async function openSlip(path, button) {
  if (!path) return;
  const popup = window.open("about:blank", "_blank");
  try {
    setBusy(button, true, "Opening…");
    const { data, error } = await supabase.storage.from(SLIP_BUCKET).createSignedUrl(path, 120);
    if (error) throw error;
    if (popup) {
      popup.opener = null;
      popup.location.href = data.signedUrl;
    } else {
      window.location.href = data.signedUrl;
    }
  } catch (error) {
    popup?.close();
    showToast(friendlyError(error, "We could not open the slip."), "error");
  } finally {
    setBusy(button, false);
  }
}

export async function revealContact(requestId, container, button, roleLabel) {
  try {
    setBusy(button, true, "Loading…");
    const { data, error } = await supabase.rpc("get_request_contact", { p_request_id: requestId });
    if (error) throw error;
    const contact = data?.[0];
    if (!contact) throw new Error("Contact details are not available.");
    const box = createElement("div", { className: "contact-reveal" });
    const who = createElement("div");
    who.append(createElement("span", { text: roleLabel }), createElement("strong", { text: contact.contact_name }), createElement("span", { text: contact.contact_phone }));
    box.append(who, contactButtons(contact.contact_phone));
    button.replaceWith(box);
  } catch (error) {
    showToast(friendlyError(error, "We could not load the contact details."), "error");
    setBusy(button, false);
  }
  return container;
}

function fact(term, value) {
  const wrapper = createElement("div");
  wrapper.append(createElement("span", { className: "meta-label", text: term }), createElement("strong", { text: value || "—" }));
  return wrapper;
}

function initRequestPage() {
  const form = document.querySelector("#contact-request-form");
  if (!form) return;
  const summary = document.querySelector("#requested-donor-summary");
  const success = document.querySelector("#request-success");
  const donorId = new URLSearchParams(window.location.search).get("donorId") || "";
  const selected = readSession("pb-selected-donor");
  const donor = selected && selected.id === donorId ? selected : null;
  form.elements.donorId.value = donorId;
  form.elements.requiredBy.min = todayISO();
  form.elements.requiredBy.max = todayISO(60);
  form.elements.requiredBy.value = todayISO(1);
  if (!donorId) {
    summary.replaceChildren(createElement("span", { className: "eyebrow", text: "No donor selected" }), createElement("strong", { text: "Go back to Find donors and choose a donor first." }));
    form.hidden = true;
    return;
  }
  if (donor) {
    summary.replaceChildren(
      createElement("span", { className: "eyebrow", text: "Selected donor" }),
      createElement("div", { className: "donor-identity", children: [createElement("span", { className: "blood-badge", text: donor.blood_group }), createElement("div", { children: [createElement("h3", { text: donor.display_name }), createElement("small", { text: [donor.hospital, donor.city].filter(Boolean).join(" · ") })] })] })
    );
    if (donor.needed) form.elements.bloodGroupNeeded.value = donor.needed;
    if (donor.city) form.elements.hospitalCity.value = donor.city;
  } else {
    summary.replaceChildren(createElement("span", { className: "eyebrow", text: "Selected donor" }), createElement("strong", { text: "Donor details are protected. Fill in the form to send your request." }));
  }
  onAuth((user) => {
    if (user && !form.elements.requesterName.value) form.elements.requesterName.value = displayName(user).includes("@") ? "" : displayName(user);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    const user = window.PulseBridgeAuth?.currentUser?.();
    if (!user || !supabaseReady) {
      showToast("Please sign in before sending a request.", "error");
      return;
    }
    const values = Object.fromEntries(new FormData(form).entries());
    if (!isValidPhone(values.requesterPhone)) {
      showToast("Please enter a valid phone number, for example 98765 43210.", "error");
      form.elements.requesterPhone.focus();
      return;
    }
    if (!form.elements.consent.checked) {
      showToast("Please confirm the declaration before sending.", "error");
      return;
    }
    try {
      setBusy(submit, true, "Uploading slip…");
      const slipPath = await uploadSlip(form.elements.slip.files[0], user.id);
      setBusy(submit, false);
      setBusy(submit, true, "Sending request…");
      const { error } = await supabase.rpc("create_blood_request", {
        p_donor_id: values.donorId,
        p_patient_name: values.patientName.trim(),
        p_blood_group_needed: values.bloodGroupNeeded,
        p_units: Number(values.units),
        p_hospital_name: values.hospitalName.trim(),
        p_hospital_city: values.hospitalCity.trim(),
        p_required_by: values.requiredBy,
        p_requester_name: values.requesterName.trim(),
        p_requester_phone: values.requesterPhone.trim(),
        p_urgency: values.urgency,
        p_message: values.message.trim(),
        p_slip_path: slipPath
      });
      if (error) {
        await supabase.storage.from(SLIP_BUCKET).remove([slipPath]).catch(() => null);
        throw error;
      }
      form.hidden = true;
      summary.hidden = true;
      success.hidden = false;
      success.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      console.error(error);
      showToast(friendlyError(error, "We could not send your request. Please try again."), "error");
    } finally {
      setBusy(submit, false);
    }
  });
}

function myRequestCard(request, reload) {
  const card = createElement("article", { className: "request-card card-surface" });
  const head = createElement("div", { className: "request-head" });
  const title = createElement("div");
  title.append(createElement("p", { className: "eyebrow", text: `${request.blood_group_needed || "Blood"} needed · ${request.units_needed || 1} unit${request.units_needed > 1 ? "s" : ""}` }), createElement("h3", { text: `For ${request.patient_name || "patient"}` }));
  head.append(title, statusPill(request.status));
  const meta = createElement("div", { className: "request-meta" });
  meta.append(
    fact("Donor", `${request.donor_display_name} (${request.donor_blood_group})`),
    fact("Hospital", [request.hospital_name, request.hospital_city].filter(Boolean).join(", ")),
    fact("Needed by", formatDate(request.required_by))
  );
  const actions = createElement("div", { className: "request-actions" });
  const note = createElement("p", { className: "request-message" });
  if (request.status === "pending") {
    note.textContent = `Sent ${formatDateTime(request.created_at)}. The donor has up to 72 hours to respond. If they don't, the request expires and you can contact another donor.`;
    const cancel = createElement("button", { className: "button button-small button-ghost", text: "Cancel request", attrs: { type: "button" } });
    cancel.addEventListener("click", () => act("cancel_my_request", request.id, cancel, "Request cancelled.", reload));
    actions.append(cancel);
  } else if (request.status === "accepted") {
    note.textContent = `The donor accepted on ${formatDateTime(request.donor_responded_at)}. Please call them, share the hospital details, and thank them.`;
    const reveal = createElement("button", { className: "button button-small", text: "Show donor's phone number", attrs: { type: "button" } });
    reveal.addEventListener("click", () => revealContact(request.id, card, reveal, "Donor"));
    const done = createElement("button", { className: "button button-small button-outline", text: "Mark as done", attrs: { type: "button" } });
    done.addEventListener("click", () => act("complete_my_request", request.id, done, "Marked as done. Thank you for updating it.", reload));
    actions.append(reveal, done);
  } else if (request.status === "declined") {
    note.textContent = "This donor can't help this time. Please try another donor.";
  } else if (request.status === "expired") {
    note.textContent = "The donor didn't respond in time. Please try another donor.";
  }
  card.append(head, meta);
  if (note.textContent) card.append(note);
  if (actions.childElementCount) card.append(actions);
  return card;
}

async function act(fn, id, button, message, reload) {
  try {
    setBusy(button, true, "Updating…");
    const { error } = await supabase.rpc(fn, { p_request_id: id });
    if (error) throw error;
    showToast(message, "success");
    reload();
  } catch (error) {
    showToast(friendlyError(error), "error");
    setBusy(button, false);
  }
}

function initMyRequestsPage() {
  const list = document.querySelector("#my-request-list");
  if (!list) return;
  const load = async () => {
    setPanelMessage(list, "Loading your requests…", "loading");
    try {
      const { data, error } = await supabase.rpc("my_requests");
      if (error) throw error;
      list.replaceChildren();
      if (!data?.length) {
        list.replaceChildren(createElement("div", { className: "panel-message", children: [createElement("p", { text: "You haven't sent any requests yet." }), createElement("a", { className: "button button-small", text: "Find donors", attrs: { href: "find-donors.html" } })] }));
        return;
      }
      data.forEach((request) => list.append(myRequestCard(request, load)));
    } catch (error) {
      setPanelMessage(list, friendlyError(error, "We could not load your requests."), "error");
    }
  };
  let started = false;
  onAuth((user) => {
    if (user && !started) {
      started = true;
      load();
    }
  });
}

function init() {
  initRequestPage();
  initMyRequestsPage();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
