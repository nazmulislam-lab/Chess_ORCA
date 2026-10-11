import { Chess } from 'chess.js';
import './pieces.css';
import './style.css';
import { Engine } from './engine.js';
import { sfx } from './sound.js';
import { OnlineClient } from './online.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const FILES = 'abcdefgh';
const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const ENGINE_URL = import.meta.env.BASE_URL + 'engine/stockfish-19-lite-single.js';

// Bot personalities: Stockfish skill level + search budget + a human-ish delay.
const BOTS = [
  { id: 'pip', name: 'Pip', elo: '~500', piece: 'wp', hue: '#a6e3a1', skill: 0, go: 'depth 1', delay: 600, blurb: 'Pip just learned the horsey moves in an L. Be gentle.' },
  { id: 'juno', name: 'Juno', elo: '~900', piece: 'wn', hue: '#94e2d5', skill: 2, go: 'depth 3', delay: 700, blurb: 'Juno loves forks. Watch your knights and queens.' },
  { id: 'brick', name: 'Brick', elo: '~1300', piece: 'wr', hue: '#89b4fa', skill: 6, go: 'depth 6', delay: 700, blurb: 'Brick plays solid, slow chess and punishes loose pieces.' },
  { id: 'vesper', name: 'Vesper', elo: '~1800', piece: 'wb', hue: '#f9e2af', skill: 11, go: 'movetime 500', delay: 500, blurb: 'Vesper sees long diagonals you forgot existed.' },
  { id: 'kraken', name: 'Kraken', elo: '~2300', piece: 'wq', hue: '#fab387', skill: 16, go: 'movetime 900', delay: 300, blurb: 'Kraken drags games into deep water and squeezes.' },
  { id: 'exindel', name: 'Exindel Max', elo: '3000+', piece: 'wk', hue: '#f38ba8', skill: 20, go: 'movetime 1500', delay: 0, blurb: 'Full-strength Stockfish 19. Good luck.' },
];

const THEMES = {
  orchid: { name: 'Orchid', light: '#e9e1fa', dark: '#8d7bc7' },
  lagoon: { name: 'Lagoon', light: '#d8f3ee', dark: '#4e928b' },
  ember: { name: 'Ember', light: '#f8e8d6', dark: '#c27852' },
  graphite: { name: 'Graphite', light: '#d4d8e5', dark: '#5f6582' },
  mocha: { name: 'Mocha', light: '#b9c1dd', dark: '#45475a' },
  sakura: { name: 'Sakura', light: '#fbe3ec', dark: '#c46b8e' },
};

const ACCENTS = {
  mauve: ['#cba6f7', '#fab387'],
  teal: ['#94e2d5', '#89b4fa'],
  peach: ['#fab387', '#f38ba8'],
  blue: ['#89b4fa', '#cba6f7'],
  green: ['#a6e3a1', '#94e2d5'],
};

const TAGS = {
  best: { label: 'Best', sym: '★', cls: 't-best' },
  excellent: { label: 'Excellent', sym: '!', cls: 't-excellent' },
  good: { label: 'Good', sym: '✓', cls: 't-good' },
  inaccuracy: { label: 'Inaccuracy', sym: '?!', cls: 't-inacc' },
  mistake: { label: 'Mistake', sym: '?', cls: 't-mistake' },
  blunder: { label: 'Blunder', sym: '??', cls: 't-blunder' },
};

const TOGGLES = [
  ['coach', 'Live coach', 'Eval bar, move grades and the eval graph while you play'],
  ['lens', 'Threat lens', 'Shade who controls each square and ring hanging pieces'],
  ['legal', 'Legal-move dots', 'Show where the picked-up piece can go'],
  ['coords', 'Coordinates', 'Files and ranks on the board edge'],
  ['view3d', '3D board', 'Orbit a modelled 3D board — drag to rotate, scroll to zoom'],
];

// ---------------------------------------------------------------- state

const S = {
  mode: 'bot',
  startFen: DEFAULT_FEN,
  moves: [],
  view: 0,
  orientation: 'w',
  playerColor: 'w',
  bot: BOTS[2],
  tc: { base: 0, inc: 0 },
  clock: { w: 0, b: 0 },
  clockRunning: false,
  result: null,
  hints: 0,
  gen: 0,
  thinking: false,
  selected: null,
  userArrows: [],
  userMarks: [],
  plan: null,
  online: null,
  resignArmed: 0,
  tab: 'setup',
  setup: { mode: 'bot', botId: 'brick', color: 'w', tc: '0+0', fen: '', name: '' },
  settings: { theme: 'orchid', accent: 'mauve', sound: true, coach: true, lens: false, legal: true, coords: true, autoflip: false, view3d: true },
};

let game = new Chess();
const analyst = new Engine(ENGINE_URL);
const botEngine = new Engine(ENGINE_URL);

const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ }
  },
};

const fenAt = (i) => (i === 0 ? S.startFen : S.moves[i - 1].after);
const isLive = () => S.view === S.moves.length;
// Engine help is never shown during a live online game.
const assist = () => (S.mode === 'online' ? !!S.result : S.mode === 'analysis' || !!S.result || S.settings.coach);
const opp = (c) => (c === 'w' ? 'b' : 'w');

const posCache = new Map();
function posAt(i) {
  const fen = fenAt(i);
  let p = posCache.get(fen);
  if (!p) {
    p = new Chess(fen);
    posCache.set(fen, p);
  }
  return p;
}

// ---------------------------------------------------------------- analysis

const analysisPromises = new Map();
const analysis = new Map();

const winPct = (wcp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * wcp)) - 1);

function analyze(fen) {
  if (analysisPromises.has(fen)) return analysisPromises.get(fen);
  const pos = new Chess(fen);
  const sgn = pos.turn() === 'w' ? 1 : -1;
  let p;
  if (pos.isCheckmate()) {
    p = Promise.resolve({ best: null, pv: [], wcp: -sgn * 10000, mateW: 0 });
  } else if (pos.isGameOver()) {
    p = Promise.resolve({ best: null, pv: [], wcp: 0, mateW: null });
  } else {
    p = analyst.search(fen, 'depth 13').then((r) => {
      let wcp;
      if (r.mate != null) wcp = sgn * (r.mate > 0 ? 10000 - r.mate * 20 : -10000 - r.mate * 20);
      else wcp = sgn * (r.cp ?? 0);
      return { best: r.best, pv: r.pv, wcp, mateW: r.mate != null ? r.mate * sgn : null };
    });
  }
  p = p.then((res) => {
    analysis.set(fen, res);
    scheduleRender();
    return res;
  });
  analysisPromises.set(fen, p);
  return p;
}

function grade(i) {
  const a = analysis.get(fenAt(i - 1));
  const b = analysis.get(fenAt(i));
  if (!a || !b) return null;
  const mv = S.moves[i - 1];
  const sgn = mv.color === 'w' ? 1 : -1;
  const drop = Math.max(0, (winPct(a.wcp) - winPct(b.wcp)) * sgn);
  const uci = mv.from + mv.to + (mv.promotion || '');
  let tag;
  if (uci === a.best) tag = 'best';
  else if (drop < 2) tag = 'excellent';
  else if (drop < 5) tag = 'good';
  else if (drop < 10) tag = 'inaccuracy';
  else if (drop < 20) tag = 'mistake';
  else tag = 'blunder';
  const acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));
  return { tag, drop, acc, best: a.best, bestSan: uciToSan(fenAt(i - 1), a.best) };
}

function uciToSan(fen, uci) {
  if (!uci) return null;
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}

