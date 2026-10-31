// The page: state, the little job scheduler that keeps the heavy maths off the critical path,
// and the cards. Rendering lives in globe.js, timeline.js and postcard.js.
(function () {
  "use strict";
  var S = FairSolver, FD = FairData;
  var HQ = window.HQ = window.HQ || {};
  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return performance.now(); };

  // ---------------------------------------------------------------- data
  var D = HQ.D = FD.build();
  HQ.towns = FD.towns();
  HQ.land = topojson.feature(FAIR.land, FAIR.land.objects.land);
  HQ.BRANCH = {
    ssp1: { code: "SSP1", name: "Sustainability", short: "the green road", color: "#199e70" },
    ssp3: { code: "SSP3", name: "Regional rivalry", short: "the rocky road", color: "#d95926" },
    ssp5: { code: "SSP5", name: "Fossil-fuelled development", short: "the fast lane", color: "#9085e9" },
  };
  HQ.CONF_LABEL = { modelled: "modelled", observed: "observed", projected: "projected" };
  HQ.SERIES_LABEL = {
    hyde: "HYDE 3.3", "isimip-hist": "ISIMIP3a histsoc (HYDE-based)", ghsl: "GHSL GHS-POP R2023A",
    ssp1: "ISIMIP3b SSP1", ssp3: "ISIMIP3b SSP3", ssp5: "ISIMIP3b SSP5",
  };
  if (FAIR.isMock) Object.keys(HQ.SERIES_LABEL).forEach(function (k) { HQ.SERIES_LABEL[k] += " (mock)"; });
  var FORK = D.trunk.length ? D.trunk[D.trunk.length - 1].year : 2030;
  HQ.FORK = FORK;
  var years = [];
  D.frames.forEach(function (f) { if (years.indexOf(f.year) < 0) years.push(f.year); });
  years.sort(function (a, b) { return a - b; });
  HQ.years = years;
  HQ.nearestYear = function (y) {
    return years.reduce(function (a, b) { return Math.abs(b - y) < Math.abs(a - y) ? b : a; });
  };
  // HYDE's own name for each step: 10,000 BC ... 0 AD, 100 AD ... 1000, 1850.
  HQ.yearLabel = function (y) {
    return y < 0 ? fmt(-y) + " BC" : y < 1000 ? y + " AD" : String(y);
  };
  // Time is uneven: millennia, then centuries, then decades before 1850, then 5-year frames. One
  // piecewise-linear scale gives each era a strip roughly in proportion to its frames.
  HQ.timeScale = function (r0, r1) {
    var d = [-10000, 0, 1700, 1850, 2100], f = [0, 0.13, 0.22, 0.30, 1];
    if (years[0] >= 1850) { d = [1850, 2100]; f = [0, 1]; }
    return d3.scaleLinear(d, f.map(function (t) { return r0 + t * (r1 - r0); })).clamp(true);
  };
  var trunkByYear = {};
  D.trunk.forEach(function (f) { trunkByYear[f.year] = f; });

  HQ.frameAt = function (year, branch) {
    if (trunkByYear[year]) return trunkByYear[year];
    return D.byKey[branch + "/" + year] || D.byKey["ssp1/" + year] || D.byKey["ssp3/" + year] || D.byKey["ssp5/" + year] || null;
  };

  var state = HQ.state = {
    year: years.indexOf(2020) >= 0 ? 2020 : years[years.length - 1], branch: "ssp1",
    p: 1, worst: 0, vote: true, k: 1, mode: "all", playing: false,
  };
  if (FAIR.isMock) $("mockNote").hidden = false;

  // Populations per frame and weighting, decoded on demand (small LRU: 80 frames won't fit).
  var popCache = new Map();
  function pop(fr, mode) {
    var key = fr.key + "|" + mode;
    if (popCache.has(key)) { var v = popCache.get(key); popCache.delete(key); popCache.set(key, v); return v; }
    var P = FD.population(D, fr, mode);
    popCache.set(key, P);
    if (popCache.size > 8) popCache.delete(popCache.keys().next().value);
    return P;
  }
  HQ.pop = pop;

  // ---------------------------------------------------------------- jobs
  // Generators from solver.js, pumped in time slices so the page never freezes.
  var jobs = [];
  function addJob(name, prio, label, gen, done) {
    for (var i = 0; i < jobs.length; i++) if (jobs[i].name === name) return;
    jobs.push({ name: name, prio: prio, label: label, gen: gen, done: done });
    jobs.sort(function (a, b) { return a.prio - b.prio; });
    if (!pumping) { pumping = true; setTimeout(pump, 0); }
  }
  function dropJobs(pred) { jobs = jobs.filter(function (j) { return !pred(j); }); }
  var pumping = false;
  function pump() {
    var t0 = now(), budget = dragging() ? 8 : 24;
    while (jobs.length && now() - t0 < budget) {
      var j = jobs[0], r = j.gen.next();
      if (r.done) { jobs.shift(); j.done(r.value); }
    }
    showBusy();
    if (jobs.length) setTimeout(pump, 0); else pumping = false;
  }
  function dragging() { return HQ.Globe && HQ.Globe.isDragging(); }
  function showBusy() {
    var j = jobs.filter(function (j) { return j.label; })[0];
    $("busy").hidden = !j;
    if (j) $("busyText").textContent = j.label;
  }
  HQ.jobsPending = function () { return jobs.length; };

  // ---------------------------------------------------------------- trail (p = 1, everyone)
  // A warm-start chain frame to frame, seeded from the Python reference medians when present.
  var trail = HQ.trail = {};       // key -> { x, src }
  var stats = HQ.stats = {};       // key -> { pop }
  var ref = FAIR.reference || null;
  // The Python medians are a provisional trail from the first frame; the chain below re-solves
  // every frame in the browser and replaces them (they agree to well under a metre).
  if (ref) D.frames.forEach(function (f) { if (ref[f.key]) trail[f.key] = { x: S.toXYZ(ref[f.key].median[0], ref[f.key].median[1]), src: "ref" }; });
  function* chainGen() {
    var order = D.trunk.slice();
    ["ssp1", "ssp3", "ssp5"].forEach(function (b) { order = order.concat(D.frames.filter(function (f) { return f.sid === b; })); });
    for (var i = 0; i < order.length; i++) {
      var fr = order[i];
      if (trail[fr.key] && stats[fr.key]) continue;
      var P = FD.population(D, fr, "all");
      var c = S.centroid(P);   // only a starting guess for the solver
      stats[fr.key] = { pop: P.W };
      yield;
      if (!trail[fr.key] || trail[fr.key].src === "ref") {
        var r = ref && ref[fr.key] ? S.toXYZ(ref[fr.key].median[0], ref[fr.key].median[1])
          : fr.prev && trail[fr.prev.key] ? trail[fr.prev.key].x : c;
        var res, left = 500;
        do { res = S.fairPoint(P, 1, r, { iters: 10, tol: 1e-10 }); r = res.x; left -= res.iters; yield; }
        while (!res.converged && left > 0);
        if (!trail[fr.key] || trail[fr.key].src === "ref") trail[fr.key] = { x: res.x, src: "chain" };
      }
      HQ.Globe.invalidate();
      if (i % 4 === 0) HQ.Timeline.update();
    }
  }
  function chainDone() { HQ.Timeline.update(); refreshCards(); HQ.Globe.invalidate(); HQ.chainReady = true; }

  // ---------------------------------------------------------------- the current view
  var V = HQ.view = { F: null, M: "all", P: null, hq: null, worst: null, vote: null, offices: null, labels: null };
  var glob = new Map();    // F|M -> x of the global p=1 search
  var dialCache = new Map();
  var dial = { key: null, x: null, t: undefined, done: true, fm: null };
  var worstCache = new Map(), kCache = new Map(), voteCache = new Map();
  var capP = (function () {
    var C = FAIR.capitals || [], xyz = new Float64Array(3 * C.length), w = new Float64Array(C.length);
    C.forEach(function (c, i) { var v = S.toXYZ(c.lat, c.lon); xyz[3 * i] = v[0]; xyz[3 * i + 1] = v[1]; xyz[3 * i + 2] = v[2]; w[i] = 1; });
    return S.makePop(xyz, w);
  })();

  function fmKey() { return V.F.key + "|" + V.M; }
  function p1Base() {
    var k = fmKey();
    if (glob.has(k)) return glob.get(k);
    if (V.M === "all" && trail[V.F.key]) return trail[V.F.key].x;
    if (trail[V.F.key]) return trail[V.F.key].x;
    if (ref && ref[V.F.key]) return S.toXYZ(ref[V.F.key].median[0], ref[V.F.key].median[1]);
    return S.centroid(V.P);
  }

  // Called whenever the state changes. Cheap: it only sets targets and queues jobs.
  var lastFrameKey = null, lastTlKey = null;
  function update(opts) {
    opts = opts || {};
    var F = HQ.frameAt(state.year, state.branch);
    if (!F) return;
    var M = state.mode !== "all" && !F.hasUrban ? "all" : state.mode;
    var frameChanged = !V.F || V.F.key !== F.key || V.M !== M;
    if (!EX.story && (frameChanged || EX.probeP !== state.p)) clearProbe();
    V.F = F; V.M = M;
    V.P = pop(F, M);
    var k = fmKey();

    if (frameChanged) {
      dropJobs(function (j) { return j.prio <= 3 && j.name.indexOf(k) < 0; });
      if (!state.playing && !glob.has(k)) {
        var fk = k, fr = F;
        addJob("glob " + fk, 3, null, S.fairPointGlobalGen(V.P, 1), function (best) {
          glob.set(fk, best.x);
          if (fk.split("|")[1] === "all") {
            var old = trail[fr.key];
            if (!old || S.km(old.x, best.x) > 0.001) { trail[fr.key] = { x: best.x, src: "global" }; HQ.Timeline.update(); }
          }
          // A different basin than the warm start? Re-solve the dial from the global answer.
          Array.from(dialCache.keys()).forEach(function (dk) { if (dk.indexOf(fk + "|") === 0) dialCache.delete(dk); });
          if (V.F && fmKey() === fk) { dial.key = null; retarget(); }
          HQ.Globe.invalidate();
        });
      }
    }
    retarget();

    // Worst-off (clipped minimax), on demand, once per frame/weighting/q.
    V.worst = null;
    if (state.worst) {
      var wk = k + "|" + state.worst;
      if (worstCache.has(wk)) V.worst = worstCache.get(wk);
      else if (!state.playing) {
        var q = state.worst;
        addJob("worst " + wk, 1, "Finding the spot that strands the fewest people…", S.worstOffGen(V.P, q, 4000, 0), function (r) {
          r.q = q; worstCache.set(wk, r);
          if (fmKey() + "|" + state.worst === wk) { V.worst = r; refreshCards(); HQ.Globe.invalidate(); }
        });
      }
    }
    // k HQs.
    V.offices = null; V.labels = null; V.kRes = null;
    if (state.k > 1) {
      var kk = k + "|" + state.k;
      if (kCache.has(kk)) applyK(kCache.get(kk));
      else if (!state.playing) {
        var nK = state.k, PP = V.P, fmKey0 = k;
        addJob("k " + kk, 1, "Drawing " + nK + " office catchments…", S.kMediansGen(PP, nK, { restarts: 4, seed: 7 }), function (r) {
          r.fm = fmKey0; kCache.set(kk, r);
          if (fmKey() + "|" + state.k === kk) { applyK(r); refreshCards(); HQ.Globe.invalidate(); }
        });
      }
    }
    // One country, one vote: cheap (193 points), at the dial's p.
    V.vote = null;
    if (state.vote && capP.n) {
      var vk = state.p.toFixed(1);
      if (!voteCache.has(vk)) voteCache.set(vk, S.fairPointGlobal(capP, state.p, 200).x);
      V.vote = voteCache.get(vk);
    }

    if (frameChanged && lastFrameKey !== F.key + M) {
      lastFrameKey = F.key + M;
      // While playing, only turn the globe when the HQ wanders away from the middle.
      if (!opts.noFly) HQ.Globe.flyTo(V.hq || p1Base(), state.playing ? 600 : 900, false, state.playing ? 12 : 0);
    }
    refreshCards();
    var tlKey = state.year + state.branch;
    if (frameChanged || tlKey !== lastTlKey) { lastTlKey = tlKey; HQ.Timeline.update(); }
    HQ.Globe.invalidate();
  }
  HQ.update = update;

  function applyK(r) {
    V.kRes = r;
    V.offices = r.centers;
    V.labels = r.fm === fmKey() && r.labels.length === V.P.n ? r.labels : null;
  }

  // The dial: warm-started, resumable, solved a slice per animation frame.
  function retarget() {
    var key = fmKey() + "|" + state.p.toFixed(1);
    if (dial.key === key) return;
    var fm = fmKey();
    if (state.p === 1 && glob.has(fm)) { finish(key, glob.get(fm)); return; }
    if (dialCache.has(key)) { finish(key, dialCache.get(key)); return; }
    var sameFm = dial.fm === fm && dial.x;
    var start = sameFm ? dial.x : p1Base();
    dial = { key: key, fm: fm, x: start, t: undefined, done: false, p: state.p, P: V.P, t0: now(), ms: 0, passes: 0, iters: 0, stage: "quick" };
    if (!sameFm || !V.hq) V.hq = start;
  }
  function finish(key, x) {
    dial = { key: key, fm: fmKey(), x: x, done: true, p: state.p };
    V.hq = x;
    refreshCards();
  }
  var DIAL_TOL = 1e-5, POLISH_TOL = 1e-7;   // 64 m and 0.6 m. fair.py's 1e-12 default is for the reference.
  HQ.lastTick = null;
  // Two stages: a quick solve to DIAL_TOL (64 m: far below a pixel) while the dial moves, then,
  // once it has rested for a moment, a polish to POLISH_TOL from the same x and step size.
  HQ.tick = function () {   // called by the globe's animation loop
    settleTick();
    if (dial.done) return;
    if (dial.stage === "polish" && now() < dial.polishAt) return;
    var t0 = now(), budget = 28, it = dial.p > 2 ? 2 : 4, tol = dial.stage === "polish" ? POLISH_TOL : DIAL_TOL;
    var pass0 = S.stats.passes;
    while (true) {
      var r = S.fairPoint(dial.P, dial.p, dial.x, { iters: it, tol: tol, t: dial.t });
      dial.x = r.x; dial.t = r.t; dial.iters += r.iters;
      if (r.converged) break;
      if (now() - t0 > budget) break;
    }
    dial.ms += now() - t0;
    dial.passes += S.stats.passes - pass0;
    V.hq = dial.x;
    HQ.Globe.invalidate();
    if (!r.converged) { throttledCards(); return; }
    if (dial.stage !== "polish") {
      HQ.lastTick = { key: dial.key, ms: dial.ms, wall: now() - dial.t0, iters: dial.iters, passes: dial.passes };
      HQ.Globe.flyTo(dial.x, 700, false, 40);   // only if the dial dragged it off towards the limb
      refreshCards();
      dial.stage = "polish"; dial.polishAt = now() + 300;
      dial.ms = 0; dial.passes = 0; dial.iters = 0;
    } else {
      dial.done = true;
      dialCache.set(dial.key, dial.x);
      HQ.lastPolish = { key: dial.key, ms: dial.ms, passes: dial.passes, iters: dial.iters };
      refreshCards();
    }
  };
  var cardTimer = null;
  function throttledCards() {
    if (cardTimer) return;
    cardTimer = setTimeout(function () { cardTimer = null; refreshCards(); }, 120);
  }

  // ---------------------------------------------------------------- formatting
  var fmt = function (v, d) { return v.toLocaleString("en-GB", { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); };
  HQ.fmt = fmt;
  function ll(x) {
    var a = S.toLatLon(x);
    return fmt(Math.abs(a[0]), 2) + "° " + (a[0] >= 0 ? "N" : "S") + ", " + fmt(Math.abs(a[1]), 2) + "° " + (a[1] >= 0 ? "E" : "W");
  }
  HQ.ll = ll;
  var COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  function bearing(from, to) {   // initial great-circle bearing, as a compass word
    var a = S.toLatLon(from), b = S.toLatLon(to), D2R = Math.PI / 180;
    var p1 = a[0] * D2R, p2 = b[0] * D2R, dl = (b[1] - a[1]) * D2R;
    var y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    var deg = (Math.atan2(y, x) / D2R + 360) % 360;
    return COMPASS[Math.round(deg / 45) % 8];
  }
  HQ.bearing = bearing;
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  HQ.hash = hash;

  // ---------------------------------------------------------------- nearest town
  HQ.nearestTown = function (x) {
    var T = HQ.towns;
    if (!T) return null;
    var best = -1, bd = -2, X = T.xyz;
    for (var i = 0; i < T.n; i++) {
      var d = X[3 * i] * x[0] + X[3 * i + 1] * x[1] + X[3 * i + 2] * x[2];
      if (d > bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    var tx = [X[3 * best], X[3 * best + 1], X[3 * best + 2]];
    return {
      name: T.name[best], cc: T.cc[best], country: (FAIR.countries || {})[T.cc[best]] || T.cc[best],
      pop: T.pop[best], x: tx, km: S.km(tx, x), dir: bearing(tx, x),
    };
  };
  HQ.atSea = function (x) { var a = S.toLatLon(x); return !d3.geoContains(HQ.land, [a[1], a[0]]); };

  var BLURBS = [
    "Expect a sudden boom in lanyard sales.",
    "Local cafés are advised to order more chairs. Many more chairs.",
    "The tourist board has been told. They are thrilled. Mostly.",
    "Parking is about to get complicated.",
    "Somebody should probably tell the mayor.",
    "Rents: up. Interpreters: in demand. Flags: everywhere.",
    "It has never hosted a summit. It is about to host all of them.",
    "Delegates are asked to learn the local word for 'queue'.",
  ];
  var BIG_BLURBS = [
    "Already big. About to be the place everyone flies to.",
    "A big city that is about to get a lot more acronyms.",
  ];
  var SEA_BLURBS = [
    "Nobody lives here, which is exactly what's fair about it. Bring seasickness tablets.",
    "The fairest spot is wet. Plenary sessions will be held on deck.",
  ];

  // ---------------------------------------------------------------- cards
  function refreshCards() {
    if (!V.F || !V.hq) return;
    var F = V.F, x = V.hq;
    // year badge
    $("yearBig").textContent = HQ.yearLabel(F.year);
    $("yearSub").innerHTML = '<span class="conf">' + F.conf + "</span>" + HQ.SERIES_LABEL[F.sid];
    var b = F.branch ? HQ.BRANCH[F.branch] : null;
    $("yearBranch").innerHTML = b ? '<span class="swatch" style="background:' + b.color + '"></span>' + b.code + ": " + b.name : "";

    welcome(x);
    caption();
    notes();
    drift();
    why();
    legend();
  }
  HQ.refreshCards = refreshCards;

  var townSVG = '<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true"><path d="M22 3c-7 0-12 5-12 12 0 9 12 23 12 23s12-14 12-23c0-7-5-12-12-12z" fill="#4b92db" stroke="#1f5f9e" stroke-width="1.5"/><circle cx="22" cy="15" r="5" fill="#fff"/><ellipse cx="22" cy="40" rx="7" ry="2" fill="#000" opacity=".15"/></svg>';
  HQ.bargeSVG = function (w) {
    return '<svg width="' + w + '" height="' + Math.round(w * 0.8) + '" viewBox="0 0 70 56" aria-hidden="true">' +
      '<path d="M2 46c6 4 10 4 16 0s10-4 16 0 10 4 16 0 10-4 18 0" fill="none" stroke="#4b92db" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M8 36h54l-7 9H15z" fill="#23223a"/>' +
      '<rect x="18" y="24" width="30" height="12" rx="2" fill="#fbf6ea" stroke="#23223a" stroke-width="1.5"/>' +
      '<rect x="22" y="28" width="5" height="4" fill="#4b92db"/><rect x="30.5" y="28" width="5" height="4" fill="#4b92db"/><rect x="39" y="28" width="5" height="4" fill="#4b92db"/>' +
      '<path d="M33 24V5" stroke="#23223a" stroke-width="1.6"/>' +
      '<path d="M33 5h16l-3 4.5 3 4.5H33z" fill="#4b92db"/>' +
      '<circle cx="40" cy="9.5" r="2.4" fill="none" stroke="#fff" stroke-width="1"/>' +
      '</svg>';
  };

  var lastTownKey = null;
  function welcome(x) {
    var T = HQ.nearestTown(x), sea = HQ.atSea(x);
    var key = (T ? T.name : "") + sea + Math.round(T ? T.km : 0);
    $("townCoords").textContent = "The exact spot: " + ll(x);
    if (key === lastTownKey) return;
    lastTownKey = key;
    if (!T) { $("townName").textContent = "Somewhere fair"; return; }
    var h = hash(T.name);
    if (sea) {
      $("townIcon").innerHTML = HQ.bargeSVG(64);
      $("townName").textContent = "The HQ barge";
      $("townWhere").innerHTML = "Moored at sea, " + fmt(T.km) + " km " + T.dir + " of <b>" + esc(T.name) + "</b>, " + esc(T.country);
      $("townBlurb").textContent = SEA_BLURBS[h % SEA_BLURBS.length];
    } else {
      $("townIcon").innerHTML = townSVG;
      $("townName").textContent = T.name;
      $("townWhere").innerHTML = esc(T.country) + (T.pop ? " · pop. " + fmt(T.pop) : "") +
        "<br>" + (T.km < 1 ? "The exact spot is right in town." : "The exact spot is " + fmt(T.km, T.km < 10 ? 1 : 0) + " km " + T.dir + " of town.");
      var L = T.pop > 2e6 ? BIG_BLURBS : BLURBS;
      $("townBlurb").textContent = L[h % L.length];
    }
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  HQ.esc = esc;

  function captionFor(p) {
    if (p < 1.05) return ["Least total travel.", "Every kilometre anyone travels counts the same. This is the geometric median: one person, one vote."];
    if (p < 1.75) return ["Long trips start to cost extra.", "A 4,000 km journey now hurts more than two 2,000 km ones."];
    if (p < 2.25) return ["Squared distance punishes far-flung people.", "Not the centre of mass, mind: the centroid is a different, deeper beast."];
    if (p < 4) return ["The remote are getting louder.", "The HQ shuffles toward whoever is furthest away."];
    if (p < 6.5) return ["Now it is mostly about not stranding anyone.", "A few distant islands are starting to call the shots."];
    return ["The far-away get a veto.", "At p = 8 the loneliest outposts all but decide where everyone meets."];
  }
  function caption() {
    var c = captionFor(state.p);
    $("caption").innerHTML = esc(c[0]) + "<small>" + esc(c[1]) + "</small>";
    $("dialOut").textContent = "p = " + (state.p === Math.round(state.p) ? state.p : state.p.toFixed(1));
  }

  function notes() {
    var x = V.hq;
    // worst-off
    var nw = "";
    if (state.worst && V.worst) {
      var share = state.worst === 0.999 ? "99.9%" : "99%";
      nw = "Puts " + share + " of people within <b>" + fmt(V.worst.km) + " km</b>. " +
        (V.worst.km > 10008 ? "Over half the planet, so the trick is to stand opposite the emptiest patch of ocean." : "") +
        (S.toLatLon(V.worst.x)[0] > 66 ? " <b>This year it has fled to the Arctic</b> (it flips between the Levant and the pole)." : "");
    } else if (state.worst) nw = "Searching…";
    $("noteWorst").innerHTML = nw;
    // country vote
    $("noteVote").innerHTML = state.vote && V.vote
      ? "The median of " + (FAIR.capitals || []).length + " capitals, one vote each, lands <b>" + fmt(S.km(V.vote, x)) + " km</b> from the one-person-one-vote HQ."
      : "";
    // k
    var nk = "";
    if (state.k > 1 && V.kRes) {
      var one = S.cost(p1Base(), V.P, 1);
      nk = state.k + " offices cut the average trip from <b>" + fmt(one) + "</b> to <b>" + fmt(V.kRes.meanKm) + " km</b>.";
    } else if (state.k > 1) nk = "Working out the catchments…";
    $("noteK").innerHTML = nk;
    // weighting
    var F = V.F, can = F.hasUrban;
    Array.prototype.forEach.call($("segMode").querySelectorAll("button"), function (bt) {
      if (bt.dataset.v !== "all") bt.disabled = !can;
    });
    $("noteMode").innerHTML = !can && state.mode !== "all" ? (F.sid === "hyde"
        ? "Nobody lived in towns yet in " + HQ.yearLabel(F.year) + ", so everyone counts."
        : "No city/country split for " + HQ.yearLabel(F.year) + ", so everyone counts.") :
      state.mode === "urban" ? "Only people in towns and cities. The trail stays everyone." :
      state.mode === "rural" ? "Only people in the countryside. The trail stays everyone." : "";
  }

  function drift() {
    var F = V.F, cur = trail[F.key], prev = F.prev && trail[F.prev.key];
    var head = $("driftHead"), body = $("driftBody"), warn = $("driftWarn");
    $("driftAside").textContent = "p = 1, everyone";
    warn.innerHTML = "";
    if (!F.prev) {
      head.innerHTML = "This is where the story starts.";
      body.textContent = "Ask again in " + HQ.yearLabel(years[1]) + ". Before " + HQ.yearLabel(F.year) + " there is no map of people to ask.";
      return;
    }
    if (!cur || !prev) { head.textContent = "Measuring…"; body.textContent = ""; return; }
    var km = S.km(prev.x, cur.x), dy = F.year - F.prev.year, kmyr = km / dy, mday = kmyr * 1000 / 365.25;
    head.innerHTML = "The HQ would have to crawl <span class=\"big\">" + fmt(mday, mday < 10 ? 1 : 0) + " metres a day</span>.";
    var snailMin = mday / 0.013 / 60;
    body.innerHTML = HQ.yearLabel(F.prev.year) + " → " + HQ.yearLabel(F.year) + ": " + fmt(km) + " km " + bearing(prev.x, cur.x) + ", or " + fmt(kmyr, 1) +
      " km a year. A garden snail could cover a day's crawl in " + (snailMin < 90 ? fmt(snailMin) + " minutes" : fmt(snailMin / 60, 1) + " hours") + ", then nap.";
    if (F.seam) warn.innerHTML = '<div class="warn">Careful: this step crosses a data seam (' + esc(HQ.SERIES_LABEL[F.prev.sid]) + " → " +
      esc(HQ.SERIES_LABEL[F.sid]) + "). Part of the jump is the change of source, not people moving.</div>";
  }

  function legend() {
    var dash = function (d, c) { return '<svg width="24" height="8"><line x1="2" y1="4" x2="22" y2="4" stroke="' + (c || "#fff1cf") + '" stroke-width="2.2" stroke-linecap="round"' + (d ? ' stroke-dasharray="' + d + '"' : "") + "/></svg>"; };
    var rows = [
      '<div class="row"><svg width="30" height="14"><path d="M15 1c-3.3 0-5.5 2.4-5.5 5.5C9.5 10 15 14 15 14s5.5-4 5.5-7.5C20.5 3.4 18.3 1 15 1z" fill="#4b92db" stroke="#fff" stroke-width="1.2"/></svg>The fair HQ (p = ' + (state.p === Math.round(state.p) ? state.p : state.p.toFixed(1)) + ")</div>",
      '<div class="row trail-styles">trail:<span>' + dash("0.5 4") + "modelled</span><span>" + dash("") + "observed</span><span>" + dash("6 4") + "projected</span></div>",
      '<div class="row"><svg width="30" height="12"><circle cx="15" cy="6" r="4.5" fill="#0b1128" stroke="#fff" stroke-width="1.4"/><path d="M12.5 6h5" stroke="#fff" stroke-width="1.4"/></svg>seam between data sources</div>',
    ];
    if (state.year > FORK) rows.push('<div class="row">' + ["ssp1", "ssp3", "ssp5"].map(function (b) { return '<span class="swatch" style="background:' + HQ.BRANCH[b].color + '"></span>' + HQ.BRANCH[b].code; }).join(" &nbsp;") + "</div>");
    if (state.worst) rows.push('<div class="row"><svg width="30" height="14"><circle cx="15" cy="7" r="5.5" fill="none" stroke="#fff" stroke-width="3"/><circle cx="15" cy="7" r="5.5" fill="none" stroke="#e34948" stroke-width="3" stroke-dasharray="4.3 4.3"/></svg>worst-off (' + (state.worst === 0.999 ? "99.9" : "99") + "%)</div>");
    if (state.vote) rows.push('<div class="row"><svg width="30" height="14"><rect x="9" y="2" width="12" height="11" rx="2" fill="#b05fd0" stroke="#fff" stroke-width="1.2"/><path d="M12 5h6" stroke="#fff" stroke-width="1.5"/></svg>one country, one vote</div>');
    if (state.k > 1) rows.push('<div class="row"><svg width="30" height="14"><circle cx="15" cy="7" r="6" fill="#3987e5" stroke="#fff" stroke-width="1.2"/></svg>' + state.k + " offices, people coloured by nearest</div>");
    var who = V.M === "urban" ? "city folk" : V.M === "rural" ? "country folk" : "people";
    if (EX.layers.blocks && V.P) {
      var unit = V.P.W / FB.NB;
      rows.push('<div class="row"><svg width="30" height="20"><path d="M12 6h6v13h-6z" fill="#c8463d"/><path d="M18 6l3-2v13l-3 2z" fill="#7c2b26"/><path d="M12 6l3-2h6l-3 2z" fill="#e8a49e"/><path d="M12 10.5h6M12 14.5h6" stroke="#7c2b26" stroke-width=".8"/></svg>' +
        "1 block = 0.1% of " + who + " (" + people(unit) + ")</div>");
      if (!(state.k > 1)) rows.push('<div class="row conts">' + FB.continents.map(function (n, i) { return '<span><span class="swatch" style="background:' + FB.COLORS[i] + '"></span>' + n + "</span>"; }).join("") + "</div>");
    }
    if (EX.layers.ropes) rows.push('<div class="row"><svg width="30" height="12"><path d="M2 3C10 3 12 6 16 6M2 10C10 10 12 6 16 6" stroke="#3b74c4" stroke-width="1.4" fill="none"/><path d="M16 6h12" stroke="#3b74c4" stroke-width="3.5"/></svg>' +
      (state.k > 1 ? "ropes: each block to its nearest office" : EX.ropeMode === "direct" ? "ropes: each block's pull on the HQ" : "ropes: each block's pull, joined by region") + "</div>");
    if (EX.layers.bowl) rows.push('<div class="row"><svg width="30" height="12"><ellipse cx="15" cy="6" rx="12" ry="4.5" fill="none" stroke="#c9c4e8" stroke-dasharray="3 2"/></svg>bowl: how much longer the average trip gets</div>');
    rows.push('<div class="row" style="opacity:.8"><svg width="30" height="10"><rect x="8" y="3" width="4" height="4" fill="#ff8a3d" opacity=".4"/><rect x="14" y="3" width="4" height="4" fill="#ff8a3d" opacity=".7"/><rect x="20" y="3" width="4" height="4" fill="#ff8a3d"/></svg>' + (EX.layers.blocks ? "dots: people too spread out for a block" : "where " + who + " live") + "</div>");
    $("legend").innerHTML = rows.join("");
  }

  // ---------------------------------------------------------------- the tug of war
  // Every block pulls the HQ toward itself; the fair HQ is where the pulls cancel. The reader
  // can grab the pin and test any spot (the probe); letting go replays the solver's own steps.
  var FB = FairBlocks;
  var EX = HQ.ex = {
    probe: null, probeP: 1, path: null, settle: null,
    layers: { blocks: true, ropes: true, bowl: false }, ropeMode: "bundled", story: null,
  };
  HQ.anchor = function () { return EX.probe || V.hq; };
  HQ.blocksNow = function () { return V.P && V.P.idx ? FB.ofPop(D, V.P) : null; };
  var webMemo = { key: null, val: null };
  HQ.webNow = function () {
    var B = HQ.blocksNow(), a = HQ.anchor();
    if (!B || !a) return null;
    var off = state.k > 1 && V.offices ? V.offices : null;
    var key = [V.F.key, V.M, a.join(), state.p, off ? off.join() : "", EX.ropeMode].join("|");
    if (webMemo.key !== key) webMemo = { key: key, val: FB.web(B, a, off ? 1 : state.p, { offices: off, direct: EX.ropeMode === "direct" }) };
    return webMemo.val;
  };
  var pullMemo = { key: null, val: null };
  function pullsAt(a) {
    var key = [V.F.key, V.M, a.join(), state.p].join("|");
    if (pullMemo.key !== key) pullMemo = { key: key, val: FB.pulls(D, V.P, a, state.p) };
    return pullMemo.val;
  }
  HQ.probePulls = function () { return EX.probe && V.P ? pullsAt(EX.probe) : null; };
  var hqCost = { key: null, km: 0 };
  function hqMeanKm() {
    var key = [V.F.key, V.M, V.hq.join(), state.p].join("|");
    if (hqCost.key !== key) hqCost = { key: key, km: FB.pulls(D, V.P, V.hq, state.p).meanKm };
    return hqCost.km;
  }
  HQ.probeExtraKm = function () { return EX.probe && V.hq ? Math.max(0, pullsAt(EX.probe).meanKm - hqMeanKm()) : null; };

  function clearProbe() {
    if (!EX.probe && !EX.settle) return;
    EX.probe = null; EX.path = null; EX.settle = null;
    clearTimeout(EX.clearTimer);
    HQ.Globe && HQ.Globe.invalidate();
  }
  HQ.probeTo = function (x) {
    EX.settle = null; EX.path = null; clearTimeout(EX.clearTimer);
    EX.probe = x; EX.probeP = state.p;
    HQ.Globe.invalidate();
    scheduleWhy();
  };
  // Let go: the solver's own iteration, one step every 110 ms, from the tested spot.
  HQ.probeRelease = function (onDone) {
    if (!EX.probe || !V.P) return;
    EX.settle = { x: EX.probe, t: undefined, n: 0, last: 0, onDone: onDone || null };
    EX.path = [EX.probe];
  };
  function settleTick() {
    var st = EX.settle;
    if (!st || now() - st.last < 110) return;
    st.last = now();
    var r = S.fairPoint(V.P, state.p, st.x, { iters: 1, tol: 0, t: st.t });
    st.x = r.x; st.t = r.t; st.n++;
    EX.probe = st.x; EX.path.push(st.x);
    var left = V.hq ? S.km(st.x, V.hq) : 0;
    if (left < 2 || st.n >= 70 || (r.converged && st.n > 1)) {
      EX.settle = null;
      EX.settled = { steps: st.n, left: left };
      if (st.onDone) st.onDone();
      EX.clearTimer = setTimeout(function () { EX.probe = null; EX.path = null; HQ.Globe.invalidate(); refreshCards(); }, EX.story ? 1e9 : 1600);
    }
    HQ.Globe.invalidate();
    scheduleWhy();
  }
  var whyQueued = false;
  function scheduleWhy() {
    if (whyQueued) return;
    whyQueued = true;
    requestAnimationFrame(function () { whyQueued = false; if (V.hq) { why(); legend(); } });
  }

  // The bowl: average trip from every spot, on a 2° grid from the blocks, as a background job.
  var bowlCache = new Map();
  HQ.bowlNow = function () {
    if (!V.P || !V.P.idx) return null;
    var key = fmKey() + "|" + state.p.toFixed(1);
    if (bowlCache.has(key)) return bowlCache.get(key);
    var B = HQ.blocksNow(), p = state.p;
    addJob("bowl " + key, 2, "Shaping the bowl…", FB.bowlGen(B, p), function (vals) {
      var lo = Infinity;
      for (var i = 0; i < vals.length; i++) if (vals[i] < lo) lo = vals[i];
      bowlCache.set(key, FB.rings(vals, lo));
      if (bowlCache.size > 12) bowlCache.delete(bowlCache.keys().next().value);
      HQ.Globe.invalidate();
    });
    return null;
  };

  // Tooltips for the stacks and the cable knots.
  function people(v) {
    return v >= 1e9 ? fmt(v / 1e9, 2) + " billion" : v >= 1e6 ? fmt(v / 1e6, v < 1e7 ? 1 : 0) + " million" : v >= 1e4 ? fmt(Math.round(v / 1e3)) + " thousand" : fmt(Math.round(v));
  }
  HQ.people = people;
  function pullWords(en) {
    var m = Math.hypot(en[0], en[1]) * 100;
    if (m < 0.5) return "barely pulls at all (it surrounds the spot)";
    var deg = (Math.atan2(en[0], en[1]) / (Math.PI / 180) + 360) % 360;
    return "pulls " + COMPASS[Math.round(deg / 45) % 8] + " with strength <b>" + fmt(m, m < 10 ? 1 : 0) + "</b>";
  }
  HQ.stackTip = function (s, outside) {
    var a = HQ.anchor(), km = a ? S.km(s.x, a) : 0, sub = FB.subregions[s.sub];
    return "<b>" + s.n + " block" + (s.n === 1 ? "" : "s") + "</b> · " + fmt(s.n / 10, 1) + "% of " + (V.M === "all" ? "everyone" : V.M === "urban" ? "city folk" : "country folk") +
      "<br>" + people(s.people) + " people, mostly " + esc(sub ? sub.name : "") +
      "<br>" + fmt(km) + " km from the " + (EX.probe ? "tested spot" : "HQ") +
      (state.p !== 1 && !(state.k > 1) ? '<br><span class="muted">at p = ' + state.p + " each of its ropes pulls " + fmt(Math.pow(km / Math.max(1, hqMeanKm()), state.p - 1), 2) + "× an average one</span>" : "") +
      (outside ? '<br><b style="color:#e34948">Outside the worst-off circle</b>' : "");
  };
  HQ.knotTip = function (kn) {
    var a = HQ.anchor(), pl = pullsAt(a);
    var o = kn.level === 2 ? pl.cont[kn.cont] : pl.sub[kn.sub], name = kn.level === 2 ? FB.continents[kn.cont] : FB.subregions[kn.sub].name;
    return "<b>" + esc(name) + "</b> · " + fmt(o.people / pl.W * 100, 1) + "% of people (" + kn.n + " blocks)" +
      "<br>All its ropes together " + pullWords(o.en) + "." +
      '<br><span class="muted">' + (kn.level === 2 ? "a continent's trunk: the sum of its regions' cables" : "a region's cable: the sum of its blocks' ropes") +
      ". Strength 100 would be everyone pulling the same way.</span>";
  };

  // The "Why here?" card: the force polygon and a pull per continent.
  function why() {
    var a = HQ.anchor();
    if (!a || !V.P || !V.P.idx) return;
    var pl = pullsAt(a), probing = !!EX.probe, settling = !!EX.settle;
    var netM = Math.hypot(pl.netEN[0], pl.netEN[1]) * 100;
    var pTxt = state.p === Math.round(state.p) ? state.p : state.p.toFixed(1);
    var lead;
    if (settling) {
      lead = "<b>Sliding back, step " + EX.settle.n + ".</b> " + (state.p <= 2
        ? "Each step jumps to the average of everyone, weighted by 1&#8202;/&#8202;distance" + (state.p > 1 ? "<sup>" + fmt(2 - state.p, 1) + "</sup>" : "") + ". That is Weiszfeld's method, and it is how this page finds the HQ."
        : "Each step follows the net pull downhill, the same way this page solves the dial.");
    } else if (probing) {
      lead = "<b>Out of balance.</b> Here the pulls leave a net tug of <b>" + fmt(netM, netM < 10 ? 1 : 0) + "</b> to the " + HQ.bearing(a, S.unit([a[0] + 0.01 * pl.net[0], a[1] + 0.01 * pl.net[1], a[2] + 0.01 * pl.net[2]])) +
        " (red), and the average trip is <b>" + fmt(HQ.probeExtraKm()) + " km</b> longer. Let go and it slides back.";
    } else {
      lead = "<b>Every block pulls the HQ toward itself.</b> " + (state.p === 1
        ? "At p = 1 every rope pulls equally hard, near or far."
        : "At p = " + pTxt + " a rope pulls harder the longer it is (distance<sup>" + fmt(state.p - 1, 1) + "</sup>), so far-off blocks count for more.") +
        " Chained tip to tail, the pulls come back to where they started: <b>here they cancel</b>. That is what makes it the fair spot.";
    }
    $("whyLead").innerHTML = lead;
    $("whyPoly").innerHTML = polygonSVG(pl, probing);
    var rows = pl.cont.slice().filter(function (c) { return c.people > 0; }).sort(function (x, y) { return y.people - x.people; });
    $("whyRows").innerHTML = rows.map(function (c) {
      var m = Math.hypot(c.en[0], c.en[1]) * 100, ang = Math.atan2(-c.en[1], c.en[0]) / (Math.PI / 180);
      return '<div class="pull"><span class="swatch" style="background:' + FB.COLORS[c.i] + '"></span><span class="nm">' + esc(c.name) + "</span>" +
        '<span class="pc">' + fmt(c.people / pl.W * 100, c.people / pl.W < 0.1 ? 1 : 0) + "%</span>" +
        '<svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true"><g transform="rotate(' + ang.toFixed(0) + ')"><path d="M-6 0h9" stroke="' + FB.COLORS[c.i] + '" stroke-width="2.2" stroke-linecap="round"/><path d="M7 0l-4.5-3.5v7z" fill="' + FB.COLORS[c.i] + '"/></g></svg>' +
        '<span class="st">' + fmt(m, m < 10 ? 1 : 0) + "</span></div>";
    }).join("") + '<div class="pull net"><span class="swatch" style="background:' + (netM > 0.5 ? "#e34948" : "#4b92db") + '"></span><span class="nm">' + (netM > 0.5 ? "Net pull" : "All together") +
      '</span><span class="pc"></span><span></span><span class="st">' + fmt(netM, netM < 10 ? 1 : 0) + "</span></div>";
    $("whyFoot").innerHTML = "Share of people, the direction its ropes pull, and how hard (100 would be everyone pulling the same way)." +
      (FB.hasRegions ? "" : " Regions are guessed from lat/lon in the demo data.");
  }

  // Region pulls chained tip to tail, grouped by continent (continents in angle order, so the
  // chords make a convex loop). A balanced spot closes the loop; a gap is the net pull.
  function polygonSVG(pl, probing) {
    var W0 = 320, H0 = 196, pad = 24;
    var cs = pl.cont.filter(function (c) { return Math.hypot(c.en[0], c.en[1]) > 1e-6; });
    cs.sort(function (a, b) { return Math.atan2(a.en[1], a.en[0]) - Math.atan2(b.en[1], b.en[0]); });
    var pts = [[0, 0]], chords = [], subs = [];
    cs.forEach(function (c) {
      var start = pts[pts.length - 1];
      var ss = pl.sub.filter(function (s) { return s.cont === c.i && Math.hypot(s.en[0], s.en[1]) > 1e-6; });
      ss.sort(function (a, b) { return Math.atan2(a.en[1], a.en[0]) - Math.atan2(b.en[1], b.en[0]); });
      ss.forEach(function (s) {
        var q = pts[pts.length - 1], r = [q[0] + s.en[0], q[1] - s.en[1]];
        subs.push({ a: q, b: r, s: s }); pts.push(r);
      });
      chords.push({ a: start, b: pts[pts.length - 1], c: c });
    });
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var k = Math.min((W0 - 2 * pad) / Math.max(1e-9, x1 - x0), (H0 - 2 * pad) / Math.max(1e-9, y1 - y0));
    var ox = (W0 - k * (x1 + x0)) / 2, oy = (H0 - k * (y1 + y0)) / 2;
    var X = function (p) { return (ox + k * p[0]).toFixed(1); }, Y = function (p) { return (oy + k * p[1]).toFixed(1); };
    var arrow = function (a, b, col, w, op) {
      var dx = (b[0] - a[0]) * k, dy = (b[1] - a[1]) * k, L = Math.hypot(dx, dy);
      if (L < 0.5) return "";
      var s = '<line x1="' + X(a) + '" y1="' + Y(a) + '" x2="' + X(b) + '" y2="' + Y(b) + '" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round" opacity="' + op + '"/>';
      if (L > 7) {
        var ux = dx / L, uy = dy / L, hx = +X(b), hy = +Y(b), hs = Math.min(6, 2 + w * 1.4);
        s += '<path d="M' + hx + " " + hy + "L" + (hx - hs * ux - hs * 0.6 * uy).toFixed(1) + " " + (hy - hs * uy + hs * 0.6 * ux).toFixed(1) + "L" + (hx - hs * ux + hs * 0.6 * uy).toFixed(1) + " " + (hy - hs * uy - hs * 0.6 * ux).toFixed(1) + 'Z" fill="' + col + '" opacity="' + op + '"/>';
      }
      return s;
    };
    var cx0 = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length, cy0 = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
    var placed = [[+X([0, 0]) - 8, +Y([0, 0]) - 8, 16, 16]];
    var s = '<rect width="' + W0 + '" height="' + H0 + '" fill="none"/>';
    chords.forEach(function (ch) { s += arrow(ch.a, ch.b, FB.COLORS[ch.c.i], 7, 0.22); });
    subs.forEach(function (o) { s += "<g><title>" + esc(o.s.name) + "</title>" + arrow(o.a, o.b, FB.COLORS[o.s.cont], 2, 0.95) + "</g>"; });
    chords.forEach(function (ch) {
      var mx = (ch.a[0] + ch.b[0]) / 2, my = (ch.a[1] + ch.b[1]) / 2, dx = mx - cx0, dy = my - cy0, d = Math.hypot(dx, dy) || 1;
      if (Math.hypot(ch.b[0] - ch.a[0], ch.b[1] - ch.a[1]) * k < 16) return;
      // outside the loop, anchored away from it, kept in the box and off earlier labels
      var tw = ch.c.name.length * 5.6, ux = dx / d, uy = dy / d, tx = ox + k * mx + ux * 9, ty = oy + k * my + uy * 9;
      var left = ux > 0.35 ? tx : ux < -0.35 ? tx - tw : tx - tw / 2;
      left = Math.max(3, Math.min(W0 - 3 - tw, left)); ty = Math.max(9, Math.min(H0 - 7, ty));
      for (var tries = 0; tries < 4 && placed.some(function (b) { return left < b[0] + b[2] && b[0] < left + tw && ty - 6 < b[1] + b[3] && b[1] < ty + 6; }); tries++) ty += uy >= 0 ? 12 : -12;
      placed.push([left, ty - 6, tw, 12]);
      s += '<text x="' + left.toFixed(1) + '" y="' + ty.toFixed(1) + '" dominant-baseline="middle" font-size="10.5" font-weight="700" fill="' + FB.COLORS[ch.c.i] + '" stroke="#f3ead6" stroke-width="3" paint-order="stroke">' + esc(ch.c.name) + "</text>";
    });
    var end = pts[pts.length - 1], gap = Math.hypot(end[0], end[1]) * k;
    if (gap > 3) s += '<g stroke-dasharray="4 3">' + arrow([0, 0], end, "#e34948", 2.6, 1) + "</g>";
    s += '<circle cx="' + X([0, 0]) + '" cy="' + Y([0, 0]) + '" r="5" fill="' + (probing ? "#f0a43a" : "#4b92db") + '" stroke="#fff" stroke-width="1.6"/>';
    s += '<text x="' + (W0 - 4) + '" y="12" text-anchor="end" font-size="10" fill="#8a8699">N ↑</text>';
    return s;
  }

  // Layer switches and the step-by-step story.
  ["blocks", "ropes", "bowl"].forEach(function (k) {
    var el = $("lay-" + k);
    el.checked = EX.layers[k];
    el.addEventListener("change", function () { EX.layers[k] = el.checked; HQ.Globe.invalidate(); legend(); });
  });
  function syncLayers() { ["blocks", "ropes", "bowl"].forEach(function (k) { $("lay-" + k).checked = EX.layers[k]; }); }

  var STORY = [
    { layers: { blocks: true, ropes: false, bowl: false }, text: function () {
      return "<b>These are the people of " + HQ.yearLabel(V.F.year) + ".</b> Each block is 0.1% of everyone alive then, about " + people(V.P.W / FB.NB) + " people. Tall stacks are where people crowd.";
    } },
    { layers: { blocks: true, ropes: true, bowl: false }, ropes: "direct", text: function () {
      return "<b>Every block ties a rope to the HQ</b> and pulls it towards home. " + (state.p === 1 ? "Near or far, every rope pulls equally hard." : "At p = " + state.p + ", longer ropes pull harder.");
    } },
    { layers: { blocks: true, ropes: true, bowl: false }, ropes: "bundled", text: function () {
      return "<b>Ropes from one region twist into a cable</b>, and cables into a trunk per continent. A cable pulls exactly as hard as its ropes together, so the sum can be done region by region.";
    } },
    { layers: { blocks: true, ropes: true, bowl: false }, ropes: "bundled", probe: true, text: function () {
      return "<b>Now put the HQ somewhere else.</b> The pulls stop cancelling: the red arrow is what is left over, the net pull. It points back towards the fair spot.";
    } },
    { layers: { blocks: true, ropes: true, bowl: false }, ropes: "bundled", settle: true, text: function () {
      return "<b>Let go and it slides home</b>, one step at a time. " + (state.p <= 2 ? "Each step moves to the average of everyone, weighted by 1 / distance (Weiszfeld's method)." : "Each step follows the net pull downhill.") + " This is exactly how the page finds the HQ.";
    } },
    { layers: { blocks: true, ropes: true, bowl: true }, ropes: "bundled", text: function () {
      return "<b>At the fair spot every pull is cancelled.</b> The rings show how much longer the average trip gets as the HQ walks away: it sits at the bottom of a bowl. Drag the pin to try any spot yourself.";
    } },
  ];
  function storyGo(i) {
    var st = EX.story, step = STORY[i];
    st.i = i;
    EX.layers = Object.assign({}, step.layers); syncLayers();
    EX.ropeMode = step.ropes || "bundled";
    clearProbe();
    if (step.probe || step.settle) {
      var pl = FB.pulls(D, V.P, V.hq, state.p), big = pl.cont.slice().sort(function (a, b) { return Math.hypot(b.en[0], b.en[1]) - Math.hypot(a.en[0], a.en[1]); })[0];
      var v = big.v, m = Math.hypot(v[0], v[1], v[2]) || 1, t = 3000 / 6371.0088, h = V.hq;
      var x = S.unit([Math.cos(t) * h[0] - Math.sin(t) * v[0] / m, Math.cos(t) * h[1] - Math.sin(t) * v[1] / m, Math.cos(t) * h[2] - Math.sin(t) * v[2] / m]);
      EX.probe = x; EX.probeP = state.p;
      HQ.Globe.flyTo(S.unit([x[0] + h[0], x[1] + h[1], x[2] + h[2]]), 700, true);
      if (step.settle) setTimeout(function () { if (EX.story && EX.story.i === i) HQ.probeRelease(); }, 500);
    } else HQ.Globe.flyTo(V.hq, 700, true, 20);
    $("storyText").innerHTML = step.text();
    $("storyCount").textContent = (i + 1) + " / " + STORY.length;
    $("storyBack").disabled = i === 0;
    $("storyNext").textContent = i === STORY.length - 1 ? "Done" : "Next";
    HQ.Globe.invalidate(); refreshCards();
  }
  function storyOpen() {
    if (state.playing) HQ.togglePlay();
    EX.story = { saved: Object.assign({}, EX.layers), i: 0 };
    $("story").hidden = false;
    storyGo(0);
  }
  function storyClose() {
    if (!EX.story) return;
    EX.layers = EX.story.saved; EX.story = null; EX.ropeMode = "bundled";
    $("story").hidden = true;
    clearProbe(); syncLayers(); refreshCards(); HQ.Globe.invalidate();
  }
  $("whyStory").addEventListener("click", storyOpen);
  $("storyBack").addEventListener("click", function () { if (EX.story.i > 0) storyGo(EX.story.i - 1); });
  $("storyNext").addEventListener("click", function () { if (EX.story.i < STORY.length - 1) storyGo(EX.story.i + 1); else storyClose(); });
  $("storyClose").addEventListener("click", storyClose);

  // ---------------------------------------------------------------- controls
  HQ.setYear = function (year, branch) {
    year = Math.max(years[0], Math.min(years[years.length - 1], year));
    if (years.indexOf(year) < 0) year = HQ.nearestYear(year);
    var changed = year !== state.year || (branch && branch !== state.branch);
    state.year = year;
    if (branch) state.branch = branch;
    if (changed) { update(); syncBranchButtons(); }
  };
  function seg(id, key, parse) {
    var el = $(id);
    el.addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b || b.disabled) return;
      state[key] = parse(b.dataset.v);
      Array.prototype.forEach.call(el.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      update();
    });
  }
  seg("segWorst", "worst", Number);
  seg("segK", "k", Number);
  seg("segMode", "mode", String);
  $("voteToggle").addEventListener("change", function (ev) { state.vote = ev.target.checked; update(); });
  $("dial").addEventListener("input", function (ev) { state.p = Math.round(+ev.target.value * 10) / 10; update({ noFly: true }); });

  var bWrap = $("branches");
  ["ssp1", "ssp3", "ssp5"].forEach(function (b) {
    if (!FAIR.series || !D.frames.some(function (f) { return f.sid === b; })) return;
    var bt = document.createElement("button");
    bt.dataset.b = b;
    bt.innerHTML = '<span class="swatch" style="background:' + HQ.BRANCH[b].color + '"></span>' + HQ.BRANCH[b].code + " " + HQ.BRANCH[b].name;
    bt.title = HQ.BRANCH[b].code + ", " + HQ.BRANCH[b].short;
    bt.addEventListener("click", function () { state.branch = b; syncBranchButtons(); update(); });
    bWrap.appendChild(bt);
  });
  function syncBranchButtons() {
    Array.prototype.forEach.call(bWrap.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", String(x.dataset.b === state.branch)); });
  }
  HQ.syncBranchButtons = syncBranchButtons;

  // Play: step through the frames; the globe follows the HQ.
  var playTimer = null;
  HQ.togglePlay = function () {
    state.playing = !state.playing;
    $("playIcon").innerHTML = state.playing ? '<rect x="5" y="4" width="4" height="14" fill="#2b1b00"/><rect x="13" y="4" width="4" height="14" fill="#2b1b00"/>'
      : '<path d="M6 3l13 8-13 8z" fill="#2b1b00"/>';
    $("play").setAttribute("aria-label", state.playing ? "Pause" : "Play the drift");
    if (state.playing) {
      if (state.year >= years[years.length - 1]) { state.year = years[0]; update(); }
      step();
    } else { clearTimeout(playTimer); update(); }
  };
  function step() {
    playTimer = setTimeout(function () {
      if (!state.playing) return;
      var i = years.indexOf(state.year);
      if (i >= years.length - 1) { HQ.togglePlay(); return; }
      HQ.setYear(years[i + 1]);
      step();
    }, 650);
  }
  $("play").addEventListener("click", HQ.togglePlay);
  $("zoomIn").addEventListener("click", function () { HQ.Globe.zoomBy(1.4); });
  $("zoomOut").addEventListener("click", function () { HQ.Globe.zoomBy(1 / 1.4); });
  $("recentre").addEventListener("click", function () { HQ.Globe.flyTo(V.hq, 800, true); });

  $("postcardBtn").addEventListener("click", function () {
    var url = HQ.makePostcard();
    $("postcardImg").src = url;
    $("postcardDl").href = url;
    var T = HQ.nearestTown(V.hq);
    $("postcardDl").download = "fair-hq-" + HQ.yearLabel(state.year).replace(/[^\w]+/g, "") + (T ? "-" + T.name.replace(/[^\w]+/g, "-").toLowerCase() : "") + ".png";
    $("postcardModal").hidden = false;
  });
  $("postcardClose").addEventListener("click", function () { $("postcardModal").hidden = true; });
  $("postcardModal").addEventListener("click", function (ev) { if (ev.target.id === "postcardModal") $("postcardModal").hidden = true; });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { $("postcardModal").hidden = true; storyClose(); } });

  // ---------------------------------------------------------------- go
  HQ.Globe.init($("globe"));
  HQ.Timeline.init($("tl"));
  syncBranchButtons();
  window.addEventListener("resize", function () { HQ.Globe.resize(); HQ.Timeline.update(); });
  update();
  HQ.Globe.jumpTo(V.hq || p1Base());
  addJob("chain", 9, null, chainGen(), chainDone);
  HQ.ready = true;
})();
