
// Connection state enum
export const ConnectionStatus = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RETRYING: 'retrying',
  ERROR: 'error'
};

// Message class
export class Message {
  constructor(direction, data) {
    this.id = crypto.randomUUID();
    this.direction = direction; // 'incoming' | 'outgoing'
    this.data = data;
    this.timestamp = new Date();
  }
}

