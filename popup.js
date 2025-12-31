/**
 * Gemini to Markdown - Popup Script
 */

document.addEventListener('DOMContentLoaded', () => {
  // Check if we're on Gemini page
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    if (currentTab.url && currentTab.url.includes('gemini.google.com')) {
      // Show success message
      console.log('Extension is active on Gemini page');
    } else {
      // Show warning
      console.log('Please navigate to gemini.google.com');
    }
  });
  
  // Load settings
  loadSettings();
});

/**
 * Load extension settings
 */
function loadSettings() {
  chrome.storage.local.get(null, (items) => {
    console.log('Settings loaded:', items);
  });
}

