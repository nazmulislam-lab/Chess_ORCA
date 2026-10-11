// Exindel Chess online server: serves the built app and runs invite-link games
// over a WebSocket at /ws. All game state lives in memory; the server is the
// authority for move legality, clocks and results.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Chess } from 'chess.js';

const PORT = +process.env.PORT || 8787;
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ROOM_TTL = 6 * 3600 * 1000;
const MATCH_TC = '10+0';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------------------------------------------------------------- static files

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(`ok ${rooms.size} rooms`);
  }
  let file = path.join(DIST, path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST)) file = path.join(DIST, 'index.html');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(DIST, 'index.html');
    fs.readFile(file, (err2, data) => {
      if (err2) {
        res.writeHead(404);
        return res.end('Not found — run `npm run build` first.');
      }
      const ext = path.extname(file);
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(data);
    });
  });
});

// ---------------------------------------------------------------- rooms

const rooms = new Map();
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function roomId() {
  let id;
  do id = Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');
  while (rooms.has(id));
  return id;
}

function parseTc(tc) {
  const m = /^(\d{1,2})\+(\d{1,2})$/.exec(tc || '');
  if (!m) return { base: 0, inc: 0 };
  return { base: +m[1] * 60000, inc: +m[2] * 1000 };
}

function resetGame(room) {
  room.chess = new Chess(DEFAULT_FEN);
  room.uci = [];
  room.clock = { w: room.tc.base, b: room.tc.base };
  room.turnStartedAt = Date.now();
  room.result = null;
  room.drawOffer = null;
  room.rematch = new Set();
  room.gameNo = (room.gameNo || 0) + 1;
  clearTimeout(room.flagTimer);
}

function createRoom(tc) {
  const room = { id: roomId(), tc: parseTc(tc), tcLabel: tc, seats: { w: null, b: null }, sockets: new Set(), touched: Date.now() };
  resetGame(room);
  rooms.set(room.id, room);
  return room;
}

const running = (room) => !!room.tc.base && !room.result && room.uci.length >= 2;

function liveClock(room) {
  const clock = { ...room.clock };
  if (running(room)) clock[room.chess.turn()] -= Date.now() - room.turnStartedAt;
  return clock;
}

function publicState(room) {
  const seat = (c) => room.seats[c] && { name: room.seats[c].name, connected: room.seats[c].sockets.size > 0 };
  return {
    t: 'state',
    room: room.id,
    tc: room.tcLabel,
    gameNo: room.gameNo,
    startFen: DEFAULT_FEN,
    uci: room.uci,
    clock: liveClock(room),
    running: running(room),
    players: { w: seat('w'), b: seat('b') },
    result: room.result,
    drawOffer: room.drawOffer,
    rematch: [...room.rematch],
  };
}

function broadcast(room) {
  const msg = JSON.stringify(publicState(room));
  for (const ws of room.sockets) if (ws.readyState === 1) ws.send(msg);
}

function finish(room, score, reason) {
  room.result = { score, reason };
  room.clock = liveClock(room);
  room.drawOffer = null;
  clearTimeout(room.flagTimer);
}

function armFlag(room) {
  clearTimeout(room.flagTimer);
  if (!running(room)) return;
  const side = room.chess.turn();
  room.flagTimer = setTimeout(() => {
    if (room.result || room.chess.turn() !== side) return;
    const left = liveClock(room)[side];
    if (left > 50) return armFlag(room);
    const winner = side === 'w' ? 'b' : 'w';
    const pieces = room.chess.board().flat().filter((p) => p && p.color === winner && p.type !== 'k');
    const canMate = pieces.some((p) => p.type !== 'b' && p.type !== 'n') || pieces.length > 1;
    room.clock[side] = 0;
    finish(room, canMate ? (winner === 'w' ? '1-0' : '0-1') : '1/2-1/2', canMate ? 'time' : 'timeout vs insufficient material');
    broadcast(room);
  }, Math.max(50, liveClock(room)[side]));
}

function applyMove(room, color, uci) {
  if (room.result) return 'The game is over.';
  if (room.chess.turn() !== color) return 'Not your turn.';
  if (!room.seats.w || !room.seats.b) return 'Waiting for your opponent to join.';
  const now = Date.now();
  if (running(room)) {
    room.clock[color] -= now - room.turnStartedAt;
    if (room.clock[color] <= 0) {
      room.clock[color] = 0;
      armFlag(room);
      return 'Out of time.';
    }
  }
  try {
    room.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return 'Illegal move.';
  }
  if (running(room)) room.clock[color] += room.tc.inc;
  room.uci.push(uci);
  room.turnStartedAt = now;
  room.drawOffer = null;
  const c = room.chess;
  if (c.isCheckmate()) finish(room, color === 'w' ? '1-0' : '0-1', 'checkmate');
  else if (c.isStalemate()) finish(room, '1/2-1/2', 'stalemate');
  else if (c.isInsufficientMaterial()) finish(room, '1/2-1/2', 'insufficient material');
  else if (c.isThreefoldRepetition()) finish(room, '1/2-1/2', 'threefold repetition');
  else if (c.isDrawByFiftyMoves()) finish(room, '1/2-1/2', '50-move rule');
  else armFlag(room);
  return null;
}

// ---------------------------------------------------------------- sockets

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

