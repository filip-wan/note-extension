const MENU_OPEN_ID = "open_notes_sidebar_menu";
const MENU_ADD_SELECTION_ID = "add_selection_to_notes";

function createMenu() {
  try {
    chrome.contextMenus.create({
      id: MENU_OPEN_ID,
      title: "Open Notes Sidebar for This Page",
      contexts: [
        "page",
        "selection",
        "link",
        "editable",
        "image",
        "video",
        "audio",
        "frame",
      ],
    });
    chrome.contextMenus.create({
      id: MENU_ADD_SELECTION_ID,
      title: 'Add selection to Notes: "%s"',
      contexts: ["selection"],
    });
  } catch (e) {
    // Ignore if it already exists
  }
}

chrome.runtime.onInstalled.addListener(() => {
  createMenu();
});

chrome.runtime.onStartup.addListener(() => {
  createMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return;
  if (info.menuItemId === MENU_OPEN_ID) {
    // Try to ping the content; if it fails, inject content.js then retry
    chrome.tabs.sendMessage(tab.id, { type: "OPEN_SIDEBAR" }, () => {
      if (chrome.runtime.lastError) {
        // Likely no content script injected (tab open pre-install or special page)
        chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            files: ["content.js"],
          })
          .then(() => {
            chrome.tabs.sendMessage(tab.id, { type: "OPEN_SIDEBAR" });
          })
          .catch(() => {
            // Swallow; cannot inject on restricted pages (chrome:// etc.)
          });
      }
    });
  } else if (info.menuItemId === MENU_ADD_SELECTION_ID) {
    const selectionText = info.selectionText || "";
    chrome.tabs.sendMessage(
      tab.id,
      { type: "APPEND_SELECTION", selectionText },
      () => {
        if (chrome.runtime.lastError) {
          chrome.scripting
            .executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
            .then(() =>
              chrome.tabs.sendMessage(tab.id, {
                type: "APPEND_SELECTION",
                selectionText,
              })
            )
            .catch(() => {});
        }
      }
    );
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-sidebar") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null) return;
      chrome.tabs.sendMessage(tab.id, { type: "OPEN_AND_TOGGLE_PIN" }, () => {
        if (chrome.runtime.lastError) {
          chrome.scripting
            .executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
            .then(() =>
              chrome.tabs.sendMessage(tab.id, { type: "OPEN_AND_TOGGLE_PIN" })
            )
            .catch(() => {});
        }
      });
    });
  }
});
