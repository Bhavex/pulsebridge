export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "हिन्दी" },
  { code: "bn", name: "বাংলা" },
  { code: "mr", name: "मराठी" },
  { code: "te", name: "తెలుగు" },
  { code: "ta", name: "தமிழ்" },
  { code: "gu", name: "ગુજરાતી" },
  { code: "pa", name: "ਪੰਜਾਬੀ" }
];

const PATTERNS = [
  ["years_active", /^(\d+) years · (.+)$/],
  ["years", /^(\d+) years$/],
  ["asking", /^(.+) is asking for help$/],
  ["compatible", /^Compatible with (.+)$/],
  ["confirmed_days", /^Confirmed available (\d+) days ago$/],
  ["got_it", /^Got it, (.+)\.$/],
  ["thank_you", /^Thank you, (.+)!$/],
  ["last_confirmed", /^Last confirmed (.+)\. We'll ask again in about (\d+) days\.$/],
  ["hidden_in", /^Please confirm you're still available\. You'll be hidden from search in (\d+) days?\.$/],
  ["received", /^Received (.+)\. Check the hospital slip before accepting\. Your number is shared only if you accept\.$/],
  ["sent", /^Sent (.+)\. The donor has up to 72 hours to respond\. If they don't, the request expires and you can contact another donor\.$/],
  ["signed_in_as", /^Signed in as (.+)\.$/],
  ["accepted_on", /^The donor accepted on (.+)\. Please call them, share the hospital details, and thank them\.$/],
  ["matches", /^(\d+) potential match(?:es)?$/],
  ["for_patient", /^For (.+)$/],
  ["needed_units_urgent", /^Urgent · (.+) needed · (\d+) units?$/],
  ["needed_units_soon", /^Soon · (.+) needed · (\d+) units?$/],
  ["needed_units", /^(.+) needed · (\d+) units?$/],
  ["number", /^Number: (.+)$/]
];

const ATTRS = ["placeholder", "aria-label", "title"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "NOSCRIPT"]);

let dict = null;
let patterns = null;
let current = "en";

export function currentLanguage() {
  return current;
}

export function locale() {
  return current === "en" ? "en-IN" : `${current}-IN`;
}

function savedLanguage() {
  try {
    const saved = window.localStorage.getItem("pb-lang");
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    return "en";
  }
  const browser = (navigator.languages || [navigator.language || "en"]).map((l) => String(l).slice(0, 2).toLowerCase());
  return browser.find((code) => LANGUAGES.some((l) => l.code === code)) || "en";
}

export function setLanguage(code) {
  try {
    window.localStorage.setItem("pb-lang", code);
  } catch {
    return;
  }
  window.location.reload();
}

export function t(text) {
  if (!dict || typeof text !== "string") return text;
  const key = text.replace(/\s+/g, " ").trim();
  if (!key) return text;
  if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
  for (const [name, regex] of PATTERNS) {
    const template = patterns[name];
    if (!template) continue;
    const match = key.match(regex);
    if (match) return template.replace(/\$(\d)/g, (_, i) => t(match[Number(i)] ?? ""));
  }
  return text;
}

function translateText(node) {
  const raw = node.nodeValue;
  if (!raw || !/[A-Za-z]/.test(raw)) return;
  const translated = t(raw);
  if (translated !== raw) {
    const lead = raw.match(/^\s*/)[0];
    const trail = raw.match(/\s*$/)[0];
    node.nodeValue = lead + translated + trail;
  }
}

function translateElement(el) {
  if (el.closest?.("[data-no-i18n]")) return;
  ATTRS.forEach((attr) => {
    const value = el.getAttribute?.(attr);
    if (value && /[A-Za-z]/.test(value)) {
      const translated = t(value);
      if (translated !== value) el.setAttribute(attr, translated);
    }
  });
}

export function translateTree(root) {
  if (!dict || !root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    if (!SKIP.has(root.parentElement?.tagName) && !root.parentElement?.closest("[data-no-i18n]")) translateText(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || SKIP.has(root.tagName)) return;
  translateElement(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      if (!el || SKIP.has(el.tagName) || el.closest("[data-no-i18n], svg")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node);
    else translateElement(node);
    node = walker.nextNode();
  }
  root.querySelectorAll?.("input[placeholder], textarea[placeholder], input[aria-label], textarea[aria-label], select[aria-label]").forEach(translateElement);
}

function reveal() {
  document.documentElement.classList.remove("i18n-pending");
}

async function init() {
  current = savedLanguage();
  document.documentElement.lang = current;
  if (current === "en") {
    reveal();
    return;
  }
  try {
    const response = await fetch(`js/i18n/${current}.json`, { cache: "force-cache" });
    if (!response.ok) throw new Error("missing language file");
    const data = await response.json();
    dict = data.strings || {};
    patterns = data.patterns || {};
  } catch {
    dict = null;
    reveal();
    return;
  }
  const run = () => {
    translateTree(document.body);
    document.title = t(document.title);
    reveal();
    new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        if (m.type === "characterData") translateTree(m.target);
        else if (m.type === "attributes") translateElement(m.target);
        else m.addedNodes.forEach((n) => translateTree(n));
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) run();
  else document.addEventListener("DOMContentLoaded", run);
}

export const ready = init();
