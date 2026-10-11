// WebSocket link to the Exindel game server, with automatic reconnects.
export class OnlineClient {
  constructor({ onOpen, onMessage, onStatus }) {
    this.handlers = { onOpen, onMessage, onStatus };
    this.closed = false;
    this.retry = 0;
    this.connect();
  }

  connect() {
    const url = new URL('ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = '';
    this.ws = new WebSocket(url);
    this.handlers.onStatus('connecting');
    this.ws.onopen = () => {
      this.retry = 0;
      this.handlers.onStatus('online');
      this.handlers.onOpen();
    };
    this.ws.onmessage = (e) => {
      try {
        this.handlers.onMessage(JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    this.ws.onclose = () => {
      if (this.closed) return;
      this.handlers.onStatus('offline');
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }
}
