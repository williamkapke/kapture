import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const exec = promisify(execCallback);

/**
 * Check if a port is already in use and get process info
 */
async function getPortInfo(port: number): Promise<{ inUse: boolean; pid?: string; command?: string }> {
  const platform = process.platform;
  let command: string;

  if (platform === 'darwin' || platform === 'linux') {
    command = `lsof -i :${port} -P -n | grep LISTEN || true`;
  } else if (platform === 'win32') {
    command = `netstat -ano | findstr :${port} || exit 0`;
  } else {
    return { inUse: false };
  }

  const { stdout } = await exec(command);

  if (stdout.trim()) {
    if (platform === 'darwin' || platform === 'linux') {
      const lines = stdout.trim().split('\n');
      const parts = lines[0].split(/\s+/);
      return {
        inUse: true,
        pid: parts[1],
        command: parts[0]
      };
    } else if (platform === 'win32') {
      const lines = stdout.trim().split('\n');
      const listenLine = lines.find(l => l.includes('LISTENING')) || lines[0];
      const parts = listenLine.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      return {
        inUse: true,
        pid: pid
      };
    }
  }

  return { inUse: false };
}

/**
 * Check if port is in use and exit with helpful message if it is
 */
export async function checkIfPortInUse(port: number): Promise<void> {
  const portCheck = await getPortInfo(port);
  const GREEN = "\x1b[1;32m";
  const YELLOW = "\x1b[1;33m";
  const GREY = "\x1b[38;5;244m";
  const RESET = "\x1b[0m";

  if (portCheck.inUse) {
    let message = '';
    if (portCheck.pid) {
      if (portCheck.command !== 'node') {
        message = `⚠️ Port ${port} is already in use by "${portCheck.command}"`;
      }
      else {
        message = `✅ A server instance is already running!`;
      }
      console.log(`${GREEN}┌${'─'.repeat(message.length + 3)}┐${RESET}`);
      console.log(`${GREEN}│${RESET} ${YELLOW}${message}${RESET} ${GREEN}│${RESET}`);
      console.log(`${GREEN}├${'─'.repeat(message.length + 3)}┤${RESET}`);
      if (portCheck.pid) {
        let kill_cmd = '';
        if (process.platform === 'darwin' || process.platform === 'linux') {
          kill_cmd = `      kill -9 ${portCheck.pid}`
        } else if (process.platform === 'win32') {
          kill_cmd = `      taskkill /PID ${portCheck.pid} /F`;
        }
        console.log(`${GREEN}│${RESET} ${GREY}${'   To stop the other instance, run:'.padEnd(message.length + 2)}${GREEN}│${RESET}`);
        console.log(`${GREEN}│${RESET} ${GREY}${kill_cmd.padEnd(message.length + 2)}${GREEN}│${RESET}`);
        console.log(`${GREEN}└${'─'.repeat(message.length + 3)}┘${RESET}`);
      }
    }

    console.log();
    process.exit(1);
  }
}
