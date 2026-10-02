/*!
 * feedback.js — drop-in Pastel-style feedback overlay
 *
 * Usage:
 *   <script src="https://your-host/feedback.js"></script>
 *
 * Optional config (must run BEFORE the script tag):
 *   window.FEEDBACK_CONFIG = {
 *     title: "Feedback",              // panel title
 *     accent: "#eab308",              // pin & primary color
 *     navy:   "#1d2038",              // dark text / contrast color
 *     storageKey: "feedback.pins",    // localStorage key for pins
 *     nameKey:    "feedback.author",  // localStorage key for author name
 *     // CSS selectors for overlays/modals. Pins dropped inside one of these
 *     // are scoped to that overlay's title. Defaults intentionally exclude
 *     // generic `.modal` (too commonly used for non-modal content); pass
 *     // your own selector list if your app uses different overlay classes.
 *     overlaySelectors: '.overlay-drawer, .overlay-center, [role="dialog"], [aria-modal="true"], dialog[open]',
 *
 *     // Optional shared inbox. When set, every saved/edited pin is POSTed
 *     // here as JSON. Works directly with Slack incoming webhooks (uses the
 *     // Slack-compatible `text` field) or any custom endpoint (full pin +
 *     // page + userAgent in the body).
 *     webhookUrl: "https://hooks.slack.com/services/T000/B000/XXXX",
 *
 *     // Optional shared-backend URL. When set, pins are stored centrally so
 *     // every reviewer sees everyone else's feedback (not just their own
 *     // localStorage). The endpoint must accept GET (?app=name → returns
 *     // {pins:[...]}, POST (body: {pin}), and DELETE (?app=name&id=pinId).
 *     // A reference implementation lives at api/feedback.js in this repo.
 *     apiUrl: "https://your-app.vercel.app/api/feedback",
 *
 *     // Optional poll interval (ms) for picking up other reviewers' pins.
 *     // Default 30 000. Set 0 to disable polling (fetch only on load/save).
 *     pollInterval: 30000,
 *
 *     // Optional label that appears in the webhook + api payloads, so a
 *     // single backend receiving feedback from multiple apps can tell them
 *     // apart. Defaults to document.title.
 *     appName: "Cheddr IQ",
 *   };
 *
 * One-time setup. Idempotent — safe if the script loads more than once.
 */
