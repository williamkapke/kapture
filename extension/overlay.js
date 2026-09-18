// overlay.js - Content script: visual feedback while an MCP client drives this tab.
//
// Renders a glowing border, a "controlled by Kapture" badge with the current
// action, and the virtual cursor. Everything lives in a closed shadow root on a
// host attached to <html> (not <body>), so `dom` output, selectors and
// elementsFromPoint (pointer-events: none) never see it. Loaded before
// page-helpers.js, which drives it through the global `kaptureOverlay`.

const kaptureOverlay = (() => {
  const IDLE_MS = 2500;

  let host = null;
  let root = null;
  let active = false;
  let cursorPos = null; // last virtual cursor position (viewport coords)
  let idleTimer = null;

  const STYLE = `
    :host { all: initial; }
    .layer {
      position: fixed; inset: 0; pointer-events: none;
      z-index: 2147483647; opacity: 0; transition: opacity 300ms ease;
      font: 500 12px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .layer.active { opacity: 1; }
    .layer.capturing { display: none; }

    .frame {
      position: absolute; inset: 0; border-radius: 2px;
      box-shadow: inset 0 0 0 2px rgba(139, 92, 246, 0.85),
                  inset 0 0 24px 4px rgba(139, 92, 246, 0.35);
      animation: pulse 2.4s ease-in-out infinite;
    }
    .layer.busy .frame { animation-duration: 1.2s; }
    @keyframes pulse {
      0%, 100% { opacity: 0.55; }
      50% { opacity: 1; }
    }

    .badge {
      position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 8px;
      padding: 6px 12px 6px 10px; border-radius: 999px;
      background: rgba(24, 16, 44, 0.86); color: #f3efff;
      box-shadow: 0 4px 18px rgba(76, 29, 149, 0.45), 0 0 0 1px rgba(167, 139, 250, 0.5);
      white-space: nowrap; transition: opacity 300ms ease;
    }
    .layer.idle .badge { opacity: 0.55; }
    .dot {
      width: 8px; height: 8px; border-radius: 50%; background: #a78bfa;
      box-shadow: 0 0 0 0 rgba(167, 139, 250, 0.7);
      animation: ping 1.6s ease-out infinite;
    }
    @keyframes ping {
      0% { box-shadow: 0 0 0 0 rgba(167, 139, 250, 0.7); }
      100% { box-shadow: 0 0 0 8px rgba(167, 139, 250, 0); }
    }
    .action { color: #c4b5fd; }
    .action:empty { display: none; }
    .action::before { content: "\\00b7  "; color: #7c6aa8; }

    .cursor {
      position: absolute; top: 0; left: 0; width: 20px; height: 20px;
      will-change: transform; transition: opacity 300ms ease;
      filter: drop-shadow(0 0 4px rgba(139, 92, 246, 0.9)) drop-shadow(0 0 10px rgba(139, 92, 246, 0.5));
    }
    .cursor[hidden] { display: none; }
    .layer.idle .cursor { opacity: 0.55; }

    .ripple {
      position: absolute; top: 0; left: 0; width: 36px; height: 36px;
      margin: -18px 0 0 -18px; border-radius: 50%;
      border: 2px solid rgba(167, 139, 250, 0.95);
      background: rgba(139, 92, 246, 0.25);
      animation: ripple 500ms ease-out forwards;
    }
    @keyframes ripple {
      from { transform: var(--at) scale(0.3); opacity: 1; }
      to { transform: var(--at) scale(1.6); opacity: 0; }
    }

    @media (prefers-reduced-motion: reduce) {
      .frame, .dot { animation: none; }
      .ripple { animation-duration: 1ms; }
    }
  `;

  const CURSOR_SVG = `
    <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0 L0 16 L4.5 12.5 L7.5 20 L10 19 L7 11.5 L12 11 Z"
            fill="white" stroke="black" stroke-width="1"/>
    </svg>`;

  function ensure() {
    if (!host) {
      host = document.createElement('kapture-overlay');
      root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>${STYLE}</style>
        <div class="layer">
          <div class="frame"></div>
          <div class="badge"><span class="dot"></span><span>Controlled by Kapture</span><span class="action"></span></div>
          <div class="cursor" hidden>${CURSOR_SVG}</div>
        </div>`;
    }
    // Attach under <html> so body.outerHTML stays clean; re-attach if a page
    // (or SPA re-render) removed it.
    if (!host.isConnected && document.documentElement) {
      document.documentElement.appendChild(host);
    }
    return root;
  }

  const $ = (sel) => ensure().querySelector(sel);

  function markBusy() {
    const layer = $('.layer');
    layer.classList.add('busy');
    layer.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      layer.classList.remove('busy');
      layer.classList.add('idle');
      $('.action').textContent = '';
    }, IDLE_MS);
  }

  return {
    setActive(on) {
      active = on;
      if (!on && !host) return;
      const layer = $('.layer');
      layer.classList.toggle('active', on);
      if (on) {
        layer.classList.add('idle');
      } else {
        clearTimeout(idleTimer);
        $('.action').textContent = '';
        $('.cursor').hidden = true;
      }
    },

    activity(label) {
      if (!active) return;
      $('.action').textContent = label || '';
      markBusy();
    },

    showCursor(show) {
      const cursor = $('.cursor');
      if (show) {
        cursor.hidden = false;
        $('.layer').classList.add('active');
        markBusy();
      } else if (!active) {
        // Not under remote control: the cursor only lives for the command
        cursor.hidden = true;
        $('.layer').classList.remove('active');
      }
      // While connected the cursor stays put; the idle timer dims it.
      return cursorPos;
    },

    moveCursor(x, y, duration) {
      const cursor = $('.cursor');
      cursor.style.transition = duration > 0
        ? `transform ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 300ms ease`
        : 'opacity 300ms ease';
      cursor.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
      cursorPos = { x, y };
      markBusy();
    },

    clickEffect(x, y) {
      const ripple = document.createElement('div');
      ripple.className = 'ripple';
      ripple.style.setProperty('--at', `translate(${x}px, ${y}px)`);
      $('.layer').appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
      setTimeout(() => ripple.remove(), 1000); // fallback if animations are off
      markBusy();
    },

    // Hide for screenshots so captures show the page as-is
    setCapturing(on) {
      if (!host) return;
      $('.layer').classList.toggle('capturing', on);
    },
  };
})();