function fmtEval(res) {
  if (!res) return '…';
  if (res.mateW === 0) return '#';
  if (res.mateW != null) return (res.mateW > 0 ? 'M' : '-M') + Math.abs(res.mateW);
  const v = res.wcp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

// ---------------------------------------------------------------- game flow

function rebuildGame() {
  game = new Chess(S.startFen);
  for (const m of S.moves) game.move({ from: m.from, to: m.to, promotion: m.promotion });
}

function parseTc(tc) {
  const [m, inc] = (tc || '0+0').split('+').map(Number);
  return { base: (m || 0) * 60000, inc: (inc || 0) * 1000 };
}

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function newGame(cfg) {
  let start = DEFAULT_FEN;
  if (cfg.fen && cfg.fen.trim()) {
    try {
      start = new Chess(cfg.fen.trim()).fen();
    } catch {
      toast('That FEN is not a legal position.');
      return;
    }
  }
  leaveOnline();
  S.gen++;
  S.mode = cfg.mode;
  S.startFen = start;
  S.moves = [];
  S.view = 0;
  S.result = null;
  S.hints = 0;
  S.thinking = false;
  S.selected = null;
  S.userArrows = [];
  S.userMarks = [];
  S.plan = null;
  S.bot = BOTS.find((b) => b.id === cfg.botId) || BOTS[2];
  const turn = start.split(' ')[1];
  if (S.mode === 'bot') S.playerColor = cfg.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : cfg.color;
  else S.playerColor = turn;
  S.orientation = S.mode === 'bot' ? S.playerColor : turn;
  S.tc = S.mode === 'analysis' ? { base: 0, inc: 0 } : parseTc(cfg.tc);
  S.clock = { w: S.tc.base, b: S.tc.base };
  S.clockRunning = false;
  game = new Chess(start);
  botEngine.send('ucinewgame');
  sfx.play('start');
  closeModal();
  buildBoard();
  b3d?.setOrientation(S.orientation);
  showTab('game');
  analyze(start);
  persistGame();
  render();
  if (S.mode === 'bot' && game.turn() !== S.playerColor) botMove();
}

function makeMove(m) {
  if (S.result) return false;
  if (!isLive()) {
    if (S.mode === 'bot') return false;
    // Analysis / pass & play: playing from an earlier position branches the game.
    S.moves = S.moves.slice(0, S.view);
    rebuildGame();
  }
  let mv;
  try {
    mv = game.move(m);
  } catch {
    sfx.play('illegal');
    return false;
  }
  const mover = mv.color;
  if (S.mode === 'online') {
    S.moves.push(mv);
    S.view = S.moves.length;
    S.selected = null;
    S.userArrows = [];
    S.userMarks = [];
    net?.send({ t: 'move', uci: mv.from + mv.to + (mv.promotion || '') });
    moveSound(mv, game);
    render(true);
    return true;
  }
  if (S.tc.base) {
    if (S.clockRunning) S.clock[mover] += S.tc.inc;
    if (S.moves.length >= 1) startClock();
  }
  S.moves.push(mv);
  S.view = S.moves.length;
  S.selected = null;
  S.userArrows = [];
  S.userMarks = [];
  S.plan = null;

  moveSound(mv, game);

  analyze(mv.after);
  checkEnd();
  persistGame();
  render(true);

  if (S.mode === 'local' && S.settings.autoflip && !S.result) {
    setTimeout(() => {
      S.orientation = game.turn();
      buildBoard();
      render();
    }, 450);
  }
  if (S.mode === 'bot' && !S.result && game.turn() !== S.playerColor) botMove();
  return true;
}

function moveSound(mv, pos) {
  if (pos.inCheck()) sfx.play('check');
  else if (mv.promotion) sfx.play('promote');
  else if (mv.captured) sfx.play('capture');
  else if (mv.flags.includes('k') || mv.flags.includes('q')) sfx.play('castle');
  else sfx.play('move');
}

async function botMove() {
  const gen = S.gen;
  const fen = game.fen();
  const bot = S.bot;
  S.thinking = true;
  renderPlayers();
  const t0 = performance.now();
  const r = await botEngine.search(fen, bot.go, [`setoption name Skill Level value ${bot.skill}`]);
  const wait = bot.delay - (performance.now() - t0);
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
  if (gen !== S.gen || game.fen() !== fen || S.result) return;
  S.thinking = false;
  if (!r.best) return;
  makeMove({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] });
}

function checkEnd() {
  if (game.isCheckmate()) endGame(game.turn() === 'w' ? '0-1' : '1-0', 'checkmate');
  else if (game.isStalemate()) endGame('1/2-1/2', 'stalemate');
  else if (game.isInsufficientMaterial()) endGame('1/2-1/2', 'insufficient material');
  else if (game.isThreefoldRepetition()) endGame('1/2-1/2', 'threefold repetition');
  else if (game.isDrawByFiftyMoves()) endGame('1/2-1/2', '50-move rule');
}

function endGame(score, reason) {
  if (S.mode === 'analysis' && reason !== 'checkmate' && reason !== 'stalemate') return;
  S.result = { score, reason };
  S.clockRunning = false;
  S.thinking = false;
  S.gen++;
  sfx.play('end');
  persistGame();
  render();
  setTimeout(showSummary, 700);
}

function takeback() {
  if (!S.moves.length) return;
  S.gen++;
  S.thinking = false;
  S.result = null;
  if (S.mode === 'bot') {
    // Pop back through the player's last move so it's their turn again.
    let popped;
    do popped = S.moves.pop();
    while (popped && popped.color !== S.playerColor && S.moves.length);
  } else {
    S.moves.pop();
  }
  rebuildGame();
  S.view = S.moves.length;
  S.selected = null;
  S.plan = null;
  persistGame();
  render();
  if (S.mode === 'bot' && game.turn() !== S.playerColor) botMove();
}

function resign() {
  if (S.mode === 'online' && !S.result) {
    if (!S.online?.color) return;
    if (S.moves.length < 2) return net?.send({ t: 'abort' });
    // Two-step confirm so a stray click doesn't throw a real game away.
    if (Date.now() - S.resignArmed > 3000) {
      S.resignArmed = Date.now();
      renderTools();
      setTimeout(renderTools, 3100);
      return;
    }
    S.resignArmed = 0;
    return net?.send({ t: 'resign' });
  }
  if (S.result || S.mode === 'analysis' || !S.moves.length) {
    showTab('setup');
    return;
  }
  const loser = S.mode === 'bot' ? S.playerColor : game.turn();
  endGame(loser === 'w' ? '0-1' : '1-0', (loser === 'w' ? 'White' : 'Black') + ' resigned');
}

// Rewind to the player's worst move and let them try again.
function retryWorst() {
  let worst = null;
  for (let i = 1; i <= S.moves.length; i++) {
    if (S.moves[i - 1].color !== S.playerColor) continue;
    const g = grade(i);
    if (g && (!worst || g.drop > worst.g.drop)) worst = { i, g };
  }
  if (!worst || worst.g.drop < 5) return;
  S.gen++;
  S.moves = S.moves.slice(0, worst.i - 1);
  S.result = null;
  S.thinking = false;
  S.view = S.moves.length;
  rebuildGame();
  if (S.tc.base) S.clock[S.playerColor] = Math.max(S.clock[S.playerColor], 60000);
  S.clockRunning = false;
  closeModal();
  showTab('game');
  persistGame();
  render();
  toast(`You played a ${TAGS[worst.g.tag].label.toLowerCase()} from here. Find something better!`);
}

// ---------------------------------------------------------------- clock

function startClock() {
  if (!S.clockRunning) {
    S.clockRunning = true;
    lastTick = performance.now();
  }
}
let lastTick = 0;
setInterval(() => {
  if (!S.clockRunning || S.result || !S.tc.base) return;
  const now = performance.now();
  const side = game.turn();
  S.clock[side] -= now - lastTick;
  lastTick = now;
  if (S.clock[side] <= 0 && S.mode === 'online') S.clock[side] = 0;
  else if (S.clock[side] <= 0) {
    S.clock[side] = 0;
    const winner = opp(side);
    const winnerMat = new Chess(game.fen()).board().flat().filter((p) => p && p.color === winner && p.type !== 'k');
    const canMate = winnerMat.some((p) => p.type !== 'b' && p.type !== 'n') || winnerMat.length > 1;
    endGame(canMate ? (winner === 'w' ? '1-0' : '0-1') : '1/2-1/2', canMate ? 'time' : 'timeout vs insufficient material');
  }
  renderClocks();
}, 100);

function fmtClock(ms) {
  if (!S.tc.base) return '';
  const s = Math.max(0, ms) / 1000;
  if (s < 20) return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const t = Math.ceil(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- board

const boardEl = $('#board');
const sqEls = new Map();

function buildBoard() {
  boardEl.innerHTML = '';
  sqEls.clear();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const file = S.orientation === 'w' ? f : 7 - f;
      const rank = S.orientation === 'w' ? 8 - r : r + 1;
      const sq = FILES[file] + rank;
      const el = document.createElement('div');
      el.dataset.sq = sq;
      el.dataset.base = 'sq ' + ((file + rank) % 2 === 1 ? 'dark' : 'light');
      el.className = el.dataset.base;
      if (f === 0) el.insertAdjacentHTML('beforeend', `<span class="coord rank">${rank}</span>`);
      if (r === 7) el.insertAdjacentHTML('beforeend', `<span class="coord file">${FILES[file]}</span>`);
      const layer = document.createElement('div');
      layer.className = 'layer';
      el.appendChild(layer);
      boardEl.appendChild(el);
      sqEls.set(sq, el);
    }
  }
}

