## Notes Sidebar per Page (Manifest V3)

Install by loading this folder as an unpacked extension in Chrome.

### How it works

- Background service worker adds a context menu item: "Open Notes Sidebar for This Page".
- Content script runs on all `http(s)` pages, tracks visits/time, and injects a right-hand sidebar on demand.
- Notes and stats are saved in `localStorage` per subpage using the key format below.

### LocalStorage keys (per subpage)

- `notes_ext:${location.host + location.pathname}:notes`: plain text string for the notes.
- `notes_ext:${location.host + location.pathname}:stats`: JSON string for visit/time stats.

Example `stats` value:

```json
{
  "firstVisitAt": 1736251200000,
  "lastVisitAt": 1736337600000,
  "visitCount": 5,
  "totalTimeSpentMs": 842000
}
```

### Stats semantics

- **Visit count**: incremented each time a page (same host + pathname) is loaded.
- **First visit**: timestamp of the first recorded visit.
- **Last visit**: timestamp of the most recent visit.
- **Time spent**: accumulated time while the tab is focused and visible, updated on focus/blur/visibility changes and every 5s heartbeat.
- **Average duration**: computed as `totalTimeSpentMs / visitCount`.

### Files

- `manifest.json`: MV3 manifest.
- `service_worker.js`: background service worker that adds the context menu and sends a message to open the sidebar.
- `content.js`: injects the sidebar, manages notes, stats, and time tracking in the page context.
- `sidebar.html`, `sidebar.js`, `sidebar.css`: optional iframe-based UI scaffold (not required by default). Provided for future customization.

### New features

- Dark mode (auto/light/dark toggle)
- Keyboard shortcut: Toggle sidebar (`Ctrl+Shift+Y`, mac: `Cmd+Shift+Y`)
- Context menu: Add selected text to notes
- Scope toggle: Page / Site / Full URL data scoping
- Search input with inline highlighting (lightweight)
- Export/Import of all extension data (JSON)
- Pin: auto-open sidebar on new pages (toggle via Pin)
- Last saved indicator + basic writing metrics (words/chars/lines/reading time)
- Sidebar width persistence and drag-resize

### Notes

- The sidebar is designed to be non-obtrusive, scrollable, and resizable (via a drag handle on its left edge).
- Works on most HTTPS sites. Sites with extremely restrictive CSPs are better supported by direct DOM injection (this default approach) rather than an extension iframe.
