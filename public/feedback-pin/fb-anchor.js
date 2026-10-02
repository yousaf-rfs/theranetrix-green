/*
 * fb-anchor.js — element-anchored pin positioning for feedback.js
 *
 * Replaces feedback.js's absolute {x, y} model, which has two failures on any
 * app that swaps screens without navigating:
 *
 *   1. BLEED — pins keyed on location.hash show through onto every other view,
 *      because a tab switch never changes the hash.
 *   2. DETACH — pins stored as document pixels drift the moment their element
 *      moves: zoom, pan, expand/collapse, reflow, or a full node rebuild.
 *
 * The model here is: a pin remembers WHICH ELEMENT it was dropped on and WHICH
 * SCREEN was showing, never where the pixels were. Position is recomputed from
 * the live element every frame it matters; visibility is decided by comparing
 * the recorded screen against the current one.
 *
 * Page-specific knowledge lives entirely in config (contextRules + readSignature),
 * so this engine stays reusable across apps.
 *
 * Exposes window.FBAnchor. Load BEFORE feedback.js.
 */
(function () {
  "use strict";
  if (window.FBAnchor) return;

  var cfg = {
    rules: null,          // [{ sel, add: [field, ...] }] — null = use AUTO_RULES
    readSignature: null,  // () -> { field: value }       — null = use autoSignature
    worldHost: null,      // selector of the transformed pan/zoom layer, if any
    rebuildHosts: [],     // selectors whose children are destroyed/recreated
    scopeNodes: [],       // selectors to watch for context switches
    mirrors: {},          // hostSel -> [alternate host selectors] for responsive swaps
    debug: false,
  };

  // ─── Zero-config defaults ───────────────────────────────────────────────────
  // The engine is usable on any page with no configuration at all.
  //
  // This works because most show/hide is GEOMETRIC: a container toggled with
  // [hidden], display:none or visibility:hidden collapses its descendants'
  // rects, and gates C and D already refuse to paint there. No signature is
  // needed to stop a pin bleeding across a hidden tab.
  //
  // A signature is only required for the case geometry cannot see: ONE container
  // REUSED for different content (a detail pane that swaps per selected row, a
  // modal that swaps on next/prev). That is inherently page-specific, so it is
  // what a per-page config supplies. Everything below is the sensible default
  // until someone writes one.
  var DIALOG_SEL = 'dialog[open], [role="dialog"], [aria-modal="true"], .modal, .overlay-center, .overlay-drawer';

  var AUTO_RULES = [
    // Pins dropped inside a dialog are scoped to that dialog's identity, so they
    // do not reappear over the page behind it or over a different dialog.
    { sel: DIALOG_SEL, add: ['overlay'] },
  ];

  function visibleEl(el) {
    if (!el) return false;
    if (el.hasAttribute && el.hasAttribute('hidden')) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  // Identity of the topmost open dialog: its accessible name, else its first
  // line of text, else its id. Text is used because many dialogs are one reused
  // element whose title is the only thing distinguishing their contents.
  function topOverlayId() {
    var els = document.querySelectorAll(DIALOG_SEL);
    var best = null;
    for (var i = 0; i < els.length; i++) {
      if (!visibleEl(els[i])) continue;
      best = els[i]; // later in document order wins
    }
    if (!best) return null;
    var label = best.getAttribute('aria-label');
    if (!label) {
      var by = best.getAttribute('aria-labelledby');
      if (by) { var t = document.getElementById(by); if (t) label = t.textContent; }
    }
    if (!label) label = (best.innerText || '').split('\n').map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length; })[0] || best.id || 'dialog';
    return label.replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function autoSignature() {
    return {
      access: true,
      route: location.hash || location.pathname,
      overlay: topOverlayId(),
    };
  }

  function rules() { return cfg.rules || AUTO_RULES; }

  // ─── Selector helpers ───────────────────────────────────────────────────────
  function $(sel) {
    if (!sel) return null;
    try { return document.querySelector(sel); } catch (e) { return null; }
  }
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  // Attributes that identify an element stably across a rebuild, best first.
  var ID_ATTRS = ["data-feedback-id", "data-table", "data-domain", "data-feature",
                  "data-capability", "data-key", "data-id", "data-node", "data-target"];

  function identityOf(el) {
    for (var i = 0; i < ID_ATTRS.length; i++) {
      var v = el.getAttribute && el.getAttribute(ID_ATTRS[i]);
      if (v) return { attr: ID_ATTRS[i], val: v };
    }
    return null;
  }

  // A structural path from `root` down to `el`, using nth-of-type so it survives
  // sibling text changes. Only used when nothing identifies the element.
  function pathFrom(root, el) {
    var parts = [];
    var node = el;
    while (node && node !== root && node.nodeType === 1 && parts.length < 12) {
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (!parent) break;
      var same = 0, index = 0;
      for (var i = 0; i < parent.children.length; i++) {
        var c = parent.children[i];
        if (c.tagName === node.tagName) { same++; if (c === node) index = same; }
      }
      parts.unshift(same > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
      node = parent;
    }
    return parts.join(" > ");
  }

  function textPrint(el) {
    var t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t.slice(0, 60);
  }

  // ─── Building an anchor record ──────────────────────────────────────────────
  // Called once, when the reviewer drops a pin.
  function describe(el, clientX, clientY) {
    if (!el || el.nodeType !== 1) return null;

    // Which rebuild host owns this element? Anything inside a host may be
    // destroyed and recreated, so the anchor must be re-resolvable, never a
    // held reference.
    var host = null;
    for (var i = 0; i < cfg.rebuildHosts.length; i++) {
      if (el.closest && el.closest(cfg.rebuildHosts[i])) { host = cfg.rebuildHosts[i]; break; }
    }
    var hostEl = host ? $(host) : null;
    var scope = hostEl || document.body;

    // Identity ladder. `sel` is tried first and is the only one that is cheap
    // AND exact; the rest are progressively weaker fallbacks.
    var sel = null, ident = null;
    if (el.id) {
      sel = "#" + cssEscape(el.id);
      // An id is only useful if it is actually unique.
      try { if (document.querySelectorAll(sel).length !== 1) sel = null; } catch (e) { sel = null; }
    }
    ident = identityOf(el);

    // Nearest identified ancestor + the path from it. This is what makes pins on
    // unlabelled inner bits (a <strong>, a table cell) survive a rebuild: the
    // ancestor is found by identity, the child by structure.
    var anchorAncestor = null, ancestorIdent = null;
    var walk = el;
    while (walk && walk !== scope && walk !== document.body) {
      var id2 = identityOf(walk);
      if (id2) { anchorAncestor = walk; ancestorIdent = id2; break; }
      walk = walk.parentElement;
    }

    var rect = el.getBoundingClientRect();
    var fx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
    var fy = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;

    // Requirements: walk ancestors against the rule table and union the fields
    // each matched container contributes. This is the anti-bleed core — the
    // gate ends up exactly as strict as the element's real ancestry demands,
    // no stricter.
    //
    // Read the signature FRESH, never the per-flush memo. A pin must record the
    // screen as it is at the instant of the drop; the memo can predate a screen
    // change that happened since the last flush, which would stamp the pin with
    // the previous screen and make it bleed there while hiding where it belongs.
    // This runs once per pin drop, so the extra read costs nothing.
    sigCache = null;
    var sig = signature();
    sigCache = null;
    var requires = ["access"];
    var RL = rules();
    for (var r = 0; r < RL.length; r++) {
      var rule = RL[r];
      if (el.closest && el.closest(rule.sel)) {
        for (var f = 0; f < rule.add.length; f++) {
          if (requires.indexOf(rule.add[f]) < 0) requires.push(rule.add[f]);
        }
      }
    }
    var screen = {};
    for (var s = 0; s < requires.length; s++) screen[requires[s]] = sig[requires[s]];

    var inWorld = cfg.worldHost && el.closest && el.closest(cfg.worldHost);

    return {
      v: 2,
      sel: sel,
      attr: ident ? ident.attr : null,
      val: ident ? ident.val : null,
      aAttr: ancestorIdent ? ancestorIdent.attr : null,
      aVal: ancestorIdent ? ancestorIdent.val : null,
      path: anchorAncestor ? pathFrom(anchorAncestor, el) : pathFrom(scope, el),
      host: host,
      tag: el.tagName.toLowerCase(),
      txt: textPrint(el),
      fx: Math.max(0, Math.min(1, fx)),
      fy: Math.max(0, Math.min(1, fy)),
      requires: requires,
      screen: screen,
      painter: inWorld ? "world" : "fixed",
    };
  }

  // ─── Resolving an anchor back to an element ─────────────────────────────────
  var resolveCache = new WeakMap ? null : null; // per-flush memo, see flush()
  var memo = {};

  function hostOrder(a) {
    // GRAFT: the mirror fallback must be an ORDERED LIST, not `||`. Responsive
    // mirrors (a desktop grid and a mobile accordion) are BOTH in the DOM —
    // the breakpoint only display:none's one. `$(a.host) || $(mirror)` therefore
    // never reaches the mirror, and a pin authored on desktop silently fails to
    // place on a phone. Try each host and take the first that is both present
    // and actually rendered.
    var list = [a.host].concat(cfg.mirrors[a.host] || []);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (!list[i]) continue;
      var el = $(list[i]);
      if (el) out.push(el);
    }
    // Fall back to the document. describe() records host:null for anything not
    // inside a configured rebuildHost — page furniture, headers, intro blocks,
    // most of a typical page. Returning an empty list here left steps 2-4 of the
    // identity ladder with nothing to search, so those elements could only ever
    // be re-found by a unique id; everything else resolved to "no-host" and the
    // pin was dead the moment it was saved. Searching the document instead costs
    // one wider querySelector on a path that only runs when the cheap lookups
    // have already missed.
    if (!out.length && document.body) out.push(document.body);
    return out;
  }

  function resolve(a) {
    if (!a) return { status: "orphan", el: null };
    // Every field the lookup below reads is part of the key. ("attr=val" alone was
    // never empty, so anchors with only a path all shared the first one's result.)
    var key = a.sel || JSON.stringify([a.attr, a.val, a.host, a.aAttr, a.aVal, a.path, a.txt, a.tag]);
    if (memo[key] !== undefined) return memo[key];

    var found = null;

    // 1. Unique id — exact and cheap.
    if (a.sel) found = $(a.sel);

    // 2. Own identity attribute, scoped to its host so the same data-table in
    //    two different layers cannot cross-match.
    if (!found && a.attr && a.val) {
      var q = "[" + a.attr + '="' + cssEscape(a.val).replace(/\\/g, "\\\\") + '"]';
      var hosts = hostOrder(a);
      for (var h = 0; h < hosts.length && !found; h++) {
        try { found = hosts[h].querySelector(q); } catch (e) {}
      }
      if (!found && !a.host) { try { found = document.querySelector(q); } catch (e) {} }
    }

    // 3. Identified ancestor + structural path down to the child.
    if (!found && a.aAttr && a.aVal) {
      var aq = "[" + a.aAttr + '="' + cssEscape(a.aVal).replace(/\\/g, "\\\\") + '"]';
      var hosts2 = hostOrder(a);
      var anc = null;
      for (var h2 = 0; h2 < hosts2.length && !anc; h2++) {
        try { anc = hosts2[h2].querySelector(aq); } catch (e) {}
      }
      if (!anc) { try { anc = document.querySelector(aq); } catch (e) {} }
      if (anc) found = a.path ? safeQuery(anc, a.path) : anc;
    }

    // 4. Structural path from the host alone.
    if (!found && a.path) {
      var hosts3 = hostOrder(a);
      for (var h3 = 0; h3 < hosts3.length && !found; h3++) found = safeQuery(hosts3[h3], a.path);
    }

    // 5. Text fingerprint within the host — last resort, and only when the text
    //    is distinctive enough to be worth trusting.
    if (!found && a.txt && a.txt.length >= 4) {
      var hosts4 = hostOrder(a);
      for (var h4 = 0; h4 < hosts4.length && !found; h4++) {
        var cands = hosts4[h4].querySelectorAll(a.tag || "*");
        for (var c = 0; c < cands.length; c++) {
          if (textPrint(cands[c]) === a.txt) { found = cands[c]; break; }
        }
      }
    }

    var res = found
      ? { status: "ok", el: found }
      : { status: hostOrder(a).length ? "orphan" : "no-host", el: null };
    memo[key] = res;
    return res;
  }

  function safeQuery(root, path) {
    if (!root || !path) return null;
    try { return root.querySelector(path); } catch (e) { return null; }
  }

  // ─── Signature ──────────────────────────────────────────────────────────────
  var sigCache = null;
  function signature() {
    if (sigCache) return sigCache;
    // No config → auto signature. This is a supported mode, not a degraded one:
    // geometry handles hidden containers, and the auto signature adds dialog
    // and route scoping. A per-page config is only needed for reused containers.
    sigCache = (cfg.readSignature ? cfg.readSignature() : autoSignature()) || {};
    return sigCache;
  }

  // ─── Visibility gates ───────────────────────────────────────────────────────
  function laidOut(el) {
    if (el.checkVisibility) {
      return el.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true });
    }
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var cs = getComputedStyle(el);
    if (el.offsetParent === null && cs.position !== "fixed") return false;
    return cs.visibility !== "hidden";
  }

  // Every scrollable/overflow-hidden ancestor. A row scrolled out of a container
  // still has a perfectly valid rect — it is just somewhere it must not be drawn.
  // Testing the PIN POINT against each clipper is the correct predicate; testing
  // rect intersection would keep half-clipped pins painted at a clipped-away spot.
  function clipChain(el) {
    var out = [];
    var n = el.parentElement;
    while (n && n !== document.body && n !== document.documentElement) {
      var cs = getComputedStyle(n);
      if (cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        out.push(n);
      }
      n = n.parentElement;
    }
    return out;
  }

  // Decide what happens to one pin this frame.
  //   paint     — draw it at `at`
  //   offscreen — right element, wrong screen. Counted in the panel, not drawn.
  //   orphan    — element genuinely gone. Surfaced in the panel, never drawn at
  //               a guessed position (a wrong position is worse than none).
  //   clipped   — scrolled out of its container.
  function verdict(anchor, sig) {
    // Defensive: an anchor that arrived as a JSON string (an older backend, a
    // proxy, hand-edited storage) would otherwise pass every gate vacuously —
    // requires would be undefined, so the context check would be skipped — and
    // then fail to resolve, turning a good pin into a silent orphan.
    if (typeof anchor === "string") {
      try { anchor = JSON.parse(anchor); } catch (e) { return { kind: "orphan" }; }
    }
    if (!anchor || typeof anchor !== "object") return { kind: "orphan" };
    if (!Array.isArray(anchor.requires)) return { kind: "orphan" };

    // Gate 0 — access gate.
    if (sig.access === false) return { kind: "hidden" };

    // Gate A — semantic context. The anti-bleed gate.
    var req = anchor.requires || [];
    for (var i = 0; i < req.length; i++) {
      var f = req[i];
      if (sig[f] !== anchor.screen[f]) return { kind: "offscreen", field: f };
    }

    // Gate B — anchor resolves.
    var res = resolve(anchor);
    if (res.status !== "ok") return { kind: res.status === "no-host" ? "unplaced" : "orphan" };
    var el = res.el;

    // Gate C — geometric liveness. [hidden] collapses a rect to 0×0, and
    // 0 + fx*0 = 0 would stack every hidden pin in the top-left corner — the
    // exact bleed this whole system exists to prevent.
    if (!laidOut(el)) return { kind: "hidden" };

    // Gate D — clipping.
    var rect = el.getBoundingClientRect();
    var pt = { x: rect.left + anchor.fx * rect.width, y: rect.top + anchor.fy * rect.height };
    var chain = clipChain(el);
    for (var c = 0; c < chain.length; c++) {
      var cr = chain[c].getBoundingClientRect();
      if (pt.x < cr.left - 2 || pt.x > cr.right + 2 || pt.y < cr.top - 2 || pt.y > cr.bottom + 2) {
        return { kind: "clipped" };
      }
    }
    // Deliberately NO window-bounds test here. Being outside the current
    // viewport means "scrolled out of view", not "clipped" — the reviewer can
    // just scroll to it, and a scroll fires a flush that repositions the pin
    // back into view. Treating the window as a clipper hides every pin below
    // the fold, which on this page is most of the diagram.
    return { kind: "paint", el: el, at: pt, rect: rect, painter: anchor.painter };
  }

  // ─── World layer (pan/zoom) ─────────────────────────────────────────────────
  // Rather than chase the pan/zoom transform frame by frame, mount ERD pins
  // INSIDE the transformed layer. The compositor then moves them with the
  // diagram for free. This matters because the transform is written inline on
  // every pointermove by a hand-rolled rAF lerp with no CSS transition — there
  // is no transitionend to hook and no cheap way to observe it.
  var worldLayer = null;
  function ensureWorld() {
    if (!cfg.worldHost) return null;
    var host = $(cfg.worldHost);
    if (!host) return null;
    if (!worldLayer || !worldLayer.isConnected || worldLayer.parentElement !== host) {
      worldLayer = document.createElement("div");
      worldLayer.className = "fb-world";
      worldLayer.setAttribute("data-feedback-ui", "world");
      // GRAFT: the host page already uses z-index 8 and 9 inside this stacking
      // context, so the obvious `z-index: 9` would be occluded.
      worldLayer.style.cssText =
        "position:absolute;inset:0;pointer-events:none;z-index:2147483000;transform-origin:0 0;";
      host.appendChild(worldLayer);
    }
    return worldLayer;
  }

  // GRAFT: parse the live scale out of the transform rather than trusting a
  // cached value. A cached scale is stale on the first flush after a hidden
  // stage is revealed, because the deferred fit runs a frame later.
  function worldScale() {
    var host = $(cfg.worldHost);
    if (!host) return 1;
    var t = host.style.transform || "";
    var m = t.match(/scale\(([\d.]+)\)/);
    if (m) return parseFloat(m[1]) || 1;
    var mm = t.match(/matrix\(([-\d.]+)/);
    if (mm) return parseFloat(mm[1]) || 1;
    return 1;
  }

  // Convert a viewport point into world coordinates. Deliberately geometric
  // rather than reading the node's --node-x/--node-y custom properties: those
  // are percentages, exist only on table/domain cards, and are absent on the
  // SVG relation and hit paths that also live inside the viewport.
  function toWorld(pt) {
    var host = $(cfg.worldHost);
    if (!host) return pt;
    var hr = host.getBoundingClientRect();
    var s = worldScale() || 1;
    return { x: (pt.x - hr.left) / s, y: (pt.y - hr.top) / s };
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  var listeners = [];
  var frame = 0;
  var dirty = true;

  function schedule() {
    dirty = true;
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = 0;
      memo = {};        // per-flush resolve memo
      sigCache = null;  // per-flush signature memo
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](); } catch (e) {}
      }
    });
  }

  function observe() {
    // Structure — children destroyed/recreated. Flag only; the flush does work.
    var structure = new MutationObserver(schedule);
    cfg.rebuildHosts.forEach(function (sel) {
      var el = $(sel);
      if (el) structure.observe(el, { childList: true, subtree: true });
    });

    // Scope — context switches. Narrow by design: a fixed node list with
    // subtree:false, and no 'style' in the filter. Body-wide attribute
    // observation would fire hundreds of times per search keystroke (the page
    // toggles .is-hit across every node) and 60×/second during a pan, since the
    // pan writes style.transform inline.
    var scope = new MutationObserver(schedule);
    var scopeSel = (cfg.scopeNodes || []).concat([cfg.worldHost]).filter(Boolean);
    scopeSel.forEach(function (sel) {
      var el = $(sel);
      if (el) scope.observe(el, { attributes: true, subtree: false,
        attributeFilter: ["hidden", "class", "aria-selected", "aria-pressed", "open", "value"] });
    });

    // Zero-config fallback: with no scopeNodes named, watch the document
    // subtree so a dialog opening, a tab switching, or a panel being revealed
    // still triggers a reflow. This is the broad observation the configured
    // path deliberately avoids — it is correct but costs more, which is exactly
    // the trade a page makes by not naming its own context nodes.
    if (!scopeSel.length) {
      scope.observe(document.documentElement, {
        attributes: true, subtree: true, childList: true,
        attributeFilter: ["hidden", "open", "aria-selected", "aria-expanded", "aria-modal", "class"],
      });
    }
    // Text-content discriminators (which feature / which table is showing).
    (cfg.textNodes || []).forEach(function (sel) {
      var el = $(sel);
      if (el) scope.observe(el, { characterData: true, childList: true, subtree: true });
    });

    // Geometry.
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(schedule);
      ro.observe(document.documentElement);
      cfg.resizeNodes = cfg.resizeNodes || [];
      cfg.resizeNodes.forEach(function (sel) { var el = $(sel); if (el) ro.observe(el); });
    }

    // One capture-phase scroll listener catches every inner scroller. `scroll`
    // does not bubble, but it does capture.
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    // The pan/zoom transform has no transitionend and is written inline, so the
    // only reliable way to track it is to sample the inline style each frame —
    // a string read, which forces no layout. The loop runs only while the world
    // layer is actually on screen.
    // Without a configured world host there is nothing to sample, so no loop.
    var lastT = "";
    if (cfg.worldHost) (function tick() {
      var host = cfg.worldHost && $(cfg.worldHost);
      if (host && laidOut(host)) {
        var t = host.style.transform || "";
        if (t !== lastT) { lastT = t; schedule(); }
      }
      requestAnimationFrame(tick);
    })();

    // Settle burst — node reveal animations are staggered, and revealing a
    // hidden stage defers its fit by a frame, so rects right after a rebuild
    // are mid-flight. Keep flushing briefly rather than trusting one reading.
    var burst = null;
    var origSchedule = schedule;
    structure.takeRecords && (function () {
      var mo = new MutationObserver(function () {
        if (burst) clearTimeout(burst);
        var until = Date.now() + 450;
        (function again() {
          origSchedule();
          if (Date.now() < until) burst = setTimeout(again, 16);
        })();
      });
      cfg.rebuildHosts.forEach(function (sel) {
        var el = $(sel);
        if (el) mo.observe(el, { childList: true });
      });
    })();
  }

  window.FBAnchor = {
    configure: function (o) {
      Object.keys(o || {}).forEach(function (k) { cfg[k] = o[k]; });
      return this;
    },
    start: function () { observe(); schedule(); return this; },
    describe: describe,
    resolve: resolve,
    verdict: verdict,
    signature: function () { sigCache = null; return signature(); },
    onFlush: function (fn) { listeners.push(fn); },
    schedule: schedule,
    ensureWorld: ensureWorld,
    worldScale: worldScale,
    toWorld: toWorld,
    clipChain: clipChain,
    laidOut: laidOut,
  };
})();