function sqOffset(sq) {
  const f = FILES.indexOf(sq[0]);
  const r = +sq[1];
  return S.orientation === 'w' ? [f, 8 - r] : [7 - f, r - 1];
}

function renderBoard(animate = false) {
  const pos = posAt(S.view);
  const last = S.view ? S.moves[S.view - 1] : null;
  const legal = S.selected ? pos.moves({ square: S.selected, verbose: true }) : [];
  const targets = new Set(legal.map((m) => m.to));
  const checkSq = pos.inCheck() ? findKing(pos, pos.turn()) : null;
  const lens = S.settings.lens;
  const me = S.orientation;
  const g = last && assist() ? grade(S.view) : null;
  if (b3d) return renderBoard3D(pos, last, legal, checkSq, g, animate);
  boardEl.classList.toggle('no-coords', !S.settings.coords);

  for (const [sq, el] of sqEls) {
    const piece = pos.get(sq);
    const cls = [el.dataset.base];
    if (last && (sq === last.from || sq === last.to)) cls.push('last');
    if (sq === S.selected) cls.push('sel');
    if (sq === checkSq) cls.push('check');
    if (targets.has(sq) && S.settings.legal) cls.push(piece ? 'cap-target' : 'move-target');
    el.className = cls.join(' ');

    let html = '';
    if (lens) {
      const w = pos.attackers(sq, 'w').length;
      const b = pos.attackers(sq, 'b').length;
      const d = w - b;
      if (d) html += `<i class="heat ${d > 0 ? 'hw' : 'hb'}" style="--a:${Math.min(0.6, 0.14 + Math.abs(d) * 0.13)}"></i>`;
      if (piece && piece.type !== 'k' && isHanging(pos, sq, piece)) html += `<i class="hang ${piece.color === me ? 'mine' : 'theirs'}"></i>`;
    }
    if (piece) html += `<div class="pc ${piece.color}${piece.type}"></div>`;
    if (g && last && sq === last.to) html += `<b class="badge ${TAGS[g.tag].cls}" title="${TAGS[g.tag].label}">${TAGS[g.tag].sym}</b>`;
    el.lastChild.innerHTML = html;
  }

  if (animate && last) {
    const pc = sqEls.get(last.to)?.querySelector('.pc');
    if (pc) {
      const [fx, fy] = sqOffset(last.from);
      const [tx, ty] = sqOffset(last.to);
      pc.style.transition = 'none';
      pc.style.transform = `translate(${(fx - tx) * 100}%, ${(fy - ty) * 100}%)`;
      pc.style.zIndex = 5;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          pc.style.transition = 'transform 160ms cubic-bezier(.3,.7,.3,1)';
          pc.style.transform = '';
        }),
      );
    }
  }
  renderArrows(pos, g);
}

function findKing(pos, color) {
  for (const row of pos.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}

function isHanging(pos, sq, piece) {
  const attackers = pos.attackers(sq, opp(piece.color));
  if (!attackers.length) return false;
  const defenders = pos.attackers(sq, piece.color);
  if (!defenders.length) return true;
  const cheapest = Math.min(...attackers.map((s) => VALUE[pos.get(s).type] || 99));
  return cheapest < VALUE[piece.type];
}

function arrowSvg(from, to, color, opts = {}) {
  const [fx, fy] = sqOffset(from);
  const [tx, ty] = sqOffset(to);
  const x1 = fx * 100 + 50, y1 = fy * 100 + 50, x2 = tx * 100 + 50, y2 = ty * 100 + 50;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const w = opts.width || 18;
  const head = w * 2.2;
  const ex = x2 - Math.cos(ang) * head * 0.9;
  const ey = y2 - Math.sin(ang) * head * 0.9;
  const sx = x1 + Math.cos(ang) * 22;
  const sy = y1 + Math.sin(ang) * 22;
  const px = Math.cos(ang + Math.PI / 2) * head * 0.62;
  const py = Math.sin(ang + Math.PI / 2) * head * 0.62;
  const op = opts.opacity ?? 0.85;
  const dash = opts.dashed ? ` stroke-dasharray="${w * 1.2} ${w * 0.9}"` : '';
  return `<g opacity="${op}"><line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"${dash}/>` +
    `<polygon points="${x2},${y2} ${ex + px},${ey + py} ${ex - px},${ey - py}" fill="${color}"/>` +
    (opts.label ? `<circle cx="${ex}" cy="${ey}" r="17" fill="${color}"/><text x="${ex}" y="${ey + 6}" text-anchor="middle" font-size="18" font-weight="800" fill="#11111b">${opts.label}</text>` : '') +
    `</g>`;
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function arrowList(pos, g) {
  const list = [];
  // Plan preview first so it draws underneath everything else.
  if (S.plan && S.plan.fen === pos.fen()) {
    const colors = [cssVar('--green'), cssVar('--red'), cssVar('--green')];
    S.plan.pv.slice(0, 3).forEach((u, i) => {
      list.unshift({ from: u.slice(0, 2), to: u.slice(2, 4), color: colors[i], opacity: i ? 0.55 : 0.9, width: i ? 13 : 18, label: i + 1 });
    });
  }
  // Coach: when reviewing a slip, show what the engine preferred instead.
  if (g && ['inaccuracy', 'mistake', 'blunder'].includes(g.tag) && g.best) {
    list.push({ from: g.best.slice(0, 2), to: g.best.slice(2, 4), color: cssVar('--blue'), opacity: 0.75, width: 18, dashed: true });
  }
  for (const [from, to] of S.userArrows) list.push({ from, to, color: cssVar('--accent'), opacity: 0.8, width: 18 });
  return list;
}

function renderArrows(pos, g) {
  let svg = '';
  const accent = cssVar('--accent');
  for (const a of arrowList(pos, g)) svg += arrowSvg(a.from, a.to, a.color, a);
  for (const sq of S.userMarks) {
    const [x, y] = sqOffset(sq);
    svg += `<circle cx="${x * 100 + 50}" cy="${y * 100 + 50}" r="44" fill="none" stroke="${accent}" stroke-width="7" opacity=".85"/>`;
  }
  $('#arrows').innerHTML = svg;
}

// ---------------------------------------------------------------- input

function canPick(pos, piece) {
  if (!piece || S.result || S.thinking) return false;
  if (piece.color !== pos.turn()) return false;
  if (S.mode === 'bot') return isLive() && piece.color === S.playerColor;
  if (S.mode === 'online') return isLive() && piece.color === S.online?.color && !!S.online.players?.w && !!S.online.players?.b;
  return true;
}

// Click-to-move, shared by the 2D board and the 3D view.
function clickSquare(sq) {
  const pos = posAt(S.view);
  const piece = pos.get(sq);
  S.userArrows = [];
  S.userMarks = [];
  if (S.selected && S.selected !== sq && tryMove(S.selected, sq)) return;
  if (canPick(pos, piece) && S.selected !== sq) {
    S.selected = sq;
  } else {
    if (piece && (S.mode === 'bot' || S.mode === 'online') && !isLive()) toast('Jump to the live position (End) to move.');
    S.selected = null;
  }
  renderBoard();
}
window.clickSquare = clickSquare;
window.S = S;

let drag = null;
let rightStart = null;

boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

boardEl.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.sq');
  if (!el) return;
  const sq = el.dataset.sq;
  if (e.button === 2) {
    rightStart = sq;
    return;
  }
  if (e.button !== 0) return;
  if (S.userArrows.length || S.userMarks.length) {
    S.userArrows = [];
    S.userMarks = [];
  }
  const pos = posAt(S.view);
  const piece = pos.get(sq);
  if (S.selected && S.selected !== sq && tryMove(S.selected, sq)) return;
  if (canPick(pos, piece)) {
    S.selected = sq;
    renderBoard();
    const pcEl = el.querySelector('.pc');
    if (pcEl) {
      const rect = el.getBoundingClientRect();
      const ghost = pcEl.cloneNode();
      ghost.classList.add('ghost');
      ghost.style.width = ghost.style.height = rect.width + 'px';
      document.body.appendChild(ghost);
      pcEl.classList.add('lifted');
      drag = { from: sq, ghost, size: rect.width, moved: false, x0: e.clientX, y0: e.clientY };
      moveGhost(e);
      boardEl.setPointerCapture(e.pointerId);
    }
  } else {
    if (piece && (S.mode === 'bot' || S.mode === 'online') && !isLive()) toast('Jump to the live position (End) to move.');
    S.selected = null;
    renderBoard();
  }
});

