(function () {
  const BUILD_INFO = "debug-2025-08-07-1";
  try {
    console.info("[NotesExt] content.js loaded", BUILD_INFO);
  } catch {}
  const EXT_PREFIX = "notes_ext";
  const SIDEBAR_OPEN_SESSION_KEY = `${EXT_PREFIX}:sidebar_open`; // sessionStorage per tab
  const SCOPE_KEY = `${EXT_PREFIX}:scope`; // "page" | "site" | "url"
  const THEME_KEY = `${EXT_PREFIX}:theme`; // "auto" | "light" | "dark"
  const AUTO_OPEN_KEY = `${EXT_PREFIX}:auto_open`; // "1" | "0"
  const WIDTH_KEY = `${EXT_PREFIX}:sidebar_width`;
  const HEIGHT_KEY = `${EXT_PREFIX}:sidebar_height`;
  const UI_PREFS_KEY = `${EXT_PREFIX}:ui_prefs`;
  const SEARCH_MODE_KEY = `${EXT_PREFIX}:search_mode`; // 'notes' | 'site'
  const PLACEMENT_KEY = `${EXT_PREFIX}:placement`; // 'right' | 'left' | 'top' | 'bottom'
  const LAST_SAVED_SUFFIX = "lastSavedAt";

  const SCOPES = { page: "page", site: "site", url: "url", global: "global" };
  let currentScope = SCOPES.site;
  let currentTheme = "auto";
  let autoOpen = false;
  let lastUrl = location.href;
  let currentActiveId = computeId(currentScope);
  let uiPrefs = null;
  let searchMode = "site";
  let collapseDelayTimer = null;
  let stickOpenUntilHover = false;
  let currentPlacement = "right";
  let lastExpandAtMs = 0;
  // keep track of last expand time for hysteresis

  // Markdown parsing functions
  function parseMarkdown(text) {
    let html = text
      // Escape HTML first
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")

      // Headers
      .replace(/^### (.*$)/gm, "<h3>$1</h3>")
      .replace(/^## (.*$)/gm, "<h2>$1</h2>")
      .replace(/^# (.*$)/gm, "<h1>$1</h1>")

      // Bold and italic
      .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")

      // Code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/```([^`]+)```/g, "<pre><code>$1</code></pre>")

      // Links
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>'
      )

      // Strikethrough
      .replace(/~~(.*?)~~/g, "<del>$1</del>")

      // Line breaks and paragraphs
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>")

      // Blockquotes
      .replace(/^> (.*$)/gm, "<blockquote>$1</blockquote>")

      // Horizontal rules
      .replace(/^---$/gm, "<hr>")
      .replace(/^\*\*\*$/gm, "<hr>");

    // Handle lists
    html = html.replace(
      /^- \[ \] (.+)$/gm,
      '<div class="checkbox-item"><input type="checkbox" disabled> $1</div>'
    );
    html = html.replace(
      /^- \[x\] (.+)$/gm,
      '<div class="checkbox-item"><input type="checkbox" checked disabled> $1</div>'
    );
    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    html = html.replace(/^(\d+)\. (.+)$/gm, "<li>$1. $2</li>");

    // Wrap orphaned list items
    html = html.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");

    // Wrap in paragraphs if not already wrapped
    if (
      !html.includes("<h1>") &&
      !html.includes("<h2>") &&
      !html.includes("<h3>") &&
      !html.includes("<ul>") &&
      !html.includes("<blockquote>")
    ) {
      html = "<p>" + html + "</p>";
    }

    return html;
  }

  // Smart templates and auto-complete
  const templates = {
    todo: "## TODO\n\n- [ ] \n- [ ] \n- [ ] \n",
    meeting: `## Meeting Notes - ${new Date().toLocaleDateString()}\n\n**Attendees:** \n\n**Agenda:**\n- \n\n**Notes:**\n\n**Action Items:**\n- [ ] \n`,
    daily: `## Daily Notes - ${new Date().toLocaleDateString()}\n\n**Goals for today:**\n- \n\n**Completed:**\n- \n\n**Notes:**\n\n`,
    idea: "💡 **Idea:** \n\n**Description:**\n\n**Next Steps:**\n- \n",
    bug: "🐛 **Bug Report**\n\n**Issue:** \n\n**Steps to reproduce:**\n1. \n\n**Expected:** \n\n**Actual:** \n\n**Fix:** \n",
    research:
      "🔍 **Research Notes**\n\n**Topic:** \n\n**Sources:**\n- \n\n**Key Findings:**\n- \n\n**Conclusions:**\n\n",
  };

  function computeId(scope) {
    switch (scope) {
      case SCOPES.global:
        return "__GLOBAL__";
      case SCOPES.site:
        return location.host;
      case SCOPES.url:
        return location.host + location.pathname + location.search;
      case SCOPES.page:
      default:
        return location.host + location.pathname;
    }
  }

  function getNotesKey() {
    return `${EXT_PREFIX}:${computeId(currentScope)}:notes`;
  }

  // Tabs model keys
  function getTabsKey() {
    return `${EXT_PREFIX}:${computeId(currentScope)}:tabs`;
  }
  function getActiveTabKey() {
    return `${EXT_PREFIX}:${computeId(currentScope)}:active_tab`;
  }
  function getTabsVersionKey() {
    return `${EXT_PREFIX}:${computeId(currentScope)}:tabs_version`;
  }
  function getGlobalDocKey() {
    return `${EXT_PREFIX}:__GLOBAL__:doc`;
  }
  function getTabLastSavedKey(tabId) {
    return `${EXT_PREFIX}:${computeId(
      currentScope
    )}:tab:${tabId}:${LAST_SAVED_SUFFIX}`;
  }

  function getStatsKey() {
    return `${EXT_PREFIX}:${computeId(currentScope)}:stats`;
  }

  function getLastSavedKey() {
    return `${EXT_PREFIX}:${computeId(currentScope)}:${LAST_SAVED_SUFFIX}`;
  }

  function statsKeyForId(id) {
    return `${EXT_PREFIX}:${id}:stats`;
  }

  function computeIdFromUrl(url, scope) {
    try {
      const u = new URL(url, location.origin);
      switch (scope) {
        case SCOPES.global:
          return "__GLOBAL__";
        case SCOPES.site:
          return u.host;
        case SCOPES.url:
          return u.host + u.pathname + u.search;
        case SCOPES.page:
        default:
          return u.host + u.pathname;
      }
    } catch {
      return computeId(scope);
    }
  }

  // ---- Title helper ----
  function getTitleForScope() {
    if (currentScope === SCOPES.global) return "Global Notes";
    if (currentScope === SCOPES.site) return `Notes for ${location.host}`;
    if (currentScope === SCOPES.url)
      return `Notes for ${location.host}${location.pathname}${location.search}`;
    // page (default)
    return `Notes for ${location.host}${location.pathname}`;
  }

  function isGlobalScope() {
    return currentScope === SCOPES.global;
  }

  function isGlobalScope() {
    return currentScope === SCOPES.global;
  }

  // ---- Safe localStorage helpers (gracefully degrade if blocked) ----
  const storageAvailable = (() => {
    try {
      const t = "__notes_ext_test__";
      localStorage.setItem(t, "1");
      localStorage.removeItem(t);
      return true;
    } catch (e) {
      return false;
    }
  })();

  const memoryStorage = new Map();

  function lsGet(key) {
    if (storageAvailable) {
      const v = localStorage.getItem(key);
      return v;
    }
    return memoryStorage.has(key) ? memoryStorage.get(key) : null;
  }

  function lsSet(key, value) {
    if (storageAvailable) {
      try {
        localStorage.setItem(key, value);
        return;
      } catch (_) {}
    }
    memoryStorage.set(key, value);
  }

  function lsRemove(key) {
    if (storageAvailable) {
      try {
        localStorage.removeItem(key);
        return;
      } catch (_) {}
    }
    memoryStorage.delete(key);
  }

  // ---- Extension global storage (persistent across sites) ----
  function extGet(keys) {
    return new Promise((resolve) => {
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(keys, (res) => resolve(res || {}));
          return;
        }
      } catch {}
      // Fallback to localStorage if chrome.storage not available
      const out = {};
      if (Array.isArray(keys)) {
        keys.forEach((k) => (out[k] = lsGet(k)));
      } else if (typeof keys === "string") {
        out[keys] = lsGet(keys);
      } else if (keys && typeof keys === "object") {
        Object.keys(keys).forEach((k) => (out[k] = lsGet(k) ?? keys[k]));
      }
      resolve(out);
    });
  }

  function extSet(obj) {
    return new Promise((resolve) => {
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(obj, resolve);
          return;
        }
      } catch {}
      // Fallback
      Object.entries(obj || {}).forEach(([k, v]) =>
        lsSet(k, typeof v === "string" ? v : JSON.stringify(v))
      );
      resolve();
    });
  }

  // Convenience helpers for extension storage
  function extGetString(key) {
    return extGet(key).then((res) => {
      const v = res ? res[key] : null;
      return typeof v === "string" ? v : v == null ? null : String(v);
    });
  }
  function extSetString(key, value) {
    return extSet({ [key]: value });
  }

  // ---- Synced settings (persist across sites and devices) ----
  function extSyncGet(keys) {
    return new Promise((resolve) => {
      try {
        if (chrome && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.get(keys, (res) => resolve(res || {}));
          return;
        }
      } catch {}
      extGet(keys).then(resolve);
    });
  }

  function extSyncSet(obj) {
    return new Promise((resolve) => {
      try {
        if (chrome && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.set(obj, resolve);
          return;
        }
      } catch {}
      extSet(obj).then(resolve);
    });
  }

  // ---- Stats model ----
  function readStats() {
    const raw = lsGet(getStatsKey());
    if (!raw) {
      return {
        firstVisitAt: null,
        lastVisitAt: null,
        visitCount: 0,
        totalTimeSpentMs: 0,
      };
    }
    try {
      const obj = JSON.parse(raw);
      return {
        firstVisitAt: obj.firstVisitAt ?? null,
        lastVisitAt: obj.lastVisitAt ?? null,
        visitCount: Number(obj.visitCount || 0),
        totalTimeSpentMs: Number(obj.totalTimeSpentMs || 0),
      };
    } catch (_) {
      return {
        firstVisitAt: null,
        lastVisitAt: null,
        visitCount: 0,
        totalTimeSpentMs: 0,
      };
    }
  }

  function writeStats(stats) {
    lsSet(getStatsKey(), JSON.stringify(stats));
  }

  function incrementVisit() {
    const now = Date.now();
    const stats = readStats();
    stats.visitCount += 1;
    if (!stats.firstVisitAt) stats.firstVisitAt = now;
    stats.lastVisitAt = now;
    writeStats(stats);
    incrementDomainVisit(now);
    return stats;
  }

  // ---- Domain stats (host-level) ----
  const DOMAIN_STATS_KEY = `${EXT_PREFIX}:${location.host}:domain_stats`;
  function readDomainStats() {
    const raw = lsGet(DOMAIN_STATS_KEY);
    if (!raw) {
      return {
        firstVisitAt: null,
        lastVisitAt: null,
        visitCount: 0,
        totalTimeSpentMs: 0,
      };
    }
    try {
      const obj = JSON.parse(raw);
      return {
        firstVisitAt: obj.firstVisitAt ?? null,
        lastVisitAt: obj.lastVisitAt ?? null,
        visitCount: Number(obj.visitCount || 0),
        totalTimeSpentMs: Number(obj.totalTimeSpentMs || 0),
      };
    } catch {
      return {
        firstVisitAt: null,
        lastVisitAt: null,
        visitCount: 0,
        totalTimeSpentMs: 0,
      };
    }
  }
  function writeDomainStats(s) {
    lsSet(DOMAIN_STATS_KEY, JSON.stringify(s));
  }
  function incrementDomainVisit(now) {
    const s = readDomainStats();
    s.visitCount += 1;
    if (!s.firstVisitAt) s.firstVisitAt = now;
    s.lastVisitAt = now;
    writeDomainStats(s);
  }
  function accumulateDomainTime(deltaMs) {
    const s = readDomainStats();
    s.totalTimeSpentMs += deltaMs;
    writeDomainStats(s);
  }

  // ---- Time tracking (rough, focus + visibility) ----
  let isActive = false;
  let lastActivityMs = Date.now();
  let heartbeatId = null;

  function setActive(active) {
    const now = Date.now();
    if (isActive) {
      // accumulate time since lastActivityMs
      const delta = Math.max(0, now - lastActivityMs);
      if (delta > 0) {
        const stats = readStats();
        stats.totalTimeSpentMs += delta;
        writeStats(stats);
        updateStatsUI(stats);
      }
    }
    isActive = active;
    lastActivityMs = now;
  }

  function handleVisibilityOrFocusChange() {
    const activeNow =
      document.visibilityState === "visible" && document.hasFocus();
    setActive(activeNow);
    // On focus/visibility regain, resync global scope from unified doc
    if (activeNow && isGlobalScope()) {
      if (Date.now() - lastLocalChangeMs < 750) return;
      extGet(getGlobalDocKey()).then((docObj) => {
        let incomingDoc = null;
        try {
          const raw = docObj ? docObj[getGlobalDocKey()] : null;
          incomingDoc = raw ? JSON.parse(raw) : null;
        } catch {}
        if (!incomingDoc || typeof incomingDoc !== "object") return;
        const newVer = Number(incomingDoc.version || 0);
        if (!(newVer > globalDocVersion)) return;
        const incTabs = Array.isArray(incomingDoc.tabs) ? incomingDoc.tabs : [];
        const incActive = incomingDoc.activeTabId || null;
        tabs = incTabs;
        activeTabId =
          incActive && incTabs.some((t) => t.id === incActive)
            ? incActive
            : incTabs[0]
            ? incTabs[0].id
            : null;
        globalDocVersion = newVer;
        try {
          lastWrittenTabsJson = JSON.stringify(tabs);
        } catch {
          lastWrittenTabsJson = "";
        }
        renderTabs();
        const t = getActiveTab();
        if (els && els.textarea) {
          const newText = (t && t.content) || "";
          if (els.textarea.value !== newText) {
            els.textarea.value = newText;
            updateMetrics();
          }
        }
        getLastSavedForTab(activeTabId).then((ms) =>
          updateLastSavedDisplay(ms)
        );
      });
    }
  }

  function startHeartbeat() {
    if (heartbeatId != null) return;
    heartbeatId = setInterval(() => {
      if (!isActive) return;
      const now = Date.now();
      const delta = Math.max(0, now - lastActivityMs);
      if (delta > 0) {
        const stats = readStats();
        stats.totalTimeSpentMs += delta;
        writeStats(stats);
        accumulateDomainTime(delta);
        updateStatsUI(stats);
        lastActivityMs = now;
      }
    }, 1000);
  }

  function stopHeartbeat() {
    if (heartbeatId != null) {
      clearInterval(heartbeatId);
      heartbeatId = null;
    }
  }

  function flushTime() {
    const now = Date.now();
    if (isActive) {
      const delta = Math.max(0, now - lastActivityMs);
      if (delta > 0) {
        const stats = readStats();
        stats.totalTimeSpentMs += delta;
        writeStats(stats);
        accumulateDomainTime(delta);
        updateStatsUI(stats);
      }
    }
    lastActivityMs = now;
  }

  // ---- Sidebar UI injection ----
  let sidebarRoot = null;
  let sidebarVisible = false;
  let els = {};

  function ensureStyles() {
    if (document.getElementById("notes-ext-sidebar-style")) return;
    const style = document.createElement("style");
    style.id = "notes-ext-sidebar-style";
    style.textContent = `
      #notes-ext-sidebar-root { position: fixed; max-width: none; z-index: 2147483647; background: #ffffff; color: #111; box-shadow: rgba(0,0,0,0.2) -3px 0 10px; border-left: 1px solid #e5e7eb; display: none; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; transition: transform 0.18s ease, opacity 0.18s ease; }
      #notes-ext-sidebar-root.collapsed { opacity: 0.15; pointer-events: none; }
      #notes-ext-sidebar-root.pos-right.collapsed { transform: translateX( calc(100% - 12px) ); }
      #notes-ext-sidebar-root.pos-left.collapsed { transform: translateX( calc(-100% + 12px) ); }
      #notes-ext-sidebar-root.pos-top.collapsed { transform: translateY( calc(-100% + 12px) ); }
      #notes-ext-sidebar-root.pos-bottom.collapsed { transform: translateY( calc(100% - 12px) ); }
      #notes-ext-sidebar-root.collapsed:hover { transform: translate(0,0); opacity: 1; }
      #notes-ext-hover-edge { position: fixed; z-index: 2147483646; }
      #notes-ext-sidebar-root.dark { background: #0b1220; color: #e5e7eb; border-left-color: #111827; box-shadow: rgba(0,0,0,0.6) -3px 0 16px; }
      #notes-ext-sidebar-root.dark-blue { background: #0a1a2b; color: #e6f0ff; border-left-color: #0b2239; }
      #notes-ext-sidebar-root.dark-purple { background: #1b1230; color: #ede9fe; border-left-color: #2a1a4b; }
      #notes-ext-sidebar-root * { box-sizing: border-box; }
      #notes-ext-sidebar-header { display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; background: #f8fafc; gap: 6px; }
      #notes-ext-header-row1 { grid-column: 1 / span 2; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      #notes-ext-header-left { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; }
      #notes-ext-header-right { display: flex; align-items: center; gap: 6px; }
      #notes-ext-header-row2 { grid-column: 1 / span 2; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      #notes-ext-header-row2 > * { flex: 0 0 auto; }
      #notes-ext-sidebar-root.dark #notes-ext-sidebar-header { background: #0f172a; border-bottom-color: #1f2937; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-sidebar-header { background: #0b2239; border-bottom-color: #1b3354; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-sidebar-header { background: #251a3f; border-bottom-color: #3a2a64; }
      #notes-ext-sidebar-title { font-weight: 600; font-size: 14px; color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; flex: 1 1 auto; min-width: 0; }
      #notes-ext-sidebar-root.dark #notes-ext-sidebar-title { color: #e5e7eb; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-sidebar-title { color: #e6f0ff; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-sidebar-title { color: #ede9fe; }
      #notes-ext-close-btn { background: transparent; border: none; font-size: 18px; line-height: 1; cursor: pointer; color: #6b7280; padding: 4px; }
      #notes-ext-close-btn:hover { color: #111827; }
      #notes-ext-pin-btn { background: transparent; border: none; font-size: 14px; cursor: pointer; color: #6b7280; padding: 4px; }
      #notes-ext-pin-btn.active { color: #2563eb; }
      #notes-ext-pin-btn:hover { color: #111827; }
      #notes-ext-sidebar-root.dark #notes-ext-close-btn { color: #9ca3af; }
      #notes-ext-sidebar-root.dark #notes-ext-close-btn:hover { color: #e5e7eb; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-close-btn { color: #a5b8d8; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-close-btn:hover { color: #e6f0ff; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-close-btn { color: #c7b9e6; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-close-btn:hover { color: #ede9fe; }
      #notes-ext-sidebar-body { height: calc(100% - 44px); overflow: auto; padding: 10px 12px; }
      #notes-ext-stats { display: block; font-size: 12px; color: #374151; margin-bottom: 10px; }
      #notes-ext-stats-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px dashed #334155; cursor: pointer; font-size: 12px; }
      #notes-ext-stats-caret { display: inline-block; transform: rotate(-90deg); transition: transform 0.15s ease; }
      #notes-ext-stats-bar.open #notes-ext-stats-caret { transform: rotate(0deg); }
      #notes-ext-sidebar-root.dark #notes-ext-stats { color: #cbd5e1; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-stats { color: #cfe1ff; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-stats { color: #e3d8ff; }
      .notes-ext-stat-label { color: #6b7280; }
      #notes-ext-sidebar-root.dark .notes-ext-stat-label { color: #9ca3af; }
      #notes-ext-sidebar-root.dark-blue .notes-ext-stat-label { color: #a5b8d8; }
      #notes-ext-sidebar-root.dark-purple .notes-ext-stat-label { color: #c7b9e6; }
      .notes-ext-buttons { display: flex; gap: 8px; margin: 8px 0 10px; }
      .notes-ext-btn { font-size: 12px; padding: 6px 8px; border-radius: 6px; border: 1px solid #d1d5db; background: #f9fafb; color: #111827; cursor: pointer; }
      .notes-ext-btn:hover { background: #f3f4f6; }
      #notes-ext-sidebar-root.dark .notes-ext-btn { background: #0b1220; color: #e5e7eb; border-color: #374151; }
      #notes-ext-sidebar-root.dark .notes-ext-btn:hover { background: #0f172a; }
      #notes-ext-sidebar-root.dark-blue .notes-ext-btn { background: #0a1a2b; color: #e6f0ff; border-color: #1b3354; }
      #notes-ext-sidebar-root.dark-blue .notes-ext-btn:hover { background: #0b2239; }
      #notes-ext-sidebar-root.dark-purple .notes-ext-btn { background: #1b1230; color: #ede9fe; border-color: #3a2a64; }
      #notes-ext-sidebar-root.dark-purple .notes-ext-btn:hover { background: #251a3f; }
      #notes-ext-textarea { width: 100%; height: 50vh; min-height: 160px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 13px; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px 6px 0 0; border-bottom: none; outline: none; }
      #notes-ext-textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.2); }
      #notes-ext-sidebar-root.dark #notes-ext-textarea { background: #0f172a; color: #e5e7eb; border-color: #374151; }
      #notes-ext-sidebar-root.dark #notes-ext-textarea:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.35); }
      #notes-ext-sidebar-root.dark-blue #notes-ext-textarea { background: #0b2239; color: #e6f0ff; border-color: #1b3354; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.35); }
      #notes-ext-sidebar-root.dark-purple #notes-ext-textarea { background: #251a3f; color: #ede9fe; border-color: #3a2a64; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-textarea:focus { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,0.35); }
      #notes-ext-resizer { position: absolute; top: 0; width: 6px; height: 100%; cursor: ew-resize; z-index: 2147483648; background: transparent; }
      #notes-ext-resizer-vert { position: absolute; left: 0; right: 0; height: 6px; cursor: ns-resize; z-index: 2147483648; background: transparent; display: none; }
      /* Top/bottom reduce textarea height and allow scroll */
      #notes-ext-sidebar-root.pos-top #notes-ext-textarea,
      #notes-ext-sidebar-root.pos-bottom #notes-ext-textarea { height: 120px; min-height: 80px; }
      #notes-ext-footer { font-size: 11px; color: #6b7280; margin-top: 10px; }
      #notes-ext-sidebar-root.dark #notes-ext-footer { color: #94a3b8; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-footer { color: #a5b8d8; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-footer { color: #c7b9e6; }
      #notes-ext-settings { position: absolute; top: 36px; right: 12px; width: 240px; background: #ffffff; color: #111827; border: 1px solid #d1d5db; border-radius: 8px; box-shadow: rgba(0,0,0,0.2) 0 6px 24px; padding: 10px; display: none; }
      #notes-ext-sidebar-root.dark #notes-ext-settings { background: #0f172a; color: #e5e7eb; border-color: #1f2937; box-shadow: rgba(0,0,0,0.5) 0 6px 24px; }
      .notes-ext-settings-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 12px; }
      .notes-ext-settings-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
      /* Tabs */
      #notes-ext-tabs { display: flex; align-items: center; gap: 6px; margin: 8px 0; flex-wrap: wrap; }
      .notes-ext-tab { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 999px; background: #f3f4f6; color: #111827; cursor: pointer; font-size: 12px; user-select: none; }
      .notes-ext-tab.active { background: #3b82f6; color: #ffffff; border-color: #2563eb; }
      .notes-ext-tab .notes-ext-tab-close { background: transparent; border: none; color: inherit; font-size: 12px; cursor: pointer; opacity: 0.85; }
      #notes-ext-add-tab { padding: 4px 8px; border: 1px dashed #d1d5db; border-radius: 999px; background: transparent; color: #374151; cursor: pointer; font-size: 12px; }
      #notes-ext-sidebar-root.dark .notes-ext-tab { background: #0f172a; color: #e5e7eb; border-color: #374151; }
      #notes-ext-sidebar-root.dark .notes-ext-tab.active { background: #2563eb; border-color: #1d4ed8; }
      #notes-ext-sidebar-root.dark #notes-ext-add-tab { border-color: #374151; color: #9ca3af; }
      #notes-ext-sidebar-root.dark-blue .notes-ext-tab { background: #0b2239; color: #e6f0ff; border-color: #1b3354; }
      #notes-ext-sidebar-root.dark-blue .notes-ext-tab.active { background: #3b82f6; border-color: #1d4ed8; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-add-tab { border-color: #1b3354; color: #a5b8d8; }
      #notes-ext-sidebar-root.dark-purple .notes-ext-tab { background: #251a3f; color: #ede9fe; border-color: #3a2a64; }
      #notes-ext-sidebar-root.dark-purple .notes-ext-tab.active { background: #8b5cf6; border-color: #6d28d9; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-add-tab { border-color: #3a2a64; color: #c7b9e6; }
      /* Markdown preview styles */
      #notes-ext-preview { 
        resize: vertical;
        background: inherit;
        color: inherit;
      }
      #notes-ext-preview h1 { font-size: 1.5em; font-weight: 600; margin: 16px 0 8px 0; color: inherit; }
      #notes-ext-preview h2 { font-size: 1.3em; font-weight: 600; margin: 14px 0 6px 0; color: inherit; }
      #notes-ext-preview h3 { font-size: 1.1em; font-weight: 600; margin: 12px 0 4px 0; color: inherit; }
      #notes-ext-preview p { margin: 8px 0; color: inherit; }
      #notes-ext-preview ul { margin: 8px 0; padding-left: 20px; }
      #notes-ext-preview li { margin: 2px 0; }
      #notes-ext-preview code { background: #f3f4f6; padding: 2px 4px; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 0.9em; color: #374151; }
      #notes-ext-preview pre { background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb; margin: 8px 0; overflow-x: auto; }
      #notes-ext-preview pre code { background: none; padding: 0; color: #374151; }
      #notes-ext-preview blockquote { border-left: 4px solid #d1d5db; padding-left: 16px; margin: 12px 0; color: #6b7280; font-style: italic; }
      #notes-ext-preview hr { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
      #notes-ext-preview a { color: #2563eb; text-decoration: underline; }
      #notes-ext-preview a:hover { color: #1d4ed8; }
      #notes-ext-preview strong { font-weight: 600; }
      #notes-ext-preview em { font-style: italic; }
      #notes-ext-preview del { text-decoration: line-through; color: #6b7280; }
      #notes-ext-preview .checkbox-item { margin: 4px 0; }
      #notes-ext-preview .checkbox-item input { margin-right: 8px; }
      /* Dark theme preview styles */
      #notes-ext-sidebar-root.dark #notes-ext-preview { background: #0f172a; color: #e5e7eb; border-color: #374151; }
      #notes-ext-sidebar-root.dark #notes-ext-preview h1, 
      #notes-ext-sidebar-root.dark #notes-ext-preview h2, 
      #notes-ext-sidebar-root.dark #notes-ext-preview h3 { color: #f9fafb; }
      #notes-ext-sidebar-root.dark #notes-ext-preview code { background: #1f2937; color: #e5e7eb; }
      #notes-ext-sidebar-root.dark #notes-ext-preview pre { background: #111827; border-color: #374151; }
      #notes-ext-sidebar-root.dark #notes-ext-preview blockquote { border-left-color: #374151; color: #9ca3af; }
      #notes-ext-sidebar-root.dark #notes-ext-preview hr { border-top-color: #374151; }
      #notes-ext-sidebar-root.dark #notes-ext-preview a { color: #60a5fa; }
      #notes-ext-sidebar-root.dark #notes-ext-preview a:hover { color: #93c5fd; }
      #notes-ext-sidebar-root.dark #notes-ext-preview del { color: #9ca3af; }
      /* Dark blue theme preview styles */
      #notes-ext-sidebar-root.dark-blue #notes-ext-preview { background: #0b2239; color: #e6f0ff; border-color: #1b3354; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-preview h1,
      #notes-ext-sidebar-root.dark-blue #notes-ext-preview h2,
      #notes-ext-sidebar-root.dark-blue #notes-ext-preview h3 { color: #f0f9ff; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-preview code { background: #1b3354; color: #e6f0ff; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-preview pre { background: #0f2c47; border-color: #1b3354; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-preview blockquote { border-left-color: #1b3354; color: #a5b8d8; }
      #notes-ext-sidebar-root.dark-blue #notes-ext-preview hr { border-top-color: #1b3354; }
      /* Dark purple theme preview styles */
      #notes-ext-sidebar-root.dark-purple #notes-ext-preview { background: #251a3f; color: #ede9fe; border-color: #3a2a64; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-preview h1,
      #notes-ext-sidebar-root.dark-purple #notes-ext-preview h2,
      #notes-ext-sidebar-root.dark-purple #notes-ext-preview h3 { color: #f3f0ff; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-preview code { background: #3a2a64; color: #ede9fe; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-preview pre { background: #1e1235; border-color: #3a2a64; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-preview blockquote { border-left-color: #3a2a64; color: #c7b9e6; }
      #notes-ext-sidebar-root.dark-purple #notes-ext-preview hr { border-top-color: #3a2a64; }
      
            /* Formatting toolbar styles */
      #notes-ext-format-toolbar { 
        background: #ffffff; 
        color: #111827; 
        border-color: #d1d5db;
      }
      .notes-ext-format-btn { 
        background: #f9fafb !important; 
        color: #374151 !important; 
        border-color: #d1d5db !important;
      }
      .notes-ext-format-btn:hover { 
        background: #f3f4f6 !important; 
        transform: translateY(-1px); 
      }
      .notes-ext-format-btn:active { transform: translateY(0); }

      /* Dark theme formatting toolbar */
      #notes-ext-sidebar-root.dark #notes-ext-format-toolbar { 
        background: #0f172a; 
        color: #e5e7eb; 
        border-color: #374151; 
      }
      #notes-ext-sidebar-root.dark .notes-ext-format-btn { 
        background: #1f2937 !important; 
        color: #e5e7eb !important; 
        border-color: #374151 !important; 
      }
      #notes-ext-sidebar-root.dark .notes-ext-format-btn:hover { 
        background: #374151 !important; 
      }

      /* Dark blue theme formatting toolbar */
      #notes-ext-sidebar-root.dark-blue #notes-ext-format-toolbar { 
        background: #0b2239; 
        color: #e6f0ff; 
        border-color: #1b3354; 
      }
      #notes-ext-sidebar-root.dark-blue .notes-ext-format-btn { 
        background: #1b3354 !important; 
        color: #e6f0ff !important; 
        border-color: #2c4a73 !important; 
      }
      #notes-ext-sidebar-root.dark-blue .notes-ext-format-btn:hover { 
        background: #2c4a73 !important; 
      }

      /* Dark purple theme formatting toolbar */
      #notes-ext-sidebar-root.dark-purple #notes-ext-format-toolbar { 
        background: #251a3f; 
        color: #ede9fe; 
        border-color: #3a2a64; 
      }
      #notes-ext-sidebar-root.dark-purple .notes-ext-format-btn { 
        background: #3a2a64 !important; 
        color: #ede9fe !important; 
        border-color: #4a3578 !important; 
      }
      #notes-ext-sidebar-root.dark-purple .notes-ext-format-btn:hover { 
        background: #4a3578 !important; 
      }

      /* Toolbar header theme styles */
      #notes-ext-sidebar-root.dark #notes-ext-format-toolbar .toolbar-header { 
        background: rgba(255,255,255,0.05); 
        border-bottom-color: #374151; 
      }
      #notes-ext-sidebar-root.dark-blue #notes-ext-format-toolbar .toolbar-header { 
        background: rgba(255,255,255,0.05); 
        border-bottom-color: #1b3354; 
      }
      #notes-ext-sidebar-root.dark-purple #notes-ext-format-toolbar .toolbar-header { 
        background: rgba(255,255,255,0.05); 
        border-bottom-color: #3a2a64; 
      }
    `;
    document.documentElement.appendChild(style);
  }

  function createSidebar() {
    if (sidebarRoot) return;
    ensureStyles();

    sidebarRoot = document.createElement("div");
    sidebarRoot.id = "notes-ext-sidebar-root";
    sidebarRoot.setAttribute("role", "complementary");
    sidebarRoot.setAttribute("aria-label", "Notes Sidebar");

    // Resizer handle
    const resizer = document.createElement("div");
    resizer.id = "notes-ext-resizer";
    sidebarRoot.appendChild(resizer);

    // Invisible hover edge to allow expand when collapsed
    const hoverEdge = document.createElement("div");
    hoverEdge.id = "notes-ext-hover-edge";
    document.body.appendChild(hoverEdge);

    // Header
    const header = document.createElement("div");
    header.id = "notes-ext-sidebar-header";
    const row1 = document.createElement("div");
    row1.id = "notes-ext-header-row1";
    const row1Left = document.createElement("div");
    row1Left.id = "notes-ext-header-left";
    const row1Right = document.createElement("div");
    row1Right.id = "notes-ext-header-right";
    const row2 = document.createElement("div");
    row2.id = "notes-ext-header-row2";
    const title = document.createElement("div");
    title.id = "notes-ext-sidebar-title";
    title.textContent = getTitleForScope();

    const themeToggle = document.createElement("button");
    themeToggle.className = "notes-ext-btn";
    themeToggle.title = "Theme";
    themeToggle.textContent = "🌓";

    const scopeSelect = document.createElement("select");
    scopeSelect.className = "notes-ext-btn";
    scopeSelect.style.padding = "4px 6px";
    scopeSelect.innerHTML = `
      <option value="page">Page</option>
      <option value="site">Site</option>
      <option value="url">Full URL</option>
      <option value="global">Global</option>
    `;

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "Search notes";
    searchInput.className = "notes-ext-btn";
    searchInput.style.minWidth = "120px";
    const searchPrev = document.createElement("button");
    searchPrev.className = "notes-ext-btn";
    searchPrev.textContent = "‹";
    const searchNext = document.createElement("button");
    searchNext.className = "notes-ext-btn";
    searchNext.textContent = "›";
    const searchModeBtn = document.createElement("button");
    searchModeBtn.className = "notes-ext-btn";
    searchModeBtn.id = "notes-ext-search-mode-btn";
    searchModeBtn.title = "Toggle search mode (Notes/Site)";
    searchModeBtn.textContent = "Search: Site";
    const searchCount = document.createElement("span");
    searchCount.style.fontSize = "11px";
    searchCount.style.alignSelf = "center";
    searchCount.style.color = "#6b7280";
    searchCount.textContent = "0/0";

    const closeBtn = document.createElement("button");
    closeBtn.id = "notes-ext-close-btn";
    closeBtn.setAttribute("title", "Close");
    closeBtn.textContent = "×";
    const pinTopBtn = document.createElement("button");
    pinTopBtn.id = "notes-ext-pin-btn";
    pinTopBtn.title = "Pin sidebar";
    pinTopBtn.textContent = "📌";
    const settingsBtn = document.createElement("button");
    settingsBtn.className = "notes-ext-btn";
    settingsBtn.title = "Settings";
    settingsBtn.textContent = "⚙";
    row1Left.appendChild(pinTopBtn);
    row1Left.appendChild(title);
    row1Right.appendChild(closeBtn);
    row1.appendChild(row1Left);
    row1.appendChild(row1Right);
    const placementSelect = document.createElement("select");
    placementSelect.className = "notes-ext-btn";
    placementSelect.style.padding = "4px 6px";
    placementSelect.innerHTML = `
      <option value="right">Right</option>
      <option value="left">Left</option>
      <option value="top">Top</option>
      <option value="bottom">Bottom</option>
    `;

    row2.appendChild(themeToggle);
    row2.appendChild(scopeSelect);
    row2.appendChild(searchInput);
    row2.appendChild(searchPrev);
    row2.appendChild(searchNext);
    row2.appendChild(searchModeBtn);
    row2.appendChild(searchCount);
    row2.appendChild(placementSelect);
    row2.appendChild(settingsBtn);
    header.appendChild(row1);
    header.appendChild(row2);

    // Body
    const body = document.createElement("div");
    body.id = "notes-ext-sidebar-body";

    const buttons = document.createElement("div");
    buttons.className = "notes-ext-buttons";
    const clearBtn = document.createElement("button");
    clearBtn.className = "notes-ext-btn";
    clearBtn.textContent = "Clear Notes";
    const resetGlobalBtn = document.createElement("button");
    resetGlobalBtn.className = "notes-ext-btn";
    resetGlobalBtn.textContent = "Reset Global Save";
    const resetBtn = document.createElement("button");
    resetBtn.className = "notes-ext-btn";
    resetBtn.textContent = "Reset Stats";
    const exportBtn = document.createElement("button");
    exportBtn.className = "notes-ext-btn";
    exportBtn.textContent = "Export";
    const importBtn = document.createElement("button");
    importBtn.className = "notes-ext-btn";
    importBtn.textContent = "Import";
    const copyBtn = document.createElement("button");
    copyBtn.className = "notes-ext-btn";
    copyBtn.textContent = "Copy";
    const quickNoteBtn = document.createElement("button");
    quickNoteBtn.className = "notes-ext-btn";
    quickNoteBtn.textContent = "Quick Note";
    quickNoteBtn.title = "Add timestamped note";
    const templatesBtn = document.createElement("button");
    templatesBtn.className = "notes-ext-btn";
    templatesBtn.textContent = "Templates";
    templatesBtn.title = "Insert note templates";
    const previewBtn = document.createElement("button");
    previewBtn.className = "notes-ext-btn";
    previewBtn.textContent = "Preview";
    previewBtn.title = "Toggle markdown preview";
    buttons.appendChild(clearBtn);
    buttons.appendChild(resetGlobalBtn);
    buttons.appendChild(resetBtn);
    buttons.appendChild(exportBtn);
    buttons.appendChild(importBtn);
    buttons.appendChild(copyBtn);
    buttons.appendChild(quickNoteBtn);
    buttons.appendChild(templatesBtn);
    buttons.appendChild(previewBtn);

    const textarea = document.createElement("textarea");
    textarea.id = "notes-ext-textarea";
    textarea.placeholder = "Type notes for this page...";

    // Markdown formatting toolbar
    const formatToolbar = document.createElement("div");
    formatToolbar.id = "notes-ext-format-toolbar";
    formatToolbar.style.cssText = `
      border: 1px solid #d1d5db;
      border-top: none;
      border-radius: 0 0 6px 6px;
      background: inherit;
      font-size: 12px;
    `;

    // Toolbar header with collapse button
    const toolbarHeader = document.createElement("div");
    toolbarHeader.className = "toolbar-header";
    toolbarHeader.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      border-bottom: 1px solid #e5e7eb;
      background: rgba(0,0,0,0.02);
      cursor: pointer;
    `;

    const toolbarTitle = document.createElement("span");
    toolbarTitle.textContent = "Formatting";
    toolbarTitle.style.cssText = `
      font-size: 11px;
      font-weight: 500;
      color: #6b7280;
    `;

    const collapseBtn = document.createElement("span");
    collapseBtn.textContent = "▼";
    collapseBtn.style.cssText = `
      font-size: 10px;
      color: #6b7280;
      transition: transform 0.2s ease;
    `;

    toolbarHeader.appendChild(toolbarTitle);
    toolbarHeader.appendChild(collapseBtn);

    // Buttons container
    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 8px;
    `;

    // Create formatting buttons
    const formatButtons = [
      {
        text: "B",
        title: "Bold (Ctrl+B)",
        action: () => insertFormatting("**", "**", "bold text"),
      },
      {
        text: "I",
        title: "Italic (Ctrl+I)",
        action: () => insertFormatting("*", "*", "italic text"),
      },
      {
        text: "S",
        title: "Strikethrough",
        action: () => insertFormatting("~~", "~~", "strikethrough"),
      },
      {
        text: "`",
        title: "Inline Code (Ctrl+`)",
        action: () => insertFormatting("`", "`", "code"),
      },
      { text: "H1", title: "Header 1", action: () => insertHeader(1) },
      { text: "H2", title: "Header 2", action: () => insertHeader(2) },
      { text: "H3", title: "Header 3", action: () => insertHeader(3) },
      {
        text: "🔗",
        title: "Link (Ctrl+K)",
        action: () => insertFormatting("[", "](https://)", "link text"),
      },
      {
        text: "•",
        title: "Bullet List (Ctrl+L)",
        action: () => insertBulletPoint(),
      },
      {
        text: "1.",
        title: "Numbered List",
        action: () => insertNumberedList(),
      },
      { text: "☐", title: "Checkbox", action: () => insertCheckbox(false) },
      { text: "☑", title: "Checked Box", action: () => insertCheckbox(true) },
      { text: "❝", title: "Quote", action: () => insertQuote() },
      { text: "```", title: "Code Block", action: () => insertCodeBlock() },
      {
        text: "—",
        title: "Horizontal Rule",
        action: () => insertHorizontalRule(),
      },
    ];

    formatButtons.forEach((btn) => {
      const button = document.createElement("button");
      button.textContent = btn.text;
      button.title = btn.title;
      button.className = "notes-ext-format-btn";
      button.style.cssText = `
        padding: 4px 8px;
        border: 1px solid;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 500;
        font-size: 11px;
        min-width: 28px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: inherit;
        color: inherit;
        border-color: inherit;
      `;
      button.addEventListener("click", (e) => {
        e.preventDefault();
        btn.action();
        els.textarea.focus();
      });
      buttonsContainer.appendChild(button);
    });

    // Add collapse functionality
    toolbarHeader.addEventListener("click", () => {
      isToolbarCollapsed = !isToolbarCollapsed;
      if (isToolbarCollapsed) {
        buttonsContainer.style.display = "none";
        collapseBtn.textContent = "▶";
        collapseBtn.style.transform = "rotate(-90deg)";
        toolbarHeader.style.borderBottom = "none";
      } else {
        buttonsContainer.style.display = "flex";
        collapseBtn.textContent = "▼";
        collapseBtn.style.transform = "rotate(0deg)";
        toolbarHeader.style.borderBottom = "1px solid #e5e7eb";
      }
      updateTextareaRadius(true);
    });

    formatToolbar.appendChild(toolbarHeader);
    formatToolbar.appendChild(buttonsContainer);

    // Markdown preview container
    const previewContainer = document.createElement("div");
    previewContainer.id = "notes-ext-preview";
    previewContainer.style.cssText = `
      width: 100%;
      height: 50vh;
      min-height: 160px;
      padding: 10px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: transparent;
      overflow-y: auto;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      display: none;
    `;

    const footer = document.createElement("div");
    footer.id = "notes-ext-footer";
    footer.textContent = `Storage key prefix: ${EXT_PREFIX}`;
    const lastSaved = document.createElement("div");
    lastSaved.id = "notes-ext-last-saved";
    lastSaved.style.marginTop = "6px";
    const metrics = document.createElement("div");
    metrics.id = "notes-ext-metrics";
    metrics.style.marginTop = "6px";
    metrics.style.fontSize = "11px";
    footer.appendChild(lastSaved);
    footer.appendChild(metrics);

    // Stats (between textarea and footer)
    const stats = document.createElement("div");
    stats.id = "notes-ext-stats";
    stats.style.marginTop = "10px";
    const statsBar = document.createElement("div");
    statsBar.id = "notes-ext-stats-bar";
    const statsCaret = document.createElement("span");
    statsCaret.id = "notes-ext-stats-caret";
    statsCaret.textContent = "▸";
    const statsLabel = document.createElement("span");
    statsLabel.textContent = "Stats";
    const statsContent = document.createElement("div");
    statsContent.style.display = "none";
    statsContent.style.marginTop = "6px";
    statsContent.innerHTML = `
      <div class="notes-ext-stat-label">Visit count</div><div id="notes-ext-stat-visitcount">–</div>
      <div class="notes-ext-stat-label">First visit</div><div id="notes-ext-stat-first">–</div>
      <div class="notes-ext-stat-label">Last visit</div><div id="notes-ext-stat-last">–</div>
      <div class="notes-ext-stat-label">Time spent</div><div id="notes-ext-stat-total">–</div>
      <div class="notes-ext-stat-label">Avg. per visit</div><div id="notes-ext-stat-avg">–</div>
      <div class="notes-ext-stat-label">Time on domain</div><div id="notes-ext-stat-domain-total">–</div>
    `;
    statsBar.appendChild(statsCaret);
    statsBar.appendChild(statsLabel);
    stats.appendChild(statsBar);
    stats.appendChild(statsContent);

    // Tabs bar (above textarea)
    const tabsBar = document.createElement("div");
    tabsBar.id = "notes-ext-tabs";
    const addTabBtn = document.createElement("button");
    addTabBtn.id = "notes-ext-add-tab";
    addTabBtn.textContent = "+ New Tab";

    body.appendChild(buttons);
    body.appendChild(tabsBar);
    body.appendChild(textarea);
    body.appendChild(formatToolbar);
    body.appendChild(previewContainer);
    body.appendChild(stats);
    body.appendChild(footer);

    // vertical resizer for top/bottom
    const resizerVert = document.createElement("div");
    resizerVert.id = "notes-ext-resizer-vert";
    sidebarRoot.appendChild(header);
    sidebarRoot.appendChild(body);
    sidebarRoot.appendChild(resizerVert);
    document.documentElement.appendChild(sidebarRoot);

    // Cache elements
    els = {
      title,
      closeBtn,
      themeToggle,
      scopeSelect,
      searchInput,
      searchPrev,
      searchNext,
      searchCount,
      searchModeBtn,
      clearBtn,
      resetBtn,
      resetGlobalBtn,
      exportBtn,
      importBtn,
      copyBtn,
      quickNoteBtn,
      templatesBtn,
      previewBtn,
      settingsBtn,
      pinTopBtn,
      placementSelect,
      textarea,
      formatToolbar,
      toolbarHeader,
      buttonsContainer,
      collapseBtn,
      previewContainer,
      tabsBar,
      addTabBtn,
      statVisit: statsContent.querySelector("#notes-ext-stat-visitcount"),
      statFirst: statsContent.querySelector("#notes-ext-stat-first"),
      statLast: statsContent.querySelector("#notes-ext-stat-last"),
      statTotal: statsContent.querySelector("#notes-ext-stat-total"),
      statAvg: statsContent.querySelector("#notes-ext-stat-avg"),
      statDomainTotal: statsContent.querySelector(
        "#notes-ext-stat-domain-total"
      ),
      resizer,
      resizerVert,
      lastSaved,
      metrics,
      hoverEdge,
    };

    // Events
    els.closeBtn.addEventListener("click", () => hideSidebar());
    // Collapse behavior when not pinned
    els.hoverEdge.addEventListener("mouseenter", () => {
      if (!autoOpen && sidebarRoot.classList.contains("collapsed")) {
        sidebarRoot.classList.remove("collapsed");
        stickOpenUntilHover = false;
        lastExpandAtMs = Date.now();
      }
    });
    sidebarRoot.addEventListener("mouseenter", () => {
      if (collapseDelayTimer) {
        clearTimeout(collapseDelayTimer);
        collapseDelayTimer = null;
      }
    });
    sidebarRoot.addEventListener("mouseleave", () => {
      if (!autoOpen && sidebarVisible && !stickOpenUntilHover) {
        if (collapseDelayTimer) clearTimeout(collapseDelayTimer);
        const sinceExpand = Date.now() - lastExpandAtMs;
        const delay = sinceExpand < 400 ? 700 : 400;
        collapseDelayTimer = setTimeout(() => {
          sidebarRoot.classList.add("collapsed");
        }, delay);
      }
    });
    els.clearBtn.addEventListener("click", () => {
      if (confirm("Clear current tab?")) {
        setActiveTabContent("");
        if (els && els.textarea) {
          els.textarea.value = "";
        }
        // last saved will update via save path below
        const ms = Date.now();
        const active = getActiveTab();
        if (active) {
          const k = getTabLastSavedKey(active.id);
          if (isGlobalScope()) {
            extSetString(k, String(ms)).catch(() => {});
            // Broadcast tabs update to keep other pages in sync
            extSetString(getTabsKey(), JSON.stringify(tabs)).catch(() => {});
          } else {
            lsSet(k, String(ms));
          }
        }
        updateLastSavedDisplay(ms);
        updateMetrics();
      }
    });
    els.resetGlobalBtn.addEventListener("click", async () => {
      if (
        !confirm(
          "Reset all Global saved notes and tabs? This cannot be undone."
        )
      )
        return;
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          const all = await new Promise((res) =>
            chrome.storage.local.get(null, (r) => res(r || {}))
          );
          const keys = Object.keys(all).filter((k) =>
            k.startsWith(`${EXT_PREFIX}:__GLOBAL__:`)
          );
          await new Promise((res) =>
            chrome.storage.local.remove(keys, () => res())
          );
        }
      } catch {}
      // Local reset of in-memory state
      tabs = [];
      activeTabId = null;
      lastWrittenTabsJson = "";
      tabsVersionCounter = 0;
      ensureAtLeastOneTab(true);
      renderTabs();
      const t = getActiveTab();
      if (els && els.textarea) {
        els.textarea.value = (t && t.content) || "";
        updateMetrics();
      }
      getLastSavedForTab(activeTabId).then((ms) => updateLastSavedDisplay(ms));
      alert("Global save reset complete.");
    });
    els.resetBtn.addEventListener("click", () => {
      if (confirm("Reset stats for this page?")) {
        writeStats({
          firstVisitAt: null,
          lastVisitAt: null,
          visitCount: 0,
          totalTimeSpentMs: 0,
        });
        const s = incrementVisit(); // counts this session as a new visit
        updateStatsUI(s);
      }
    });

    els.exportBtn.addEventListener("click", handleExport);
    els.importBtn.addEventListener("click", handleImport);
    els.pinTopBtn.addEventListener("click", togglePinning);
    els.copyBtn.addEventListener("click", () => {
      const text = els.textarea.value || "";
      navigator.clipboard &&
        navigator.clipboard.writeText(text).catch(() => {});
    });
    els.quickNoteBtn.addEventListener("click", () => {
      const now = new Date();
      const timestamp = now.toLocaleString();
      const existing = els.textarea.value;
      const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
      const quickNote = `${prefix}📝 ${timestamp}\n\n`;
      const cursorPos = existing.length + quickNote.length;
      els.textarea.value = existing + quickNote;
      els.textarea.focus();
      els.textarea.setSelectionRange(cursorPos, cursorPos);
      // Trigger save
      setActiveTabContent(els.textarea.value);
      updateMetrics();
    });
    els.templatesBtn.addEventListener("click", () => {
      showTemplateMenu();
    });
    els.previewBtn.addEventListener("click", () => {
      togglePreview();
    });
    els.themeToggle.addEventListener("click", toggleTheme);
    els.scopeSelect.addEventListener("change", onScopeChange);
    els.placementSelect.addEventListener("change", onPlacementChange);
    els.searchInput.addEventListener("input", () => searchUpdate(true));
    els.searchPrev.addEventListener("click", () => searchStep(-1));
    els.searchNext.addEventListener("click", () => searchStep(1));
    els.searchModeBtn.addEventListener("click", () => {
      searchMode = searchMode === "site" ? "notes" : "site";
      els.searchModeBtn.textContent = `Search: ${
        searchMode === "site" ? "Site" : "Notes"
      }`;
      try {
        localStorage.setItem(SEARCH_MODE_KEY, searchMode);
      } catch {}
      searchUpdate(true);
    });
    els.settingsBtn.addEventListener("click", openSettings);
    statsBar.addEventListener("click", () => {
      const isOpen = statsContent.style.display !== "block";
      statsContent.style.display = isOpen ? "block" : "none";
      statsBar.classList.toggle("open", isOpen);
      if (isOpen) {
        statsContent.style.fontSize = "12px";
      }
    });

    // Debounced save with typing indicator
    let saveTimer = null;
    let isTyping = false;
    els.textarea.addEventListener("input", () => {
      if (saveTimer) clearTimeout(saveTimer);
      const value = els.textarea.value;

      // Show typing indicator
      if (!isTyping) {
        isTyping = true;
        if (els.lastSaved) {
          els.lastSaved.textContent = "Typing...";
          els.lastSaved.style.color = "#f59e0b"; // amber
        }
      }

      saveTimer = setTimeout(() => {
        isTyping = false;
        // Legacy single-note key for backward compatibility
        lsSet(getNotesKey(), value);
        // Update current tab content model
        setActiveTabContent(value);
        const now = Date.now();
        const active = getActiveTab();
        if (active) {
          const k = getTabLastSavedKey(active.id);
          if (isGlobalScope()) {
            extSetString(k, String(now)).catch(() => {});
            // Let writeTabs debounce handle broadcasting; avoid extra spam
          } else {
            lsSet(k, String(now));
          }
        }
        updateLastSavedDisplay(now);
        updateMetrics();
        updatePreviewContent(); // Update preview if in preview mode
        // Auto-open on notes
        try {
          sessionStorage.setItem(SIDEBAR_OPEN_SESSION_KEY, "1");
        } catch {}
      }, 400);
    });

    // Text formatting shortcuts
    els.textarea.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case "b":
            e.preventDefault();
            insertFormatting("**", "**", "bold text");
            break;
          case "i":
            e.preventDefault();
            insertFormatting("*", "*", "italic text");
            break;
          case "k":
            e.preventDefault();
            insertFormatting("[", "](https://)", "link text");
            break;
          case "`":
            e.preventDefault();
            insertFormatting("`", "`", "code");
            break;
          case "l":
            e.preventDefault();
            insertBulletPoint();
            break;
        }
      }

      // Smart auto-complete for templates (type "//" + template name)
      if (e.key === " " || e.key === "Enter") {
        const textarea = els.textarea;
        const cursorPos = textarea.selectionStart;
        const textBefore = textarea.value.substring(0, cursorPos);
        const lastLine = textBefore.split("\n").pop();

        // Check for template trigger
        const templateMatch = lastLine.match(/^\/\/(\w+)$/);
        if (templateMatch) {
          const templateName = templateMatch[1];
          if (templates[templateName]) {
            e.preventDefault();

            // Replace the trigger with template
            const newText =
              textarea.value.substring(0, cursorPos - lastLine.length) +
              templates[templateName] +
              textarea.value.substring(cursorPos);

            textarea.value = newText;
            const newCursorPos =
              cursorPos - lastLine.length + templates[templateName].length;
            textarea.setSelectionRange(newCursorPos, newCursorPos);

            // Trigger save
            setActiveTabContent(textarea.value);
            updateMetrics();
          }
        }
      }
    });

    function insertFormatting(prefix, suffix, placeholder) {
      const textarea = els.textarea;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = textarea.value.substring(start, end);
      const replacement = selectedText || placeholder;
      const newText =
        textarea.value.substring(0, start) +
        prefix +
        replacement +
        suffix +
        textarea.value.substring(end);

      textarea.value = newText;
      const newCursorPos = selectedText
        ? start + prefix.length + selectedText.length + suffix.length
        : start + prefix.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
      textarea.focus();

      // Trigger save
      setActiveTabContent(textarea.value);
      updateMetrics();
    }

    function insertBulletPoint() {
      const textarea = els.textarea;
      const start = textarea.selectionStart;
      const lines = textarea.value.substring(0, start).split("\n");
      const currentLine = lines[lines.length - 1];
      const isAtLineStart = currentLine.trim() === "";

      const bullet = isAtLineStart ? "• " : "\n• ";
      const newText =
        textarea.value.substring(0, start) +
        bullet +
        textarea.value.substring(start);

      textarea.value = newText;
      textarea.setSelectionRange(start + bullet.length, start + bullet.length);
      textarea.focus();

      // Trigger save
      setActiveTabContent(textarea.value);
      updateMetrics();
    }

    function togglePreview() {
      isPreviewMode = els.previewContainer.style.display !== "none";

      if (isPreviewMode) {
        // Switch to edit mode
        isPreviewMode = false;
        els.textarea.style.display = "block";
        els.previewContainer.style.display = "none";
        els.formatToolbar.style.display = "flex"; // Show formatting toolbar
        els.previewBtn.textContent = "Preview";
        els.previewBtn.style.background = "";
        els.previewBtn.style.color = "";
        updateTextareaRadius(true); // Rounded bottom when toolbar visible
        els.textarea.focus();
      } else {
        // Switch to preview mode
        isPreviewMode = true;
        updatePreviewContent();
        els.textarea.style.display = "none";
        els.previewContainer.style.display = "block";
        els.formatToolbar.style.display = "none"; // Hide formatting toolbar
        els.previewBtn.textContent = "Edit";
        els.previewBtn.style.background = "#3b82f6";
        els.previewBtn.style.color = "#ffffff";
      }
    }

    function updateTextareaRadius(toolbarVisible) {
      if (toolbarVisible && !isToolbarCollapsed) {
        els.textarea.style.borderRadius = "6px 6px 0 0";
        els.textarea.style.borderBottom = "none";
      } else {
        els.textarea.style.borderRadius = "6px";
        // Apply theme-appropriate border color
        const sidebarRoot = document.getElementById("notes-ext-sidebar-root");
        if (sidebarRoot.classList.contains("dark")) {
          els.textarea.style.borderBottom = "1px solid #374151";
        } else if (sidebarRoot.classList.contains("dark-blue")) {
          els.textarea.style.borderBottom = "1px solid #1b3354";
        } else if (sidebarRoot.classList.contains("dark-purple")) {
          els.textarea.style.borderBottom = "1px solid #3a2a64";
        } else {
          els.textarea.style.borderBottom = "1px solid #d1d5db";
        }
      }
    }

    function updatePreviewContent() {
      if (!isPreviewMode || !els.previewContainer) return;
      const markdownText = els.textarea.value || "";
      const htmlContent = markdownText.trim()
        ? parseMarkdown(markdownText)
        : "<p><em>No content to preview</em></p>";
      els.previewContainer.innerHTML = htmlContent;
    }

    // Additional formatting functions for toolbar
    function insertHeader(level) {
      const textarea = els.textarea;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = textarea.value.substring(start, end);
      const headers = "#".repeat(level);
      const headerText = selectedText || `Header ${level}`;

      // Check if we're at the start of a line
      const beforeCursor = textarea.value.substring(0, start);
      const lineStart = beforeCursor.lastIndexOf("\n") + 1;
      const currentLineStart = textarea.value.substring(lineStart, start);

      const prefix = currentLineStart.trim() === "" ? "" : "\n";
      const suffix = "\n";
      const replacement = `${prefix}${headers} ${headerText}${suffix}`;

      textarea.value =
        textarea.value.substring(0, start) +
        replacement +
        textarea.value.substring(end);
      const newPos = start + prefix.length + headers.length + 1;
      textarea.setSelectionRange(newPos, newPos + headerText.length);
      textarea.focus();

      setActiveTabContent(textarea.value);
      updateMetrics();
    }

    function insertNumberedList() {
      const textarea = els.textarea;
      const start = textarea.selectionStart;
      const selectedText = textarea.value.substring(
        start,
        textarea.selectionEnd
      );
      const lines = selectedText.split("\n");

      if (lines.length === 1 && lines[0] === "") {
        // Insert single numbered item
        const beforeCursor = textarea.value.substring(0, start);
        const lineStart = beforeCursor.lastIndexOf("\n") + 1;
        const currentLineStart = textarea.value.substring(lineStart, start);
        const prefix = currentLineStart.trim() === "" ? "" : "\n";
        const replacement = `${prefix}1. `;

        textarea.value =
          textarea.value.substring(0, start) +
          replacement +
          textarea.value.substring(start);
        textarea.setSelectionRange(
          start + replacement.length,
          start + replacement.length
        );
      } else {
        // Convert selected lines to numbered list
        const numberedLines = lines.map(
          (line, index) => `${index + 1}. ${line.trim()}`
        );
        const replacement = numberedLines.join("\n");

        textarea.value =
          textarea.value.substring(0, start) +
          replacement +
          textarea.value.substring(textarea.selectionEnd);
        textarea.setSelectionRange(start, start + replacement.length);
      }

      textarea.focus();
      setActiveTabContent(textarea.value);
      updateMetrics();
    }

    function insertCheckbox(checked) {
      const textarea = els.textarea;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = textarea.value.substring(start, end);

      const beforeCursor = textarea.value.substring(0, start);
      const lineStart = beforeCursor.lastIndexOf("\n") + 1;
      const currentLineStart = textarea.value.substring(lineStart, start);

      const checkmark = checked ? "x" : " ";
      const itemText = selectedText || "Task item";
      const prefix = currentLineStart.trim() === "" ? "" : "\n";
      const replacement = `${prefix}- [${checkmark}] ${itemText}`;

      textarea.value =
        textarea.value.substring(0, start) +
        replacement +
        textarea.value.substring(end);
      const newPos = start + prefix.length + 6; // "- [x] ".length
      textarea.setSelectionRange(newPos, newPos + itemText.length);
      textarea.focus();

      setActiveTabContent(textarea.value);
      updateMetrics();
    }

    function insertQuote() {
      const textarea = els.textarea;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = textarea.value.substring(start, end);

      if (selectedText) {
        // Quote selected text
        const lines = selectedText.split("\n");
        const quotedLines = lines.map((line) => `> ${line}`);
        const replacement = quotedLines.join("\n");

        textarea.value =
          textarea.value.substring(0, start) +
          replacement +
          textarea.value.substring(end);
        textarea.setSelectionRange(start, start + replacement.length);
      } else {
        // Insert new quote
        const beforeCursor = textarea.value.substring(0, start);
        const lineStart = beforeCursor.lastIndexOf("\n") + 1;
        const currentLineStart = textarea.value.substring(lineStart, start);

        const prefix = currentLineStart.trim() === "" ? "" : "\n";
        const replacement = `${prefix}> Your quote here`;

        textarea.value =
          textarea.value.substring(0, start) +
          replacement +
          textarea.value.substring(start);
        const newPos = start + prefix.length + 2; // "> ".length
        textarea.setSelectionRange(newPos, newPos + 15); // "Your quote here".length
      }

      textarea.focus();
      setActiveTabContent(textarea.value);
      updateMetrics();
    }

    function insertCodeBlock() {
      const textarea = els.textarea;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = textarea.value.substring(start, end);

      const beforeCursor = textarea.value.substring(0, start);
      const lineStart = beforeCursor.lastIndexOf("\n") + 1;
      const currentLineStart = textarea.value.substring(lineStart, start);

      const prefix = currentLineStart.trim() === "" ? "" : "\n";
      const codeText = selectedText || "Your code here";
      const replacement = `${prefix}\`\`\`\n${codeText}\n\`\`\`\n`;

      textarea.value =
        textarea.value.substring(0, start) +
        replacement +
        textarea.value.substring(end);
      const newPos = start + prefix.length + 4; // "```\n".length
      textarea.setSelectionRange(newPos, newPos + codeText.length);
      textarea.focus();

      setActiveTabContent(textarea.value);
      updateMetrics();
    }

    function insertHorizontalRule() {
      const textarea = els.textarea;
      const start = textarea.selectionStart;

      const beforeCursor = textarea.value.substring(0, start);
      const lineStart = beforeCursor.lastIndexOf("\n") + 1;
      const currentLineStart = textarea.value.substring(lineStart, start);

      const prefix = currentLineStart.trim() === "" ? "" : "\n";
      const replacement = `${prefix}---\n`;

      textarea.value =
        textarea.value.substring(0, start) +
        replacement +
        textarea.value.substring(start);
      textarea.setSelectionRange(
        start + replacement.length,
        start + replacement.length
      );
      textarea.focus();

      setActiveTabContent(textarea.value);
      updateMetrics();
    }

    function showTemplateMenu() {
      const existingMenu = document.getElementById("notes-ext-template-menu");
      if (existingMenu) {
        existingMenu.remove();
        return;
      }

      const menu = document.createElement("div");
      menu.id = "notes-ext-template-menu";
      menu.style.cssText = `
        position: absolute;
        top: 40px;
        right: 12px;
        width: 200px;
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        box-shadow: 0 6px 24px rgba(0,0,0,0.2);
        padding: 8px;
        z-index: 2147483649;
        font-size: 12px;
      `;

      // Theme support for all variants
      if (sidebarRoot.classList.contains("dark")) {
        menu.style.background = "#0f172a";
        menu.style.color = "#e5e7eb";
        menu.style.borderColor = "#1f2937";
      } else if (sidebarRoot.classList.contains("dark-blue")) {
        menu.style.background = "#0b2239";
        menu.style.color = "#e6f0ff";
        menu.style.borderColor = "#1b3354";
      } else if (sidebarRoot.classList.contains("dark-purple")) {
        menu.style.background = "#251a3f";
        menu.style.color = "#ede9fe";
        menu.style.borderColor = "#3a2a64";
      } else {
        // Light theme (default)
        menu.style.background = "#ffffff";
        menu.style.color = "#111827";
        menu.style.borderColor = "#d1d5db";
      }

      Object.entries(templates).forEach(([name, template]) => {
        const item = document.createElement("div");
        item.style.cssText = `
          padding: 8px;
          cursor: pointer;
          border-radius: 4px;
          margin: 2px 0;
        `;
        item.textContent = `${name} - ${template
          .split("\n")[0]
          .replace(/[#*]/g, "")
          .trim()}`;

        item.addEventListener("mouseenter", () => {
          if (sidebarRoot.classList.contains("dark")) {
            item.style.backgroundColor = "#1f2937";
          } else if (sidebarRoot.classList.contains("dark-blue")) {
            item.style.backgroundColor = "#1b3354";
          } else if (sidebarRoot.classList.contains("dark-purple")) {
            item.style.backgroundColor = "#3a2a64";
          } else {
            item.style.backgroundColor = "#f3f4f6";
          }
        });
        item.addEventListener("mouseleave", () => {
          item.style.backgroundColor = "";
        });

        item.addEventListener("click", () => {
          insertTemplate(template);
          menu.remove();
        });

        menu.appendChild(item);
      });

      // Add instructions
      const instructions = document.createElement("div");
      instructions.style.cssText = `
        margin-top: 8px;
        padding-top: 8px;
        font-size: 10px;
      `;

      // Set border and text color based on theme
      if (sidebarRoot.classList.contains("dark")) {
        instructions.style.borderTop = "1px solid #1f2937";
        instructions.style.color = "#9ca3af";
      } else if (sidebarRoot.classList.contains("dark-blue")) {
        instructions.style.borderTop = "1px solid #1b3354";
        instructions.style.color = "#a5b8d8";
      } else if (sidebarRoot.classList.contains("dark-purple")) {
        instructions.style.borderTop = "1px solid #3a2a64";
        instructions.style.color = "#c7b9e6";
      } else {
        instructions.style.borderTop = "1px solid #e5e7eb";
        instructions.style.color = "#6b7280";
      }

      instructions.textContent =
        "Tip: Type //template_name + space to auto-insert";
      menu.appendChild(instructions);

      sidebarRoot.appendChild(menu);

      // Close on outside click
      setTimeout(() => {
        document.addEventListener("click", function closeMenu(e) {
          if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener("click", closeMenu);
          }
        });
      }, 100);
    }

    function insertTemplate(template) {
      const textarea = els.textarea;
      const cursorPos = textarea.selectionStart;
      const existing = textarea.value;
      const prefix = existing && !existing.endsWith("\n") ? "\n\n" : "";

      const newText =
        existing.substring(0, cursorPos) +
        prefix +
        template +
        existing.substring(cursorPos);

      textarea.value = newText;
      const newCursorPos = cursorPos + prefix.length + template.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
      textarea.focus();

      // Trigger save
      setActiveTabContent(textarea.value);
      updateMetrics();
    }

    // Resizer drag (horizontal for left/right)
    let resizing = false;
    let resizeStartX = 0;
    let startWidth = 360;
    const minWidth = 260;
    const maxWidth = Math.min(window.innerWidth * 0.9, 800);

    const onMouseMove = (e) => {
      if (!resizing) return;
      let dx = resizeStartX - e.clientX; // right placement: dragging left increases width
      if (currentPlacement === "left") {
        dx = -dx; // invert for left placement
      }
      const newW = Math.min(maxWidth, Math.max(minWidth, startWidth + dx));
      sidebarRoot.style.width = newW + "px";
    };
    const onMouseUp = () => {
      if (!resizing) return;
      try {
        localStorage.setItem(
          WIDTH_KEY,
          String(parseInt(sidebarRoot.style.width, 10) || 360)
        );
      } catch {}
      resizing = false;
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      // If pinned, update page offset for current placement
      if (autoOpen) {
        try {
          const w = parseInt(sidebarRoot.style.width || "360", 10);
          document.documentElement.style.paddingRight = "";
          document.documentElement.style.paddingLeft = "";
          if (currentPlacement === "right")
            document.documentElement.style.paddingRight = `${w}px`;
          if (currentPlacement === "left")
            document.documentElement.style.paddingLeft = `${w}px`;
        } catch {}
      }
    };
    els.resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      resizing = true;
      resizeStartX = e.clientX;
      const rect = sidebarRoot.getBoundingClientRect();
      startWidth = rect.width;
      window.addEventListener("mousemove", onMouseMove, true);
      window.addEventListener("mouseup", onMouseUp, true);
    });

    // Resizer drag (vertical for top/bottom)
    let vResizing = false;
    let resizeStartY = 0;
    let startHeight = 220;
    const minHeight = 120;
    const maxHeight = Math.min(window.innerHeight * 0.8, 600);

    const onMouseMoveV = (e) => {
      if (!vResizing) return;
      const dy = e.clientY - resizeStartY;
      let newH = startHeight;
      if (currentPlacement === "top") {
        newH = Math.min(maxHeight, Math.max(minHeight, startHeight + dy));
      } else if (currentPlacement === "bottom") {
        newH = Math.min(maxHeight, Math.max(minHeight, startHeight - dy));
      }
      sidebarRoot.style.height = newH + "px";
      if (autoOpen) {
        if (currentPlacement === "top")
          document.documentElement.style.paddingTop = `${newH}px`;
        if (currentPlacement === "bottom")
          document.documentElement.style.paddingBottom = `${newH}px`;
      }
    };

    const onMouseUpV = () => {
      if (!vResizing) return;
      try {
        localStorage.setItem(
          HEIGHT_KEY,
          String(parseInt(sidebarRoot.style.height, 10) || 220)
        );
      } catch {}
      vResizing = false;
      window.removeEventListener("mousemove", onMouseMoveV, true);
      window.removeEventListener("mouseup", onMouseUpV, true);
    };

    els.resizerVert.addEventListener("mousedown", (e) => {
      if (currentPlacement !== "top" && currentPlacement !== "bottom") return;
      e.preventDefault();
      vResizing = true;
      resizeStartY = e.clientY;
      const rect = sidebarRoot.getBoundingClientRect();
      startHeight = rect.height;
      window.addEventListener("mousemove", onMouseMoveV, true);
      window.addEventListener("mouseup", onMouseUpV, true);
    });
  }

  // Tabs state and helpers
  let tabs = [];
  let activeTabId = null;
  let isPreviewMode = false;
  let isToolbarCollapsed = false;
  // Used to avoid applying stale async global loads over local user actions
  let globalInitCounter = 0;
  // Timestamp of most recent local change (add/close/rename/switch/save)
  let lastLocalChangeMs = 0;
  // Debounce and dedupe global storage writes
  let lastWrittenTabsJson = "";
  let tabsWriteTimer = null;
  let pendingTabsJson = null;
  let tabsVersionCounter = 0; // local incrementing version for global writes
  let globalDocVersion = 0; // monotonic version for global doc (tabs + activeId)

  function genId() {
    try {
      return crypto.randomUUID();
    } catch (_) {
      return (
        "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      );
    }
  }

  function readTabs() {
    const raw = lsGet(getTabsKey());
    if (!raw) return null;
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
      return null;
    } catch (_) {
      return null;
    }
  }

  function writeTabs() {
    try {
      const payload = JSON.stringify(tabs);
      if (isGlobalScope()) {
        // Dedupe identical writes and debounce, but write a single global doc with version
        const doc = {
          version: (globalDocVersion + 1) >>> 0,
          tabs,
          activeTabId,
        };
        const docJson = (() => {
          try {
            return JSON.stringify(doc);
          } catch (_) {
            return payload; // fallback
          }
        })();
        if (!lastWrittenTabsJson) {
          lastLocalChangeMs = Date.now();
          globalDocVersion = doc.version;
          extSet({
            [getGlobalDocKey()]: docJson,
          }).catch(() => {});
          lastWrittenTabsJson = payload;
          return;
        }
        if (payload === lastWrittenTabsJson && !tabsWriteTimer) return;
        pendingTabsJson = payload;
        if (tabsWriteTimer) clearTimeout(tabsWriteTimer);
        tabsWriteTimer = setTimeout(() => {
          tabsWriteTimer = null;
          const toWrite = pendingTabsJson;
          pendingTabsJson = null;
          if (typeof toWrite === "string" && toWrite !== lastWrittenTabsJson) {
            lastLocalChangeMs = Date.now();
            const newDoc = {
              version: (globalDocVersion + 1) >>> 0,
              tabs,
              activeTabId,
            };
            let newDocJson = docJson;
            try {
              newDocJson = JSON.stringify(newDoc);
            } catch {}
            globalDocVersion = newDoc.version;
            extSet({ [getGlobalDocKey()]: newDocJson }).catch(() => {});
            lastWrittenTabsJson = toWrite;
          }
        }, 120);
      } else {
        lsSet(getTabsKey(), payload);
      }
    } catch (_) {}
  }

  function ensureAtLeastOneTab(seedFromLegacy) {
    if (tabs && tabs.length > 0) return;
    let initialContent = "";
    if (seedFromLegacy) {
      try {
        initialContent = lsGet(getNotesKey()) || "";
      } catch (_) {}
    }
    const id = genId();
    tabs = [
      {
        id,
        title: "Note 1",
        content: initialContent,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    activeTabId = id;
    writeTabs();
    try {
      if (isGlobalScope()) {
        extSetString(getActiveTabKey(), activeTabId).catch(() => {});
      } else {
        lsSet(getActiveTabKey(), activeTabId);
      }
    } catch (_) {}
  }

  function getActiveTab() {
    return tabs.find((t) => t.id === activeTabId) || null;
  }

  function setActiveTabContent(value) {
    const t = getActiveTab();
    if (!t) return;
    t.content = value;
    t.updatedAt = Date.now();
    lastLocalChangeMs = Date.now();
    writeTabs();
  }

  function setActiveTab(tabId) {
    if (!tabs.some((t) => t.id === tabId)) return;
    activeTabId = tabId;
    try {
      if (isGlobalScope()) {
        lastLocalChangeMs = Date.now();
        extSetString(getActiveTabKey(), activeTabId).catch(() => {});
      } else {
        lsSet(getActiveTabKey(), activeTabId);
      }
    } catch (_) {}
    // update UI
    if (els && els.textarea) {
      const t = getActiveTab();
      els.textarea.value = (t && t.content) || "";
      updateMetrics();
      updateLastSavedDisplay(null);
      getLastSavedForTab(activeTabId).then((ms) => updateLastSavedDisplay(ms));
    }
    renderTabs();
    // Persist any title/content changes after switching
    writeTabs();
  }

  function addTab() {
    const id = genId();
    const idx = tabs.length + 1;
    tabs.push({
      id,
      title: `Note ${idx}`,
      content: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    // Update UI immediately in all scopes, then persist doc
    activeTabId = id;
    renderTabs();
    if (els && els.textarea) {
      els.textarea.value = "";
      updateMetrics();
      updateLastSavedDisplay(null);
    }
    lastLocalChangeMs = Date.now();
    writeTabs();
  }

  function closeTab(tabId) {
    if (!tabs.some((t) => t.id === tabId)) return;
    if (tabs.length === 1) {
      // If only one tab, just clear it
      if (confirm("Only one tab exists. Clear its content?")) {
        setActiveTabContent("");
        if (els && els.textarea) {
          els.textarea.value = "";
        }
        const now = Date.now();
        const k = getTabLastSavedKey(tabId);
        if (isGlobalScope()) {
          extSetString(k, String(now))
            .then(() => {
              // Avoid forcing a tabs broadcast here; writeTabs will handle dedup/debounce
              return Promise.resolve();
            })
            .catch(() => {});
        } else {
          lsSet(k, String(now));
        }
        updateLastSavedDisplay(now);
        updateMetrics();
      }
      return;
    }
    // pick a neighbor to activate
    const idx = tabs.findIndex((t) => t.id === tabId);
    tabs = tabs.filter((t) => t.id !== tabId);
    if (activeTabId === tabId) {
      const newIdx = Math.max(0, idx - 1);
      activeTabId = tabs[newIdx].id;
    }
    renderTabs();
    const t = getActiveTab();
    if (els && els.textarea) {
      els.textarea.value = (t && t.content) || "";
      updateMetrics();
      getLastSavedForTab(activeTabId).then((ms) => updateLastSavedDisplay(ms));
    }
    lastLocalChangeMs = Date.now();
    writeTabs();
  }

  function renameTab(tabId) {
    const t = tabs.find((x) => x.id === tabId);
    if (!t) return;
    const nv = prompt("Rename tab", t.title || "");
    if (nv == null) return;
    t.title = String(nv).trim() || t.title;
    lastLocalChangeMs = Date.now();
    writeTabs();
    if (isGlobalScope()) {
      extSetString(getTabsKey(), JSON.stringify(tabs)).catch(() => {});
    }
    renderTabs();
  }

  function renderTabs() {
    if (!els || !els.tabsBar) return;
    const bar = els.tabsBar;
    bar.innerHTML = "";
    // render tabs
    tabs.forEach((t) => {
      const el = document.createElement("div");
      el.className = "notes-ext-tab" + (t.id === activeTabId ? " active" : "");
      const label = document.createElement("span");
      label.textContent = t.title || "Note";
      label.title = "Double-click to rename";
      el.appendChild(label);
      const x = document.createElement("button");
      x.className = "notes-ext-tab-close";
      x.type = "button";
      x.textContent = "×";
      x.title = "Close tab";
      el.appendChild(x);
      el.addEventListener("click", (ev) => {
        if (ev.target === x) return; // handled by close
        setActiveTab(t.id);
      });
      label.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        renameTab(t.id);
      });
      x.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const hasContent = !!(t.content && t.content.trim());
        if (
          !hasContent ||
          confirm("Close this tab? Unsaved content will be lost from this tab.")
        ) {
          closeTab(t.id);
        }
      });
      bar.appendChild(el);
    });
    // add button
    const addBtn = els.addTabBtn;
    addBtn.type = "button";
    addBtn.onclick = () => addTab();
    bar.appendChild(addBtn);
  }

  function initTabsForCurrentScope(seedFromLegacy) {
    if (isGlobalScope()) {
      const startedAt = ++globalInitCounter;
      const localBefore = (() => {
        try {
          return JSON.stringify(tabs);
        } catch (_) {
          return "";
        }
      })();
      // Load from extension storage
      extGet(getGlobalDocKey()).then((docObj) => {
        // If a newer init started while we were awaiting storage, drop this result
        if (globalInitCounter !== startedAt) return;
        const currentNow = (() => {
          try {
            return JSON.stringify(tabs);
          } catch (_) {
            return "";
          }
        })();
        const localChangedSinceStart = currentNow !== localBefore;
        let incomingDoc = null;
        try {
          const raw = docObj ? docObj[getGlobalDocKey()] : null;
          incomingDoc = raw ? JSON.parse(raw) : null;
        } catch {}
        if (
          !localChangedSinceStart &&
          incomingDoc &&
          typeof incomingDoc === "object"
        ) {
          const incVersion = Number(incomingDoc.version || 0);
          if (incVersion >= 0) globalDocVersion = incVersion;
          const incTabs = Array.isArray(incomingDoc.tabs)
            ? incomingDoc.tabs
            : [];
          const incActive = incomingDoc.activeTabId || null;
          tabs = incTabs;
          activeTabId = incActive;
          // baseline for dedupe
          try {
            lastWrittenTabsJson = JSON.stringify(tabs);
          } catch {
            lastWrittenTabsJson = "";
          }
          ensureAtLeastOneTab(seedFromLegacy);
          if (!activeTabId || !tabs.some((t) => t.id === activeTabId)) {
            activeTabId = tabs[0] ? tabs[0].id : null;
          }
        }
        renderTabs();
        const t = getActiveTab();
        if (els && els.textarea) {
          els.textarea.value = (t && t.content) || "";
          updateMetrics();
        }
        getLastSavedForTab(activeTabId).then((ms) =>
          updateLastSavedDisplay(ms)
        );
        // Keep legacy single-note key in sync locally for convenience
        lsSet(getNotesKey(), (t && t.content) || "");
      });
      return;
    }
    // Non-global: localStorage per scope
    tabs = readTabs() || [];
    activeTabId = lsGet(getActiveTabKey()) || null;
    ensureAtLeastOneTab(seedFromLegacy);
    if (!activeTabId || !tabs.some((t) => t.id === activeTabId)) {
      activeTabId = tabs[0].id;
      try {
        lsSet(getActiveTabKey(), activeTabId);
      } catch (_) {}
    }
    renderTabs();
    const t = getActiveTab();
    if (els && els.textarea) {
      els.textarea.value = (t && t.content) || "";
      updateMetrics();
    }
    getLastSavedForTab(activeTabId).then((ms) => updateLastSavedDisplay(ms));
    lsSet(getNotesKey(), (t && t.content) || "");
  }

  function getLastSavedForTab(tabId) {
    const k = getTabLastSavedKey(tabId);
    if (isGlobalScope()) {
      return extGetString(k).then((v) => {
        const n = Number(v || 0);
        return n && !isNaN(n) ? n : null;
      });
    }
    const n = Number(lsGet(k) || 0);
    return Promise.resolve(n && !isNaN(n) ? n : null);
  }

  function showSidebar(opts) {
    const reason = (opts && opts.reason) || "user"; // 'init' | 'user'
    if (!sidebarRoot) createSidebar();
    if (sidebarVisible) return;
    // apply persisted width/height
    try {
      const w = parseInt(localStorage.getItem(WIDTH_KEY) || "", 10);
      if (w && w >= 260 && w <= 800) sidebarRoot.style.width = w + "px";
    } catch {}
    try {
      const h = parseInt(localStorage.getItem(HEIGHT_KEY) || "", 10);
      if (h && h >= 120 && h <= 600) sidebarRoot.style.height = h + "px";
    } catch {}
    sidebarRoot.style.display = "block";
    sidebarVisible = true;
    if (els.hoverEdge) els.hoverEdge.style.display = "block";
    sessionStorage.setItem(SIDEBAR_OPEN_SESSION_KEY, "1");
    // Load tabs/notes
    initTabsForCurrentScope(true);
    // Update stats UI
    updateStatsUI(readStats());
    // Update last saved
    // handled in initTabsForCurrentScope per active tab
    applyThemeClass();
    // Init scope UI
    els.scopeSelect.value = currentScope;
    // Title per scope
    els.title.textContent = getTitleForScope();
    // Initial visibility: collapse when not pinned
    if (!autoOpen) {
      sidebarRoot.classList.add("collapsed");
    } else {
      sidebarRoot.classList.remove("collapsed");
    }
    // Apply UI prefs
    applyUiPrefs();
    // Pin button label
    if (els.pinTopBtn) {
      els.pinTopBtn.classList.toggle("active", autoOpen);
      els.pinTopBtn.style.opacity = autoOpen ? "1" : "0.55";
    }
    // Placement UI
    if (els.placementSelect) {
      els.placementSelect.value = currentPlacement;
    }
    applyPlacement();
    // If opened by explicit user action (shortcut/context), keep open until first hover on panel
    if (reason !== "init") {
      stickOpenUntilHover = true;
      sidebarRoot.addEventListener(
        "mouseenter",
        () => {
          stickOpenUntilHover = false;
        },
        { once: true }
      );
    } else {
      stickOpenUntilHover = false;
    }
  }

  function hideSidebar() {
    if (!sidebarRoot) return;
    sidebarRoot.style.display = "none";
    sidebarVisible = false;
    sessionStorage.removeItem(SIDEBAR_OPEN_SESSION_KEY);
    if (els.hoverEdge) els.hoverEdge.style.display = "none";
  }

  function formatDateTime(ms) {
    if (!ms) return "–";
    try {
      const d = new Date(ms);
      return d.toLocaleString();
    } catch (_) {
      return "–";
    }
  }

  function formatDuration(ms) {
    if (!ms || ms <= 0) return "0s";
    const s = Math.floor(ms / 1000);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const parts = [];
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(" ");
  }

  function updateStatsUI(stats) {
    if (!sidebarVisible || !els.statVisit) return;
    const avg =
      stats.visitCount > 0
        ? Math.floor(stats.totalTimeSpentMs / stats.visitCount)
        : 0;
    els.statVisit.textContent = String(stats.visitCount);
    els.statFirst.textContent = formatDateTime(stats.firstVisitAt);
    els.statLast.textContent = formatDateTime(stats.lastVisitAt);
    els.statTotal.textContent = formatDuration(stats.totalTimeSpentMs);
    els.statAvg.textContent = formatDuration(avg);
    // Domain time
    const ds = readDomainStats();
    if (els.statDomainTotal) {
      els.statDomainTotal.textContent = formatDuration(ds.totalTimeSpentMs);
    }
    updateMetrics();
  }

  // ---- Feature helpers ----
  function applyThemeClass() {
    if (!sidebarRoot) return;
    // Support multiple dark palettes
    const theme = currentTheme;
    sidebarRoot.classList.remove("dark", "dark-blue", "dark-purple");
    if (theme === "dark" || theme === "auto") {
      sidebarRoot.classList.add("dark");
    } else if (theme === "dark-blue") {
      sidebarRoot.classList.add("dark-blue");
    } else if (theme === "dark-purple") {
      sidebarRoot.classList.add("dark-purple");
    }
  }

  function toggleTheme() {
    // cycle: dark (default) -> dark-blue -> dark-purple -> dark
    const order = ["dark", "dark-blue", "dark-purple"];
    const idx = order.indexOf(currentTheme);
    currentTheme = order[(idx + 1) % order.length];
    try {
      localStorage.setItem(THEME_KEY, currentTheme);
    } catch {}
    applyThemeClass();
  }

  function onScopeChange() {
    const scope = els.scopeSelect.value;
    if (!SCOPES[scope]) return;
    currentScope = scope;
    try {
      localStorage.setItem(SCOPE_KEY, currentScope);
    } catch {}
    // Reload UI for new scope
    initTabsForCurrentScope(true);
    updateStatsUI(readStats());
    els.title.textContent = getTitleForScope();
  }

  function updateLastSavedDisplay(ms) {
    if (!els.lastSaved) return;
    const text = ms ? `Last saved: ${formatDateTime(ms)}` : "Not saved yet";
    els.lastSaved.textContent = text;

    // Add visual save indicator
    if (ms && Date.now() - ms < 2000) {
      els.lastSaved.style.color = "#059669"; // green
      setTimeout(() => {
        if (els.lastSaved) els.lastSaved.style.color = "";
      }, 2000);
    }
  }

  let searchMatches = [];
  let searchIndex = -1;

  function searchUpdate(resetIndex) {
    const q = (els.searchInput.value || "").toLowerCase();
    const text =
      searchMode === "notes"
        ? els.textarea.value || ""
        : document.body.innerText || "";
    searchMatches = [];
    if (q) {
      let i = 0;
      const lower = text.toLowerCase();
      while ((i = lower.indexOf(q, i)) !== -1) {
        searchMatches.push(i);
        i += q.length;
      }
    }
    if (resetIndex) searchIndex = searchMatches.length ? 0 : -1;
    updateSearchUI();
    if (searchIndex >= 0) scrollToMatch(searchMatches[searchIndex]);
  }

  function updateSearchUI() {
    els.searchCount.textContent = searchMatches.length
      ? `${searchIndex + 1}/${searchMatches.length}`
      : `0/0`;
  }

  function searchStep(dir) {
    if (!searchMatches.length) return;
    searchIndex =
      (searchIndex + dir + searchMatches.length) % searchMatches.length;
    updateSearchUI();
    scrollToMatch(searchMatches[searchIndex]);
  }

  function scrollToMatch(pos) {
    if (searchMode === "notes") {
      const ta = els.textarea;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      const before = ta.value.slice(0, pos);
      const lines = before.split("\n").length;
      ta.scrollTop = Math.max(0, (lines - 2) * 16);
      return;
    }
    // Site mode: scroll window to approximate position by character heuristic
    const txt = document.body.innerText || "";
    const ratio = txt.length ? pos / txt.length : 0;
    const target = Math.max(
      0,
      (document.body.scrollHeight - window.innerHeight) * ratio
    );
    window.scrollTo({ top: target, behavior: "smooth" });
  }

  function updateMetrics() {
    if (!els.metrics) return;
    const text = els.textarea.value || "";
    const words = (text.trim().match(/\b\w+\b/g) || []).length;
    const chars = text.length;
    const lines = text.split("\n").length;
    const wpm = 200;
    const minutes = Math.max(1, Math.round(words / wpm));
    els.metrics.textContent = `Words: ${words} • Chars: ${chars} • Lines: ${lines} • Read: ~${minutes} min`;
  }

  function handleExport() {
    const data = collectAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `notes-sidebar-backup-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(String(reader.result || "{}"));
          if (obj && typeof obj === "object") {
            for (const [k, v] of Object.entries(obj)) {
              try {
                localStorage.setItem(
                  k,
                  typeof v === "string" ? v : JSON.stringify(v)
                );
              } catch {}
            }
            // Reload current scope visuals (tabs + textarea)
            initTabsForCurrentScope(true);
            updateStatsUI(readStats());
          }
        } catch {}
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function collectAllData() {
    const dump = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(`${EXT_PREFIX}:`)) continue;
        dump[k] = localStorage.getItem(k);
      }
    } catch {}
    return dump;
  }

  function togglePinning() {
    // Pin means: keep sidebar open across navigations within same tab if URL changes to same scope
    autoOpen = !autoOpen;
    try {
      localStorage.setItem(AUTO_OPEN_KEY, autoOpen ? "1" : "0");
    } catch {}
    if (sidebarRoot) {
      if (autoOpen) {
        sidebarRoot.classList.remove("collapsed");
      }
    }
    if (els.pinTopBtn) {
      els.pinTopBtn.classList.toggle("active", autoOpen);
      // Gray out when not pinned
      els.pinTopBtn.style.opacity = autoOpen ? "1" : "0.55";
    }
    // When pinned, push page content left via padding so nothing is obscured
    try {
      document.documentElement.style.paddingRight = "";
      document.documentElement.style.paddingLeft = "";
      document.documentElement.style.paddingTop = "";
      document.documentElement.style.paddingBottom = "";
      const w = parseInt(sidebarRoot.style.width || "360", 10);
      if (autoOpen) {
        if (currentPlacement === "right")
          document.documentElement.style.paddingRight = `${w}px`;
        if (currentPlacement === "left")
          document.documentElement.style.paddingLeft = `${w}px`;
        if (currentPlacement === "top")
          document.documentElement.style.paddingTop = `${parseInt(
            sidebarRoot.style.height || "220",
            10
          )}px`;
        if (currentPlacement === "bottom")
          document.documentElement.style.paddingBottom = `${parseInt(
            sidebarRoot.style.height || "220",
            10
          )}px`;
      }
    } catch {}
  }

  function onPlacementChange() {
    const p = els.placementSelect.value;
    if (!p) return;
    currentPlacement = p;
    try {
      localStorage.setItem(PLACEMENT_KEY, currentPlacement);
    } catch {}
    applyPlacement();
  }

  function applyPlacement() {
    if (!sidebarRoot) return;
    // reset positioning
    sidebarRoot.style.top = "";
    sidebarRoot.style.bottom = "";
    sidebarRoot.style.left = "";
    sidebarRoot.style.right = "";
    sidebarRoot.style.height = "";
    sidebarRoot.style.width = sidebarRoot.style.width || "360px";
    sidebarRoot.style.borderLeft = "none";
    sidebarRoot.style.borderTop = "none";
    sidebarRoot.style.borderRight = "none";
    sidebarRoot.style.borderBottom = "none";
    document.documentElement.style.paddingRight = "";
    document.documentElement.style.paddingLeft = "";
    document.documentElement.style.paddingTop = "";
    document.documentElement.style.paddingBottom = "";

    const pxWidthFromStorage = (() => {
      try {
        const saved = parseInt(localStorage.getItem(WIDTH_KEY) || "", 10);
        if (saved && saved >= 260 && saved <= 800) return saved;
      } catch {}
      return 360;
    })();
    let w = parseInt(sidebarRoot.style.width || "360", 10);

    // set base class for collapsed transforms and hover edge
    sidebarRoot.classList.remove(
      "pos-right",
      "pos-left",
      "pos-top",
      "pos-bottom"
    );
    if (els && els.hoverEdge) {
      els.hoverEdge.style.display = "block";
      els.hoverEdge.style.width = "12px";
      els.hoverEdge.style.height = "120px"; // small middle strip
      els.hoverEdge.style.top = "";
      els.hoverEdge.style.bottom = "";
      els.hoverEdge.style.left = "";
      els.hoverEdge.style.right = "";
    }
    if (els && els.resizer) {
      els.resizer.style.display = "block";
      els.resizer.style.left = "";
      els.resizer.style.right = "";
      els.resizer.style.cursor = "ew-resize";
    }

    if (currentPlacement === "right") {
      sidebarRoot.classList.add("pos-right");
      sidebarRoot.style.top = "0";
      sidebarRoot.style.right = "0";
      sidebarRoot.style.height = "100vh";
      sidebarRoot.style.borderLeft = "1px solid #e5e7eb";
      // Ensure a reasonable width when switching from top/bottom
      if (
        !/px$/.test(sidebarRoot.style.width) ||
        w > Math.min(window.innerWidth * 0.9, 800)
      ) {
        w = pxWidthFromStorage;
        sidebarRoot.style.width = `${w}px`;
      }
      if (els && els.resizer) {
        els.resizer.style.left = "-4px";
        els.resizer.style.right = "";
      }
      if (els && els.hoverEdge) {
        els.hoverEdge.style.right = "0";
        els.hoverEdge.style.top = "calc(50vh - 60px)";
      }
      if (autoOpen) document.documentElement.style.paddingRight = `${w}px`;
    } else if (currentPlacement === "left") {
      sidebarRoot.classList.add("pos-left");
      sidebarRoot.style.top = "0";
      sidebarRoot.style.left = "0";
      sidebarRoot.style.height = "100vh";
      sidebarRoot.style.borderRight = "1px solid #e5e7eb";
      // Ensure a reasonable width when switching from top/bottom
      if (
        !/px$/.test(sidebarRoot.style.width) ||
        w > Math.min(window.innerWidth * 0.9, 800)
      ) {
        w = pxWidthFromStorage;
        sidebarRoot.style.width = `${w}px`;
      }
      if (els && els.resizer) {
        els.resizer.style.right = "-4px";
        els.resizer.style.left = "";
      }
      if (els && els.hoverEdge) {
        els.hoverEdge.style.left = "0";
        els.hoverEdge.style.top = "calc(50vh - 60px)";
      }
      if (autoOpen) document.documentElement.style.paddingLeft = `${w}px`;
    } else if (currentPlacement === "top") {
      sidebarRoot.classList.add("pos-top");
      sidebarRoot.style.top = "0";
      sidebarRoot.style.right = "0";
      sidebarRoot.style.left = "0";
      sidebarRoot.style.height = `${parseInt(
        localStorage.getItem(HEIGHT_KEY) || "220",
        10
      )}px`;
      sidebarRoot.style.width = ""; // stretch between left/right
      sidebarRoot.style.borderBottom = "1px solid #e5e7eb";
      if (els && els.resizer) {
        els.resizer.style.display = "none";
      }
      if (els && els.hoverEdge) {
        els.hoverEdge.style.top = "0";
        els.hoverEdge.style.height = "12px";
        els.hoverEdge.style.width = "20vw";
        els.hoverEdge.style.left = "40vw";
      }
      if (els && els.resizerVert) {
        els.resizerVert.style.display = "block";
        els.resizerVert.style.top = "";
        els.resizerVert.style.bottom = "-4px";
      }
      if (autoOpen)
        document.documentElement.style.paddingTop = `${parseInt(
          sidebarRoot.style.height || "220",
          10
        )}px`;
    } else if (currentPlacement === "bottom") {
      sidebarRoot.classList.add("pos-bottom");
      sidebarRoot.style.bottom = "0";
      sidebarRoot.style.right = "0";
      sidebarRoot.style.left = "0";
      sidebarRoot.style.height = `${parseInt(
        localStorage.getItem(HEIGHT_KEY) || "220",
        10
      )}px`;
      sidebarRoot.style.width = ""; // stretch between left/right
      sidebarRoot.style.borderTop = "1px solid #e5e7eb";
      if (els && els.resizer) {
        els.resizer.style.display = "none";
      }
      if (els && els.hoverEdge) {
        els.hoverEdge.style.bottom = "0";
        els.hoverEdge.style.height = "12px";
        els.hoverEdge.style.width = "20vw";
        els.hoverEdge.style.left = "40vw";
      }
      if (els && els.resizerVert) {
        els.resizerVert.style.display = "block";
        els.resizerVert.style.bottom = "";
        els.resizerVert.style.top = "-4px";
      }
      if (autoOpen)
        document.documentElement.style.paddingBottom = `${parseInt(
          sidebarRoot.style.height || "220",
          10
        )}px`;
    }
  }

  function openSettings() {
    if (!els || !sidebarRoot) return;
    let panel = document.getElementById("notes-ext-settings");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "notes-ext-settings";
      panel.innerHTML = `
        <div class="notes-ext-settings-row"><strong>Defaults</strong></div>
        <div class="notes-ext-settings-row">
          <label style="min-width: 120px;">Default placement</label>
          <select id="notes-ext-settings-placement" class="notes-ext-btn" style="padding:4px 6px">
            <option value="right">Right</option>
            <option value="left">Left</option>
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
        </div>
        <div class="notes-ext-settings-row">
          <label style="min-width: 120px;">Default theme</label>
          <select id="notes-ext-settings-theme" class="notes-ext-btn" style="padding:4px 6px">
            <option value="dark">Dark</option>
            <option value="dark-blue">Dark Blue</option>
            <option value="dark-purple">Dark Purple</option>
          </select>
        </div>
        <div class="notes-ext-settings-row"><strong>Visibility</strong></div>
        <div class="notes-ext-settings-row"><label><input type="checkbox" data-k="clear"/> Hide "Clear Notes"</label></div>
        <div class="notes-ext-settings-row"><label><input type="checkbox" data-k="reset"/> Hide "Reset Stats"</label></div>
        <div class="notes-ext-settings-row"><label><input type="checkbox" data-k="export"/> Hide "Export"</label></div>
        <div class="notes-ext-settings-row"><label><input type="checkbox" data-k="import"/> Hide "Import"</label></div>
        <div class="notes-ext-settings-row"><label><input type="checkbox" data-k="pin"/> Hide "Pin"</label></div>
        <div class="notes-ext-settings-row"><label><input type="checkbox" data-k="copy"/> Hide "Copy"</label></div>
        <div class="notes-ext-settings-row"><label><input type="checkbox" data-k="search"/> Hide Search Controls</label></div>
        <div class="notes-ext-settings-actions">
          <button class="notes-ext-btn" id="notes-ext-settings-cancel">Cancel</button>
          <button class="notes-ext-btn" id="notes-ext-settings-save">Save</button>
        </div>
      `;
      sidebarRoot.appendChild(panel);
      panel
        .querySelector("#notes-ext-settings-cancel")
        .addEventListener("click", () => {
          panel.style.display = "none";
        });
      panel
        .querySelector("#notes-ext-settings-save")
        .addEventListener("click", () => {
          const inputs = panel.querySelectorAll(
            'input[type="checkbox"][data-k]'
          );
          const hidden = [];
          inputs.forEach((inp) => {
            if (inp.checked) hidden.push(inp.getAttribute("data-k"));
          });
          uiPrefs.hiddenButtons = hidden;
          // Save defaults
          const placementSel = panel.querySelector(
            "#notes-ext-settings-placement"
          );
          const themeSel = panel.querySelector("#notes-ext-settings-theme");
          if (placementSel && placementSel.value) {
            uiPrefs.defaultPlacement = placementSel.value;
          }
          if (themeSel && themeSel.value) {
            uiPrefs.defaultTheme = themeSel.value;
          }
          extSyncSet({ [UI_PREFS_KEY]: JSON.stringify(uiPrefs) }).catch(
            () => {}
          );
          applyUiPrefs();
          // Apply defaults immediately
          if (
            uiPrefs.defaultPlacement &&
            uiPrefs.defaultPlacement !== currentPlacement
          ) {
            currentPlacement = uiPrefs.defaultPlacement;
            try {
              localStorage.setItem(PLACEMENT_KEY, currentPlacement);
            } catch {}
            applyPlacement();
          }
          if (uiPrefs.defaultTheme && uiPrefs.defaultTheme !== currentTheme) {
            currentTheme = uiPrefs.defaultTheme;
            try {
              localStorage.setItem(THEME_KEY, currentTheme);
            } catch {}
            applyThemeClass();
          }
          panel.style.display = "none";
        });
    }
    // set current checked states
    const hidden = new Set((uiPrefs && uiPrefs.hiddenButtons) || []);
    const inputs = panel.querySelectorAll('input[type="checkbox"][data-k]');
    inputs.forEach((inp) => {
      inp.checked = hidden.has(inp.getAttribute("data-k"));
    });
    // set defaults initial values
    const placementSel = panel.querySelector("#notes-ext-settings-placement");
    const themeSel = panel.querySelector("#notes-ext-settings-theme");
    if (placementSel)
      placementSel.value =
        uiPrefs.defaultPlacement || currentPlacement || "right";
    if (themeSel)
      themeSel.value = uiPrefs.defaultTheme || currentTheme || "dark";
    panel.style.display = panel.style.display === "block" ? "none" : "block";
  }

  function applyUiPrefs() {
    const hidden =
      uiPrefs && uiPrefs.hiddenButtons
        ? new Set(uiPrefs.hiddenButtons)
        : new Set();
    if (!els) return;
    // map keys to elements
    const map = {
      clear: els.clearBtn,
      reset: els.resetBtn,
      export: els.exportBtn,
      import: els.importBtn,
      pin: null,
      copy: els.copyBtn,
      search: els.searchInput,
    };
    Object.entries(map).forEach(([k, el]) => {
      if (!el) return;
      el.style.display = hidden.has(k) ? "none" : "";
    });
    // search controls group visibility
    const showSearch = !hidden.has("search");
    if (els.searchPrev) els.searchPrev.style.display = showSearch ? "" : "none";
    if (els.searchNext) els.searchNext.style.display = showSearch ? "" : "none";
    if (els.searchCount)
      els.searchCount.style.display = showSearch ? "" : "none";
    if (els.searchModeBtn)
      els.searchModeBtn.style.display = showSearch ? "" : "none";
    // Apply default theme/placement if provided and not previously set
    if (
      uiPrefs &&
      uiPrefs.defaultTheme &&
      currentTheme !== uiPrefs.defaultTheme
    ) {
      currentTheme = uiPrefs.defaultTheme;
      try {
        localStorage.setItem(THEME_KEY, currentTheme);
      } catch {}
      applyThemeClass();
    }
    if (
      uiPrefs &&
      uiPrefs.defaultPlacement &&
      currentPlacement !== uiPrefs.defaultPlacement
    ) {
      currentPlacement = uiPrefs.defaultPlacement;
      try {
        localStorage.setItem(PLACEMENT_KEY, currentPlacement);
      } catch {}
      applyPlacement();
    }
  }

  // ---- Hook into lifecycle ----
  // Count visit on script load (document_start)
  const currentStats = incrementVisit();
  // Initialize activity tracking
  setActive(document.visibilityState === "visible" && document.hasFocus());
  startHeartbeat();

  document.addEventListener(
    "visibilitychange",
    handleVisibilityOrFocusChange,
    true
  );
  window.addEventListener("focus", handleVisibilityOrFocusChange, true);
  window.addEventListener("blur", handleVisibilityOrFocusChange, true);
  window.addEventListener(
    "pagehide",
    () => {
      flushTime();
      stopHeartbeat();
    },
    true
  );
  window.addEventListener(
    "beforeunload",
    () => {
      flushTime();
      stopHeartbeat();
    },
    true
  );

  // Detect in-page URL changes (SPAs) and update scoped data live
  function onUrlMaybeChanged() {
    if (location.href === lastUrl) return;
    const oldId = currentActiveId;
    // attribute time to previous id before switching
    flushTime();
    lastUrl = location.href;
    currentActiveId = computeId(currentScope);
    lastActivityMs = Date.now();
    if (oldId !== currentActiveId) {
      incrementVisit();
      if (sidebarVisible) {
        els.title.textContent = getTitleForScope();
        // re-init tabs for new scope id
        initTabsForCurrentScope(true);
        updateStatsUI(readStats());
      }
    }
  }

  function installNavigationObserver() {
    try {
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function () {
        const rv = origPush.apply(this, arguments);
        setTimeout(onUrlMaybeChanged, 0);
        return rv;
      };
      history.replaceState = function () {
        const rv = origReplace.apply(this, arguments);
        setTimeout(onUrlMaybeChanged, 0);
        return rv;
      };
      window.addEventListener("popstate", onUrlMaybeChanged, true);
      window.addEventListener("hashchange", onUrlMaybeChanged, true);
    } catch {}
    // Fallback for apps that mutate DOM without history APIs
    const mo = new MutationObserver(() => onUrlMaybeChanged());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
  installNavigationObserver();

  // Load preferences
  try {
    // Default to site if not set
    currentScope = localStorage.getItem(SCOPE_KEY) || SCOPES.site;
    currentTheme = localStorage.getItem(THEME_KEY) || currentTheme;
    // Always start unpinned on each page load
    autoOpen = false;
    searchMode = localStorage.getItem(SEARCH_MODE_KEY) || searchMode;
    currentPlacement = localStorage.getItem(PLACEMENT_KEY) || currentPlacement;
    // Clear any persisted pin to avoid surprise pinning on reload
    try {
      localStorage.setItem(AUTO_OPEN_KEY, "0");
    } catch {}
  } catch {}
  // Load synced UI prefs
  extSyncGet({ [UI_PREFS_KEY]: "{}" }).then((res) => {
    try {
      uiPrefs =
        typeof res[UI_PREFS_KEY] === "string"
          ? JSON.parse(res[UI_PREFS_KEY])
          : res[UI_PREFS_KEY] || {};
    } catch {
      uiPrefs = res[UI_PREFS_KEY] || {};
    }
    if (sidebarVisible) applyUiPrefs();
  });

  // ---- Cross-tab sync for Global scope ----
  try {
    if (chrome && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        if (!isGlobalScope()) return;
        // Ignore storage echoes right after a local mutation
        if (Date.now() - lastLocalChangeMs < 750) return;
        const globalDocKey = getGlobalDocKey();
        const docChange = changes[globalDocKey];
        if (docChange && typeof docChange.newValue !== "undefined") {
          const raw = docChange.newValue;
          let incomingDoc = null;
          try {
            incomingDoc = typeof raw === "string" ? JSON.parse(raw) : raw;
          } catch {}
          if (incomingDoc && typeof incomingDoc === "object") {
            const newVer = Number(incomingDoc.version || 0);
            if (newVer > globalDocVersion) {
              const incTabs = Array.isArray(incomingDoc.tabs)
                ? incomingDoc.tabs
                : [];
              const incActive = incomingDoc.activeTabId || null;
              tabs = incTabs;
              activeTabId =
                incActive && incTabs.some((t) => t.id === incActive)
                  ? incActive
                  : incTabs[0]
                  ? incTabs[0].id
                  : null;
              globalDocVersion = newVer;
              try {
                lastWrittenTabsJson = JSON.stringify(tabs);
              } catch {
                lastWrittenTabsJson = "";
              }
              renderTabs();
              const t = getActiveTab();
              if (els && els.textarea) {
                const newText = (t && t.content) || "";
                if (els.textarea.value !== newText) {
                  els.textarea.value = newText;
                  updateMetrics();
                }
              }
              getLastSavedForTab(activeTabId).then((ms) =>
                updateLastSavedDisplay(ms)
              );
            }
          }
        }
        // Last-saved update for active tab
        Object.keys(changes).forEach((k) => {
          if (!k.startsWith(`${EXT_PREFIX}:__GLOBAL__:`)) return;
          if (k === globalDocKey) return;
          if (!activeTabId) return;
          const suffix = `:tab:${activeTabId}:${LAST_SAVED_SUFFIX}`;
          if (k.endsWith(suffix)) {
            const v = changes[k].newValue;
            const n = Number(typeof v === "string" ? v : String(v));
            const ms = n && !isNaN(n) ? n : null;
            updateLastSavedDisplay(ms);
          }
        });
      });
    }
  } catch {}

  // On page load, inject hidden sidebar (collapsed) so it's ready, but not expanded
  // Defer until DOM ready to avoid CLS
  const initOpen = () => showSidebar({ reason: "init" });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOpen);
  } else {
    initOpen();
  }

  // ---- Message from background to open sidebar ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "OPEN_SIDEBAR") {
      showSidebar();
      sendResponse && sendResponse({ ok: true });
      return true;
    } else if (msg && msg.type === "OPEN_AND_TOGGLE_PIN") {
      showSidebar();
      togglePinning();
      sendResponse && sendResponse({ ok: true });
      return true;
    } else if (msg && msg.type === "TOGGLE_SIDEBAR") {
      if (sidebarVisible) hideSidebar();
      else showSidebar();
      sendResponse && sendResponse({ ok: true });
      return true;
    } else if (msg && msg.type === "APPEND_SELECTION") {
      const text = (msg.selectionText || "").trim();
      if (text) {
        showSidebar();
        const existing = els.textarea.value;
        const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
        const now = new Date();
        els.textarea.value =
          existing +
          `${prefix}- ${text} (from ${
            location.href
          } @ ${now.toLocaleString()})\n`;
        // trigger save
        const value = els.textarea.value;
        // Legacy key
        lsSet(getNotesKey(), value);
        // Tabs model
        setActiveTabContent(value);
        const ms = Date.now();
        const active = getActiveTab();
        if (active) {
          const k = getTabLastSavedKey(active.id);
          if (isGlobalScope()) {
            extSetString(k, String(ms)).catch(() => {});
            // Broadcast updated tabs content so other tabs update textarea immediately
            extSetString(getTabsKey(), JSON.stringify(tabs)).catch(() => {});
          } else {
            lsSet(k, String(ms));
          }
        }
        updateLastSavedDisplay(ms);
      }
      sendResponse && sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  // Minimal debug surface for troubleshooting
  try {
    window.__notesExt = {
      addTab: () => addTab(),
      closeActiveTab: () => {
        const t = getActiveTab();
        if (t) closeTab(t.id);
      },
      clearActive: () => {
        setActiveTabContent("");
        if (els && els.textarea) {
          els.textarea.value = "";
        }
        updateMetrics();
      },
      getState: () => ({
        scope: currentScope,
        isGlobal: isGlobalScope(),
        tabs: Array.isArray(tabs)
          ? tabs.map((t) => ({ id: t.id, title: t.title }))
          : [],
        activeTabId,
      }),
      setScope: (scope) => {
        if (!SCOPES[scope]) return;
        currentScope = scope;
        try {
          localStorage.setItem(SCOPE_KEY, currentScope);
        } catch {}
        initTabsForCurrentScope(true);
      },
      listGlobalKeys: () =>
        new Promise((resolve) => {
          try {
            if (chrome && chrome.storage && chrome.storage.local) {
              chrome.storage.local.get(null, (all) => {
                const keys = Object.keys(all || {}).filter(
                  (k) =>
                    k === `${EXT_PREFIX}:__GLOBAL__:tabs` ||
                    k === `${EXT_PREFIX}:__GLOBAL__:active_tab` ||
                    k.startsWith(`${EXT_PREFIX}:__GLOBAL__:`)
                );
                resolve(keys);
              });
              return;
            }
          } catch {}
          const keys = [];
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (!k) continue;
              if (
                k === `${EXT_PREFIX}:__GLOBAL__:tabs` ||
                k === `${EXT_PREFIX}:__GLOBAL__:active_tab` ||
                k.startsWith(`${EXT_PREFIX}:__GLOBAL__:`)
              )
                keys.push(k);
            }
          } catch {}
          resolve(keys);
        }),
      clearGlobalKeys: () =>
        new Promise((resolve) => {
          const finish = (removed) => {
            if (isGlobalScope()) initTabsForCurrentScope(true);
            resolve({ removed });
          };
          try {
            if (chrome && chrome.storage && chrome.storage.local) {
              chrome.storage.local.get(null, (all) => {
                const keys = Object.keys(all || {}).filter(
                  (k) =>
                    k === `${EXT_PREFIX}:__GLOBAL__:tabs` ||
                    k === `${EXT_PREFIX}:__GLOBAL__:active_tab` ||
                    k.startsWith(`${EXT_PREFIX}:__GLOBAL__:`)
                );
                chrome.storage.local.remove(keys, () => finish(keys));
              });
              return;
            }
          } catch {}
          const removed = [];
          try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
              const k = localStorage.key(i);
              if (!k) continue;
              if (
                k === `${EXT_PREFIX}:__GLOBAL__:tabs` ||
                k === `${EXT_PREFIX}:__GLOBAL__:active_tab` ||
                k.startsWith(`${EXT_PREFIX}:__GLOBAL__:`)
              ) {
                try {
                  localStorage.removeItem(k);
                } catch {}
                removed.push(k);
              }
            }
          } catch {}
          finish(removed);
        }),
    };
  } catch {}
})();
