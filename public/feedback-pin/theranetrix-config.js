/*
 * TheraNetrix settings for feedback-pin. Loaded between fb-anchor.js and feedback.js
 * (see loader.js). A screen is the route plus, inside a patient record, the open tab,
 * so a pin dropped on Emma Carter's Treatment tab never shows on another patient or tab.
 */
(function () {
  if (!window.FBAnchor) {
    throw new Error("theranetrix-config.js loaded before fb-anchor.js. Required order: fb-anchor.js → theranetrix-config.js → feedback.js");
  }
  var tabLabels = { visit: "This visit", treatment: "Treatment", twin: "Digital Twin", messages: "Messages", notes: "Notes", outcomes: "Observation history", full: "Complete record" };
  var routeLabels = { "/": "Care overview", "/patients": "Patients", "/review-queue": "Review queue", "/messages": "Messages", "/schedule": "Schedule", "/settings": "Workspace settings", "/care-pathways": "Care pathways", "/patient-companion": "Patient companion" };

  function inRecord() {
    return !!document.querySelector(".feedback-patient");
  }
  function currentTab() {
    return inRecord() ? new URLSearchParams(location.search).get("tab") || "visit" : "";
  }

  window.FBAnchor.configure({
    readSignature: function () {
      return { access: true, route: location.pathname, tab: currentTab() };
    },
    // Every pin belongs to its route; pins inside a patient record also belong to the tab.
    rules: [
      { sel: "body", add: ["route"] },
      { sel: ".feedback-patient", add: ["tab"] },
    ],
    // Watch the page content only. Without named nodes the engine watches the whole
    // document, which includes its own dock, so every redraw schedules another.
    // React rebuilds nodes inside main freely, so anchors there re-resolve each flush.
    rebuildHosts: ["#main-content"],
    scopeNodes: ["#main-content"],
    resizeNodes: ["#main-content"],
  });

  // The pin composer states what a request does. feedback.js has no label hook, so the
  // note is a style rule, and the select's hard-coded "Importance" name is corrected once
  // the composer takes focus (its textarea is focused as it opens).
  var requestNote = document.createElement("style");
  requestNote.setAttribute("data-feedback-config", "request-note");
  requestNote.textContent =
    '.fb-composer::after { content: "Review request only. Nothing on screen is hidden or deleted until the team reviews it. Feedback never changes patient records."; display: block; margin-top: 10px; font-size: 11px; line-height: 1.45; color: #4a4a45; }';
  document.head.appendChild(requestNote);
  document.addEventListener("focusin", function (event) {
    var composer = event.target && event.target.closest ? event.target.closest(".fb-composer") : null;
    var select = composer && composer.querySelector("select.fb-importance");
    if (select && select.getAttribute("aria-label") !== "Request type") select.setAttribute("aria-label", "Request type");
  });

  window.FEEDBACK_CONFIG = {
    title: "Feedback",
    accent: "#087f75",
    navy: "#17313f",
    appName: "theranetrix",
    storageKey: "theranetrix.feedback.pins",
    nameKey: "theranetrix.feedback.author",
    apiUrl: "/api/feedback",
    pollInterval: 20000,
    // Each pin records a review request for the team, not a severity. The request types,
    // labels and order match the Feedback dialog (components/theranetrix/prototype-feedback.tsx).
    // feedback.js makes the "medium" entry, else the middle one, the default for a new pin, so
    // "Suggest a change" sits in the middle. Colors avoid red and the app's teal so a ring never
    // reads as a clinical status or a system recommendation.
    importance: [
      { value: "question", label: "Question", color: "#0891b2" },
      { value: "keep", label: "Keep as is", color: "#78716c" },
      { value: "hide", label: "Suggest hiding", color: "#64748b" },
      { value: "change", label: "Suggest a change", color: "#b45309" },
      { value: "prioritize", label: "Suggest prioritizing", color: "#1d4ed8" },
      { value: "remove", label: "Suggest removing", color: "#7c3aed" },
    ],
    // Pins saved before request types keep their severity. feedback.js shows it with a neutral
    // chip, and editing such a pin keeps it until the reviewer picks a request type.
    importanceLegacy: {
      blocker: "Blocker (earlier severity)",
      high: "High (earlier severity)",
      medium: "Medium (earlier severity)",
      low: "Low (earlier severity)",
    },
    screenLabel: function (s) {
      var route = (s && s.route) || location.pathname;
      var patient = route.match(/^\/patients\/([^/]+)$/);
      if (patient) return "Patient " + decodeURIComponent(patient[1]) + " · " + (tabLabels[s.tab] || s.tab || "This visit");
      return routeLabels[route] || route;
    },
    // Open the screen a pin was left on. Inside the same record a tab switch is in place.
    goToScreen: function (screen) {
      if (!screen || !screen.route) return;
      var url = screen.route + (screen.tab ? "?tab=" + encodeURIComponent(screen.tab) : "");
      if (location.pathname + location.search === url) return;
      if (location.pathname === screen.route && inRecord()) {
        history.replaceState(null, "", url);
        window.dispatchEvent(new PopStateEvent("popstate"));
      } else {
        location.href = url;
      }
    },
  };
})();
