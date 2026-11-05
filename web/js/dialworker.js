// The dial's solve on its own thread, so dragging it never waits for the maths.
//
// One worker, not a pool: each descent step needs the one before it, so more workers could only
// split the sum inside a pass, and pay a message round trip per pass to do it.
//
// file:// blocks new Worker("js/x.js") and has no fetch(), so the worker is built from a Blob of
// solver.js's own source. If that fails in any way, .live stays false and app.js solves on the
// main thread instead. .live only turns true once the worker has answered, so a worker that
// starts but cannot run costs nothing either.
(function (G) {
  "use strict";

  // Runs inside the worker, after solver.js. A slice is two descent steps, then back to the event
  // loop to read the newest request. A request with keep only moves the target: starting over
  // on every tick would mean a fast drag, ticking faster than a slice, never got anywhere.
  function body() {
    var S = self.FairSolver, P = null, job = null, running = false, loop = new MessageChannel();
    function slice() {
      var j = job;
      if (!j) { running = false; return; }
      var t0 = performance.now(), pass0 = S.stats.passes;
      var r = S.fairPoint(P, j.p, j.x, { iters: j.p > 2 ? 2 : 4, tol: j.tol, t: j.t });
      j.x = r.x; j.t = r.t;
      self.postMessage({ seq: j.seq, x: r.x, t: r.t, iters: r.iters, converged: r.converged, ms: performance.now() - t0, passes: S.stats.passes - pass0 });
      if (r.converged) job = null;
      loop.port2.postMessage(0);
    }
    loop.port1.onmessage = slice;
    self.onmessage = function (ev) {
      var m = ev.data;
      if (m.xyz) { P = S.makePop(m.xyz, m.w); return; }
      if (m.keep && job) { job.seq = m.seq; job.p = m.p; job.tol = m.tol; }
      else job = m.stop ? null : m;
      if (job && !running) { running = true; slice(); }
    };
    self.postMessage({ hello: true });
  }

  // onAnswer gets every slice's result, in order; telling stale ones apart is the caller's job.
  function start(onAnswer) {
    var api = { live: false, answers: 0, solve: function () {}, stop: function () {} };
    try {
      var src = "(" + G.FairSolver.source + ")(self);\n(" + body + ")();";
      var url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      var w = new Worker(url), sent = null;
      w.onmessage = function (ev) {
        if (ev.data.hello) { api.live = true; URL.revokeObjectURL(url); return; }
        api.answers++;
        onAnswer(ev.data);
      };
      w.onerror = function () { api.live = false; w.terminate(); };
      api.solve = function (P, seq, p, x, t, tol, keep) {
        if (P !== sent) { sent = P; w.postMessage({ xyz: P.xyz, w: P.w }); }   // a copy: the page keeps using P
        w.postMessage({ seq: seq, p: p, x: x, t: t, tol: tol, keep: keep });
      };
      api.stop = function () { w.postMessage({ stop: true }); };
    } catch (e) { api.live = false; }
    return api;
  }

  G.FairDialWorker = { start: start };
})(window);
