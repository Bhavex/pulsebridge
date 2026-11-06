const quotes = [
  { text: "A single donation can be the moment someone gets another tomorrow.", author: "PulseBridge community" },
  { text: "The strongest bridges are built one generous act at a time.", author: "Blood donation reminder" },
  { text: "Your time is short. Its impact can last a lifetime.", author: "A note for donors" }
];

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
      if (value !== undefined && value !== null) element.setAttribute(name, String(value));
    });
  }
  return element;
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function showToast(message, type = "info") {
  const region = document.querySelector("#toast-region") || createToastRegion();
  const toast = createElement("div", { className: `toast toast-${type}`, text: message, attrs: { role: "status" } });
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4600);
}

function createToastRegion() {
  const region = createElement("div", { className: "toast-region", attrs: { id: "toast-region", "aria-live": "polite", "aria-atomic": "true" } });
  document.body.append(region);
  return region;
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
  nav.innerHTML = `${logoMarkup()}
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-links"><span></span><span></span><span></span><span class="sr-only">Toggle navigation</span></button>
    <div class="nav-links" id="nav-links">
      <a class="nav-link ${current === "find-donors.html" ? "active" : ""}" href="find-donors.html">Find donors</a>
      <a class="nav-link ${current === "about.html" ? "active" : ""}" href="about.html">Why PulseBridge</a>
      <a class="nav-link ${current === "privacy.html" ? "active" : ""}" href="privacy.html">Privacy</a>
      <span class="nav-divider" aria-hidden="true"></span>
      ${isAdmin ? `<a class="nav-link nav-admin-link ${current === "admin.html" ? "active" : ""}" href="admin.html">Admin console</a>` : user ? `<a class="nav-link nav-user-link" href="find-donors.html">${escapeHtml(window.PulseBridgeAuth?.displayName?.(user) || "My search")}</a>` : `<a class="button button-small button-outline" href="login.html">Sign in</a>`}
    </div>`;
  const toggle = nav.querySelector(".nav-toggle");
  const links = nav.querySelector(".nav-links");
  toggle?.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    links.classList.toggle("open", !open);
  });
}

function renderFooter() {
  const footer = document.querySelector("#site-footer");
  if (!footer) return;
  footer.innerHTML = `<div class="shell footer-grid">
    <div><a class="footer-brand" href="index.html">Pulse<span>Bridge</span></a><p class="footer-copy">A privacy-first way to move blood donation closer to the people who need it.</p></div>
    <div class="footer-links"><a href="about.html">Our mission</a><a href="privacy.html">Privacy policy</a><a href="login.html">Sign in</a></div>
    <div class="footer-meta"><span>Built for human connection.</span><span>© ${new Date().getFullYear()} PulseBridge</span></div>
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

function initSharedUI() {
  renderNav(window.PulseBridgeAuth?.currentUser?.() || null);
  renderFooter();
  rotateQuotes();
  document.querySelectorAll("[data-current-year]").forEach((node) => { node.textContent = String(new Date().getFullYear()); });
  window.addEventListener("pulsebridge:auth", (event) => renderNav(event.detail?.user || null));
}

window.PulseBridgeUI = { escapeHtml, createElement, formatDate, showToast, setBusy, setPanelMessage, normalize, getInitials };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSharedUI);
else initSharedUI();
