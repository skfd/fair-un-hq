// Which towns can the new-capital card ever name? It follows the solved HQ, never the dragged pin,
// so the answer is fixed by the frame, the weighting and the dial: sweep them all with the page's
// own solver, warm-starting each 0.1 step of the dial from the last, as the page does.
//
//     node scripts/build_landings.js
//
// Writes data/raw/wikipedia/landings.json for build_blurbs.py. Run it after build_towns.py and
// whenever the series change.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "raw", "wikipedia", "landings.json");
const SERIES = ["hyde", "isimip-hist", "ghsl", "ssp3"];
const MODES = ["all", "urban", "rural"];
const DIAL_TOL = 1e-5;   // the page's, in app.js

function loadPage() {
  globalThis.window = globalThis;
  const files = ["js/fair-boot.js", "data/cells.js", ...SERIES.map((s) => `data/series-${s}.js`), "data/towns.js", "js/solver.js", "js/data.js"];
  for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", f), "utf8"), { filename: f });
  return { S: globalThis.FairSolver, FD: globalThis.FairData };
}

function nearest(T, x) {
  let best = -1, bd = -2;
  for (let i = 0; i < T.n; i++) {
    const d = T.xyz[3 * i] * x[0] + T.xyz[3 * i + 1] * x[1] + T.xyz[3 * i + 2] * x[2];
    if (d > bd) { bd = d; best = i; }
  }
  return best;
}

function sweep(S, P, T, hits) {
  let x = S.fairPointGlobal(P, 1).x;
  hits.add(nearest(T, x));
  for (let tenths = 11; tenths <= 80; tenths++) {
    let r, t;   // a fresh step size for each p, as retarget() does: a stale one stalls the descent
    do { r = S.fairPoint(P, tenths / 10, x, { tol: DIAL_TOL, t }); x = r.x; t = r.t; } while (!r.converged);
    hits.add(nearest(T, x));
  }
}

if (isMainThread) {
  const { FD } = loadPage();
  const D = FD.build(), n = FD.towns().n, frames = D.frames.length;
  const workers = Math.max(1, Math.min(os.cpus().length - 2, 20));
  const hits = new Set();
  let done = 0, left = workers;
  for (let w = 0; w < workers; w++) {
    new Worker(__filename, { workerData: { w, workers } }).on("message", (m) => {
      if (m.tick) { if (++done % 30 === 0) console.log(`  ${done}/${frames * MODES.length}`); return; }
      m.hits.forEach((i) => hits.add(i));
      if (--left) return;
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, JSON.stringify({ n, towns: [...hits].sort((a, b) => a - b) }));
      console.log(`${hits.size} of ${n} towns can be landed on`);
    }).on("error", (e) => { console.error(e); process.exit(1); });
  }
} else {
  const { S, FD } = loadPage();
  const D = FD.build(), T = FD.towns(), hits = new Set();
  let job = 0;
  for (const fr of D.frames) for (const mode of MODES) {
    if (job++ % workerData.workers !== workerData.w) continue;
    const P = FD.population(D, fr, mode);
    if (P.mode === mode) sweep(S, P, T, hits);   // no urban split: it falls back to "all", swept already
    parentPort.postMessage({ tick: true });
  }
  parentPort.postMessage({ hits: [...hits] });
}
