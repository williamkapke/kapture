import { BrowserWebSocketManager } from './browser-websocket-manager.js';
import { TabRegistry } from './tab-registry.js';
import { logger } from './logger.js';
import { exec } from 'child_process';
import { formatTabDetail } from './tab-utils.js';

interface CommandRequest {
  id: string;
  tabId: string;
  command: string;
  params: any;
}

interface CommandResponse {
  id: string;
  success: boolean;
  result?: any;
  error?: {
    message: string;
    code: string;
  };
}

// Common parameter interfaces
interface ElementParams {
  selector?: string;
  xpath?: string;
}

// Compare dotted version strings (e.g. "1.1.0" >= "1.1.0").
function versionGte(version: string, min: string): boolean {
  const a = version.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

// Network monitoring tool names -> extension command names. Landed in 1.1.0.
const NETWORK_TOOLS: { [key: string]: string } = {
  network_monitor: 'networkMonitor',
  network_requests: 'networkRequests',
  network_body: 'networkBody'
};

export class BrowserCommandHandler {
  private pendingCommands: Map<string, {
    resolve: (result: any) => void;
    reject: (error: any) => void;
    timeout: NodeJS.Timeout;
    tabId?: string;
  }> = new Map();
  private clientInfo: { name?: string; version?: string } = {};

  // Who wants network monitoring on, per tab. Watcher ids are MCP connection
  // ids (passed through callTool) or a caller-supplied clientId for HTTP.
  // Monitoring turns on with the first watcher and off with the last; enable
  // is idempotent per watcher, and a client disconnect releases its watchers.
  private networkWatchers: Map<string, Set<string>> = new Map();

  constructor(
    private browserWebSocketManager: BrowserWebSocketManager,
    private tabRegistry: TabRegistry
  ) {}

  setClientInfo(info: { name?: string; version?: string }) {
    this.clientInfo = info;
  }

  // ========================================================================
  // Generic Tool Execution
  // ========================================================================

  /**
   * Call any tool by name with the provided arguments
   * This is the main entry point for tool-handler
   * callerId identifies the MCP connection making the call (absent for HTTP).
   */
  async callTool(toolName: string, args: any, callerId?: string): Promise<any> {
    // Handle special cases that don't go through executeCommand
    if (toolName === 'new_tab') {
      return this.newTab(args?.browser);
    }

    if (toolName === 'watch_console') {
      // Older extensions don't report a version and don't have the watchConsole command
      const tab = this.tabRegistry.get(args.tabId);
      if (tab && !tab.version) {
        return {
          success: false,
          error: {
            code: 'EXTENSION_OUTDATED',
            message: 'The connected Kapture extension does not support watch_console. Update the extension to the latest version.'
          }
        };
      }

      // The extension watches for `duration` ms; pad the server-side wait so
      // it doesn't time out the moment the watch window ends.
      return this.executeCommand('watchConsole', {
        ...args,
        duration: args.timeout,
        timeout: args.timeout + 5000
      });
    }

    if (toolName === 'evaluate') {
      // Per-tab gate: the user must have enabled "Allow JavaScript Execution"
      // for this tab in the extension UI. (The extension enforces this too.)
      const tab = this.tabRegistry.get(args.tabId);
      if (tab && !tab.evalAllowed) {
        return {
          success: false,
          error: {
            code: 'EVAL_NOT_ALLOWED',
            message: 'JavaScript execution is not enabled for this tab. The user must turn on "Allow JavaScript Execution" in the Kapture extension popup or DevTools panel.'
          }
        };
      }

      // The extension evaluates with `evalTimeout`; pad the server-side wait
      // so the extension's timeout error wins over a generic command timeout.
      return this.executeCommand('evaluate', {
        ...args,
        evalTimeout: args.timeout,
        timeout: args.timeout + 2000
      });
    }

    if (NETWORK_TOOLS[toolName]) {
      // Network monitoring landed in extension 1.1.0; older extensions would
      // route the unknown command to the content script and fail confusingly.
      // A missing tab falls through to executeCommand, which reports it as
      // "Tab not found" rather than masking it as an outdated extension.
      const tab = this.tabRegistry.get(args.tabId);
      if (tab && (!tab.version || !versionGte(tab.version, '1.1.0'))) {
        return {
          success: false,
          error: {
            code: 'EXTENSION_OUTDATED',
            message: 'The connected Kapture extension does not support network monitoring. Update the extension to the latest version.'
          }
        };
      }

      if (toolName === 'network_monitor') {
        return this.networkMonitor(args, callerId);
      }
      return this.executeCommand(NETWORK_TOOLS[toolName], args);
    }

    // Map tool names to command names (most are the same)
    const commandMap: { [key: string]: string } = {
      'console_logs': 'getLogs'
    };

    const command = commandMap[toolName] || toolName;
    return this.executeCommand(command, args);
  }

  // ========================================================================
  // Network Monitoring Watchers
  // ========================================================================

  /**
   * Per-watcher enable/disable for network monitoring. The watcher id is the
   * caller's MCP connection id, or `clientId` from the request body for HTTP
   * callers (HTTP calls without one share the 'http' identity). Enable is
   * idempotent per watcher; monitoring stops when the last watcher disables,
   * or immediately with force:true.
   */
  private async networkMonitor(args: any, callerId?: string): Promise<any> {
    const { tabId, enabled, force, clientId } = args;
    const watcherId = clientId || callerId || 'http';

    if (enabled) {
      let watchers = this.networkWatchers.get(tabId);
      if (!watchers) {
        watchers = new Set();
        this.networkWatchers.set(tabId, watchers);
      }
      watchers.add(watcherId);

      // The extension's enable is idempotent; always forward so the response
      // carries fresh tab info and buffer state.
      let result;
      try {
        result = await this.executeCommand('networkMonitor', { tabId, enabled: true });
      } catch (error) {
        this.removeNetworkWatcher(tabId, watcherId);
        throw error;
      }
      if (result?.success === false) {
        this.removeNetworkWatcher(tabId, watcherId);
        return result;
      }
      return { ...result, watchers: watchers.size };
    }

    // Disable
    const watchers = this.networkWatchers.get(tabId);
    if (watchers) {
      if (force) watchers.clear();
      else watchers.delete(watcherId);
      if (watchers.size === 0) this.networkWatchers.delete(tabId);
    }
    const remaining = this.networkWatchers.get(tabId)?.size || 0;
    if (remaining > 0) {
      // Others still watching - leave monitoring on.
      return { success: true, monitoring: true, watchers: remaining };
    }
    const result = await this.executeCommand('networkMonitor', { tabId, enabled: false });
    return { ...result, watchers: 0 };
  }

  private removeNetworkWatcher(tabId: string, watcherId: string): void {
    const watchers = this.networkWatchers.get(tabId);
    if (!watchers) return;
    watchers.delete(watcherId);
    if (watchers.size === 0) this.networkWatchers.delete(tabId);
  }

  /**
   * Release every watcher held by a disconnecting MCP client, turning
   * monitoring off for tabs where it was the last watcher.
   */
  releaseNetworkWatchers(callerId: string): void {
    for (const [tabId, watchers] of [...this.networkWatchers]) {
      if (!watchers.delete(callerId)) continue;
      if (watchers.size > 0) continue;
      this.networkWatchers.delete(tabId);
      if (this.tabRegistry.get(tabId)) {
        this.executeCommand('networkMonitor', { tabId, enabled: false }).catch(() => {
          // Tab may be mid-disconnect; the extension also stops on socket close.
        });
      }
    }
  }

  /** Forget watchers for a disconnected tab (the extension already stopped). */
  clearNetworkWatchersForTab(tabId: string): void {
    this.networkWatchers.delete(tabId);
  }

  // ========================================================================
  // Special Commands
  // ========================================================================

  async newTab(browser?: string): Promise<any> {
    // Generate a unique session ID for this tab
    const sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const targetUrl = `https://williamkapke.github.io/kapture/how-to.html#session=${sessionId}`;

    // Open the browser with the URL using system command
    const platform = process.platform;

    let command: string;
    if (platform === 'darwin') {
      // macOS
      if (browser) {
        const browserMap: { [key: string]: string } = {
          'chrome': 'Google Chrome',
          'edge': 'Microsoft Edge',
          'brave': 'Brave Browser',
          'opera': 'Opera',
          'vivaldi': 'Vivaldi'
        };
        const appName = browserMap[browser.toLowerCase()];
        if (!appName) {
          throw new Error(`Unsupported browser: ${browser}. Supported browsers: chrome, edge, brave, opera, vivaldi`);
        }
        command = `open -a "${appName}" "${targetUrl}"`;
      } else {
        // Use system default browser
        command = `open "${targetUrl}"`;
      }
    } else if (platform === 'win32') {
      // Windows
      if (browser) {
        const browserMap: { [key: string]: string } = {
          'chrome': 'chrome',
          'edge': 'msedge',
          'brave': 'brave',
          'opera': 'opera',
          'vivaldi': 'vivaldi'
        };
        const exeName = browserMap[browser.toLowerCase()];
        if (!exeName) {
          throw new Error(`Unsupported browser: ${browser}. Supported browsers: chrome, edge, brave, opera, vivaldi`);
        }
        command = `start ${exeName} "${targetUrl}"`;
      } else {
        // Use system default browser
        command = `start "" "${targetUrl}"`;
      }
    } else {
      // Linux
      if (browser) {
        const browserMap: { [key: string]: string } = {
          'chrome': 'google-chrome',
          'edge': 'microsoft-edge',
          'brave': 'brave-browser',
          'opera': 'opera',
          'vivaldi': 'vivaldi'
        };
        const exeName = browserMap[browser.toLowerCase()];
        if (!exeName) {
          throw new Error(`Unsupported browser: ${browser}. Supported browsers: chrome, edge, brave, opera, vivaldi`);
        }
        command = `${exeName} "${targetUrl}"`;
      } else {
        // Use system default browser
        command = `xdg-open "${targetUrl}"`;
      }
    }

    // Execute the command to open the browser
    exec(command, (error) => {
      if (error) {
        logger.error('Failed to open browser:', error);
      }
    });

    // Wait for the new tab to connect
    const maxWaitTime = 15000; // 15 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      // Check if a tab with this specific session ID has connected
      const tabs = this.tabRegistry.getAll();
      const newTab = tabs.find(tab => tab.url && tab.url.includes(`session=${sessionId}`));

      if (newTab && newTab.url) {
        // Return full tab info to match other commands
        return {
          ...formatTabDetail(newTab),
          success: true
        };
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error('New tab failed to connect within timeout. Make sure the Kapture extension is installed.');
  }

  // ========================================================================
  // Core Command Execution
  // ========================================================================

  private async executeCommand(command: string, args: any): Promise<any> {
    // Extract tabId from args
    const { tabId, ...params } = args;

    if (!tabId) {
      throw new Error('tabId is required');
    }

    // Check if tab exists
    const tab = this.tabRegistry.get(tabId);
    if (!tab) {
      throw new Error(`Tab ${tabId} not found`);
    }

    // Generate unique command ID
    const commandId = `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create command message
    const commandMessage = {
      id: commandId,
      type: 'command',
      command,
      params
    };

    // Setup promise for response
    const responsePromise = new Promise<any>((resolve, reject) => {
      // Set timeout (default 5 seconds)
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        logger.warn(`Command timeout for ${command} (${commandId})`);
        reject(new Error(`Command timeout: ${command}`));
      }, params.timeout || 5000);

      this.pendingCommands.set(commandId, { resolve, reject, timeout, tabId });
      logger.log(`Registered pending command: ${command} (${commandId})`);
    });

    try {
      // Send command to tab
      logger.log(`Sending command to tab ${tabId}: ${command} (${commandId})`);
      this.browserWebSocketManager.sendCommand(tabId, commandMessage);

      // Wait for response
      const response = await responsePromise;
      logger.log(`Command completed: ${command} (${commandId})`);
      return response;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  /**
   * Handle command response from browser extension
   * Called by BrowserWebSocketManager when a response is received
   */
  handleCommandResponse(response: CommandResponse): void {
    logger.log(`Browser Command Handler received command response: ${response.id}, success: ${response.success}`);
    logger.log(`Current pending commands before handling: ${Array.from(this.pendingCommands.keys()).join(', ')}`);

    const pending = this.pendingCommands.get(response.id);
    if (!pending) {
      logger.warn(`No pending command found for response: ${response.id}`);
      logger.warn(`Current pending commands: ${Array.from(this.pendingCommands.keys()).join(', ')}`);
      return;
    }

    // Clear timeout
    clearTimeout(pending.timeout);
    this.pendingCommands.delete(response.id);

    // If this is a successful response with URL/title, update tab registry
    if (response.success && response.result && pending.tabId) {
      const result = response.result;
      // Update tab info whenever we get URL and title in the response
      if (result.url && result.title) {
        logger.log(`Updating tab ${pending.tabId} info: ${result.url}`);
        this.tabRegistry.updateTabInfo(pending.tabId, {
          url: result.url,
          title: result.title
        });
      }
    }

    // Resolve or reject based on response
    if (response.success) {
      logger.log(`Resolving command ${response.id} with result`);
      pending.resolve(response.result);
    } else {
      logger.log(`Rejecting command ${response.id} with error: ${response.error?.message}`);
      pending.reject(new Error(response.error?.message || 'Command failed'));
    }
  }

  cleanup(): void {
    // Clear all pending commands
    for (const [commandId, pending] of this.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Browser command handler shutting down'));
    }
    this.pendingCommands.clear();
  }
}
