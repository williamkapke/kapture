const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // MCP connection
  connectMCP: () => ipcRenderer.invoke('mcp-connect'),
  disconnectMCP: () => ipcRenderer.invoke('mcp-disconnect'),
  
  // MCP requests
  sendMCPRequest: (method, params) => ipcRenderer.invoke('mcp-request', method, params),
  
  // Listen for MCP notifications
  onMCPNotification: (callback) => {
    ipcRenderer.on('mcp-notification', (event, message) => callback(message));
  },
  
  // Listen for disconnection
  onMCPDisconnected: (callback) => {
    ipcRenderer.on('mcp-disconnected', (event, data) => callback(data));
  },
  
  // Listen for errors
  onMCPError: (callback) => {
    ipcRenderer.on('mcp-error', (event, data) => callback(data));
  }
});