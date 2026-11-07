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
})();