function moveGhost(e) {
  if (!drag) return;
  drag.ghost.style.transform = `translate(${e.clientX - drag.size / 2}px, ${e.clientY - drag.size / 2}px)`;
  if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true;
}

boardEl.addEventListener('pointermove', moveGhost);

boardEl.addEventListener('pointerup', (e) => {
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.sq')?.dataset.sq;
  if (e.button === 2) {
    if (rightStart && target) {
      if (target === rightStart) toggle(S.userMarks, (m) => m === target, target);
      else toggle(S.userArrows, (a) => a[0] === rightStart && a[1] === target, [rightStart, target]);
      renderBoard();
    }
    rightStart = null;
    return;
  }
  if (!drag) return;
  const { from, ghost } = drag;
  ghost.remove();
  drag = null;
  if (target && target !== from) {
    if (!tryMove(from, target)) {
      S.selected = null;
      renderBoard();
    }
  } else {
    renderBoard();
  }
});

function toggle(list, match, item) {
  const i = list.findIndex(match);
  if (i >= 0) list.splice(i, 1);
  else list.push(item);
}

function tryMove(from, to) {
  const pos = posAt(S.view);
  const cands = pos.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!cands.length) return false;
  if (cands.some((m) => m.promotion)) {
    askPromotion(from, to, pos.turn());
    return true;
  }
  return makeMove({ from, to });
}

function askPromotion(from, to, color) {
  const promo = $('#promo');
  const [x, y] = sqOffset(to);
  const down = y === 0;
  promo.classList.toggle('center', !!b3d);
  promo.innerHTML = ['q', 'n', 'r', 'b']
    .map((t, i) => `<button data-p="${t}"${b3d ? '' : ` style="left:${x * 12.5}%;top:${(down ? i : 7 - i) * 12.5}%"`}><span class="pc ${color}${t}"></span></button>`)
    .join('');
  promo.hidden = false;
  promo.onclick = (e) => {
    const b = e.target.closest('button');
    promo.hidden = true;
    S.selected = null;
    if (b) makeMove({ from, to, promotion: b.dataset.p });
    else renderBoard();
  };
}

// ---------------------------------------------------------------- panels

function renderPlayers() {
  const bottom = S.orientation;
  renderPlayer($('#playerBottom'), bottom);
  renderPlayer($('#playerTop'), opp(bottom));
}

function playerInfo(color) {
  if (S.mode === 'online') {
    const o = S.online || {};
    if (o.seeking) {
      const me = color === S.orientation;
      return { name: me ? esc(S.setup.name || 'You') : 'Searching…', sub: me ? 'You' : 'finding an opponent', piece: color + 'k', hue: me ? 'var(--accent)' : '#89dceb' };
    }
    const p = o.players?.[color];
    const mine = color === o.color;
    const sub = !p ? 'waiting…' : mine ? 'You' : p.connected ? '● online' : '○ reconnecting…';
    return { name: p ? esc(p.name) : 'Open seat', sub, piece: color + 'k', hue: mine ? 'var(--accent)' : '#89dceb', offline: p && !p.connected };
  }
  if (S.mode === 'bot') {
    if (color === S.playerColor) return { name: 'You', sub: color === 'w' ? 'White' : 'Black', piece: color + 'k', hue: 'var(--accent)' };
    return { name: S.bot.name, sub: S.bot.elo, piece: color + S.bot.piece[1], hue: S.bot.hue, bot: true };
  }
  return { name: color === 'w' ? 'White' : 'Black', sub: S.mode === 'analysis' ? 'Analysis' : 'Pass & play', piece: color + 'k', hue: color === 'w' ? '#cdd6f4' : '#585b70' };
}

function material(pos) {
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  let diff = 0;
  for (const row of pos.board())
    for (const p of row) {
      if (!p || p.type === 'k') continue;
      count[p.color][p.type]++;
      diff += (p.color === 'w' ? 1 : -1) * VALUE[p.type];
    }
  return { count, diff };
}

// Pieces missing relative to the game's own start position (works for custom FENs).
function captured(pos) {
  const start = material(posAt(0)).count;
  const now = material(pos);
  const count = { w: {}, b: {} };
  for (const c of ['w', 'b']) for (const t in start[c]) count[c][t] = start[c][t] - now.count[c][t];
  return { count, diff: now.diff };
}

function renderPlayer(el, color) {
  const info = playerInfo(color);
  const pos = posAt(S.view);
  const { count, diff } = captured(pos);
  const taken = opp(color);
  let caps = '';
  for (const t of ['q', 'r', 'b', 'n', 'p']) for (let i = 0; i < Math.max(0, count[taken][t]); i++) caps += `<span class="pc ${taken}${t}"></span>`;
  const adv = color === 'w' ? diff : -diff;
  const active = !S.result && game.turn() === color;
  const thinking = info.bot && S.thinking;
  el.className = 'player' + (active ? ' active' : '');
  el.innerHTML =
    `<div class="avatar" style="--hue:${info.hue}"><span class="pc ${info.piece}"></span></div>` +
    `<div class="pinfo"><div class="pname">${info.name} <small>${info.sub}</small>${thinking ? '<span class="dots"><i></i><i></i><i></i></span>' : ''}</div>` +
    `<div class="caps">${caps}${adv > 0 ? `<em>+${adv}</em>` : ''}</div></div>` +
    (S.tc.base ? `<div class="clock" data-c="${color}">${fmtClock(S.clock[color])}</div>` : '');
  renderClocks();
}

function renderClocks() {
  for (const el of $$('.clock')) {
    const c = el.dataset.c;
    el.textContent = fmtClock(S.clock[c]);
    el.classList.toggle('running', S.clockRunning && !S.result && game.turn() === c);
    el.classList.toggle('low', S.clock[c] < 20000);
  }
}

function renderEvalBar() {
  const bar = $('#evalbar');
  bar.classList.toggle('hidden', !assist());
  bar.classList.toggle('flipped', S.orientation === 'b');
  const res = analysis.get(fenAt(S.view));
  const pct = res ? winPct(res.wcp) : 50;
  bar.querySelector('.eval-fill').style.height = pct + '%';
  const label = bar.querySelector('.eval-label');
  label.textContent = fmtEval(res);
  label.classList.toggle('on-white', pct >= 50);
}

function renderMoves() {
  const el = $('#moves');
  const firstBlack = S.startFen.split(' ')[1] === 'b';
  const startNo = +S.startFen.split(' ')[5] || 1;
  const show = assist();
  let html = '';
  const cell = (i) => {
    const m = S.moves[i - 1];
    if (!m) return '<span class="mv empty"></span>';
    const g = show ? grade(i) : null;
    const badge = g && g.tag !== 'good' && g.tag !== 'excellent' ? `<b class="mini-badge ${TAGS[g.tag].cls}">${TAGS[g.tag].sym}</b>` : '';
    return `<button class="mv${i === S.view ? ' cur' : ''}" data-ply="${i}">${m.san}${badge}</button>`;
  };
  let ply = 1;
  let no = startNo;
  if (firstBlack && S.moves.length) {
    html += `<div class="row"><span class="no">${no}.</span><span class="mv empty">…</span>${cell(1)}</div>`;
    ply = 2;
    no++;
  }
  for (; ply <= S.moves.length; ply += 2, no++) html += `<div class="row"><span class="no">${no}.</span>${cell(ply)}${cell(ply + 1)}</div>`;
  if (!S.moves.length) {
    let note = 'Make a move — drag or click a piece. Right-drag to draw arrows.';
    if (S.mode === 'bot' && S.playerColor !== game.turn()) note = `${S.bot.name} is thinking…`;
    if (S.mode === 'online') {
      const o = S.online || {};
      if (o.seeking) note = 'Searching for an opponent…';
      else if (o.needName) note = 'Enter your name to join the game.';
      else if (!o.players?.w || !o.players?.b) note = o.kind === 'friend' ? 'Waiting for your friend to open the link…' : 'Waiting for your opponent…';
      else if (!o.color) note = 'You are watching this game.';
      else note = o.color === game.turn() ? 'Your move — the game is on!' : 'Waiting for your opponent’s first move…';
    }
    html = `<p class="empty-note">${note}</p>`;
  }
  if (S.result) html += `<div class="result-row">${S.result.score.replace('1/2', '½')} · ${S.result.reason}</div>`;
  el.innerHTML = html;
  el.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
}

