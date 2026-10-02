/*
 * Loads feedback-pin in its required order: the anchoring engine, the TheraNetrix
 * settings, then the pin UI. Each script waits for the one before it.
 */
(function () {
  if (window.__theranetrixFeedbackLoading) return;
  // The invite dashboard is an admin tool, not part of the product under review.
  if (location.pathname === "/admin" || location.pathname.indexOf("/admin/") === 0) return;
  window.__theranetrixFeedbackLoading = true;
  var files = ["fb-anchor.js", "theranetrix-config.js", "feedback.js"];
  function next(index) {
    if (index >= files.length) return;
    var script = document.createElement("script");
    script.src = "/feedback-pin/" + files[index];
    script.async = false;
    script.onload = function () { next(index + 1); };
    script.onerror = function () { console.warn("Feedback pins unavailable: could not load " + files[index]); };
    document.body.appendChild(script);
  }
  next(0);
})();
