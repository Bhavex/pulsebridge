(function () {
  var mode = "dark";
  try {
    mode = window.localStorage.getItem("pb-theme") || "dark";
  } catch (error) {
    mode = "dark";
  }
  if (document.documentElement.getAttribute("data-page-kind") === "home") mode = "dark";
  var link = document.getElementById("theme-css");
  if (mode === "light" && link) link.disabled = true;
  document.documentElement.setAttribute("data-theme", mode);
  if (mode === "light") {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", "#c62828");
  }
  var lang = "en";
  var codes = ["en", "hi", "bn", "mr", "te", "ta", "gu", "pa"];
  try {
    lang = window.localStorage.getItem("pb-lang") || "";
  } catch (error) {
    lang = "";
  }
  if (codes.indexOf(lang) === -1) {
    var prefs = navigator.languages || [navigator.language || "en"];
    lang = "en";
    for (var i = 0; i < prefs.length; i++) {
      var c = String(prefs[i]).slice(0, 2).toLowerCase();
      if (codes.indexOf(c) !== -1) { lang = c; break; }
    }
  }
  if (lang !== "en") {
    document.documentElement.classList.add("i18n-pending");
    document.documentElement.setAttribute("lang", lang);
    window.setTimeout(function () { document.documentElement.classList.remove("i18n-pending"); }, 2500);
  }
})();