function renderGraph() {
  const svg = $('#graph');
  const card = svg.parentElement;
  card.classList.toggle('hidden', !assist());
  const n = S.moves.length;
  if (!assist()) return;
  const W = 300, H = 64;
  const x = (i) => (n ? (i / n) * W : 0);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const r = analysis.get(fenAt(i));
    if (r) pts.push([x(i), H - (winPct(r.wcp) / 100) * H, i]);
  }
  let out = `<rect width="${W}" height="${H / 2}" class="g-top"/><rect y="${H / 2}" width="${W}" height="${H / 2}" class="g-bot"/>`;
  if (pts.length > 1) {
    const line = pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    out += `<polygon class="g-area" points="0,${H} ${line} ${pts[pts.length - 1][0]},${H}"/><polyline class="g-line" points="${line}"/>`;
  }
  out += `<line class="g-mid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/>`;
  out += `<line class="g-cursor" x1="${x(S.view)}" x2="${x(S.view)}" y1="0" y2="${H}"/>`;
  for (let i = 1; i <= n; i++) {
    const g = grade(i);
    const r = analysis.get(fenAt(i));
    if (g && r && ['mistake', 'blunder', 'inaccuracy'].includes(g.tag)) {
      out += `<circle class="g-dot ${TAGS[g.tag].cls}" cx="${x(i)}" cy="${H - (winPct(r.wcp) / 100) * H}" r="3.2"/>`;
    }
  }
  svg.innerHTML = out;
}

function renderCoach() {
  const el = $('#coach');
  if (S.mode === 'online' && !S.result) {
    el.innerHTML = `<p class="muted">Engine help is off during online games — it switches on for both players once the game ends.</p>`;
    return;
  }
  if (!assist()) {
    el.innerHTML = `<p class="muted">Coach is hidden while you play. Toggle <b>Live coach</b> in Style, or review after the game.</p>`;
    return;
  }
  const res = analysis.get(fenAt(S.view));
  let html = `<div class="coach-eval">${fmtEval(res)}</div>`;
  if (S.view === 0) {
    html += `<div class="coach-text">Starting position${res?.best ? ` · engine likes <b>${uciToSan(fenAt(0), res.best)}</b>` : ''}</div>`;
  } else {
    const m = S.moves[S.view - 1];
    const g = grade(S.view);
    if (!g) html += `<div class="coach-text"><b>${m.san}</b> · analysing…</div>`;
    else {
      const t = TAGS[g.tag];
      const article = g.tag === 'best' ? 'the' : /^[aeiou]/i.test(t.label) ? 'an' : 'a';
      html += `<div class="coach-text"><span class="tag ${t.cls}">${t.sym}</span><b>${m.san}</b> is ${article} ${t.label.toLowerCase()} move.`;
      if (g.tag !== 'best' && g.bestSan) html += ` <span class="muted">Best was <b>${g.bestSan}</b>.</span>`;
      html += `</div>`;
    }
  }
  el.innerHTML = html;
}

