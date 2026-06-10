// DevTools Panel UI with Real Connection and Data

const tabId = chrome.devtools.inspectedWindow.tabId;
let selectedMessageIndex = -1;
let messages = [];
let port = null;

// Initialize UI
function initializeUI() {
  // Connect to background script
  port = chrome.runtime.connect({ name: 'panel' });

  // Listen for state updates
  port.onMessage.addListener((msg) => {
    if (msg.type === 'state' && msg.tabId === tabId) {
      updateUI(msg.connected, msg.status, msg.evalAllowed);
    } else if (msg.type === 'messages' && msg.tabId === tabId) {
      // Update messages from background
      messages = msg.messages || [];
      renderMessages();
    }
  });

  // Subscribe to state updates for this tab
  port.postMessage({ type: 'subscribe', tabId });

  // Event listeners
  document.getElementById('toggle').addEventListener('change', handleToggleChange);
  document.getElementById('eval-toggle').addEventListener('change', handleEvalToggleChange);
  document.getElementById('clear-messages').addEventListener('click', handleClearMessages);
  document.getElementById('messages-list').addEventListener('click', handleMessageClick);
  document.addEventListener('keydown', handleKeyDown);

  // Resize handle
  initializeResizeHandle();

  // Keep-alive interval setting
  initializeKeepaliveSetting();
}

// Read/write the configurable keepalive interval (seconds) from chrome.storage.
// The service worker (tab-manager) reads the same key and re-arms its pings.
function initializeKeepaliveSetting() {
  const input = document.getElementById('keepalive-seconds');
  if (!input) return;

  chrome.storage.local.get('keepaliveSeconds', ({ keepaliveSeconds }) => {
    const secs = Number(keepaliveSeconds);
    input.value = Number.isFinite(secs) && secs > 0 ? secs : 30;
  });

  input.addEventListener('change', () => {
    let secs = parseInt(input.value, 10);
    if (!Number.isFinite(secs) || secs < 5) secs = 5;
    if (secs > 600) secs = 600;
    input.value = secs;
    chrome.storage.local.set({ keepaliveSeconds: secs });
  });
}

// Update UI based on connection state
function updateUI(connected, status = 'disconnected', evalAllowed = false) {
  const toggle = document.getElementById('toggle');
  const toggleContainer = toggle.parentElement;
  const statusEl = document.getElementById('status');
  const statusText = statusEl.querySelector('.status-text');
  const tabInfo = document.getElementById('tab-info');

  // Remove existing classes
  statusEl.classList.remove('connected', 'disconnected', 'retrying');
  toggleContainer.classList.remove('connected', 'disconnected', 'retrying');

  switch (status) {
    case 'connected':
      toggle.checked = true;
      toggle.disabled = false;
      statusEl.classList.add('connected');
      toggleContainer.classList.add('connected');
      statusText.textContent = 'Connected';
      tabInfo.textContent = `Tab: ${tabId} - Connected`;
      break;

    case 'retrying':
      toggle.checked = true;
      toggle.disabled = false;
      statusEl.classList.add('retrying');
      toggleContainer.classList.add('retrying');
      statusText.textContent = 'Retrying...';
      tabInfo.textContent = `Tab: ${tabId} - Reconnecting`;
      break;

    case 'disconnected':
    default:
      toggle.checked = false;
      toggle.disabled = false;
      statusEl.classList.add('disconnected');
      toggleContainer.classList.add('disconnected');
      statusText.textContent = 'Disconnected';
      tabInfo.textContent = 'Tab: Not connected';
      break;
  }

  // "Allow JavaScript Execution" toggle - always visible, disabled until connected
  const evalRow = document.getElementById('eval-row');
  const evalToggle = document.getElementById('eval-toggle');
  const evalLabel = document.getElementById('eval-label');
  evalRow.classList.toggle('disabled', status !== 'connected');
  evalToggle.disabled = status !== 'connected';
  evalToggle.checked = !!evalAllowed;
  evalLabel.classList.toggle('enabled', !!evalAllowed);
}

