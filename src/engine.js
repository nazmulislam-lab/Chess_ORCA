// Thin UCI wrapper around a Stockfish WASM worker. Searches are serialized so
// two callers never interleave `position`/`go` on the same engine.
export class Engine {
  constructor(url) {
    this.worker = new Worker(url);
    this.listeners = new Set();
    this.worker.onmessage = (e) => {
      const line = String(e.data);
      for (const fn of [...this.listeners]) fn(line);
    };
    this.queue = Promise.resolve();
    this.ready = this.waitFor('uci', 'uciok').then(() => this.waitFor('isready', 'readyok'));
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  waitFor(cmd, token) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (line.startsWith(token)) {
          this.listeners.delete(fn);
          resolve();
        }
      };
      this.listeners.add(fn);
      this.send(cmd);
    });
  }

  // Resolves to { best, cp, mate, pv, depth }, scores from the side to move.
  search(fen, go, setup = []) {
    const run = async () => {
      await this.ready;
      for (const cmd of setup) this.send(cmd);
      return new Promise((resolve) => {
        let info = { cp: 0, mate: null, pv: [], depth: 0 };
        const fn = (line) => {
          if (line.startsWith('info') && line.includes(' score ') && !/multipv [2-9]/.test(line)) {
            info = parseInfo(line) || info;
          } else if (line.startsWith('bestmove')) {
            this.listeners.delete(fn);
            const best = line.split(' ')[1];
            resolve({ ...info, best: best && best !== '(none)' ? best : null });
          }
        };
        this.listeners.add(fn);
        this.send('position fen ' + fen);
        this.send('go ' + go);
      });
    };
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }
}

function parseInfo(line) {
  const depth = line.match(/ depth (\d+)/);
  if (!depth) return null;
  const cp = line.match(/score cp (-?\d+)/);
  const mate = line.match(/score mate (-?\d+)/);
  const pv = line.match(/ pv (.+)$/);
  return {
    depth: +depth[1],
    cp: cp ? +cp[1] : null,
    mate: mate ? +mate[1] : null,
    pv: pv ? pv[1].trim().split(' ') : [],
  };
}