function renderTools() {
  const online = S.mode === 'online';
  $('[data-act="lens"]').classList.toggle('on', S.settings.lens);
  $('[data-act="hint"]').classList.toggle('on', !!S.plan);
  $('[data-act="hint"]').disabled = online && !S.result;
  $('[data-act="3d"]').classList.toggle('on', S.settings.view3d);
  const r = $('[data-act="resign"]');
  let label;
  if (online && !S.result) label = S.moves.length < 2 ? 'Abort' : Date.now() - S.resignArmed < 3000 ? 'Sure?' : 'Resign';
  else label = S.result || S.mode === 'analysis' || !S.moves.length ? 'New' : 'Resign';
  r.lastChild.textContent = label;
  r.classList.toggle('danger', label !== 'New');
  r.classList.toggle('armed', label === 'Sure?');
  r.disabled = online && !S.result && !S.online?.color;
  const undo = $('[data-act="undo"]');
  undo.hidden = online;
  undo.disabled = !S.moves.length;
  const draw = $('[data-act="draw"]');
  draw.hidden = !online;
  if (online) {
    const o = S.online || {};
    const theirOffer = o.drawOffer && o.drawOffer !== o.color;
    const mineOffer = !!o.color && o.drawOffer === o.color;
    draw.lastChild.textContent = theirOffer ? 'Accept draw' : mineOffer ? 'Offered' : 'Draw';
    draw.classList.toggle('on', !!theirOffer);
    draw.disabled = !!S.result || !o.color || S.moves.length < 2 || mineOffer;
  }
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render(animate = false) {
  renderOnlineCard();
  renderBoard(animate);
  renderPlayers();
  renderEvalBar();
  renderMoves();
  renderGraph();
  renderCoach();
  renderTools();
}

// ---------------------------------------------------------------- plan / hint

async function showPlan() {
  if (S.plan) {
    S.plan = null;
    renderBoard();
    return;
  }
  if (S.mode === 'online' && !S.result) return toast('Engine help is off during online games.');
  const fen = fenAt(S.view);
  const pos = posAt(S.view);
  if (pos.isGameOver()) return;
  if (S.mode === 'bot' && !S.result) S.hints++;
  const res = await analyze(fen);
  if (fenAt(S.view) !== fen || !res.pv?.length) return;
  S.plan = { fen, pv: res.pv };
  sfx.play('hint');
  render();
  const sans = [];
  const c = new Chess(fen);
  for (const u of res.pv.slice(0, 3)) {
    try { sans.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; }
  }
  toast(`Plan: ${sans.join('  →  ')}`);
}

// ---------------------------------------------------------------- modal

function closeModal() {
  $('#modal').hidden = true;
}

async function showSummary() {
  const modal = $('#modal');
  const card = $('#modalCard');
  const { score, reason } = S.result;
  let title;
  if (score === '1/2-1/2') title = 'Draw';
  else if (S.mode === 'bot') title = (score === '1-0') === (S.playerColor === 'w') ? 'You won!' : `${S.bot.name} wins`;
  else if (S.mode === 'online' && S.online?.color) title = (score === '1-0') === (S.online.color === 'w') ? 'You won!' : 'You lost';
  else if (score === '*') title = 'Game aborted';
  else title = score === '1-0' ? 'White wins' : 'Black wins';
  card.innerHTML = `<h2>${title}</h2><p class="muted">by ${reason}</p><div class="summary"><p class="muted">Reviewing ${S.moves.length} moves…</p></div>`;
  modal.hidden = false;
  await Promise.all(Array.from({ length: S.moves.length + 1 }, (_, i) => analyze(fenAt(i))));
  if (!S.result || modal.hidden) return;

  const stats = { w: { acc: [], tags: {} }, b: { acc: [], tags: {} } };
  let worstMine = null;
  for (let i = 1; i <= S.moves.length; i++) {
    const g = grade(i);
    const c = S.moves[i - 1].color;
    if (!g) continue;
    stats[c].acc.push(g.acc);
    stats[c].tags[g.tag] = (stats[c].tags[g.tag] || 0) + 1;
    if (S.mode === 'bot' && c === S.playerColor && (!worstMine || g.drop > worstMine.drop)) worstMine = g;
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const col = (c) => {
    const info = playerInfo(c);
    const rows = Object.keys(TAGS)
      .map((t) => `<li><span class="tag ${TAGS[t].cls}">${TAGS[t].sym}</span>${TAGS[t].label}<b>${stats[c].tags[t] || 0}</b></li>`)
      .join('');
    return `<div class="sum-col"><div class="sum-head"><span class="avatar sm" style="--hue:${info.hue}"><span class="pc ${info.piece}"></span></span>${info.name}</div>` +
      `<div class="acc">${avg(stats[c].acc).toFixed(1)}<small>accuracy</small></div><ul>${rows}</ul></div>`;
  };
  const canRetry = worstMine && worstMine.drop >= 5;
  card.querySelector('.summary').innerHTML =
    `<div class="sum-grid">${col('w')}${col('b')}</div>` +
    (S.mode === 'bot' && S.hints ? `<p class="muted center">You used ${S.hints} plan hint${S.hints > 1 ? 's' : ''}.</p>` : '') +
    `<div class="modal-actions">` +
    (canRetry ? `<button class="cta" data-m="retry">Retry my worst move</button>` : '') +
    (S.mode === 'online'
      ? (S.online?.color ? `<button class="cta" data-m="rematch" id="rematchBtn">${rematchLabel()}</button>` : '') + (S.online?.kind === 'random' ? `<button class="ghost-btn" data-m="newopp">New opponent</button>` : '')
      : `<button class="${canRetry ? 'ghost-btn' : 'cta'}" data-m="rematch">${S.mode === 'bot' ? 'Rematch' : 'New game'}</button>`) +
    `<button class="ghost-btn" data-m="review">Review</button></div>`;
  card.onclick = (e) => {
    const a = e.target.closest('[data-m]')?.dataset.m;
    if (a === 'retry') retryWorst();
    else if (a === 'rematch' && S.mode === 'online') net?.send({ t: 'rematch' });
    else if (a === 'newopp') startOnline({ seek: true });
    else if (a === 'rematch') newGame({ ...S.setup, mode: S.mode, botId: S.bot.id, color: S.setup.color });
    else if (a === 'review') closeModal();
  };
}

$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------------------------------------------------------------- setup / style UI

function showTab(tab) {
  S.tab = tab;
  for (const b of $$('.tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const t of $$('.tab')) t.classList.toggle('on', t.id === 'tab-' + tab);
  for (const b of $$('.nav-item[data-nav]')) {
    const n = b.dataset.nav;
    b.classList.toggle('on', n === tab || (tab === 'setup' && n === S.setup.mode));
  }
}

function renderSetup() {
  const s = S.setup;
  for (const b of $$('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === s.mode);
  for (const b of $$('#colorSeg button')) b.classList.toggle('on', b.dataset.color === s.color);
  for (const b of $$('#tcSeg button')) b.classList.toggle('on', b.dataset.tc === s.tc);
  $('#botPick').hidden = s.mode !== 'bot';
  const net_ = s.mode === 'online' || s.mode === 'friend';
  $('#onlinePick').hidden = !net_;
  $('#colorPick').hidden = s.mode !== 'bot' && s.mode !== 'friend';
  $('#tcPick').hidden = s.mode === 'analysis' || s.mode === 'online';
  $('#fenPick').hidden = net_;
  $('#onlineHint').innerHTML =
    s.mode === 'friend'
      ? 'Create a private game and send the link to a friend. Whoever opens it plays you — no account needed.'
      : 'Enter your name and press <b>Find opponent</b>. You’ll be paired with the next player who’s looking — colours are random, 10 minutes each.';
  $('#fenInput').value = s.fen;
  $('#nameInput').value = s.name || '';
  $('#bots').innerHTML = BOTS.map(
    (b) => `<button class="bot${b.id === s.botId ? ' on' : ''}" data-bot="${b.id}" style="--hue:${b.hue}"><span class="avatar"><span class="pc ${b.piece}"></span></span><span class="bname">${b.name}</span><span class="belo">${b.elo}</span></button>`,
  ).join('');
  const bot = BOTS.find((b) => b.id === s.botId);
  $('#botBubble').innerHTML = `<b>${bot.name}</b> ${bot.blurb}`;
  $('#startBtn').textContent = { analysis: 'Open analysis board', friend: 'Create invite link', online: 'Find opponent' }[s.mode] || `Play ${bot.name}`;
  if (S.tab === 'setup') showTab('setup');
}

function renderStyle() {
  const st = S.settings;
  $('#themes').innerHTML = Object.entries(THEMES)
    .map(([id, t]) => `<button class="theme${st.theme === id ? ' on' : ''}" data-theme="${id}"><span class="sw" style="--l:${t.light};--d:${t.dark}"></span>${t.name}</button>`)
    .join('');
  $('#accents').innerHTML = Object.entries(ACCENTS)
    .map(([id, [a, b]]) => `<button class="accent${st.accent === id ? ' on' : ''}" data-accent="${id}" title="${id}" style="--a:${a};--b:${b}"></button>`)
    .join('');
  $('#toggles').innerHTML = TOGGLES.map(
    ([k, label, desc]) => `<label class="tg"><span><b>${label}</b><small>${desc}</small></span><input type="checkbox" data-set="${k}"${st[k] ? ' checked' : ''}/><i></i></label>`,
  ).join('');
  applyStyle();
}

function applyStyle() {
  const st = S.settings;
  const root = document.documentElement.style;
  const t = THEMES[st.theme] || THEMES.orchid;
  root.setProperty('--sq-light', t.light);
  root.setProperty('--sq-dark', t.dark);
  const [a, b] = ACCENTS[st.accent] || ACCENTS.mauve;
  root.setProperty('--accent', a);
  root.setProperty('--accent-2', b);
  sfx.enabled = st.sound;
  $('#soundToggle').classList.toggle('off', !st.sound);
  store.set('orca.settings', st);
}

$('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) showTab(b.dataset.tab);
});

$('.nav').addEventListener('click', (e) => {
  const n = e.target.closest('[data-nav]')?.dataset.nav;
  if (!n) return;
  if (n === 'game' || n === 'style') showTab(n);
  else {
    S.setup.mode = n;
    showTab('setup');
    renderSetup();
  }
});

$('#tab-setup').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mode) S.setup.mode = b.dataset.mode;
  else if (b.dataset.color) S.setup.color = b.dataset.color;
  else if (b.dataset.tc) S.setup.tc = b.dataset.tc;
  else if (b.dataset.bot) S.setup.botId = b.dataset.bot;
  else if (b.id === 'startBtn') {
    S.setup.fen = $('#fenInput').value;
    S.setup.name = $('#nameInput').value.trim();
    store.set('orca.setup', { ...S.setup, fen: '' });
    if (S.setup.mode === 'online' || S.setup.mode === 'friend') {
      if (!S.setup.name) {
        $('#nameInput').focus();
        return toast('Enter your name first.');
      }
      if (S.setup.mode === 'friend') startOnline({ create: { name: S.setup.name, color: S.setup.color, tc: S.setup.tc } });
      else startOnline({ seek: true });
    } else newGame(S.setup);
    return;
  } else return;
  store.set('orca.setup', { ...S.setup, fen: '' });
  renderSetup();
});

$('#nameInput').addEventListener('input', (e) => {
  S.setup.name = e.target.value.trim();
  store.set('orca.setup', { ...S.setup, fen: '' });
});

$('#tab-style').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.theme) S.settings.theme = b.dataset.theme;
  else if (b.dataset.accent) S.settings.accent = b.dataset.accent;
  else return;
  renderStyle();
  render();
});

$('#tab-style').addEventListener('change', (e) => {
  const k = e.target.dataset.set;
  if (!k) return;
  if (k === 'view3d') return setView3D(e.target.checked);
  S.settings[k] = e.target.checked;
  applyStyle();
  render();
});

$('#soundToggle').addEventListener('click', () => {
  S.settings.sound = !S.settings.sound;
  applyStyle();
  if (S.settings.sound) sfx.play('move');
});

$('#boardHud')?.addEventListener('click', (e) => {
  const vBtn = e.target.closest('[data-view]');
  if (vBtn) {
    const want3D = vBtn.dataset.view === '3d';
    setView3D(want3D);
    return;
  }
  const cBtn = e.target.closest('[data-cam]');
  if (cBtn && b3d) {
    b3d.setCameraPreset(cBtn.dataset.cam);
    $$('#camPill [data-cam]').forEach((b) => b.classList.toggle('active', b === cBtn));
    return;
  }
  const rBtn = e.target.closest('#camResetBtn');
  if (rBtn && b3d) {
    b3d.resetCamera();
    $$('#camPill [data-cam]').forEach((b) => b.classList.toggle('active', b.dataset.cam === 'default'));
  }
});

function setView(i) {
  S.view = Math.max(0, Math.min(S.moves.length, i));
  S.selected = null;
  S.plan = null;
  analyze(fenAt(S.view));
  render();
}