function cleanName(name) {
  return String(name || '').replace(/[<>&"']/g, '').trim().slice(0, 20) || 'Guest';
}

function seatSocket(room, ws, color, token, name) {
  if (!room.seats[color]) room.seats[color] = { token, name, sockets: new Set() };
  const seat = room.seats[color];
  if (name) seat.name = name;
  seat.sockets.add(ws);
  ws.color = color;
}

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === 'create') {
      // Private game: the creator gets a seat and shares the room link.
      unqueue(ws);
      leave(ws);
      const room = createRoom(msg.tc);
      const color = msg.color === 'w' || msg.color === 'b' ? msg.color : Math.random() < 0.5 ? 'w' : 'b';
      const token = crypto.randomBytes(16).toString('hex');
      ws.room = room;
      room.sockets.add(ws);
      seatSocket(room, ws, color, token, cleanName(msg.name));
      send({ t: 'joined', room: room.id, token, color });
      return broadcast(room);
    }
    if (msg.t === 'seek') {
      leave(ws);
      ws.seekName = cleanName(msg.name);
      const other = queue.find((q) => q !== ws && q.readyState === 1);
      if (!other) {
        if (!queue.includes(ws)) queue.push(ws);
        return send({ t: 'seeking', online: wss.clients.size });
      }
      unqueue(other);
      unqueue(ws);
      pair(other, ws);
      return;
    }
    if (msg.t === 'cancel') {
      unqueue(ws);
      return;
    }
    if (msg.t === 'peek') {
      // Invitee looking at a room before choosing a name: state only, no seat.
      const room = rooms.get(String(msg.room || '').toLowerCase());
      if (!room) return send({ t: 'error', code: 'no-room', msg: 'That game link has expired or never existed.' });
      return send(publicState(room));
    }
    if (msg.t === 'join') {
      unqueue(ws);
      leave(ws);
      const room = rooms.get(String(msg.room || '').toLowerCase());
      if (!room) return send({ t: 'error', code: 'no-room', msg: 'That game link has expired or never existed.' });
      ws.room = room;
      room.sockets.add(ws);
      room.touched = Date.now();
      const name = cleanName(msg.name);
      let color = ['w', 'b'].find((c) => room.seats[c] && msg.token && room.seats[c].token === msg.token);
      let token = msg.token;
      if (!color) {
        color = ['w', 'b'].find((c) => !room.seats[c]);
        if (color) token = crypto.randomBytes(16).toString('hex');
      }
      if (color) seatSocket(room, ws, color, token, name);
      send({ t: 'joined', room: room.id, token: color ? token : null, color: color || null });
      return broadcast(room);
    }

    const room = ws.room;
    const color = ws.color;
    if (!room || !color) return;
    room.touched = Date.now();
    const opp = color === 'w' ? 'b' : 'w';
    if (msg.t === 'move') {
      const err = applyMove(room, color, String(msg.uci || '').slice(0, 5));
      if (err) {
        send({ t: 'error', msg: err });
        return send(publicState(room));
      }
    } else if (msg.t === 'resign') {
      if (room.result || !room.uci.length) return;
      finish(room, color === 'w' ? '0-1' : '1-0', (color === 'w' ? 'White' : 'Black') + ' resigned');
    } else if (msg.t === 'draw') {
      if (room.result || !room.uci.length) return;
      if (room.drawOffer === opp) finish(room, '1/2-1/2', 'agreement');
      else room.drawOffer = color;
    } else if (msg.t === 'decline') {
      if (room.drawOffer === opp) room.drawOffer = null;
    } else if (msg.t === 'abort') {
      if (room.result || room.uci.length >= 2) return;
      finish(room, '*', 'aborted');
    } else if (msg.t === 'rematch') {
      if (!room.result) return;
      room.rematch.add(color);
      if (room.rematch.size === 2) {
        [room.seats.w, room.seats.b] = [room.seats.b, room.seats.w];
        for (const c of ['w', 'b']) for (const s of room.seats[c].sockets) s.color = c;
        resetGame(room);
        for (const c of ['w', 'b'])
          for (const s of room.seats[c].sockets) s.readyState === 1 && s.send(JSON.stringify({ t: 'joined', room: room.id, token: room.seats[c].token, color: c }));
      }
    } else return;
    broadcast(room);
  });

  ws.on('close', () => {
    unqueue(ws);
    leave(ws);
  });
});

// ---------------------------------------------------------------- matchmaking

const queue = [];

function unqueue(ws) {
  const i = queue.indexOf(ws);
  if (i >= 0) queue.splice(i, 1);
}

// Seat two waiting players in a fresh room with random colours.
function pair(a, b) {
  const room = createRoom(MATCH_TC);
  const [white, black] = Math.random() < 0.5 ? [a, b] : [b, a];
  for (const [ws, color] of [[white, 'w'], [black, 'b']]) {
    const token = crypto.randomBytes(16).toString('hex');
    ws.room = room;
    room.sockets.add(ws);
    seatSocket(room, ws, color, token, ws.seekName);
    ws.send(JSON.stringify({ t: 'joined', room: room.id, token, color, matched: true }));
  }
  broadcast(room);
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  room.sockets.delete(ws);
  room.touched = Date.now();
  for (const c of ['w', 'b']) room.seats[c]?.sockets.delete(ws);
  ws.room = null;
  ws.color = null;
  broadcast(room);
}

// Keep connections alive through proxies and drop dead ones; expire idle rooms.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) ws.terminate();
    else {
      ws.alive = false;
      ws.ping();
    }
  }
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (!room.sockets.size && now - room.touched > ROOM_TTL) {
      clearTimeout(room.flagTimer);
      rooms.delete(id);
    }
  }
}, 25000);

server.listen(PORT, () => console.log(`Exindel Chess server on http://localhost:${PORT}`));
