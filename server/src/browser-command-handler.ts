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

export class BrowserCommandHandler {
  private pendingCommands: Map<string, {
    resolve: (result: any) => void;
    reject: (error: any) => void;
    timeout: NodeJS.Timeout;
    tabId?: string;
  }> = new Map();
  private clientInfo: { name?: string; version?: string } = {};

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
   */
  async callTool(toolName: string, args: any): Promise<any> {
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

    // Map tool names to command names (most are the same)
    const commandMap: { [key: string]: string } = {
      'console_logs': 'getLogs'
    };

    const command = commandMap[toolName] || toolName;
    return this.executeCommand(command, args);
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