function act(a) {
  if (a === 'first') setView(0);
  else if (a === 'prev') setView(S.view - 1);
  else if (a === 'next') setView(S.view + 1);
  else if (a === 'last') setView(S.moves.length);
  else if (a === 'flip') {
    S.orientation = opp(S.orientation);
    buildBoard();
    render();
    b3d?.setOrientation(S.orientation);
  } else if (a === 'hint') showPlan();
  else if (a === '3d') setView3D(!S.settings.view3d);
  else if (a === 'draw') offerDraw();
  else if (a === 'lens') {
    S.settings.lens = !S.settings.lens;
    renderStyle();
    render();
    toast(S.settings.lens ? 'Threat lens on: blue = White controls, red = Black controls, rings = hanging pieces.' : 'Threat lens off');
  } else if (a === 'undo') takeback();
  else if (a === 'resign') resign();
  else if (a === 'pgn') copyPgn();
}

$('#tab-game').addEventListener('click', (e) => {
  const ply = e.target.closest('[data-ply]')?.dataset.ply;
  if (ply) return setView(+ply);
  const a = e.target.closest('[data-act]')?.dataset.act;
  if (a) act(a);
});

$('#graph').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  setView(Math.round(((e.clientX - r.left) / r.width) * S.moves.length));
});

async function copyPgn() {
  const c = new Chess(S.startFen);
  if (S.startFen !== DEFAULT_FEN) {
    c.setHeader('SetUp', '1');
    c.setHeader('FEN', S.startFen);
  }
  c.setHeader('Event', 'Exindel Chess');
  c.setHeader('Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'));
  c.setHeader('White', playerInfo('w').name);
  c.setHeader('Black', playerInfo('b').name);
  for (const m of S.moves) c.move({ from: m.from, to: m.to, promotion: m.promotion });
  c.setHeader('Result', S.result ? S.result.score : '*');
  const pgn = c.pgn();
  try {
    await navigator.clipboard.writeText(pgn);
    toast('PGN copied to clipboard');
  } catch {
    prompt('Copy PGN:', pgn);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  const k = e.key;
  if (k === 'ArrowLeft') act('prev');
  else if (k === 'ArrowRight') act('next');
  else if (k === 'Home') act('first');
  else if (k === 'End') act('last');
  else if (k === 'f' || k === 'F') act('flip');
  else if (k === 'h' || k === 'H') act('hint');
  else if (k === 't' || k === 'T') act('lens');
  else if (k === '3') act('3d');
  else if (k === 'z' && (e.ctrlKey || e.metaKey)) act('undo');
  else if (k === 'Escape') {
    closeModal();
    S.selected = null;
    renderBoard();
  } else return;
  e.preventDefault();
});

// ---------------------------------------------------------------- 3D view

const TAG_COLOR = { best: '--green', excellent: '--teal', good: '--blue', inaccuracy: '--yellow', mistake: '--peach', blunder: '--red' };
let b3d = null;

function renderBoard3D(pos, last, legal, checkSq, g, animate) {
  const pieces = new Map();
  for (const row of pos.board()) for (const p of row) if (p) pieces.set(p.square, p.color + p.type);
  const targets = new Map();
  if (S.settings.legal) for (const m of legal) targets.set(m.to, m.captured ? 'capture' : 'move');
  const heat = new Map();
  const hang = new Map();
  if (S.settings.lens) {
    for (const f of FILES)
      for (let r = 1; r <= 8; r++) {
        const sq = f + r;
        const d = pos.attackers(sq, 'w').length - pos.attackers(sq, 'b').length;
        if (d) heat.set(sq, { side: d > 0 ? 'w' : 'b', alpha: Math.min(0.6, 0.14 + Math.abs(d) * 0.13) });
        const piece = pos.get(sq);
        if (piece && piece.type !== 'k' && isHanging(pos, sq, piece)) hang.set(sq, piece.color === S.orientation ? 'mine' : 'theirs');
      }
  }
  const t = THEMES[S.settings.theme] || THEMES.orchid;
  b3d.update({
    pieces,
    last,
    selected: S.selected,
    targets,
    check: checkSq,
    heat,
    hang,
    marks: S.userMarks,
    arrows: arrowList(pos, g),
    badge: g && last ? { sq: last.to, sym: TAGS[g.tag].sym, color: cssVar(TAG_COLOR[g.tag]) } : null,
    animate,
    coords: S.settings.coords,
    colors: { light: t.light, dark: t.dark, accent: cssVar('--accent'), accent2: cssVar('--accent-2'), red: cssVar('--red'), green: cssVar('--green'), blue: cssVar('--blue') },
  });
}

function updateBoardHud() {
  const is3D = !!b3d;
  $$('#boardHud [data-view]').forEach((b) => b.classList.toggle('active', (b.dataset.view === '3d') === is3D));
  const camPill = $('#camPill');
  if (camPill) camPill.hidden = !is3D;
  $('[data-act="3d"]')?.classList.toggle('on', is3D);
}

async function setView3D(on) {
  S.settings.view3d = on;
  store.set('orca.settings', S.settings);
  const frame = $('#boardFrame');
  if (on && !b3d) {
    try {
      const { createBoard3D } = await import('./board3d.js');
      if (!S.settings.view3d || b3d) return;
      b3d = createBoard3D(frame, { onSquare: clickSquare });
      b3d.setOrientation(S.orientation, true);
    } catch (err) {
      console.error(err);
      S.settings.view3d = false;
      store.set('orca.settings', S.settings);
      toast('3D needs WebGL, which this browser can’t provide.');
    }
  } else if (!on && b3d) {
    b3d.dispose();
    b3d = null;
  }
  frame.classList.toggle('is3d', !!b3d);
  updateBoardHud();
  renderStyle();
  render();
}

// ---------------------------------------------------------------- online play

let net = null;

function roomLink(id) {
  const u = new URL(location.href);
  u.search = '?room=' + id;
  u.hash = '';
  return u.toString();
}

function startOnline({ seek, room, create }) {
  leaveOnline();
  S.gen++;
  S.mode = 'online';
  S.startFen = DEFAULT_FEN;
  S.moves = [];
  S.view = 0;
  S.result = null;
  S.thinking = false;
  S.selected = null;
  S.plan = null;
  S.userArrows = [];
  S.userMarks = [];
  S.tc = parseTc(create ? create.tc : '10+0');
  S.clock = { w: S.tc.base, b: S.tc.base };
  S.clockRunning = false;
  game = new Chess();
  S.online = { room: room || null, seeking: !!seek, create: create || null, kind: seek ? 'random' : 'friend', needName: !!room && !S.setup.name, color: null, token: room ? store.get('exindel.token.' + room) : null, players: {}, status: 'connecting', drawOffer: null, rematch: [], gameNo: 0 };
  closeModal();
  showTab('game');
  net = new OnlineClient({
    onOpen: () => {
      const o = S.online;
      if (!o) return;
      if (o.room) {
        if (o.needName) net.send({ t: 'peek', room: o.room });
        else net.send({ t: 'join', room: o.room, token: o.token, name: S.setup.name });
      } else if (o.seeking) net.send({ t: 'seek', name: S.setup.name });
      else if (o.create) {
        net.send({ t: 'create', ...o.create });
        o.create = null;
      }
    },
    onMessage: onlineMessage,
    onStatus: (st) => {
      if (!S.online) return;
      S.online.status = st;
      renderOnlineCard();
    },
  });
  render();
}

function leaveOnline() {
  if (!net && !S.online) return;
  net?.close();
  net = null;
  S.online = null;
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);
}

function onlineMessage(m) {
  const o = S.online;
  if (!o) return;
  if (m.t === 'seeking') {
    o.playersOnline = m.online;
    renderOnlineCard();
  } else if (m.t === 'joined') {
    o.seeking = false;
    const reorient = !o.oriented || o.color !== m.color;
    o.room = m.room;
    o.color = m.color;
    o.token = m.token;
    if (m.token) store.set('exindel.token.' + m.room, m.token);
    history.replaceState(null, '', roomLink(m.room));
    S.playerColor = m.color || 'w';
    if (reorient) {
      o.oriented = true;
      S.orientation = m.color || 'w';
      buildBoard();
      b3d?.setOrientation(S.orientation);
    }
    render();
  } else if (m.t === 'state') {
    applyOnlineState(m);
  } else if (m.t === 'error') {
    toast(m.msg);
    if (m.code === 'no-room') {
      newGame({ mode: 'analysis', tc: '0+0' });
      S.setup.mode = 'online';
      renderSetup();
      showTab('setup');
    }
  }
}