(function () {
  if (window.__feedbackTool) return;
  window.__feedbackTool = true;

  var cfg = Object.assign(
    {
      title: "Feedback",
      accent: "#eab308",
      navy: "#1d2038",
      storageKey: "feedback.pins",
      nameKey: "feedback.author",
      overlaySelectors:
        '.overlay-drawer, .overlay-center, [role="dialog"], [aria-modal="true"], dialog[open]',
      webhookUrl: null,
      apiUrl: null,
      // Supabase is an alternative to apiUrl, not a replacement: PostgREST is
      // reachable straight from the browser, so a page that already has a
      // Supabase project needs no serverless function deployed alongside it.
      // { url, anonKey, table } — table defaults to "feedback_pins".
      supabase: null,
      pollInterval: 30000,
      appName: null, // falls back to document.title
    },
    window.FEEDBACK_CONFIG || {},
  );

  // App slug for namespacing (per-app key in the shared backend / localStorage).
  function appSlug() {
    var n = cfg.appName || document.title || location.host;
    return (
      n
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .slice(0, 60) || "default"
    );
  }

  // ─── Storage helpers ──────────────────────────────────────────────────────
  var DOCK_POS_KEY = (cfg.storageKey || "feedback.pins") + ".dockPos";
  function readDockPos() {
    try {
      var raw = localStorage.getItem(DOCK_POS_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (typeof p?.left === "number" && typeof p?.top === "number") return p;
      return null;
    } catch (e) {
      return null;
    }
  }
  function writeDockPos(p) {
    try {
      if (!p) localStorage.removeItem(DOCK_POS_KEY);
      else localStorage.setItem(DOCK_POS_KEY, JSON.stringify(p));
    } catch (e) {}
  }
  function readPins() {
    try {
      return JSON.parse(localStorage.getItem(cfg.storageKey) || "[]");
    } catch (e) {
      return [];
    }
  }
  function writePins() {
    try {
      localStorage.setItem(cfg.storageKey, JSON.stringify(pins));
    } catch (e) {}
  }
  // Replies mirror pins in their own key, for the same reason they are their own
  // rows server-side: they are merged by union, and keeping them beside the pin
  // would drag them into the pin's last-write-wins path.
  var REPLIES_KEY = (cfg.storageKey || "feedback.pins") + ".replies";
  function readReplies() {
    try {
      return JSON.parse(localStorage.getItem(REPLIES_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function writeReplies() {
    try {
      localStorage.setItem(REPLIES_KEY, JSON.stringify(replies));
    } catch (e) {}
  }
  // Every name that has been used on this page, most recent first. Read from the
  // shared data rather than a separate list, so a teammate who has ever left
  // feedback is offered without anything extra to maintain.
  function knownAuthors() {
    var seen = {};
    var all = [];
    pins
      .concat(
        replies.filter(function (r) {
          return !r.deleted;
        }),
      )
      .slice()
      .sort(function (a, b) {
        return (b.ts || 0) - (a.ts || 0);
      })
      .forEach(function (row) {
        var n = String(row.author || "").trim();
        if (!n || n === "anon" || seen[n]) return;
        seen[n] = true;
        all.push(n);
      });
    return all;
  }

  function repliesFor(pinId) {
    return replies
      .filter(function (r) {
        return r.pinId === pinId && !r.deleted;
      })
      .sort(function (a, b) {
        return (a.ts || 0) - (b.ts || 0);
      });
  }
  function readName() {
    try {
      return localStorage.getItem(cfg.nameKey) || "";
    } catch (e) {
      return "";
    }
  }
  function writeName(n) {
    try {
      localStorage.setItem(cfg.nameKey, n);
    } catch (e) {}
  }

  // ─── State ────────────────────────────────────────────────────────────────
  // Element-anchoring engine (fb-anchor.js). Optional: without it the tool
  // falls back to the original absolute x/y behaviour, which is fine for simple
  // pages and wrong for anything with tabs, drawers, or a pan/zoom canvas.
  var ANCHOR = window.FBAnchor || null;
  var pins = readPins();
  var replies = readReplies();
  // Which thread the panel should highlight and scroll to. Cleared once the
  // user interacts elsewhere, so the highlight marks "I just opened this" and
  // does not become permanent decoration.
  var focusPinId = null;
  var author = readName();
  var active = false; // annotation mode
  var editing = null; // pin being composed
  var panelOpen = false;
  var overlayTitle = null; // null = no modal up; else the modal's title text
  var drag = null; // { id, startX, startY, originX, originY, node, moved, finalX, finalY }
  var dockPos = readDockPos(); // null = default bottom-right; else { left, top } in viewport coords
  var lastVerdicts = {}; // pinId -> why it is (or is not) on screen this frame

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function routeFromHash() {
    return (location.hash.slice(1) || "page").split("?")[0];
  }
  function topOverlay() {
    var els = document.querySelectorAll(cfg.overlaySelectors);
    if (!els.length) return null;
    // Walk back-to-front; pick the first selector match that's actually
    // floating + visible + sized like a real modal. Many apps leave a
    // matching element in the DOM that isn't currently shown — we ignore those.
    for (var i = els.length - 1; i >= 0; i--) {
      var el = els[i];
      if (!el || !el.getBoundingClientRect) continue;
      // Skip hidden elements
      if (el.offsetParent === null && el.style.position !== "fixed") continue;
      var st;
      try {
        st = window.getComputedStyle(el);
      } catch (e) {
        continue;
      }
      if (
        !st ||
        st.display === "none" ||
        st.visibility === "hidden" ||
        st.opacity === "0"
      )
        continue;
      // Must be positioned (modals are nearly always position:fixed or absolute)
      if (st.position !== "fixed" && st.position !== "absolute") continue;
      // Must occupy meaningful screen area (skip 0×0 or tiny stubs)
      var r = el.getBoundingClientRect();
      if (r.width < 200 || r.height < 100) continue;
      var line =
        (el.innerText || "")
          .split("\n")
          .map(function (s) {
            return s.trim();
          })
          .find(function (s) {
            return s.length > 0;
          }) || "modal";
      return { el: el, title: line.slice(0, 120) };
    }
    return null;
  }
  function labelOf(el) {
    if (!el || el === document.documentElement || el === document.body)
      return "page";
    var fbId = el.getAttribute && el.getAttribute("data-feedback-id");
    if (fbId) return fbId;
    if (el.id) return "#" + el.id;
    var cls = (el.className || "")
      .toString()
      .split(/\s+/)
      .filter(function (c) {
        return c && c.indexOf("kpi-value") !== 0;
      })
      .slice(0, 2)
      .join(".");
    var tag = (el.tagName || "div").toLowerCase();
    return cls ? tag + "." + cls : tag;
  }
  function snippetOf(el) {
    if (!el) return "";
    var t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t.length > 60 ? t.slice(0, 57) + "…" : t;
  }
  // Deterministic per-author color so each reviewer's pins are visually
  // distinct on a shared canvas. Palette is hand-picked for contrast against
  // navy text and against each other.
  var AUTHOR_PALETTE = [
    "#fbbf24", // amber
    "#34d399", // emerald
    "#60a5fa", // blue
    "#f472b6", // pink
    "#c4b5fd", // violet
    "#fb923c", // orange
    "#2dd4bf", // teal
    "#fde047", // yellow
    "#a3e635", // lime
    "#fca5a5", // rose
  ];
  function colorForAuthor(name) {
    var key = (name || "").trim().toLowerCase();
    if (!key) return cfg.accent;
    var h = 0;
    for (var i = 0; i < key.length; i++)
      h = ((h << 5) - h + key.charCodeAt(i)) | 0;
    return AUTHOR_PALETTE[Math.abs(h) % AUTHOR_PALETTE.length];
  }

  // Importance levels. Each saved pin gets one (default "medium" if the
  // viewer doesn't change it). Override via cfg.importance for app-specific
  // labels — e.g. status workflows like "open/in-review/resolved".
  var IMPORTANCE_DEFAULTS = [
    { value: "blocker", label: "Blocker", color: "#dc2626" },
    { value: "high", label: "High", color: "#ea580c" },
    { value: "medium", label: "Medium", color: "#ca8a04" },
    { value: "low", label: "Low", color: "#16a34a" },
    { value: "question", label: "Question", color: "#0891b2" },
  ];
  var IMPORTANCE_LEVELS =
    Array.isArray(cfg.importance) && cfg.importance.length
      ? cfg.importance
      : IMPORTANCE_DEFAULTS;
  var IMPORTANCE_DEFAULT = (function () {
    var m = IMPORTANCE_LEVELS.find(function (l) {
      return l.value === "medium";
    });
    return (
      m ||
      IMPORTANCE_LEVELS[Math.floor(IMPORTANCE_LEVELS.length / 2)] ||
      IMPORTANCE_LEVELS[0]
    ).value;
  })();
  // TheraNetrix change: a value that matches no configured level (for example a severity saved
  // before the app switched to request types) still resolves, with a neutral color and the label
  // from cfg.importanceLegacy if one is given, so it keeps its ring, chip and export prefix.
  var IMPORTANCE_LEGACY = cfg.importanceLegacy || {};
  function importanceFor(value) {
    if (!value) return null;
    return (
      IMPORTANCE_LEVELS.find(function (l) {
        return l.value === value;
      }) || {
        value: value,
        label: Object.prototype.hasOwnProperty.call(IMPORTANCE_LEGACY, value)
          ? String(IMPORTANCE_LEGACY[value])
          : String(value),
        color: "#6b7280",
        legacy: true,
      }
    );
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function newId() {
    return (
      "fb-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    );
  }
  function numberFor(pin) {
    for (var i = 0; i < pins.length; i++)
      if (pins[i].id === pin.id) return i + 1;
    return 0;
  }

  // ─── Style sheet ──────────────────────────────────────────────────────────
  var style = document.createElement("style");
  style.setAttribute("data-feedback-style", "");
  style.textContent = [
    '[data-feedback-root] { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: ' +
      cfg.navy +
      "; }",
    ".fb-dock { position: fixed; bottom: 58px; right: 18px; z-index: 2147483640; display: flex; gap: 8px; align-items: center; }",
    ".fb-dock-handle { width: 18px; height: 44px; display: grid; place-items: center; cursor: grab; color: " +
      cfg.navy +
      "; opacity: 0.45; font-size: 14px; line-height: 1; user-select: none; border-radius: 6px; }",
    ".fb-dock-handle:hover { opacity: 0.9; background: rgba(255,255,255,0.6); }",
    ".fb-dock-handle:active, .fb-dock-handle.fb-dragging { cursor: grabbing; opacity: 1; }",
    ".fb-btn-main { height: 44px; padding: 0 18px; border-radius: 999px; background: " +
      cfg.accent +
      "; color: " +
      cfg.navy +
      "; border: none; font-size: 13.5px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,0.15); display: inline-flex; align-items: center; gap: 8px; font-family: inherit; }",
    ".fb-btn-main.fb-active { background: #c0392b; color: white; }",
    ".fb-btn-count { height: 40px; padding: 0 14px; border-radius: 999px; background: white; color: " +
      cfg.navy +
      "; border: 1px solid #d0d0cc; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.08); display: inline-flex; align-items: center; gap: 6px; font-family: inherit; }",
    ".fb-scrim { position: fixed; inset: 0; z-index: 2147483637; cursor: crosshair; background: rgba(29,32,56,0.04); pointer-events: none; }",
    ".fb-scrim-hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: " +
      cfg.navy +
      "; color: white; padding: 10px 18px; border-radius: 999px; font-size: 13px; font-weight: 500; box-shadow: 0 4px 16px rgba(0,0,0,0.25); pointer-events: auto; z-index: 2147483638; }",
    ".fb-pin { width: 28px; height: 28px; border-radius: 50%; background: " +
      cfg.accent +
      "; color: " +
      cfg.navy +
      '; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.2); font-weight: 700; font-size: 12px; font-family: "JetBrains Mono", ui-monospace, monospace; display: grid; place-items: center; cursor: grab; padding: 0; }',
    ".fb-pin.fb-pin-page { position: absolute; z-index: 2147483635; }",
    ".fb-pin.fb-pin-modal { position: fixed; z-index: 2147483636; }",
    // Anchored pins are placed from the live element rect each flush.
    ".fb-pin.fb-pin-anchored { position: fixed; z-index: 2147483636; }",
    // World pins live inside the page\'s own transformed pan/zoom layer, so the
    // compositor moves them with the diagram. transform-origin must be the
    // centre or the counter-scale would shift the dot off its point.
    ".fb-pin.fb-pin-world { position: absolute; transform-origin: 50% 50%; }",
    ".fb-world .fb-pin { pointer-events: auto; }",
    ".fb-pin-status { font-size: 11px; color: #9a9a95; margin-top: 2px; font-style: italic; }",
    // Threading. The reply list is indented under its pin with a rule down the
    // left, so a thread reads as belonging to the comment above it rather than
    // as more comments.
    ".fb-thread { margin: 8px 0 0 0; padding-left: 10px; border-left: 2px solid #ece9e4; display: grid; gap: 7px; }",
    ".fb-reply-meta { font-size: 10px; color: #9a9a95; font-weight: 600; display: flex; align-items: center; gap: 6px; }",
    ".fb-reply-del { margin-left: auto; border: 0; background: none; color: #c0b8b0; cursor: pointer; font-size: 13px; line-height: 1; padding: 0 2px; }",
    ".fb-reply-del:hover { color: #c0392b; }",
    ".fb-reply-body { font-size: 12.5px; color: #3a3a35; line-height: 1.45; white-space: pre-wrap; }",
    ".fb-reply-box { display: flex; gap: 6px; margin-top: 8px; }",
    ".fb-reply-input { flex: 1; min-width: 0; padding: 6px 8px; font-size: 12px; border-radius: 6px; border: 1px solid #e6e6e2; font-family: inherit; color: " +
      cfg.navy +
      "; }",
    ".fb-reply-box button { padding: 6px 11px; font-size: 11px; font-weight: 600; border-radius: 6px; border: 1px solid #e6e6e2; background: white; cursor: pointer; font-family: inherit; }",
    ".fb-reply-box button:hover { border-color: " +
      cfg.accent +
      "; color: " +
      cfg.accent +
      "; }",
    // Reply count on the on-page pin: small, high-contrast, and offset so it
    // does not cover the pin's number.
    ".fb-pin-replies { position: absolute; bottom: -3px; right: -3px; min-width: 13px; height: 13px; padding: 0 3px; border-radius: 999px; background: " +
      cfg.navy +
      "; color: white; font-size: 9px; font-weight: 700; font-style: normal; line-height: 13px; text-align: center; box-shadow: 0 0 0 1.5px white; }",
    // A resolved thread is de-emphasised rather than hidden: the decision is
    // usually the part worth keeping.
    ".fb-panel-pin.fb-resolved { opacity: 0.6; }",
    // The just-opened thread. A tinted background and a bar down the left edge,
    // so it is findable in a long list without shouting.
    ".fb-panel-pin.fb-focused { background: #fff6f7; box-shadow: inset 3px 0 0 " +
      cfg.accent +
      "; }",
    // Name gate. Centred over the page rather than docked, because it blocks the
    // one action the user just asked for and should not be missable.
    ".fb-name-gate { position: fixed; inset: 0; z-index: 2147483646; background: rgba(16,21,37,0.35); display: grid; place-items: center; pointer-events: auto; }",
    ".fb-name-card { width: min(360px, calc(100vw - 32px)); padding: 20px 22px; border-radius: 14px; background: white; box-shadow: 0 18px 48px rgba(0,0,0,0.24); font-family: inherit; }",
    ".fb-name-title { font-size: 15px; font-weight: 600; color: " +
      cfg.navy +
      "; }",
    ".fb-name-sub { margin-top: 4px; font-size: 12px; color: #6a6a66; line-height: 1.45; }",
    ".fb-name-known { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }",
    ".fb-name-pick { padding: 6px 12px; border-radius: 999px; border: 1px solid #e6e6e2; background: #f7f7f5; color: " +
      cfg.navy +
      "; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }",
    ".fb-name-pick:hover { border-color: " +
      cfg.accent +
      "; color: " +
      cfg.accent +
      "; background: white; }",
    ".fb-name-or { margin-top: 12px; font-size: 11px; color: #9a9a95; }",
    ".fb-name-row { display: flex; gap: 6px; margin-top: 6px; }",
    ".fb-name-input { flex: 1; min-width: 0; padding: 8px 10px; font-size: 13px; border-radius: 8px; border: 1px solid #e6e6e2; font-family: inherit; color: " +
      cfg.navy +
      "; }",
    ".fb-name-go { padding: 8px 14px; border-radius: 8px; border: none; background: " +
      cfg.accent +
      "; color: white; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }",
    ".fb-name-cancel { margin-top: 10px; border: none; background: none; color: #9a9a95; font: inherit; font-size: 11px; cursor: pointer; padding: 0; }",
    ".fb-resolved-chip { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; background: #e8f6ef; color: #146544; font-size: 10px; font-weight: 700; }",
    ".fb-composer { position: absolute; width: 320px; background: white; border-radius: 10px; box-shadow: 0 12px 36px rgba(0,0,0,0.22); border: 1px solid #e6e6e2; z-index: 2147483643; padding: 14px; font-size: 13px; }",
    ".fb-composer.fb-composer-fixed { position: fixed; }",
    ".fb-composer label { display: block; font-size: 11px; color: #6a6a66; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }",
    ".fb-composer .fb-label { font-size: 11px; color: #6a6a66; margin-bottom: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }",
    ".fb-composer .fb-label-accent { color: " + cfg.accent + "; }",
    ".fb-composer .fb-snippet { font-size: 12px; color: #6a6a66; margin-bottom: 10px; font-style: italic; }",
    ".fb-composer textarea, .fb-composer input { width: 100%; padding: 8px; font-size: 13px; border-radius: 6px; border: 1px solid #e6e6e2; font-family: inherit; color: " +
      cfg.navy +
      "; box-sizing: border-box; }",
    ".fb-composer textarea { min-height: 80px; resize: vertical; }",
    ".fb-composer input { height: 30px; padding: 0 8px; font-size: 12px; }",
    ".fb-composer .fb-row { display: flex; gap: 6px; margin-top: 10px; justify-content: flex-end; }",
    ".fb-composer button { padding: 6px 10px; font-size: 12px; border-radius: 6px; cursor: pointer; font-family: inherit; }",
    ".fb-composer .fb-btn-cancel { background: white; border: 1px solid #e6e6e2; color: #4a4a45; }",
    ".fb-composer .fb-btn-delete { background: none; border: 1px solid #e6e6e2; color: #c0392b; }",
    ".fb-composer .fb-btn-save { background: " +
      cfg.accent +
      "; color: " +
      cfg.navy +
      "; border: none; font-weight: 600; padding: 6px 14px; }",
    ".fb-composer .fb-btn-save:disabled { background: #f4f4f0; color: #aaa6a0; cursor: default; }",
    ".fb-composer select.fb-importance { width: 100%; height: 30px; padding: 0 8px; font-size: 12px; border-radius: 6px; border: 1px solid #e6e6e2; font-family: inherit; color: " +
      cfg.navy +
      "; box-sizing: border-box; background: white; }",
    ".fb-importance-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; color: white; text-transform: uppercase; letter-spacing: 0.4px; }",
    '.fb-importance-chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.85); }',
    ".fb-panel { position: fixed; right: 0; top: 0; bottom: 0; width: 380px; background: white; border-left: 1px solid #e6e6e2; box-shadow: -8px 0 24px rgba(0,0,0,0.12); z-index: 2147483643; display: flex; flex-direction: column; font-size: 13px; }",
    ".fb-panel-head { padding: 16px 18px; border-bottom: 1px solid #e6e6e2; display: flex; align-items: center; gap: 8px; }",
    ".fb-panel-head .fb-title { flex: 1; font-weight: 600; font-size: 15px; }",
    ".fb-panel-head button { padding: 6px 10px; font-size: 12px; background: #f4f4f0; border: 1px solid #e6e6e2; border-radius: 6px; cursor: pointer; color: #4a4a45; font-family: inherit; }",
    ".fb-panel-head .fb-btn-close { width: 28px; height: 28px; padding: 0; background: none; border: none; font-size: 16px; color: #4a4a45; }",
    ".fb-panel-head .fb-btn-clear { color: #c0392b; background: none; }",
    ".fb-panel-name { padding: 10px 18px; border-bottom: 1px solid #e6e6e2; background: #f7f7f5; }",
    ".fb-panel-name input { width: 100%; height: 30px; margin-top: 4px; padding: 0 8px; font-size: 13px; border-radius: 6px; border: 1px solid #e6e6e2; box-sizing: border-box; font-family: inherit; }",
    // min-height: 0 is load-bearing, not tidying. A column flex item defaults to
    // min-height: auto, which refuses to shrink below its content — so this grew
    // past the panel instead of scrolling and overflow-y never engaged. The list
    // was short enough to hide it until replies made cards taller.
    // Bottom padding rather than 8px all round: the last card's action row sat
    // flush against the panel edge, which reads as cut off even when the list is
    // fully scrolled.
    ".fb-panel-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 8px 0 24px; }",
    ".fb-panel-empty { padding: 24px; text-align: center; color: #6a6a66; }",
    ".fb-panel-route { padding: 10px 18px 4px; font-size: 11px; color: #6a6a66; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }",
    ".fb-panel-route .fb-current { color: " + cfg.accent + "; }",
    ".fb-panel-pin { padding: 10px 18px; border-bottom: 1px solid #e6e6e2; display: flex; gap: 10px; }",
    ".fb-panel-pin .fb-pin-num { width: 24px; height: 24px; border-radius: 50%; background: " +
      cfg.accent +
      "; color: " +
      cfg.navy +
      '; display: grid; place-items: center; font-size: 11px; font-weight: 700; font-family: "JetBrains Mono", ui-monospace, monospace; flex-shrink: 0; }',
    ".fb-panel-pin .fb-pin-body { flex: 1; min-width: 0; }",
    ".fb-panel-pin .fb-pin-text { font-size: 13px; line-height: 1.4; margin-bottom: 4px; word-wrap: break-word; }",
    ".fb-panel-pin .fb-pin-meta { font-size: 11px; color: #6a6a66; }",
    ".fb-panel-pin .fb-pin-modal { font-size: 11px; margin-top: 4px; display: inline-block; padding: 1px 6px; border-radius: 999px; background: rgba(234,179,8,0.15); color: #8a6a08; font-weight: 600; }",
    ".fb-panel-pin .fb-pin-snippet { font-size: 11px; color: #6a6a66; font-style: italic; margin-top: 2px; word-wrap: break-word; }",
    ".fb-panel-pin .fb-pin-actions { display: flex; gap: 6px; margin-top: 6px; }",
    ".fb-panel-pin .fb-pin-actions button { padding: 3px 8px; font-size: 11px; background: #f4f4f0; border: 1px solid #e6e6e2; border-radius: 4px; cursor: pointer; color: #4a4a45; font-family: inherit; }",
    ".fb-panel-pin .fb-pin-actions .fb-del { background: none; color: #c0392b; }",
    // ─── Mobile (<= 640px) ──────────────────────────────────────────────────
    "@media (max-width: 640px) {",
    // Beefier drag handle for fingers
    "  .fb-dock-handle { width: 28px; height: 48px; font-size: 18px; opacity: 0.7; }",
    // Side panel goes full-screen on phones
    "  .fb-panel { width: 100% !important; right: 0; left: 0; }",
    // Composer becomes a bottom sheet so it never overflows the viewport
    "  .fb-composer, .fb-composer.fb-composer-fixed {",
    "    position: fixed !important;",
    "    left: 12px !important;",
    "    right: 12px !important;",
    "    bottom: 12px !important;",
    "    top: auto !important;",
    "    width: auto !important;",
    "    max-width: calc(100vw - 24px);",
    "    max-height: 70vh;",
    "    overflow-y: auto;",
    "  }",
    // Dock buttons keep a comfy tap height
    "  .fb-btn-main { height: 48px; padding: 0 16px; font-size: 14px; }",
    "  .fb-btn-count { height: 44px; }",
    // Hide the helpful Esc hint label on tiny screens (no Esc on phones)
    "  .fb-scrim-hint { font-size: 12px; padding: 8px 14px; max-width: calc(100vw - 24px); text-align: center; }",
    "}",
  ].join("\n");
  document.head.appendChild(style);

  // ─── Root mount ───────────────────────────────────────────────────────────
  var root = document.createElement("div");
  root.setAttribute("data-feedback-root", "");
  document.body.appendChild(root);

  // The panel mounts here, not in root. render() clears root wholesale and runs
  // on every anchor flush — which fires on every scroll event — so a panel
  // inside root was destroyed and rebuilt continuously while being scrolled.
  // Preserving scrollTop hid most of that, but the node under the cursor was
  // still being replaced mid-gesture, so the browser lost its scroll target and
  // handed the wheel to the page. Keeping the panel out of root means it is
  // simply not touched by a reposition.
  var panelRoot = document.createElement("div");
  panelRoot.setAttribute("data-feedback-ui", "panel-root");
  document.body.appendChild(panelRoot);

  // ─── Render ───────────────────────────────────────────────────────────────
  function render() {
    // The panel lives inside root, and render() rebuilds root wholesale. The
    // anchor engine schedules a flush on every scroll event so it can reposition
    // pins — so scrolling the panel re-rendered it and reset scrollTop to 0 on
    // each frame, which reads as the list fighting back and refusing to reach
    // the end. Carry the position across the rebuild.
    // Clear & rebuild — overall is tiny, simpler than diffing. The panel is
    // deliberately not in here; see syncPanel().
    root.innerHTML = "";

    // Pins visible in current context.
    //
    // Two paths. Anchored pins are decided by the engine: right screen, element
    // present, laid out, unclipped. Legacy pins (no anchor) keep the original
    // hash+overlay filter so existing feedback does not vanish on upgrade.
    var route = routeFromHash();
    var sig = ANCHOR ? ANCHOR.signature() : null;
    var world = ANCHOR ? ANCHOR.ensureWorld() : null;
    if (world) world.innerHTML = "";

    // Verdicts are needed by the panel too (to show why a pin is not on screen),
    // so compute them once here and stash them.
    lastVerdicts = {};
    var visible = [];
    pins.forEach(function (p) {
      // A resolved thread is settled, so it stops competing for attention on the
      // page. It stays in the panel under Resolved — hiding it there would lose
      // the decision, which is usually the part worth keeping.
      if (p.resolvedAt) {
        lastVerdicts[p.id] = { kind: "resolved" };
        return;
      }
      if (p.anchor && ANCHOR) {
        var v = ANCHOR.verdict(p.anchor, sig);
        lastVerdicts[p.id] = v;
        if (v.kind === "paint") visible.push(p);
        return;
      }
      lastVerdicts[p.id] = { kind: "legacy" };
      if (
        overlayTitle
          ? p.overlay === overlayTitle
          : !p.overlay && p.route === route
      )
        visible.push(p);
    });

    visible.forEach(function (pin) {
      var v = lastVerdicts[pin.id];
      var btn = document.createElement("button");
      btn.setAttribute("data-feedback-ui", "pin");
      btn.setAttribute("data-pin-id", pin.id);

      if (v && v.kind === "paint") {
        if (v.painter === "world" && world) {
          // Inside the transformed layer: position in world units and let the
          // compositor carry the pin through every pan and zoom. Counter-scale
          // so the dot stays a constant size on screen.
          var w = ANCHOR.toWorld(v.at);
          var inv = 1 / (ANCHOR.worldScale() || 1);
          btn.className = "fb-pin fb-pin-world";
          btn.style.position = "absolute";
          btn.style.left = w.x + "px";
          btn.style.top = w.y + "px";
          btn.style.transform =
            "translate(-50%,-50%) scale(" + inv.toFixed(4) + ")";
          btn.style.pointerEvents = "auto";
        } else {
          // Everything else is positioned from the live viewport rect, so it
          // tracks scroll, reflow and expand/collapse without storing pixels.
          btn.className = "fb-pin fb-pin-anchored";
          btn.style.position = "fixed";
          btn.style.left = v.at.x - 14 + "px";
          btn.style.top = v.at.y - 14 + "px";
        }
      } else {
        btn.className =
          "fb-pin " + (pin.overlay ? "fb-pin-modal" : "fb-pin-page");
        btn.style.left = pin.x - 14 + "px";
        btn.style.top = pin.y - 14 + "px";
      }
      btn.style.background = colorForAuthor(pin.author);
      var imp = importanceFor(pin.importance);
      if (imp) {
        btn.style.boxShadow =
          "0 0 0 3px " + imp.color + ", 0 2px 8px rgba(0,0,0,0.25)";
      }
      btn.title =
        (imp ? "[" + imp.label + "] " : "") +
        pin.author +
        ": " +
        pin.text +
        "  ·  drag to reposition";
      btn.textContent = numberFor(pin);
      // Reply count, so an answered thread is visible without opening the panel.
      var nReplies = repliesFor(pin.id).length;
      if (nReplies) {
        var badge = document.createElement("i");
        badge.className = "fb-pin-replies";
        badge.textContent = nReplies > 9 ? "9+" : String(nReplies);
        badge.title = nReplies === 1 ? "1 reply" : nReplies + " replies";
        btn.appendChild(badge);
      }
      btn.addEventListener("mousedown", function (e) {
        onPinDragStart(pin, e, btn);
      });
      btn.addEventListener(
        "touchstart",
        function (e) {
          onPinDragStart(pin, e, btn);
        },
        { passive: false },
      );
      if (v && v.kind === "paint" && v.painter === "world" && world)
        world.appendChild(btn);
      else root.appendChild(btn);
    });

    // Annotation mode scrim
    if (active) {
      var scrim = document.createElement("div");
      scrim.className = "fb-scrim";
      scrim.setAttribute("data-feedback-ui", "scrim");
      root.appendChild(scrim);
      var hint = document.createElement("div");
      hint.className = "fb-scrim-hint";
      hint.setAttribute("data-feedback-ui", "scrim");
      hint.innerHTML =
        'Click anywhere to drop a feedback pin · <span style="opacity:0.7">Esc to cancel</span>';
      root.appendChild(hint);
    }

    // Composer
    if (editing) renderComposer();

    // Side panel
    syncPanel();

    // Dock (always last so it's on top)
    var dock = document.createElement("div");
    dock.className = "fb-dock";
    dock.setAttribute("data-feedback-ui", "dock");
    // Apply persisted position if the user dragged the dock somewhere — else
    // default to bottom-right via the stylesheet.
    if (dockPos) {
      dock.style.left = dockPos.left + "px";
      dock.style.top = dockPos.top + "px";
      dock.style.right = "auto";
      dock.style.bottom = "auto";
    }

    // Drag handle (vertical grip on the left). Only the handle initiates
    // drag — buttons inside stay clickable normally.
    var handle = document.createElement("div");
    handle.className = "fb-dock-handle";
    handle.setAttribute(
      "title",
      "Drag to move · double-click to reset to bottom-right",
    );
    handle.textContent = "⋮⋮";
    handle.addEventListener("mousedown", function (e) {
      onDockDragStart(e, dock);
    });
    handle.addEventListener(
      "touchstart",
      function (e) {
        onDockDragStart(e, dock);
      },
      { passive: false },
    );
    handle.addEventListener("dblclick", function () {
      dockPos = null;
      writeDockPos(null);
      render();
    });
    dock.appendChild(handle);

    if (pins.length > 0) {
      var counter = document.createElement("button");
      counter.className = "fb-btn-count";
      counter.innerHTML = "<span>💬</span> " + pins.length;
      counter.addEventListener("click", function () {
        // Opening the list from the dock is browsing, not arriving at a
        // particular thread, so nothing is highlighted. The highlight only ever
        // means "this is the pin you just clicked".
        focusPinId = null;
        panelOpen = true;
        render();
      });
      dock.appendChild(counter);
    }
    var main = document.createElement("button");
    main.className = "fb-btn-main" + (active ? " fb-active" : "");
    main.textContent = active ? "✕ Cancel" : "💬 Leave feedback";
    main.addEventListener("click", function () {
      // Cancelling never needs a name. Arming does: feedback signed "anon" is
      // feedback nobody can follow up on, and asking at the point of use costs
      // one click, where asking on page load interrupts people who are only
      // reading.
      if (active) {
        active = false;
        render();
        return;
      }
      requireAuthor(function () {
        active = true;
        render();
      });
    });
    dock.appendChild(main);
    root.appendChild(dock);
  }

  // Normalise mouse + touch events to a { clientX, clientY } point.
  function _pointFrom(e) {
    if (e.touches && e.touches.length)
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length)
      return {
        clientX: e.changedTouches[0].clientX,
        clientY: e.changedTouches[0].clientY,
      };
    return { clientX: e.clientX, clientY: e.clientY };
  }

  // Drag the floating dock around. Position is persisted so the next page
  // load lands the dock back where the user left it. Supports both mouse
  // and touch — on phones, drag with one finger from the ⋮⋮ handle.
  function onDockDragStart(e, dock) {
    // Mouse: left-button only. Touch: ignore multi-finger gestures.
    if (e.type === "mousedown" && e.button !== 0) return;
    if (e.touches && e.touches.length !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    var p0 = _pointFrom(e);
    var rect = dock.getBoundingClientRect();
    var startX = p0.clientX,
      startY = p0.clientY;
    var originLeft = rect.left,
      originTop = rect.top;
    dock.classList.add("fb-dragging");
    function onMove(ev) {
      if (ev.cancelable) ev.preventDefault(); // prevent page scroll while dragging on touch
      var p = _pointFrom(ev);
      var x = originLeft + (p.clientX - startX);
      var y = originTop + (p.clientY - startY);
      // Clamp to viewport (8px padding so it never slips fully off-screen)
      var maxX = Math.max(8, window.innerWidth - rect.width - 8);
      var maxY = Math.max(8, window.innerHeight - rect.height - 8);
      x = Math.max(8, Math.min(maxX, x));
      y = Math.max(8, Math.min(maxY, y));
      dock.style.left = x + "px";
      dock.style.top = y + "px";
      dock.style.right = "auto";
      dock.style.bottom = "auto";
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
      document.removeEventListener("touchcancel", onUp);
      dock.classList.remove("fb-dragging");
      var finalRect = dock.getBoundingClientRect();
      dockPos = { left: finalRect.left, top: finalRect.top };
      writeDockPos(dockPos);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
    document.addEventListener("touchcancel", onUp);
  }

  function renderComposer() {
    var useFixed = !!editing.overlay;
    var scrollX = useFixed ? 0 : window.scrollX;
    var left = Math.min(
      Math.max(editing.x - 160, 12 + scrollX),
      scrollX + window.innerWidth - 332,
    );
    var top = editing.y + 24;

    var c = document.createElement("div");
    c.className = "fb-composer" + (useFixed ? " fb-composer-fixed" : "");
    c.setAttribute("data-feedback-ui", "composer");
    c.style.left = left + "px";
    c.style.top = top + "px";

    var currentImp = editing.importance || IMPORTANCE_DEFAULT;
    // TheraNetrix change: an earlier value is listed first and stays selected, so saving an edit
    // to the text keeps it; the reviewer can still pick a configured level instead.
    var currentLevel = importanceFor(currentImp);
    var impOptions = (currentLevel && currentLevel.legacy ? [currentLevel] : [])
      .concat(IMPORTANCE_LEVELS)
      .map(function (l) {
        return (
          '<option value="' +
          escapeHtml(l.value) +
          '"' +
          (l.value === currentImp ? " selected" : "") +
          ">" +
          escapeHtml(l.label) +
          "</option>"
        );
      })
      .join("");

    c.innerHTML =
      '<div class="fb-label">Feedback on <span class="fb-label-accent">' +
      escapeHtml(editing.label) +
      "</span></div>" +
      (editing.snippet
        ? '<div class="fb-snippet">"' + escapeHtml(editing.snippet) + '"</div>'
        : "") +
      '<textarea placeholder="What needs to change? (Cmd-Enter to save)"></textarea>' +
      '<div style="margin-top:8px"><select class="fb-importance" aria-label="Importance">' +
      impOptions +
      "</select></div>" +
      '<div style="margin-top:8px"><input type="text" placeholder="Your name"></div>' +
      '<div class="fb-row">' +
      (pins.some(function (p) {
        return p.id === editing.id;
      })
        ? '<button class="fb-btn-delete">Delete</button>'
        : "") +
      '<button class="fb-btn-cancel">Cancel</button>' +
      '<button class="fb-btn-save">Save</button>' +
      "</div>";
    root.appendChild(c);

    var ta = c.querySelector("textarea");
    var name = c.querySelector('input[type="text"]');
    var impSel = c.querySelector(".fb-importance");
    var btnSave = c.querySelector(".fb-btn-save");
    var btnCancel = c.querySelector(".fb-btn-cancel");
    var btnDelete = c.querySelector(".fb-btn-delete");
    ta.value = editing.text || "";
    name.value = author || "";
    setTimeout(function () {
      ta.focus();
    }, 50);

    function syncSave() {
      btnSave.disabled = !ta.value.trim();
    }
    syncSave();
    ta.addEventListener("input", syncSave);
    ta.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && ta.value.trim()) {
        saveDraft(ta.value, name.value, impSel.value);
      }
    });
    name.addEventListener("input", function () {
      author = name.value;
      writeName(author);
    });
    btnSave.addEventListener("click", function () {
      saveDraft(ta.value, name.value, impSel.value);
    });
    btnCancel.addEventListener("click", function () {
      editing = null;
      render();
    });
    if (btnDelete)
      btnDelete.addEventListener("click", function () {
        deletePin(editing.id);
        editing = null;
        render();
      });
  }

  // A human-readable name for the screen a pin belongs to. Grouping by
  // location.hash is useless on an app that never sets one — every pin would
  // land in a single "#page" bucket, so a reviewer could not tell which of the
  // dozen screens a comment was left on.
  function screenLabelOf(pin) {
    if (cfg.screenLabel && pin.anchor) {
      var l = cfg.screenLabel(pin.anchor.screen || {}, pin.anchor);
      if (l) return l;
    }
    return pin.route ? "#" + pin.route : "Page";
  }
  var VERDICT_NOTE = {
    offscreen: "on another screen",
    orphan: "element not found",
    clipped: "scrolled out of view",
    hidden: "hidden right now",
    unplaced: "no anchor",
    resolved: "resolved",
  };

  // Called after render() so the card exists. rAF rather than a timeout: the
  // panel is rebuilt synchronously in render(), so one frame is enough and a
  // timeout would only add visible lag.
  function scrollPanelToFocused() {
    if (!focusPinId) return;
    requestAnimationFrame(function () {
      var card = root.querySelector('[data-pin-card="' + focusPinId + '"]');
      if (card && card.scrollIntoView)
        card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      var input = card && card.querySelector(".fb-reply-input");
      if (input) input.focus({ preventScroll: true });
    });
  }

  // Rebuild the panel only when its contents would differ. Anything that moves
  // a pin on the page — scrolling, resizing, panning — leaves this signature
  // alone, so the panel DOM survives the flush untouched and keeps its scroll
  // position and its scroll target.
  //
  // Deliberately excluded: the per-pin verdict notes ("scrolled out of view"),
  // which change as you scroll and are the one thing that would reintroduce
  // rebuild-on-scroll. They refresh on the next data change or reopen. Live
  // verdict text is not worth a panel that cannot be scrolled.
  function panelSignature() {
    return [
      panelOpen ? "1" : "0",
      focusPinId || "",
      author || "",
      pins
        .map(function (p) {
          return p.id + (p.resolvedAt ? "!" : "") + (p.ts || 0);
        })
        .join(","),
      replies
        .map(function (r) {
          return r.id + (r.deleted ? "!" : "");
        })
        .join(","),
    ].join("|");
  }

  var lastPanelSignature = null;

  function syncPanel() {
    if (!panelOpen) {
      if (panelRoot.firstChild) panelRoot.innerHTML = "";
      lastPanelSignature = null;
      return;
    }
    var sig = panelSignature();
    if (sig === lastPanelSignature && panelRoot.firstChild) return;
    lastPanelSignature = sig;
    renderPanel();
  }

  function renderPanel() {
    var currentLabel =
      ANCHOR && cfg.screenLabel
        ? cfg.screenLabel(ANCHOR.signature(), null)
        : routeFromHash();
    var byRoute = {};
    pins.forEach(function (p) {
      var r = screenLabelOf(p);
      (byRoute[r] = byRoute[r] || []).push(p);
    });
    var routeKeys = Object.keys(byRoute).sort(function (a, b) {
      if (a === currentLabel) return -1;
      if (b === currentLabel) return 1;
      return a.localeCompare(b);
    });
    var route = currentLabel;

    var panel = document.createElement("div");
    panel.className = "fb-panel";
    panel.setAttribute("data-feedback-ui", "panel");
    panel.innerHTML =
      '<div class="fb-panel-head">' +
      '<div class="fb-title">' +
      escapeHtml(cfg.title) +
      " · " +
      pins.length +
      "</div>" +
      '<button class="fb-btn-copy" title="Copy as markdown">Copy</button>' +
      '<button class="fb-btn-clear"' +
      (pins.length === 0 ? " disabled" : "") +
      ">Clear</button>" +
      '<button class="fb-btn-close">✕</button>' +
      "</div>" +
      '<div class="fb-panel-name">' +
      "<label>Your name</label>" +
      '<input type="text" placeholder="Anonymous">' +
      "</div>" +
      '<div class="fb-panel-body"></div>';

    var body = panel.querySelector(".fb-panel-body");
    if (pins.length === 0) {
      body.innerHTML =
        '<div class="fb-panel-empty">No feedback yet. Click <b>Leave feedback</b>, then click any element on the page.</div>';
    } else {
      var html = "";
      routeKeys.forEach(function (r) {
        html +=
          '<div class="fb-panel-route">' +
          escapeHtml(r) +
          (r === route ? ' <span class="fb-current">· current</span>' : "") +
          "</div>";
        byRoute[r].forEach(function (pin) {
          var n = numberFor(pin);
          var imp = importanceFor(pin.importance);
          html +=
            '<div class="fb-panel-pin' +
            (pin.resolvedAt ? " fb-resolved" : "") +
            (pin.id === focusPinId ? " fb-focused" : "") +
            '" data-pin-card="' +
            pin.id +
            '">' +
            '<div class="fb-pin-num" style="background:' +
            colorForAuthor(pin.author) +
            (imp ? "; box-shadow: 0 0 0 2px " + imp.color : "") +
            '">' +
            n +
            "</div>" +
            '<div class="fb-pin-body">' +
            '<div class="fb-pin-text">' +
            escapeHtml(pin.text) +
            "</div>" +
            (pin.resolvedAt
              ? '<span class="fb-resolved-chip">Resolved</span>'
              : "") +
            '<div class="fb-pin-meta">' +
            escapeHtml(pin.author) +
            " · " +
            new Date(pin.ts).toLocaleString() +
            (imp
              ? ' · <span class="fb-importance-chip" style="background:' +
                imp.color +
                '">' +
                escapeHtml(imp.label) +
                "</span>"
              : "") +
            "</div>" +
            (function () {
              // Say plainly why a pin is not on screen. A pin that is simply
              // absent reads as lost feedback, which is the fastest way to
              // lose a reviewer's trust in the tool.
              var v = lastVerdicts[pin.id];
              if (!v || v.kind === "paint" || v.kind === "legacy") return "";
              var note = VERDICT_NOTE[v.kind] || v.kind;
              return (
                '<div class="fb-pin-status">· ' + escapeHtml(note) + "</div>"
              );
            })() +
            (pin.overlay
              ? '<div class="fb-pin-modal" title="' +
                escapeHtml(pin.overlay) +
                '">in modal: ' +
                escapeHtml(
                  pin.overlay.length > 36
                    ? pin.overlay.slice(0, 34) + "…"
                    : pin.overlay,
                ) +
                "</div>"
              : "") +
            (pin.snippet
              ? '<div class="fb-pin-snippet">"' +
                escapeHtml(pin.snippet) +
                '"</div>'
              : "") +
            (function () {
              var list = repliesFor(pin.id);
              if (!list.length) return "";
              return (
                '<div class="fb-thread">' +
                list
                  .map(function (r) {
                    return (
                      '<div class="fb-reply">' +
                      '<div class="fb-reply-meta">' +
                      escapeHtml(r.author) +
                      " · " +
                      new Date(r.ts).toLocaleString() +
                      '<button class="fb-reply-del" data-action="reply-delete" data-id="' +
                      r.id +
                      '" title="Delete reply">×</button>' +
                      "</div>" +
                      '<div class="fb-reply-body">' +
                      escapeHtml(r.body) +
                      "</div>" +
                      "</div>"
                    );
                  })
                  .join("") +
                "</div>"
              );
            })() +
            '<div class="fb-reply-box">' +
            '<input type="text" class="fb-reply-input" data-pin="' +
            pin.id +
            '" placeholder="Reply…">' +
            '<button data-action="reply" data-id="' +
            pin.id +
            '">Send</button>' +
            "</div>" +
            '<div class="fb-pin-actions">' +
            '<button data-action="jump" data-id="' +
            pin.id +
            '">Jump to</button>' +
            '<button data-action="resolve" data-id="' +
            pin.id +
            '">' +
            (pin.resolvedAt ? "Reopen" : "Resolve") +
            "</button>" +
            '<button class="fb-del" data-action="delete" data-id="' +
            pin.id +
            '">Delete</button>' +
            "</div>" +
            "</div>" +
            "</div>";
        });
      });
      body.innerHTML = html;
    }

    // Carry the scroll position across a genuine rebuild (a reply added, a pin
    // resolved). Set after the panel is in the document — assigning scrollTop to
    // a detached node silently does nothing.
    var prevBody = panelRoot.querySelector(".fb-panel-body");
    var keep = prevBody ? prevBody.scrollTop : 0;
    panelRoot.innerHTML = "";
    panelRoot.appendChild(panel);
    if (keep) body.scrollTop = keep;

    var nameInput = panel.querySelector(".fb-panel-name input");
    nameInput.value = author;
    nameInput.addEventListener("input", function () {
      author = nameInput.value;
      writeName(author);
    });

    panel.querySelector(".fb-btn-close").addEventListener("click", function () {
      focusPinId = null;
      panelOpen = false;
      render();
    });
    panel
      .querySelector(".fb-btn-copy")
      .addEventListener("click", exportMarkdown);
    var btnClear = panel.querySelector(".fb-btn-clear");
    if (btnClear && !btnClear.disabled)
      btnClear.addEventListener("click", clearAll);

    // Clicking any other card drops the highlight: it means "you just arrived
    // here", and leaving it on turns it into permanent decoration.
    body.querySelectorAll("[data-pin-card]").forEach(function (card) {
      card.addEventListener("mousedown", function () {
        if (focusPinId && card.getAttribute("data-pin-card") !== focusPinId) {
          focusPinId = null;
          card.classList.remove("fb-focused");
          var prev = body.querySelector(".fb-panel-pin.fb-focused");
          if (prev) prev.classList.remove("fb-focused");
        }
      });
    });

    body.querySelectorAll(".fb-reply-input").forEach(function (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (input.value.trim())
          addReply(input.getAttribute("data-pin"), input.value);
      });
    });

    body.querySelectorAll("button[data-action]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-id");
        var act = b.getAttribute("data-action");
        // Reply ids are not pin ids, so this must be handled before the pin
        // lookup below — otherwise the `if (!pin) return` bails and the delete
        // button does nothing at all, silently.
        if (act === "reply-delete") {
          deleteReply(id);
          return;
        }
        var pin = pins.find(function (p) {
          return p.id === id;
        });
        if (!pin) return;
        if (act === "delete") {
          deletePin(id);
          render();
        } else if (act === "resolve") {
          toggleResolved(id);
        } else if (act === "reply") {
          var input = body.querySelector(
            '.fb-reply-input[data-pin="' + id + '"]',
          );
          if (input && input.value.trim()) {
            addReply(id, input.value);
          }
        } else {
          jumpTo(pin);
        }
      });
    });
  }

  // ─── Behaviors ────────────────────────────────────────────────────────────
  function saveDraft(text, nm, importance) {
    var trimmed = (text || "").trim();
    if (!editing) return;
    if (!trimmed) {
      editing = null;
      render();
      return;
    }
    author = (nm || "").trim() || author || "anon";
    writeName(author);
    var impValue = importanceFor(importance)
      ? importance
      : editing.importance || IMPORTANCE_DEFAULT;
    var pin = {
      id: editing.id,
      route: editing.route,
      x: editing.x,
      y: editing.y,
      label: editing.label,
      snippet: editing.snippet,
      overlay: editing.overlay,
      anchor: editing.anchor || null,
      text: trimmed,
      author: author,
      importance: impValue,
      ts: Date.now(),
    };
    var idx = pins.findIndex(function (p) {
      return p.id === pin.id;
    });
    var isNew = idx < 0;
    if (idx >= 0) pins[idx] = pin;
    else pins.push(pin);
    writePins();
    editing = null;
    render();
    // Fire-and-forget: post to webhook if configured. Errors don't block
    // local save — the reviewer's pin always lands in localStorage first.
    if (cfg.webhookUrl) postWebhook(pin, isNew);
    if (sb()) sbPost(pin);
    else if (cfg.apiUrl) postApi(pin);
  }

  // Post a single pin to cfg.webhookUrl. Body is Slack-compatible
  // (`text` for plain Slack incoming webhooks) AND carries the full
  // structured pin + page metadata for custom endpoints.
  function postWebhook(pin, isNew) {
    var appName = cfg.appName || document.title || location.host;
    var where = pin.overlay ? " / modal: " + pin.overlay : "";
    var imp = importanceFor(pin.importance);
    var impPrefix = imp ? "[" + imp.label + "] " : "";
    var text =
      "💬 " +
      (isNew ? "New" : "Edited") +
      " " +
      impPrefix +
      "feedback from " +
      pin.author +
      " on " +
      appName +
      " (" +
      location.host +
      location.pathname +
      (pin.route ? "#" + pin.route : "") +
      where +
      ")\n" +
      "> " +
      pin.text +
      (pin.snippet ? "\n_at `" + pin.label + '` · "' + pin.snippet + '"_' : "");
    var body = {
      text: text,
      event: isNew ? "feedback.created" : "feedback.updated",
      app: appName,
      page: {
        url: location.href,
        host: location.host,
        path: location.pathname,
        route: pin.route,
        title: document.title,
      },
      userAgent: navigator.userAgent,
      pin: pin,
    };
    try {
      fetch(cfg.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        mode: "cors",
        keepalive: true, // survive page unload
      }).catch(function () {});
    } catch (e) {}
  }

  // ─── Remote backends ──────────────────────────────────────────────────────
  // Two are supported and they are mutually exclusive: the apiUrl service in
  // tools/feedback-pin/api/, and Supabase. Everything above this line is
  // storage-agnostic, and both paths converge on mergeRemote() below so the
  // merge rules are written once.
  function sb() {
    var s = cfg.supabase;
    return s && s.url && s.anonKey ? s : null;
  }
  function hasRemote() {
    return !!(cfg.apiUrl || sb());
  }
  function sbUrl(qs) {
    var s = sb();
    return (
      s.url.replace(/\/+$/, "") +
      "/rest/v1/" +
      (s.table || "feedback_pins") +
      (qs || "")
    );
  }
  function sbHeaders(extra) {
    var s = sb();
    var h = { apikey: s.anonKey, Authorization: "Bearer " + s.anonKey };
    for (var k in extra)
      if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
    return h;
  }
  // Upsert rather than insert: editing a pin re-posts it under the same id, and
  // an INSERT would fail on the primary key. resolution=merge-duplicates is
  // PostgREST's upsert, so create and edit are the same call.
  function sbPost(pin) {
    try {
      fetch(sbUrl(""), {
        method: "POST",
        headers: sbHeaders({
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        }),
        body: JSON.stringify({
          id: pin.id,
          app: appSlug(),
          pin: pin,
          ts: pin.ts || Date.now(),
          resolved_at: pin.resolvedAt || null,
          resolved_by: pin.resolvedBy || null,
        }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }
  // Soft delete. There is no DELETE policy on the table by design: a hard
  // delete lets another reviewer's in-flight poll push the pin straight back,
  // because their localStorage copy still has it and nothing records that it
  // was removed.
  function sbDelete(id) {
    try {
      fetch(
        sbUrl(
          "?id=eq." +
            encodeURIComponent(id) +
            "&app=eq." +
            encodeURIComponent(appSlug()),
        ),
        {
          method: "PATCH",
          headers: sbHeaders({
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          }),
          body: JSON.stringify({ deleted_at: new Date().toISOString() }),
          keepalive: true,
        },
      ).catch(function () {});
    } catch (e) {}
  }
  function sbRepliesUrl(qs) {
    var s = sb();
    return (
      s.url.replace(/\/+$/, "") +
      "/rest/v1/" +
      (s.repliesTable || "feedback_replies") +
      (qs || "")
    );
  }
  function sbPostReply(reply) {
    try {
      fetch(sbRepliesUrl(""), {
        method: "POST",
        headers: sbHeaders({
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        }),
        body: JSON.stringify({
          id: reply.id,
          pin_id: reply.pinId,
          app: appSlug(),
          author: reply.author || "anon",
          body: reply.body,
          ts: reply.ts || Date.now(),
        }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }
  function sbDeleteReply(id) {
    try {
      fetch(
        sbRepliesUrl(
          "?id=eq." +
            encodeURIComponent(id) +
            "&app=eq." +
            encodeURIComponent(appSlug()),
        ),
        {
          method: "PATCH",
          headers: sbHeaders({
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          }),
          body: JSON.stringify({ deleted_at: new Date().toISOString() }),
          keepalive: true,
        },
      ).catch(function () {});
    } catch (e) {}
  }
  // Replies merge by union on id, never last-write-wins. Two reviewers replying
  // in the same window must both survive; picking a winner is the one outcome
  // this whole design exists to prevent.
  function mergeReplies(rows) {
    if (!Array.isArray(rows)) return false;
    var byId = {};
    replies.forEach(function (r) {
      byId[r.id] = r;
    });
    rows.forEach(function (row) {
      if (!row || !row.id) return;
      byId[row.id] = {
        id: row.id,
        pinId: row.pin_id,
        author: row.author,
        body: row.body,
        ts: row.ts,
        deleted: !!row.deleted_at,
      };
    });
    var merged = Object.keys(byId).map(function (k) {
      return byId[k];
    });
    merged.sort(function (a, b) {
      return (a.ts || 0) - (b.ts || 0);
    });
    if (JSON.stringify(merged) === JSON.stringify(replies)) return false;
    replies = merged;
    writeReplies();
    return true;
  }
  function sbPullReplies() {
    try {
      fetch(
        sbRepliesUrl(
          "?app=eq." +
            encodeURIComponent(appSlug()) +
            "&select=id,pin_id,author,body,ts,deleted_at",
        ),
        {
          method: "GET",
          headers: sbHeaders({}),
          cache: "no-store",
        },
      )
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (rows) {
          if (mergeReplies(rows)) render();
        })
        .catch(function () {});
    } catch (e) {}
  }

  // Reshaped into the apiUrl service's { pins, deleted } envelope so both
  // backends share one merge path.
  function sbPull() {
    try {
      fetch(
        sbUrl(
          "?app=eq." +
            encodeURIComponent(appSlug()) +
            "&select=id,pin,ts,deleted_at,resolved_at,resolved_by",
        ),
        {
          method: "GET",
          headers: sbHeaders({}),
          cache: "no-store",
        },
      )
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (rows) {
          if (!Array.isArray(rows)) return;
          var body = { pins: [], deleted: [] };
          rows.forEach(function (row) {
            if (!row || !row.id) return;
            if (row.deleted_at)
              body.deleted.push({
                id: row.id,
                deletedAt: Date.parse(row.deleted_at) || Infinity,
              });
            else if (row.pin) {
              // Resolve lives in its own columns, not inside the pin blob, so it
              // is reattached here. Taking it from the row rather than the blob
              // means resolving does not have to rewrite the whole pin and race
              // with an edit.
              row.pin.resolvedAt = row.resolved_at || null;
              row.pin.resolvedBy = row.resolved_by || null;
              body.pins.push(row.pin);
            }
          });
          mergeRemote(body);
        })
        .catch(function () {});
      sbPullReplies();
    } catch (e) {}
  }

  // ─── Shared-backend sync (apiUrl) ─────────────────────────────────────────
  // GET ?app=slug → { pins: [...] }
  // POST { pin } → 200
  // DELETE ?app=slug&id=pinId → 200
  function apiBase() {
    if (!cfg.apiUrl) return null;
    var sep = cfg.apiUrl.indexOf("?") >= 0 ? "&" : "?";
    return cfg.apiUrl + sep + "app=" + encodeURIComponent(appSlug());
  }
  function apiHeaders(json) {
    var h = {};
    if (json) h["Content-Type"] = "application/json";
    if (cfg.accessKey) h["x-feedback-key"] = cfg.accessKey;
    return h;
  }
  function postApi(pin) {
    try {
      fetch(
        cfg.apiUrl +
          (cfg.apiUrl.indexOf("?") >= 0 ? "&" : "?") +
          "app=" +
          encodeURIComponent(appSlug()),
        {
          method: "POST",
          headers: apiHeaders(true),
          body: JSON.stringify({
            pin: pin,
            app: appSlug(),
            url: location.href,
          }),
          mode: "cors",
          keepalive: true,
        },
      ).catch(function () {});
    } catch (e) {}
  }
  function deleteApi(id) {
    try {
      var url =
        cfg.apiUrl +
        (cfg.apiUrl.indexOf("?") >= 0 ? "&" : "?") +
        "app=" +
        encodeURIComponent(appSlug()) +
        "&id=" +
        encodeURIComponent(id);
      fetch(url, {
        method: "DELETE",
        headers: apiHeaders(false),
        mode: "cors",
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }
  // Pull all pins from the shared backend and merge with local. Last-write-
  // wins by timestamp. New remote pins appear, locally-deleted pins stay
  // deleted only if the user actually deleteApi'd them (otherwise they
  // resurface, which is correct — a fresh load shouldn't lose data).
  function pullApi() {
    if (sb()) return sbPull();
    if (!cfg.apiUrl) return;
    try {
      fetch(apiBase(), {
        method: "GET",
        headers: apiHeaders(false),
        mode: "cors",
      })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(mergeRemote)
        .catch(function () {});
    } catch (e) {}
  }

  // The merge, shared by both backends. Last-write-wins by the client's own
  // timestamp, with tombstones honoured in both directions so a delete is not
  // undone by another reviewer's stale copy.
  function mergeRemote(body) {
    {
      if (!body || !Array.isArray(body.pins)) return;
      var byId = {};
      body.pins.forEach(function (p) {
        if (p && p.id) byId[p.id] = p;
      });
      // Tombstones. Without honouring these, this merge resurrects other
      // reviewers' deletes: reviewer B deletes a pin, reviewer A still has
      // it in localStorage, and A's next poll pushes it straight back.
      var tomb = {};
      (body.deleted || []).forEach(function (d) {
        if (d && d.id) tomb[d.id] = d.deletedAt || Infinity;
      });
      pins.forEach(function (p) {
        if (tomb[p.id] !== undefined && (p.ts || 0) <= tomb[p.id]) {
          delete byId[p.id];
          return;
        }
        var remote = byId[p.id];
        if (!remote || (p.ts || 0) > (remote.ts || 0)) byId[p.id] = p;
      });
      Object.keys(tomb).forEach(function (id) {
        var kept = byId[id];
        if (kept && (kept.ts || 0) <= tomb[id]) delete byId[id];
      });
      var merged = Object.keys(byId).map(function (k) {
        return byId[k];
      });
      merged.sort(function (a, b) {
        return (a.ts || 0) - (b.ts || 0);
      });
      // Only re-render if anything actually changed
      if (JSON.stringify(merged) === JSON.stringify(pins)) return;
      pins = merged;
      writePins();
      render();
    }
  }

  // Asks who is leaving feedback, once, and only when it is needed.
  //
  // Shows the names already used on this page as one-click choices, plus a field
  // for a new one. The list comes from the shared data, so on a machine that has
  // never been used the field stands alone, and on a team page the common case
  // is a single click.
  function requireAuthor(next) {
    if (String(author || "").trim() && author !== "anon") {
      next();
      return;
    }

    var known = knownAuthors();
    var wrap = document.createElement("div");
    wrap.className = "fb-name-gate";
    wrap.setAttribute("data-feedback-ui", "name-gate");
    wrap.innerHTML =
      '<div class="fb-name-card">' +
      '<div class="fb-name-title">Who is leaving this feedback?</div>' +
      '<div class="fb-name-sub">Shown next to your comments so people know who to ask.</div>' +
      (known.length
        ? '<div class="fb-name-known">' +
          known
            .slice(0, 8)
            .map(function (n) {
              return (
                '<button type="button" class="fb-name-pick" data-name="' +
                escapeHtml(n) +
                '">' +
                escapeHtml(n) +
                "</button>"
              );
            })
            .join("") +
          "</div>" +
          '<div class="fb-name-or">or use a new name</div>'
        : "") +
      '<div class="fb-name-row">' +
      '<input type="text" class="fb-name-input" placeholder="Your name" maxlength="80">' +
      '<button type="button" class="fb-name-go">Continue</button>' +
      "</div>" +
      '<button type="button" class="fb-name-cancel">Cancel</button>' +
      "</div>";
    root.appendChild(wrap);

    var input = wrap.querySelector(".fb-name-input");
    input.focus();

    function choose(name) {
      var clean = String(name || "")
        .trim()
        .slice(0, 80);
      if (!clean) {
        input.focus();
        return;
      }
      author = clean;
      writeName(author);
      wrap.remove();
      next();
    }

    wrap.querySelectorAll(".fb-name-pick").forEach(function (b) {
      b.addEventListener("click", function () {
        choose(b.getAttribute("data-name"));
      });
    });
    wrap.querySelector(".fb-name-go").addEventListener("click", function () {
      choose(input.value);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        choose(input.value);
      }
      if (e.key === "Escape") wrap.remove();
    });
    wrap
      .querySelector(".fb-name-cancel")
      .addEventListener("click", function () {
        wrap.remove();
      });
  }

  function addReply(pinId, body) {
    var text = String(body || "").trim();
    if (!text) return;
    var reply = {
      id:
        "fbr-" +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 6),
      pinId: pinId,
      author: author || "anon",
      body: text.slice(0, 4000),
      ts: Date.now(),
      deleted: false,
    };
    replies.push(reply);
    writeReplies();
    if (sb()) sbPostReply(reply);
    render();
  }

  function deleteReply(id) {
    replies = replies.map(function (r) {
      return r.id === id ? Object.assign({}, r, { deleted: true }) : r;
    });
    writeReplies();
    if (sb()) sbDeleteReply(id);
    render();
  }

  // Resolve is a timestamp, not a boolean: "when was this settled" answers
  // strictly more and null is an unambiguous "still open".
  function toggleResolved(id) {
    var pin = pins.find(function (p) {
      return p.id === id;
    });
    if (!pin) return;
    if (pin.resolvedAt) {
      pin.resolvedAt = null;
      pin.resolvedBy = null;
    } else {
      pin.resolvedAt = new Date().toISOString();
      pin.resolvedBy = author || "anon";
    }
    writePins();
    if (sb()) {
      try {
        fetch(
          sbUrl(
            "?id=eq." +
              encodeURIComponent(id) +
              "&app=eq." +
              encodeURIComponent(appSlug()),
          ),
          {
            method: "PATCH",
            headers: sbHeaders({
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            }),
            body: JSON.stringify({
              resolved_at: pin.resolvedAt,
              resolved_by: pin.resolvedBy,
            }),
            keepalive: true,
          },
        ).catch(function () {});
      } catch (e) {}
    } else if (cfg.apiUrl) postApi(pin);
    render();
  }

  function deletePin(id) {
    pins = pins.filter(function (p) {
      return p.id !== id;
    });
    writePins();
    if (sb()) sbDelete(id);
    else if (cfg.apiUrl) deleteApi(id);
  }

  function clearAll() {
    if (
      !confirm(
        "Delete all " +
          pins.length +
          " feedback pin" +
          (pins.length === 1 ? "" : "s") +
          "?",
      )
    )
      return;
    pins = [];
    writePins();
    render();
  }

  // Jump to a pin: restore its screen, then scroll to the live element.
  //
  // Both halves were written before the anchor engine existed and neither works
  // on an app that anchors. `location.hash` moves nothing on a page that routes
  // by DOM state — the very case a config exists for — so a pin on another tab
  // scrolled the current tab instead of switching. And pin.y is the pixel the
  // element sat at when the pin was dropped, which the README is explicit is
  // wrong the moment anything moves.
  //
  // Restoring the screen needs page knowledge the tool cannot have, so it asks
  // the config via goToScreen(screen). Without one, the old hash behaviour is
  // kept so nothing regresses for hash-routed pages.
  function jumpTo(pin) {
    var screen = pin.anchor && pin.anchor.screen;
    if (screen && typeof cfg.goToScreen === "function") {
      try {
        cfg.goToScreen(screen);
      } catch (e) {}
    } else {
      var route = routeFromHash();
      if (pin.route !== route) location.hash = "#" + pin.route;
    }
    panelOpen = false;
    // Longer than the old 80ms: goToScreen may switch a tab and re-render a
    // list, and the element has to exist before it can be scrolled to.
    setTimeout(function () {
      var el = null;
      if (ANCHOR && pin.anchor) {
        var res = ANCHOR.resolve(pin.anchor);
        if (res && res.status === "ok") el = res.el;
      }
      if (el && el.scrollIntoView)
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      else
        window.scrollTo({ top: Math.max(0, pin.y - 200), behavior: "smooth" });
      render();
    }, 160);
  }

  function exportMarkdown() {
    var lines = ["# " + cfg.title + "\n"];
    var byRoute = {};
    pins.forEach(function (p) {
      (byRoute[p.route || "page"] = byRoute[p.route || "page"] || []).push(p);
    });
    Object.keys(byRoute)
      .sort()
      .forEach(function (r) {
        lines.push("\n## /#" + r + "\n");
        byRoute[r].forEach(function (p) {
          var d = new Date(p.ts).toISOString().slice(0, 16).replace("T", " ");
          var where = p.overlay ? " _(in modal: " + p.overlay + ")_" : "";
          var imp = importanceFor(p.importance);
          var prefix = imp ? "[" + imp.label + "] " : "";
          var state = p.resolvedAt ? " _(resolved)_" : "";
          lines.push(
            "- " +
              prefix +
              "**" +
              p.author +
              "** (" +
              d +
              ")" +
              where +
              state +
              " — " +
              p.text,
          );
          if (p.snippet)
            lines.push("  - at `" + p.label + '` · "' + p.snippet + '"');
          // Replies belong in the export: this is how a thread reaches a developer,
          // and a question exported without its answer actively misleads whoever
          // picks it up.
          repliesFor(p.id).forEach(function (r) {
            var rd = new Date(r.ts)
              .toISOString()
              .slice(0, 16)
              .replace("T", " ");
            lines.push("  - ↳ **" + r.author + "** (" + rd + ") — " + r.body);
          });
        });
      });
    var md = lines.join("\n");
    try {
      navigator.clipboard.writeText(md);
      alert("Feedback copied to clipboard as markdown.");
    } catch (e) {
      var w = window.open("", "_blank");
      if (w) {
        w.document.write("<pre>" + escapeHtml(md) + "</pre>");
        w.document.close();
      }
    }
  }

  // Drag: direct DOM updates during the drag (no re-render); commit on mouseup/touchend.
  // Works with both mouse and single-finger touch.
  function onPinDragStart(pin, e, node) {
    if (e.type === "mousedown" && e.button !== 0) return;
    if (e.touches && e.touches.length !== 1) return;
    e.stopPropagation();
    e.preventDefault();
    var p0 = _pointFrom(e);
    drag = {
      id: pin.id,
      startX: p0.clientX,
      startY: p0.clientY,
      originX: pin.x,
      originY: pin.y,
      node: node,
      moved: false,
      finalX: pin.x,
      finalY: pin.y,
    };
    function onMove(ev) {
      if (!drag) return;
      if (ev.cancelable) ev.preventDefault();
      var p = _pointFrom(ev);
      var dx = p.clientX - drag.startX;
      var dy = p.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
      drag.lastPoint = { x: p.clientX, y: p.clientY };
      if (drag.moved) {
        drag.finalX = drag.originX + dx;
        drag.finalY = drag.originY + dy;
        drag.node.style.left = drag.finalX - 14 + "px";
        drag.node.style.top = drag.finalY - 14 + "px";
      }
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
      document.removeEventListener("touchcancel", onUp);
      if (!drag) return;
      if (drag.moved) {
        var idx = pins.findIndex(function (p) {
          return p.id === drag.id;
        });
        if (idx >= 0) {
          pins[idx].x = drag.finalX;
          pins[idx].y = drag.finalY;
          // Re-anchor to whatever is now under the pin. Without this a dragged
          // pin keeps its old anchor and snaps back the next time the engine
          // repositions it — the drag would look like it silently failed.
          if (ANCHOR && drag.lastPoint) {
            var node = drag.node;
            var prev = node.style.display;
            node.style.display = "none"; // don't hit-test the pin itself
            var under = document.elementFromPoint(
              drag.lastPoint.x,
              drag.lastPoint.y,
            );
            node.style.display = prev;
            if (
              under &&
              !(under.closest && under.closest("[data-feedback-ui]"))
            ) {
              var a = ANCHOR.describe(
                under,
                drag.lastPoint.x,
                drag.lastPoint.y,
              );
              if (a) pins[idx].anchor = a;
            }
          }
          writePins();
          if (sb()) sbPost(pins[idx]);
          else if (cfg.apiUrl) postApi(pins[idx]);
        }
      } else {
        // A click, not a drag. Open the panel on this thread rather than the
        // composer: once a pin has replies the conversation is the thing you
        // came for, and the composer only ever showed the original comment with
        // no way to answer it.
        var p = pins.find(function (p) {
          return p.id === drag.id;
        });
        if (p) {
          focusPinId = p.id;
          panelOpen = true;
          render();
          scrollPanelToFocused();
        }
      }
      drag = null;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
    document.addEventListener("touchcancel", onUp);
  }

  // ─── Global listeners ─────────────────────────────────────────────────────

  // Annotation-mode click capture.
  //
  // On `window`, not `document`: the guard further down registers a window
  // capture listener that calls stopPropagation() for exactly this case — an
  // armed click on a page element. Window capture runs before document capture,
  // so a document-level listener here never sees the event and no pin is ever
  // created. Registering on window keeps this earlier in the path (it is
  // declared first), so the pin is captured and only then is the host page's
  // own handling suppressed.
  window.addEventListener(
    "click",
    function (e) {
      if (!active) return;
      if (e.target.closest && e.target.closest("[data-feedback-ui]")) return;
      e.preventDefault();
      e.stopPropagation();
      var el = e.target;
      var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      var top = topOverlay();
      var inOverlay = top && top.el.contains(el);
      var x = r ? r.left + r.width / 2 : e.clientX;
      var y = r ? r.top + r.height / 2 : e.clientY;
      var px = inOverlay ? x : x + window.scrollX;
      var py = inOverlay ? y : y + window.scrollY;
      editing = {
        id: newId(),
        x: px,
        y: py,
        route: routeFromHash(),
        overlay: inOverlay ? top.title : null,
        label: labelOf(el),
        snippet: snippetOf(el),
        text: "",
        // Element anchor. Recorded at the exact click point so the pin sits where
        // the reviewer put it, not at the element's centre. x/y above are kept
        // only as a fallback for pins created before anchoring existed.
        anchor: ANCHOR ? ANCHOR.describe(el, e.clientX, e.clientY) : null,
      };
      active = false;
      render();
    },
    true,
  );

  // Esc cancels
  window.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (editing) {
      editing = null;
      render();
    } else if (active) {
      active = false;
      render();
    } else if (panelOpen) {
      panelOpen = false;
      render();
    }
  });

  // Outside-click closes the side panel
  document.addEventListener("mousedown", function (e) {
    if (!panelOpen) return;
    var t = e.target;
    if (
      t.closest &&
      (t.closest('[data-feedback-ui="panel"]') ||
        t.closest('[data-feedback-ui="dock"]'))
    )
      return;
    panelOpen = false;
    render();
  });

  // Hash route change → re-render
  window.addEventListener("hashchange", render);

  // Anchor engine drives repositioning. Every scroll, resize, pan, zoom, tab
  // switch, expand and rebuild coalesces into one rAF flush, which re-renders
  // pins from their live elements.
  if (ANCHOR) {
    ANCHOR.onFlush(function () {
      if (!drag) render();
    });

    // The host page has its own capture-phase pointerdown and click handlers
    // that close the inspector, start a pan, clear domain focus, and open the
    // capability modal. Registering on `window` puts these earlier in the
    // capture path than the page's document-level listeners, so interacting
    // with a pin cannot trigger them.
    window.addEventListener(
      "pointerdown",
      function (e) {
        if (e.target.closest && e.target.closest("[data-feedback-ui]"))
          e.stopPropagation();
      },
      true,
    );
    window.addEventListener(
      "click",
      function (e) {
        if (!active) return;
        if (e.target.closest && e.target.closest("[data-feedback-ui]")) return;
        e.stopPropagation();
      },
      true,
    );
  }

  // Watch for overlay/modal open & close, re-render when changed
  var obs = new MutationObserver(function () {
    var top = topOverlay();
    var t = top ? top.title : null;
    if (t !== overlayTitle) {
      overlayTitle = t;
      render();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Initial render
  function boot() {
    if (ANCHOR) ANCHOR.start();
    render();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // Shared-backend bootstrap: pull on load, then poll for other reviewers'
  // pins. Polling is a no-op if cfg.pollInterval is 0 or apiUrl is unset.
  if (hasRemote()) {
    pullApi();
    if (cfg.pollInterval > 0) {
      setInterval(pullApi, Math.max(2000, cfg.pollInterval));
    }
  }

  // Debug surface — open the console and run `__feedbackPin.dump()` to see
  // why a pin may be hidden (overlay detection, route mismatch, etc).
  window.__feedbackPin = {
    dump: function () {
      var route = routeFromHash();
      var top = topOverlay();
      var visible = pins.filter(function (p) {
        if (overlayTitle) return p.overlay === overlayTitle;
        return !p.overlay && p.route === route;
      });
      return {
        pinCount: pins.length,
        visibleCount: visible.length,
        currentRoute: route,
        detectedOverlay: top ? top.title : null,
        overlaySelector: cfg.overlaySelectors,
        pins: pins.map(function (p) {
          return {
            id: p.id,
            route: p.route,
            overlay: p.overlay,
            text: p.text.slice(0, 40),
            x: p.x,
            y: p.y,
          };
        }),
      };
    },
    clear: clearAll,
    rerender: render,
  };
})();
