// Optional iframe UI scaffold (not used by default).
// If you choose to load sidebar.html in an iframe from the content script,
// use the messaging below to communicate with the content script.

(function () {
  // Read token from query (?token=...) if any
  function getQueryParam(name) {
    const url = new URL(location.href);
    return url.searchParams.get(name);
  }

  const token = getQueryParam("token");

  function postToParent(type, payload) {
    if (!token) return;
    window.parent.postMessage({ __notesExt: true, token, type, payload }, "*");
  }

  // Example: announce ready to parent so it can send initial data
  if (token) {
    postToParent("SIDEBAR_READY", {});
  }

  // Handle incoming messages from content script (if used)
  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (!data || !data.__notesExt) return;
    // Here you can update your iframe UI accordingly
    // e.g., handle INIT_DATA, STATS_UPDATE, etc.
  });
})();