function applyOnlineState(st) {
  const o = S.online;
  const them = o.color && opp(o.color);
  const hadOpponent = them && o.players?.[them];
  o.players = st.players;
  o.rematch = st.rematch;
  let animate = false;
  if (st.gameNo !== o.gameNo) {
    if (o.gameNo) {
      S.result = null;
      closeModal();
      sfx.play('start');
      toast('Rematch — colours swapped. Good luck!');
    }
    o.gameNo = st.gameNo;
    S.moves = [];
    S.view = 0;
  }
  const mine = S.moves.map((m) => m.from + m.to + (m.promotion || ''));
  const prefix = mine.every((u, i) => u === st.uci[i]);
  if (!(prefix && mine.length === st.uci.length)) {
    const wasLive = isLive();
    const oneMore = prefix && st.uci.length === mine.length + 1;
    S.startFen = st.startFen;
    game = new Chess(st.startFen);
    S.moves = st.uci.map((u) => game.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }));
    if (wasLive || S.view > S.moves.length) S.view = S.moves.length;
    S.selected = null;
    if (oneMore && wasLive) {
      animate = true;
      moveSound(S.moves[S.moves.length - 1], game);
    }
  }
  S.tc = parseTc(st.tc);
  S.clock = st.clock;
  S.clockRunning = st.running;
  lastTick = performance.now();

  if (them && !hadOpponent && st.players[them]) {
    toast(`Matched with ${st.players[them].name} — you play ${o.color === 'w' ? 'White' : 'Black'}.`);
    sfx.play('start');
  }
  if (st.drawOffer && st.drawOffer === them && o.drawOffer !== them) toast('Your opponent offers a draw.');
  o.drawOffer = st.drawOffer;

  if (st.result && !S.result) {
    S.result = st.result;
    S.clockRunning = false;
    sfx.play('end');
    if (st.result.score === '*') toast('Game aborted.');
    else setTimeout(showSummary, 700);
  } else if (!st.result) S.result = null;
  const rb = $('#rematchBtn');
  if (rb) rb.textContent = rematchLabel();
  render(animate);
}

function rematchLabel() {
  const o = S.online;
  if (!o?.color) return 'Rematch';
  if (o.rematch.includes(o.color)) return 'Waiting for opponent…';
  if (o.rematch.includes(opp(o.color))) return 'Accept rematch';
  return 'Rematch';
}

function offerDraw() {
  if (S.mode !== 'online' || S.result) return;
  net?.send({ t: 'draw' });
}

function renderOnlineCard() {
  const el = $('#onlineCard');
  const o = S.online;
  if (S.mode !== 'online' || !o) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const them = o.color && opp(o.color);
  const status = { connecting: 'Connecting…', online: 'Connected', offline: 'Connection lost — reconnecting…' }[o.status];
  const seated = o.players?.w && o.players?.b;
  let html = `<div class="oc-status ${o.status}"><i></i>${status}${o.room ? ` · game <b>${o.room}</b>` : ''}${o.room && !o.color && seated ? ' · spectating' : ''}</div>`;
  if (o.needName) {
    const host = o.players?.w || o.players?.b;
    html = `<div class="oc-invite"><p><b>${host ? esc(host.name) + ' invited you to a game.' : 'You’ve been invited to a game.'}</b> Enter your name to join:</p>` +
      `<div class="oc-link"><input class="input name" id="joinName" maxlength="20" placeholder="Your name" autocomplete="nickname" /><button data-oc="join" class="cta small">Join game</button></div></div>`;
  } else if (o.room && !seated && o.color) {
    html += `<div class="oc-invite"><p>Send this link to your friend — they’ll play ${o.color === 'w' ? 'Black' : 'White'}:</p>` +
      `<div class="oc-link"><input class="input" readonly value="${roomLink(o.room)}" /><button data-oc="copy" class="ghost-btn">Copy</button>` +
      (navigator.share ? `<button data-oc="share" class="ghost-btn">Share</button>` : '') + `</div></div>`;
  }
  if (o.seeking) {
    html = `<div class="oc-seek"><span class="spinner"></span><div><b>Looking for an opponent…</b><small>${o.playersOnline > 1 ? `${o.playersOnline} people connected` : 'You’ll be paired as soon as someone else presses Find opponent'}</small></div><button data-oc="cancel" class="ghost-btn">Cancel</button></div>`;
  }
  if (!S.result && them && o.drawOffer === them) {
    html += `<div class="oc-offer"><span>Draw offered</span><button data-oc="accept" class="ghost-btn">Accept</button><button data-oc="decline" class="ghost-btn">Decline</button></div>`;
  }
  // Don't wipe a name the invitee is typing when something else re-renders.
  const typing = o.needName && el.querySelector('#joinName');
  if (typing && (typing.value || el.dataset.host === String(!!(o.players?.w || o.players?.b)))) return;
  el.dataset.host = String(!!(o.players?.w || o.players?.b));
  el.innerHTML = html;
}

function joinWithName() {
  const o = S.online;
  const name = $('#joinName')?.value.trim();
  if (!o || !name) return toast('Enter your name first.');
  S.setup.name = name;
  store.set('orca.setup', { ...S.setup, fen: '' });
  o.needName = false;
  net?.send({ t: 'join', room: o.room, token: o.token, name });
  renderOnlineCard();
}

$('#onlineCard').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'joinName') joinWithName();
});

$('#onlineCard').addEventListener('click', (e) => {
  const a = e.target.closest('[data-oc]')?.dataset.oc;
  const o = S.online;
  if (!a || !o) return;
  if (a === 'join') return joinWithName();
  if (a === 'copy') {
    navigator.clipboard.writeText(roomLink(o.room)).then(
      () => toast('Invite link copied — send it to your friend'),
      () => $('#onlineCard input')?.select(),
    );
  } else if (a === 'share') {
    navigator.share({ title: 'Exindel Chess', text: 'Play a game of chess with me', url: roomLink(o.room) }).catch(() => {});
  } else if (a === 'cancel') {
    net?.send({ t: 'cancel' });
    newGame({ mode: 'analysis', tc: '0+0' });
    S.setup.mode = 'online';
    renderSetup();
    showTab('setup');
  } else if (a === 'accept') net?.send({ t: 'draw' });
  else if (a === 'decline') net?.send({ t: 'decline' });
});

// ---------------------------------------------------------------- persistence

function persistGame() {
  if (S.mode === 'online') return;
  store.set('orca.game', {
    mode: S.mode,
    startFen: S.startFen,
    uci: S.moves.map((m) => m.from + m.to + (m.promotion || '')),
    playerColor: S.playerColor,
    orientation: S.orientation,
    botId: S.bot.id,
    tc: S.tc,
    clock: S.clock,
    result: S.result,
    hints: S.hints,
  });
}

function restoreGame() {
  const d = store.get('orca.game');
  if (!d || !d.uci) return false;
  try {
    S.mode = d.mode;
    S.startFen = d.startFen;
    S.playerColor = d.playerColor;
    S.orientation = d.orientation || d.playerColor;
    S.bot = BOTS.find((b) => b.id === d.botId) || BOTS[2];
    S.tc = d.tc;
    S.clock = d.clock;
    S.result = d.result;
    S.hints = d.hints || 0;
    game = new Chess(S.startFen);
    S.moves = d.uci.map((u) => game.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }));
    S.view = S.moves.length;
    S.clockRunning = !!S.tc.base && S.moves.length > 1 && !S.result;
    lastTick = performance.now();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- boot

const savedSettings = store.get('orca.settings') || {};
Object.assign(S.settings, savedSettings);
S.settings.view3d = true;
store.set('orca.settings', S.settings);
Object.assign(S.setup, store.get('orca.setup') || {});
if (S.setup.mode === 'local') S.setup.mode = 'friend';
renderStyle();
renderSetup();
const roomParam = new URLSearchParams(location.search).get('room');
const resumed = !roomParam && restoreGame();
buildBoard();
updateBoardHud();
if (roomParam) {
  startOnline({ room: roomParam.toLowerCase() });
} else if (resumed) {
  for (let i = 0; i <= S.moves.length; i++) analyze(fenAt(i));
  showTab(S.moves.length || S.mode !== 'bot' ? 'game' : 'setup');
  render();
  if (S.mode === 'bot' && !S.result && game.turn() !== S.playerColor) botMove();
} else {
  analyze(S.startFen);
  showTab('setup');
  render();
}
if (S.settings.view3d) setView3D(true);
