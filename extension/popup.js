// Popup UI

let tabId;
let port;
let isUpdatingUI = false;

// Get current tab and set up
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  tabId = tabs[0].id;
  
  // Connect to background
  port = chrome.runtime.connect();
  port.postMessage({ type: 'subscribe', tabId });
  
  // Listen for state updates
  port.onMessage.addListener((msg) => {
    if (msg.type === 'state' && msg.tabId === tabId) {
      updateUI(msg.connected, msg.status, msg.evalAllowed);
    }
  });

  // Get initial state
  chrome.runtime.sendMessage({ type: 'getState', tabId }, (state) => {
    updateUI(state.connected, state.status, state.evalAllowed);
  });
});

// Handle toggle switch
document.getElementById('toggle').addEventListener('change', (e) => {
  if (isUpdatingUI) return; // Prevent feedback loop

  const type = e.target.checked ? 'connect' : 'disconnect';
  chrome.runtime.sendMessage({ type, tabId }, () => {
    // Reconcile from authoritative state - a failed connect (e.g. content
    // script missing after extension reload) must snap the toggle back.
    chrome.runtime.sendMessage({ type: 'getState', tabId }, (state) => {
      updateUI(state.connected, state.status, state.evalAllowed);
    });
  });
});

// Handle "Allow JavaScript Execution" toggle
document.getElementById('eval-toggle').addEventListener('change', (e) => {
  if (isUpdatingUI) return; // Prevent feedback loop

  chrome.runtime.sendMessage({ type: 'setEvalAllowed', tabId, allowed: e.target.checked });
});

// Update UI
function updateUI(connected, status = 'disconnected', evalAllowed = false) {
  isUpdatingUI = true;

  const toggle = document.getElementById('toggle');
  const toggleContainer = toggle.parentElement;
  const statusEl = document.getElementById('status');
  const statusText = statusEl.querySelector('.status-text');
  
  // Remove all state classes
  statusEl.classList.remove('connected', 'disconnected', 'retrying');
  toggleContainer.classList.remove('connected', 'disconnected', 'retrying');
  
  switch (status) {
    case 'connected':
      toggle.checked = true;
      toggle.disabled = false;
      statusEl.classList.add('connected');
      toggleContainer.classList.add('connected');
      statusText.textContent = 'Connected';
      break;
    
    case 'retrying':
      toggle.checked = true;
      toggle.disabled = false;
      statusEl.classList.add('retrying');
      toggleContainer.classList.add('retrying');
      statusText.textContent = 'Connecting';
      break;
    
    case 'disconnected':
    default:
      toggle.checked = false;
      toggle.disabled = false;
      statusEl.classList.add('disconnected');
      toggleContainer.classList.add('disconnected');
      statusText.textContent = 'Disconnected';
      break;
  }

  // "Allow JavaScript Execution" row - always visible, disabled until connected
  const evalRow = document.getElementById('eval-row');
  const evalToggle = document.getElementById('eval-toggle');
  const evalLabel = document.getElementById('eval-label');
  evalRow.classList.toggle('disabled', status !== 'connected');
  evalToggle.disabled = status !== 'connected';
  evalToggle.checked = !!evalAllowed;
  evalLabel.classList.toggle('enabled', !!evalAllowed);

  setTimeout(() => { isUpdatingUI = false; }, 100);
}