export class PresenceDO {
  state:   DurableObjectState;
  sessions: Map<WebSocket, { userId: string; name: string; avatar?: string }>;

  constructor(state: DurableObjectState) {
    this.state    = state;
    this.sessions = new Map();
    this.state.acceptWebSocket = this.state.acceptWebSocket?.bind(this.state);
  }

  async fetch(request: Request): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);

    const url  = new URL(request.url);
    const meta = { userId: url.searchParams.get('userId') ?? 'anon', name: url.searchParams.get('name') ?? 'Unknown' };
    this.sessions.set(server, meta);

    this.broadcast({ type: 'join', ...meta }, server);
    server.send(JSON.stringify({ type: 'presence', users: this.presentUsers() }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
      const meta = this.sessions.get(ws);
      if (!meta) return;

      if (data.type === 'cursor') {
        this.broadcast({ type: 'cursor', userId: meta.userId, ...data }, ws);
      } else if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch {}
  }

  async webSocketClose(ws: WebSocket) {
    const meta = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (meta) this.broadcast({ type: 'leave', userId: meta.userId, name: meta.name });
  }

  async webSocketError(ws: WebSocket) {
    this.sessions.delete(ws);
  }

  broadcast(payload: object, exclude?: WebSocket) {
    const msg = JSON.stringify(payload);
    for (const [ws] of this.sessions) {
      if (ws !== exclude) {
        try { ws.send(msg); } catch {}
      }
    }
  }

  presentUsers() {
    return Array.from(this.sessions.values());
  }
}
