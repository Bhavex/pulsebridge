const quotes = [
  { text: "A single donation can be the moment someone gets another tomorrow.", author: "PulseBridge community" },
  { text: "The strongest bridges are built one generous act at a time.", author: "Blood donation reminder" },
  { text: "Your time is short. Its impact can last a lifetime.", author: "A note for donors" }
];

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createElement(tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([name, value]) => {
      if (value !== undefined && value !== null && value !== false) element.setAttribute(name, value === true ? "" : String(value));
    });
  }
  if (options.children) element.append(...options.children.filter(Boolean));
  return element;
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function todayISO(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function showToast(message, type = "info") {
  const region = document.querySelector("#toast-region") || createToastRegion();
  const toast = createElement("div", { className: `toast toast-${type}`, text: message, attrs: { role: "status" } });
  region.append(toast);
  window.setTimeout(() => toast.remove(), 5200);
}

function createToastRegion() {
  const region = createElement("div", { className: "toast-region", attrs: { id: "toast-region", "aria-live": "polite", "aria-atomic": "true" } });
  document.body.append(region);
  return region;
}

export function friendlyError(error, fallback = "Something went wrong. Please try again.") {
  const message = String(error?.message || "");
  if (!message) return fallback;
  if (/failed to fetch|network/i.test(message)) return "You seem to be offline. Check your connection and try again.";
  if (/jwt|not authenticated|permission denied/i.test(message)) return "Please sign in again to continue.";
  if (/payload too large|exceeded the maximum/i.test(message)) return "That file is too large. Please use a file under 5 MB.";
  if (/mime type|invalid_mime/i.test(message)) return "Please upload a JPG, PNG, WEBP or PDF file.";
  if (message.length < 160 && !/[{}<>]|violates|constraint|relation|column|function/i.test(message)) return message;
  return fallback;
}

export function setBusy(button, busy, busyLabel = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.replaceChildren(createElement("span", { className: "button-spinner", attrs: { "aria-hidden": "true" } }), document.createTextNode(busyLabel));
  } else {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = button.dataset.originalLabel || "Continue";
  }
}

export function setPanelMessage(container, message, type = "empty") {
  if (!container) return;
  container.replaceChildren(createElement("div", { className: `panel-message panel-message-${type}`, text: message }));
}

export function normalize(value = "") {
  return String(value).trim().toLowerCase();
}

export function getInitials(value = "PulseBridge") {
  return String(value).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "PB";
}

