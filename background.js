/**
 * Gemini to Markdown - Background Service Worker
 */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Gemini to Markdown extension installed');
    // Set default settings if needed
    chrome.storage.local.set({
      version: '1.0.0',
      installed: true
    });
  } else if (details.reason === 'update') {
    console.log('Gemini to Markdown extension updated');
  }
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSettings') {
    chrome.storage.local.get(null, (items) => {
      sendResponse({ success: true, data: items });
    });
    return true; // Keep channel open for async response
  }
  
  return false;
});

