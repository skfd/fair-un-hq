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
    "isimip-hist": "ISIMIP3a histsoc (HYDE-based)", ghsl: "GHSL GHS-POP R2023A",
    ssp1: "ISIMIP3b SSP1", ssp3: "ISIMIP3b SSP3", ssp5: "ISIMIP3b SSP5",
  };
  if (FAIR.isMock) Object.keys(HQ.SERIES_LABEL).forEach(function (k) { HQ.SERIES_LABEL[k] += " (mock)"; });
  var FORK = D.trunk.length ? D.trunk[D.trunk.length - 1].year : 2030;
  HQ.FORK = FORK;
  var years = [];
  D.frames.forEach(function (f) { if (years.indexOf(f.year) < 0) years.push(f.year); });
  years.sort(function (a, b) { return a - b; });
  HQ.years = years;
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
  var stats = HQ.stats = {};       // key -> { depth, pop }
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
      var c = S.centroid(P);
      stats[fr.key] = { depth: (1 - Math.hypot(c[0], c[1], c[2])) * 6371, pop: P.W, centroid: c };
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
      if (i % 4 === 0) { HQ.Timeline.update(); drawSpark(); }
    }
  }
  function chainDone() { HQ.Timeline.update(); drawSpark(); refreshCards(); HQ.Globe.invalidate(); HQ.chainReady = true; }

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
    $("yearBig").textContent = F.year;
    $("yearSub").innerHTML = '<span class="conf">' + F.conf + "</span>" + HQ.SERIES_LABEL[F.sid];
    var b = F.branch ? HQ.BRANCH[F.branch] : null;
    $("yearBranch").innerHTML = b ? '<span class="swatch" style="background:' + b.color + '"></span>' + b.code + ": " + b.name : "";

    welcome(x);
    caption();
    notes();
    drift();
    depth();
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
    $("noteMode").innerHTML = !can && state.mode !== "all" ? "No city/country split for " + F.year + ", so everyone counts." :
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
      body.textContent = "Ask again in " + (F.year + 5) + ". (Antiquity is still in the post.)";
      return;
    }
    if (!cur || !prev) { head.textContent = "Measuring…"; body.textContent = ""; return; }
    var km = S.km(prev.x, cur.x), dy = F.year - F.prev.year, kmyr = km / dy, mday = kmyr * 1000 / 365.25;
    head.innerHTML = "The HQ would have to crawl <span class=\"big\">" + fmt(mday, mday < 10 ? 1 : 0) + " metres a day</span>.";
    var snailMin = mday / 0.013 / 60;
    body.innerHTML = F.prev.year + " → " + F.year + ": " + fmt(km) + " km " + bearing(prev.x, cur.x) + ", or " + fmt(kmyr, 1) +
      " km a year. A garden snail could cover a day's crawl in " + (snailMin < 90 ? fmt(snailMin) + " minutes" : fmt(snailMin / 60, 1) + " hours") + ", then nap.";
    if (F.seam) warn.innerHTML = '<div class="warn">Careful: this step crosses a data seam (' + esc(HQ.SERIES_LABEL[F.prev.sid]) + " → " +
      esc(HQ.SERIES_LABEL[F.sid]) + "). Part of the jump is the change of source, not people moving.</div>";
  }

  var LAYERS = [[35, "crust"], [660, "upper mantle"], [2890, "lower mantle"], [5150, "outer core"], [6371, "inner core"]];
  function layerOf(d) { for (var i = 0; i < LAYERS.length; i++) if (d < LAYERS[i][0]) return LAYERS[i][1]; return "inner core"; }
  HQ.layerOf = layerOf;
  function depth() {
    var c = S.centroid(V.P), dep = (1 - Math.hypot(c[0], c[1], c[2])) * 6371;
    V.depth = dep;
    var who = V.M === "urban" ? "city folk's" : V.M === "rural" ? "country folk's" : "humanity's";
    $("depthHead").innerHTML = fmt(dep) + " km down";
    $("depthBody").innerHTML = "The 3D centre of mass of " + who + " bodies sits in the <b>" + layerOf(dep) + "</b>. " +
      "Spread evenly, it would be at the very centre; all in one spot, at the surface.";
    cutaway(dep);
    if (sparkKey !== V.F.key + V.M + state.branch) drawSpark();
  }
  var sparkKey = null;
  function cutaway(dep) {
    var r = 44, rr = function (d) { return r * (1 - d / 6371); };
    var s = '<defs><clipPath id="cutc"><path d="M0 0L' + r + ' 0A' + r + ' ' + r + ' 0 1 1 0 -' + r + 'Z"/></clipPath></defs>' +
      '<circle r="' + r + '" fill="#2a5d8f"/>' +
      '<path d="M0 0L' + r + ' 0A' + r + ' ' + r + ' 0 0 0 0 -' + r + 'Z" fill="#efe3c6"/>' +
      '<circle r="' + rr(35) + '" fill="none"/>' +
      '<path d="M0 0L' + rr(35) + ' 0A' + rr(35) + ' ' + rr(35) + ' 0 0 0 0 -' + rr(35) + 'Z" fill="#e8a25c"/>' +
      '<path d="M0 0L' + rr(660) + ' 0A' + rr(660) + ' ' + rr(660) + ' 0 0 0 0 -' + rr(660) + 'Z" fill="#df7f45"/>' +
      '<path d="M0 0L' + rr(2890) + ' 0A' + rr(2890) + ' ' + rr(2890) + ' 0 0 0 0 -' + rr(2890) + 'Z" fill="#f2c14e"/>' +
      '<path d="M0 0L' + rr(5150) + ' 0A' + rr(5150) + ' ' + rr(5150) + ' 0 0 0 0 -' + rr(5150) + 'Z" fill="#fff0b3"/>';
    // the land caps on the globe part, for charm
    s += '<path d="M-30 -28c6-4 12 0 16-4M-38 6c5 2 8-3 14 0 4 3 8 1 10 6M-20 30c5-2 9 2 14 0" stroke="#efe3c6" stroke-width="5" stroke-linecap="round" fill="none" opacity=".9"/>';
    // the dot, on the cut face at 45 degrees
    var d = rr(dep), a = -Math.PI / 4;
    s += '<line x1="0" y1="0" x2="' + (r * Math.cos(a)).toFixed(1) + '" y2="' + (r * Math.sin(a)).toFixed(1) + '" stroke="#23223a" stroke-dasharray="2 2" stroke-width="1"/>' +
      '<circle cx="' + (d * Math.cos(a)).toFixed(1) + '" cy="' + (d * Math.sin(a)).toFixed(1) + '" r="4.5" fill="#4b92db" stroke="#fff" stroke-width="1.5"/>' +
      '<circle r="' + r + '" fill="none" stroke="#23223a" stroke-opacity=".35"/>';
    $("cutaway").innerHTML = s;
  }

  // Depth over time: trunk plus the three futures. Deeper is lower, like the real thing.
  function drawSpark() {
    if (V.F) sparkKey = V.F.key + V.M + state.branch;
    var svg = d3.select("#spark"), w = svg.node().clientWidth || 320, h = 56;
    var series = [{ id: "trunk", color: "#23223a", fr: D.trunk }].concat(["ssp1", "ssp3", "ssp5"].map(function (b) {
      return { id: b, color: HQ.BRANCH[b].color, fr: (D.trunk.length ? [D.trunk[D.trunk.length - 1]] : []).concat(D.frames.filter(function (f) { return f.sid === b; })) };
    }));
    var all = [];
    series.forEach(function (s) { s.pts = s.fr.filter(function (f) { return stats[f.key]; }).map(function (f) { return [f.year, stats[f.key].depth, f]; }); all = all.concat(s.pts); });
    svg.selectAll("*").remove();
    if (all.length < 2) return;
    var x = d3.scaleLinear([years[0], years[years.length - 1]], [2, w - 2]);
    var ext = d3.extent(all, function (d) { return d[1]; });
    var y = d3.scaleLinear(ext, [6, h - 12]);
    svg.append("text").attr("x", 2).attr("y", h).attr("font-size", 10).attr("fill", "#8a8699").text(years[0]);
    svg.append("text").attr("x", w - 2).attr("y", h).attr("text-anchor", "end").attr("font-size", 10).attr("fill", "#8a8699").text(years[years.length - 1]);
    svg.append("text").attr("x", 2).attr("y", 4).attr("font-size", 10).attr("fill", "#8a8699").text(fmt(ext[0]) + " km");
    svg.append("text").attr("x", 2).attr("y", h - 14).attr("font-size", 10).attr("fill", "#8a8699").attr("dy", -2).text(fmt(ext[1]) + " km");
    var line = d3.line().x(function (d) { return x(d[0]); }).y(function (d) { return y(d[1]); });
    series.forEach(function (s) {
      if (s.pts.length < 2) return;
      var sel = s.id === "trunk" || s.id === state.branch;
      svg.append("path").attr("d", line(s.pts)).attr("fill", "none").attr("stroke", s.color)
        .attr("stroke-width", sel ? 2 : 1.5).attr("stroke-opacity", sel ? 1 : 0.45).attr("stroke-linecap", "round");
    });
    if (V.F && stats[V.F.key]) {
      svg.append("line").attr("x1", x(V.F.year)).attr("x2", x(V.F.year)).attr("y1", 2).attr("y2", h - 12).attr("stroke", "#c9bfa6").attr("stroke-dasharray", "2 2");
      svg.append("circle").attr("cx", x(V.F.year)).attr("cy", y(stats[V.F.key].depth)).attr("r", 4).attr("fill", "#4b92db").attr("stroke", "#fff").attr("stroke-width", 1.5);
    }
    svg.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
      .on("mousemove", function (ev) {
        var yr = Math.round(x.invert(d3.pointer(ev)[0]) / 5) * 5, f = HQ.frameAt(yr, state.branch);
        $("sparkRead").textContent = f && stats[f.key] ? yr + ": " + fmt(stats[f.key].depth) + " km down" : "";
      })
      .on("mouseleave", function () { $("sparkRead").textContent = ""; })
      .on("click", function (ev) { var yr = Math.round(x.invert(d3.pointer(ev)[0]) / 5) * 5; HQ.setYear(yr, state.branch); });
  }

  function legend() {
    var dash = function (d, c) { return '<svg width="24" height="8"><line x1="2" y1="4" x2="22" y2="4" stroke="' + (c || "#fff1cf") + '" stroke-width="2.2" stroke-linecap="round"' + (d ? ' stroke-dasharray="' + d + '"' : "") + "/></svg>"; };
    var rows = [
      '<div class="row"><svg width="30" height="14"><path d="M15 1c-3.3 0-5.5 2.4-5.5 5.5C9.5 10 15 14 15 14s5.5-4 5.5-7.5C20.5 3.4 18.3 1 15 1z" fill="#4b92db" stroke="#fff" stroke-width="1.2"/></svg>The fair HQ (p = ' + (state.p === Math.round(state.p) ? state.p : state.p.toFixed(1)) + ")</div>",
      '<div class="row">Trail of the p = 1 HQ:</div><div class="row trail-styles"><span>' + dash("0.5 4") + "modelled</span><span>" + dash("") + "observed</span><span>" + dash("6 4") + "projected</span></div>",
      '<div class="row"><svg width="30" height="12"><circle cx="15" cy="6" r="4.5" fill="#0b1128" stroke="#fff" stroke-width="1.4"/><path d="M12.5 6h5" stroke="#fff" stroke-width="1.4"/></svg>seam between data sources</div>',
    ];
    if (state.year > FORK) rows.push('<div class="row">' + ["ssp1", "ssp3", "ssp5"].map(function (b) { return '<span class="swatch" style="background:' + HQ.BRANCH[b].color + '"></span>' + HQ.BRANCH[b].code; }).join(" &nbsp;") + "</div>");
    if (state.worst) rows.push('<div class="row"><svg width="30" height="14"><circle cx="15" cy="7" r="5.5" fill="none" stroke="#fff" stroke-width="3"/><circle cx="15" cy="7" r="5.5" fill="none" stroke="#e34948" stroke-width="3" stroke-dasharray="4.3 4.3"/></svg>worst-off (' + (state.worst === 0.999 ? "99.9" : "99") + "%)</div>");
    if (state.vote) rows.push('<div class="row"><svg width="30" height="14"><rect x="9" y="2" width="12" height="11" rx="2" fill="#b05fd0" stroke="#fff" stroke-width="1.2"/><path d="M12 5h6" stroke="#fff" stroke-width="1.5"/></svg>one country, one vote</div>');
    if (state.k > 1) rows.push('<div class="row"><svg width="30" height="14"><circle cx="15" cy="7" r="6" fill="#3987e5" stroke="#fff" stroke-width="1.2"/></svg>' + state.k + " offices, people coloured by nearest</div>");
    rows.push('<div class="row" style="opacity:.8"><svg width="30" height="10"><rect x="8" y="3" width="4" height="4" fill="#ff8a3d" opacity=".4"/><rect x="14" y="3" width="4" height="4" fill="#ff8a3d" opacity=".7"/><rect x="20" y="3" width="4" height="4" fill="#ff8a3d"/></svg>where people live (' + (V.M === "urban" ? "cities" : V.M === "rural" ? "countryside" : "everyone") + ")</div>");
    $("legend").innerHTML = rows.join("");
  }

  // ---------------------------------------------------------------- controls
  HQ.setYear = function (year, branch) {
    year = Math.max(years[0], Math.min(years[years.length - 1], year));
    if (years.indexOf(year) < 0) year = years.reduce(function (a, b) { return Math.abs(b - year) < Math.abs(a - year) ? b : a; });
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
    $("postcardDl").download = "fair-hq-" + state.year + (T ? "-" + T.name.replace(/[^\w]+/g, "-").toLowerCase() : "") + ".png";
    $("postcardModal").hidden = false;
  });
  $("postcardClose").addEventListener("click", function () { $("postcardModal").hidden = true; });
  $("postcardModal").addEventListener("click", function (ev) { if (ev.target.id === "postcardModal") $("postcardModal").hidden = true; });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") $("postcardModal").hidden = true; });

  // ---------------------------------------------------------------- go
  HQ.Globe.init($("globe"));
  HQ.Timeline.init($("tl"));
  syncBranchButtons();
  window.addEventListener("resize", function () { HQ.Globe.resize(); HQ.Timeline.update(); drawSpark(); });
  update();
  HQ.Globe.jumpTo(V.hq || p1Base());
  addJob("chain", 9, null, chainGen(), chainDone);
  HQ.ready = true;
})();
