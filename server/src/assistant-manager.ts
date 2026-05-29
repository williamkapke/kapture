import { homedir, platform } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

interface AssistantConfig {
  key: string;
  configPaths: {
    darwin?: string;
    win32?: string;
    linux?: string;
  };
  appPaths?: {
    darwin?: string;
    win32?: string;
    linux?: string;
  };
  configKey: string;
}

interface AssistantStatus {
  installed: boolean;
  configured: boolean;
  configPath?: string;
}

const ASSISTANTS: Record<string, AssistantConfig> = {
  'Claude Desktop': {
    key: 'claude-desktop',
    configPaths: {
      darwin: join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      win32: process.env.APPDATA ? join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json') : undefined,
      linux: join(homedir(), '.config', 'Claude', 'claude_desktop_config.json')
    },
    appPaths: {
      darwin: '/Applications/Claude.app',
      win32: process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Claude', 'Claude.exe') : undefined,
      linux: '/usr/bin/claude-desktop'
    },
    configKey: 'mcpServers'
  },
  'Claude Code': {
    key: 'claude-code',
    configPaths: {
      darwin: join(homedir(), '.claude.json'),
      win32: join(homedir(), '.claude.json'),
      linux: join(homedir(), '.claude.json')
    },
    configKey: 'mcpServers'
  },
  'VS Code': {
    key: 'vscode',
    configPaths: {
      darwin: join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
      win32: process.env.APPDATA ? join(process.env.APPDATA, 'Code', 'User', 'settings.json') : undefined,
      linux: join(homedir(), '.config', 'Code', 'User', 'settings.json')
    },
    appPaths: {
      darwin: '/Applications/Visual Studio Code.app',
      win32: process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Microsoft VS Code', 'Code.exe') : undefined,
      linux: '/usr/bin/code'
    },
    configKey: 'mcp.servers'
  },
  'Cursor': {
    key: 'cursor',
    configPaths: {
      darwin: join(homedir(), '.cursor', 'mcp.json'),
      win32: join(homedir(), '.cursor', 'mcp.json'),
      linux: join(homedir(), '.cursor', 'mcp.json')
    },
    appPaths: {
      darwin: '/Applications/Cursor.app',
      win32: process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'cursor', 'Cursor.exe') : undefined,
      linux: '/usr/bin/cursor'
    },
    configKey: 'mcpServers'
  },
  'Gemini': {
    key: 'gemini',
    configPaths: {
      darwin: join(homedir(), '.gemini', 'settings.json'),
      win32: join(homedir(), '.gemini', 'settings.json'),
      linux: join(homedir(), '.gemini', 'settings.json')
    },
    configKey: 'mcpServers'
  }
};

function readConfig(configPath: string): any {
  try {
    const content = readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return {};
  }
}

function isKaptureConfigured(configPath: string, configKey: string): boolean {
  try {
    const config = readConfig(configPath);
    const keys = configKey.split('.');
    let section = config;

    for (const key of keys) {
      if (!section[key]) return false;
      section = section[key];
    }

    return !!section.kapture;
  } catch {
    return false;
  }
}

const KAPTURE_MCP_CONFIG = {
  command: "npx",
  args: ["-y", "kapture-mcp@latest", "bridge"]
};

function writeConfig(configPath: string, config: any): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function updateAssistantConfig(name: string, configure: boolean): { success: boolean; error?: string } {
  const config = Object.entries(ASSISTANTS).find(([_, c]) => c.key === name)?.[1];
  if (!config) {
    return { success: false, error: 'Unknown assistant' };
  }

  const currentPlatform = platform() as 'darwin' | 'win32' | 'linux';
  const configPath = config.configPaths[currentPlatform];

  if (!configPath) {
    return { success: false, error: 'Platform not supported' };
  }

  // If unconfiguring and file doesn't exist, that's success
  if (!configure && !existsSync(configPath)) {
    return { success: true };
  }

  try {
    const currentConfig = readConfig(configPath);

    // Handle different config key structures (e.g., "mcp.servers" vs "mcpServers")
    const keys = config.configKey.split('.');
    let configSection = currentConfig;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!configSection[keys[i]]) {
        if (configure) {
          configSection[keys[i]] = {};
        } else {
          // Nothing to remove
          return { success: true };
        }
      }
      configSection = configSection[keys[i]];
    }

    const finalKey = keys[keys.length - 1];
    if (configure) {
      // Add or update Kapture configuration
      if (!configSection[finalKey]) {
        configSection[finalKey] = {};
      }
      configSection[finalKey].kapture = KAPTURE_MCP_CONFIG;
    } else {
      // Remove Kapture configuration
      if (configSection[finalKey] && configSection[finalKey].kapture) {
        delete configSection[finalKey].kapture;

        // Clean up empty objects
        if (Object.keys(configSection[finalKey]).length === 0) {
          delete configSection[finalKey];
        }
      }
    }

    writeConfig(configPath, currentConfig);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function detectAssistants(): Record<string, AssistantStatus> {
  const currentPlatform = platform() as 'darwin' | 'win32' | 'linux';
  const results: Record<string, AssistantStatus> = {};

  for (const [name, config] of Object.entries(ASSISTANTS)) {
    const configPath = config.configPaths[currentPlatform];
    const appPath = config.appPaths?.[currentPlatform];

    if (configPath) {
      // Check if app is installed by looking for app path or config directory
      let installed = false;

      if (appPath) {
        // If we have an app path, check if it exists
        installed = existsSync(appPath);
      } else {
        // For apps without specific app paths (like Claude Code, Gemini),
        // check if the parent directory of the config file exists
        const configDir = dirname(configPath);
        installed = existsSync(configDir);
      }

      // Check if Kapture is configured (only if config file exists)
      const configured = existsSync(configPath) && isKaptureConfigured(configPath, config.configKey);

      results[config.key] = {
        installed,
        configured,
        configPath
      };
    } else {
      // Platform not supported for this assistant
      results[config.key] = {
        installed: false,
        configured: false
      };
    }
  }

  return results;
}

export function configureAssistants(assistantsToConfig: Record<string, boolean>): Record<string, { success: boolean; error?: string }> {
  const results: Record<string, { success: boolean; error?: string }> = {};

  for (const [assistantKey, shouldConfigure] of Object.entries(assistantsToConfig)) {
    results[assistantKey] = updateAssistantConfig(assistantKey, shouldConfigure);
  }

  return results;
}