export function phoneDigits(phone = "") {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

export function isValidPhone(phone = "") {
  return /^\+?[0-9][0-9 -]{8,16}[0-9]$/.test(String(phone).trim());
}

export function contactButtons(phone) {
  const digits = phoneDigits(phone);
  const wrap = createElement("div", { className: "request-actions" });
  wrap.append(
    createElement("a", { className: "button button-small", text: "Call", attrs: { href: `tel:+${digits}` } }),
    createElement("a", { className: "button button-small button-outline", text: "WhatsApp", attrs: { href: `https://wa.me/${digits}`, target: "_blank", rel: "noopener noreferrer" } })
  );
  return wrap;
}

export function statusPill(status, overrides = {}) {
  const labels = { pending: "Waiting for donor", accepted: "Accepted", declined: "Declined", cancelled: "Cancelled", expired: "Expired", reported: "Reported", completed: "Done", contacted: "Contacted", rejected: "Rejected" };
  return createElement("span", { className: `status-pill status-${status}`, text: overrides[status] || labels[status] || status });
}

export function readSession(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeSession(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function logoMarkup() {
  return `<a class="brand" href="index.html" aria-label="PulseBridge home">
    <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false"><path d="M24 5.5C18.3 13.5 11.2 20.3 11.2 29.2A12.8 12.8 0 0 0 24 42a12.8 12.8 0 0 0 12.8-12.8C36.8 20.3 29.7 13.5 24 5.5Z"/><path class="pulse-line" d="M15.2 29.1h4.2l2.2-5.5 4.3 10.2 2.2-5.2h4.8"/></svg></span>
    <span class="brand-copy"><strong>Pulse</strong><span>Bridge</span></span>
  </a>`;
}

function renderNav(user) {
  const nav = document.querySelector("#site-nav");
  if (!nav) return;
  const current = window.location.pathname.split("/").pop() || "index.html";
  const isAdmin = user && window.PulseBridgeAuth?.isAdmin?.(user);
  const link = (href, label, extra = "") => `<a class="nav-link ${extra} ${current === href ? "active" : ""}" href="${href}">${label}</a>`;
  nav.innerHTML = `${logoMarkup()}
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-links"><span></span><span></span><span></span><span class="sr-only">Toggle navigation</span></button>
    <div class="nav-links" id="nav-links">
      ${link("find-donors.html", "Find donors")}
      ${link("donate.html", "Become a donor")}
      ${user ? link("my-requests.html", "My requests") : link("about.html", "Why PulseBridge")}
      ${link("privacy.html", "Privacy")}
      <span class="nav-divider" aria-hidden="true"></span>
      ${isAdmin ? link("admin.html", "Admin console", "nav-admin-link") : ""}
      ${user ? `<button class="button button-small button-outline" type="button" data-action="sign-out">Sign out</button>` : `<a class="button button-small button-outline" href="login.html">Sign in</a>`}
    </div>`;
  const toggle = nav.querySelector(".nav-toggle");
  const links = nav.querySelector(".nav-links");
  toggle?.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    links.classList.toggle("open", !open);
  });
  window.dispatchEvent(new CustomEvent("pulsebridge:nav"));
}

function renderFooter() {
  const footer = document.querySelector("#site-footer");
  if (!footer) return;
  footer.innerHTML = `<div class="shell footer-grid">
    <div><a class="footer-brand" href="index.html">Pulse<span>Bridge</span></a><p class="footer-copy">A privacy-first way to move blood donation closer to the people who need it.</p></div>
    <div class="footer-links"><a href="find-donors.html">Find donors</a><a href="donate.html">Become a donor</a><a href="about.html">Our mission</a><a href="privacy.html">Privacy policy</a></div>
    <div class="footer-meta"><span>In an emergency, call 108 or go to the nearest hospital.</span><span>© ${new Date().getFullYear()} PulseBridge</span></div>
  </div>`;
}

function rotateQuotes() {
  const rotator = document.querySelector("[data-quote-rotator]");
  if (!rotator) return;
  const quoteText = rotator.querySelector("[data-quote-text]");
  const quoteAuthor = rotator.querySelector("[data-quote-author]");
  let index = 0;
  const renderQuote = () => {
    const quote = quotes[index];
    rotator.classList.add("is-changing");
    window.setTimeout(() => {
      if (quoteText) quoteText.textContent = quote.text;
      if (quoteAuthor) quoteAuthor.textContent = `— ${quote.author}`;
      rotator.classList.remove("is-changing");
    }, 230);
    index = (index + 1) % quotes.length;
  };
  renderQuote();
  window.setInterval(renderQuote, 5200);
}

let deferredInstall = null;

function dismissedInstall() {
  try {
    return window.localStorage.getItem("pb-install-dismissed") === "1";
  } catch {
    return false;
  }
}

function showInstallBanner() {
  if (!deferredInstall || dismissedInstall() || document.querySelector(".install-banner")) return;
  const banner = createElement("div", { className: "install-banner", attrs: { role: "dialog", "aria-label": "Install PulseBridge" } });
  const install = createElement("button", { className: "button button-small", text: "Install app", attrs: { type: "button" } });
  const later = createElement("button", { className: "text-button", text: "Not now", attrs: { type: "button" } });
  banner.append(createElement("span", { text: "Add PulseBridge to your home screen" }), install, later);
  install.addEventListener("click", async () => {
    banner.remove();
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => null);
    deferredInstall = null;
  });
  later.addEventListener("click", () => {
    banner.remove();
    try {
      window.localStorage.setItem("pb-install-dismissed", "1");
    } catch {
      return;
    }
  });
  document.body.append(banner);
}

function initPwa() {
  if ("serviceWorker" in navigator && window.location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => null);
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event;
    window.setTimeout(showInstallBanner, 2500);
  });
}

function initSharedUI() {
  renderNav(window.PulseBridgeAuth?.currentUser?.() || null);
  renderFooter();
  rotateQuotes();
  initPwa();
  document.querySelectorAll("[data-current-year]").forEach((node) => { node.textContent = String(new Date().getFullYear()); });
  window.addEventListener("pulsebridge:auth", (event) => renderNav(event.detail?.user || null));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSharedUI);
else initSharedUI();
