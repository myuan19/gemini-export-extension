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
  
  // Setup toggle button
  setupToggle();
});

/**
 * Load extension settings
 */
function loadSettings() {
  chrome.storage.local.get(null, (items) => {
    console.log('Settings loaded:', items);
  });
}

/**
 * Setup extension toggle button
 */
function setupToggle() {
  const toggle = document.getElementById('extension-toggle');
  if (!toggle) return;
  
  // Load current state (default: enabled)
  chrome.storage.local.get(['extensionEnabled'], (result) => {
    const enabled = result.extensionEnabled !== false; // Default to true
    toggle.checked = enabled;
  });
  
  // Handle toggle change
  toggle.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    
    // Save state
    await chrome.storage.local.set({ extensionEnabled: enabled });
    
    // If disabling, reload the current tab
    if (!enabled) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        if (currentTab.url && currentTab.url.includes('gemini.google.com')) {
          chrome.tabs.reload(currentTab.id);
        }
      });
    } else {
      // If enabling, reload the current tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        if (currentTab.url && currentTab.url.includes('gemini.google.com')) {
          chrome.tabs.reload(currentTab.id);
        }
      });
    }
  });
}