// Create an element with a class and (safe) text content
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Render messages
function renderMessages() {
  const messagesList = document.getElementById('messages-list');
  const messagesContainer = document.querySelector('.messages-container');

  // Toggle class based on whether we have messages
  messagesContainer.classList.toggle('has-messages', messages.length > 0);

  if (messages.length === 0) {
    return;
  }

  messagesList.innerHTML = '';

  messages.forEach((msg, index) => {
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    if (index === selectedMessageIndex) {
      messageEl.classList.add('selected');
    }

    const arrow = msg.direction === 'outgoing' ? '⬆' : '⬇'; // Up arrow for outgoing, down arrow for incoming
    const arrowClass = msg.direction === 'outgoing' ? 'outgoing' : 'incoming';

    // Show the raw JSON data. Built with textContent (never innerHTML) -
    // message data contains page-controlled strings (DOM, console, titles).
    const dataEl = el('div', 'message-data');
    dataEl.append(el('span', `message-arrow ${arrowClass}`, arrow), ' ' + JSON.stringify(msg.data));
    messageEl.append(dataEl, el('div', 'message-time', formatTime(msg.timestamp)));

    messageEl.dataset.index = index;
    messagesList.appendChild(messageEl);
  });

  // Scroll to bottom
  messagesList.scrollTop = messagesList.scrollHeight;
}

// Format timestamp
function formatTime(date) {
  // Convert string to Date if needed
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateObj.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Handle message click
function handleMessageClick(e) {
  const messageEl = e.target.closest('.message');
  if (!messageEl) return;

  const index = parseInt(messageEl.dataset.index);
  selectMessage(index);
}

// Select message
function selectMessage(index) {
  selectedMessageIndex = index;

  // Update selected state
  document.querySelectorAll('.message').forEach((msgEl, i) => {
    msgEl.classList.toggle('selected', i === index);
  });

  // Show detail view
  const detailContainer = document.getElementById('detail-container');
  const detailContent = document.getElementById('detail-content');

  if (index >= 0 && index < messages.length) {
    detailContainer.classList.add('visible');
    const data = messages[index].data;
    detailContent.innerHTML = '';

    // Screenshot responses get a click-to-open image preview above the JSON
    if (data.type === 'response' && data.success && data.result && data.result.data &&
        data.result.mimeType && data.result.mimeType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = `data:${data.result.mimeType};base64,${data.result.data}`;
      img.title = 'Click to open in new tab';
      img.addEventListener('click', () => window.open(img.src, '_blank'));
      detailContent.append(img, el('pre', null, JSON.stringify(data.result, null, 2)));
    } else {
      detailContent.append(el('pre', null, JSON.stringify(data, null, 2)));
    }
  } else {
    detailContainer.classList.remove('visible');
  }
}

// Handle keyboard navigation
function handleKeyDown(e) {
  if (e.key === 'ArrowUp' && selectedMessageIndex > 0) {
    selectMessage(selectedMessageIndex - 1);
    e.preventDefault();
  } else if (e.key === 'ArrowDown' && selectedMessageIndex < messages.length - 1) {
    selectMessage(selectedMessageIndex + 1);
    e.preventDefault();
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    // Clear messages
    handleClearMessages();
    e.preventDefault();
  }
}

// Handle toggle change
function handleToggleChange(e) {
  const checked = e.target.checked;

  chrome.runtime.sendMessage(
    {
      type: checked ? 'connect' : 'disconnect',
      tabId: tabId
    },
    (response) => {
      if (response?.error) {
        console.error('Toggle error:', response.error);
      }
      // Reconcile from authoritative state - a failed connect (e.g. content
      // script missing after extension reload) must snap the toggle back.
      chrome.runtime.sendMessage({ type: 'getState', tabId }, (state) => {
        if (state) updateUI(state.connected, state.status, state.evalAllowed);
      });
    }
  );
}

// Handle "Allow JavaScript Execution" toggle change
function handleEvalToggleChange(e) {
  chrome.runtime.sendMessage({ type: 'setEvalAllowed', tabId, allowed: e.target.checked });
}

// Handle clear messages
function handleClearMessages() {
  // Request background to clear messages
  port.postMessage({ type: 'clearMessages', tabId });
  
  // Clear the detail view
  const detailContainer = document.getElementById('detail-container');
  detailContainer.classList.remove('visible');
  selectedMessageIndex = -1;
}

// Initialize resize handle
function initializeResizeHandle() {
  const resizeHandle = document.getElementById('resize-handle');
  const detailContainer = document.getElementById('detail-container');
  let isResizing = false;
  let startY = 0;
  let startHeight = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startY = e.clientY;
    startHeight = detailContainer.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const deltaY = startY - e.clientY;
    const newHeight = Math.min(Math.max(100, startHeight + deltaY), 500);
    detailContainer.style.height = `${newHeight}px`;
  });

  document.addEventListener('mouseup', () => {
    isResizing = false;
    document.body.style.cursor = '';
  });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initializeUI);
