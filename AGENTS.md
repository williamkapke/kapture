# Kapture

This document provides a high-level overview of the Kapture project, intended to be used as a reference for AI coding agents.

## Project Goal

Kapture is a Chrome Extension that enables browser automation through the Model Context Protocol (MCP). AI applications (Claude Desktop, Cline, etc.) connect to a local MCP server, which relays commands over WebSocket to the extension, which executes them in the browser (navigate, click, fill, screenshot, read DOM, read console logs, etc.).

DevTools does NOT need to be open: the extension's background service worker owns the WebSocket connections and executes commands via `chrome.debugger` (CDP) and content scripts.

## Key Directories

*   **`/extension`**: The Chrome extension (Manifest V3).
    *   `manifest.json`: Permissions: `activeTab`, `debugger`, `storage`; host permissions: `<all_urls>`.
    *   `background.js` + `modules/`: Service worker — owns one WebSocket per connected tab (to `ws://127.0.0.1:61822`), dispatches commands. Input/navigation/screenshot commands use `chrome.debugger`; DOM commands are forwarded to the content script.
    *   `page-helpers.js`: Content script (isolated world) handling DOM commands (`dom`, `elements`, `fill`, `select`, `focus`, `blur`, ...).
    *   `modules/background-console.js`: Console retrieval via CDP — reads Chrome's per-page console buffer on demand (`console_logs`) or watches live for a duration (`watch_console`); no extension-side log storage.
    *   `popup.js` / `popup.html`: Toolbar popup with the connection toggle.
    *   `panel.js` / `panel.html`: Optional DevTools panel (connection toggle, message viewer).
*   **`/server`**: TypeScript/Node.js MCP server on port 61822. MCP clients connect via WebSocket at `ws://localhost:61822/mcp` or via stdio using the `kapture-mcp bridge` command. Tools are defined in `src/tools.yaml`.
*   **`/e2e`**: End-to-end tests.
*   **`/website`**: Project documentation and website (GitHub Pages).
*   **`/test-app`**: Electron test app that acts as an MCP client for manual testing.

## How it Works

1.  The user installs the Kapture Chrome extension and starts the MCP server (usually automatically via the `npx kapture-mcp bridge` MCP client config).
2.  The user connects a tab via the toolbar popup toggle, the DevTools Kapture panel, or a `?kapture-connect=true` URL parameter.
3.  The background service worker opens a WebSocket to the server and registers the tab.
4.  MCP clients call tools (`navigate`, `click`, `fill`, `screenshot`, ...); the server forwards each command to the extension over WebSocket and returns the result.

## Development & Testing

*   **Server**: `cd server && npm install && npm run build` (or `npm run dev` for hot-reload).
*   **Extension**: Load unpacked from `/extension`; reload in `chrome://extensions/` after changes.
*   **Testing**: End-to-end tests are in `/e2e`.

See `CLAUDE.md` for a more detailed architecture reference.
