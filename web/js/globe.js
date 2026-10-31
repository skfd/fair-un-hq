// The globe: an orthographic canvas, drag to spin, wheel to zoom, flies to the HQ when the
// year changes. Land and the trail go through d3-geo (for clipping); the ~50k population dots
// are projected by hand from their xyz, which is much faster than 50k projection() calls.
(function () {
  "use strict";
  var HQ = window.HQ = window.HQ || {};
  var S = FairSolver;
  var D2R = Math.PI / 180;
  var G = HQ.Globe = {};

  var canvas, ctx, W = 0, H = 0, dpr = 1, R0 = 300, zoom = 1.4, rot = [-75, -30, 0];
  var base = document.createElement("canvas"), bctx = base.getContext("2d"), baseState = null;
  G.stats = { draws: 0, baseDraws: 0, lastMs: 0, lastBaseMs: 0 };
  var projection = d3.geoOrthographic().clipAngle(90).precision(0.4);
  var path, dirty = true, fly = null, drag = null, hits = [], hover = null;
  var sphere = { type: "Sphere" }, graticule = d3.geoGraticule10(), land, landLo, borders;

  // A lighter coastline for frames in motion (drag, fly): 50m land has ~60k points, and
  // projecting and clipping those is most of a frame. Full detail returns when it stops.
  function decimate(fc, tol) {
    function ring(r) {
      var out = [r[0]], last = r[0];
      for (var i = 1; i < r.length - 1; i++) {
        var p = r[i], dx = (p[0] - last[0]) * Math.cos(p[1] * D2R), dy = p[1] - last[1];
        if (dx * dx + dy * dy > tol * tol) { out.push(p); last = p; }
      }
      out.push(r[r.length - 1]);
      return out.length >= 4 ? out : null;
    }
    function poly(rs) { var o = []; for (var i = 0; i < rs.length; i++) { var r = ring(rs[i]); if (r) o.push(r); else if (i === 0) return null; } return o; }
    var polys = [];
    fc.features.forEach(function (f) {
      var g = f.geometry, ps = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      // Thinning can flip a small ring inside out, and then it covers the whole globe: keep the
      // original wherever the thinned polygon comes out bigger than a hemisphere.
      ps.forEach(function (p) { var q = poly(p); if (q) polys.push(d3.geoArea({ type: "Polygon", coordinates: q }) > 2 * Math.PI ? p : q); });
    });
    return { type: "MultiPolygon", coordinates: polys };
  }
  var CLUSTER = ["#3987e5", "#d95926", "#199e70", "#c98500"];
  HQ.CLUSTER = CLUSTER;

  G.init = function (cv) {
    canvas = cv;
    ctx = cv.getContext("2d");
    path = d3.geoPath(projection, ctx);
    land = HQ.land;
    borders = topojson.mesh(FAIR.world, FAIR.world.objects.countries, function (a, b) { return a !== b; });
    landLo = decimate(land, 0.35);
    G.resize();
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", function () { if (!drag) setHover(null); });
    cv.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      G.zoomBy(Math.exp(-ev.deltaY * 0.0015));
    }, { passive: false });
    requestAnimationFrame(loop);
  };
  G.resize = function () {
    var r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    base.width = canvas.width; base.height = canvas.height; baseState = null;
    R0 = Math.min(W, H) * 0.44;
    dirty = true;
  };
  G.invalidate = function () { dirty = true; };
  G.isDragging = function () { return !!(drag && drag.moved && !drag.pin); };   // spinning, not moving the pin
  G.zoomBy = function (f) { zoom = Math.max(0.7, Math.min(9, zoom * f)); dirty = true; };
  G.rotation = function () { return rot.slice(); };

  function targetRot(x) { var a = S.toLatLon(x); return [-a[1], Math.max(-75, Math.min(75, -a[0])), 0]; }
  G.jumpTo = function (x) { if (x) { rot = targetRot(x); dirty = true; } };
  // minDeg: stay put if x is already within that many degrees of the middle.
  G.flyTo = function (x, ms, force, minDeg) {
    if (!x || (drag && drag.moved && !force)) return;
    if (minDeg && !fly) { var V = view(); if (S.angle(V.c, x) < minDeg * D2R) return; }
    var to = targetRot(x), from = rot.slice();
    var dl = ((to[0] - from[0]) % 360 + 540) % 360 - 180;   // the short way round
    fly = { from: from, dl: dl, dp: to[1] - from[1], t0: performance.now(), ms: ms || 800 };
  };

  function loop() {
    if (fly) {
      var t = Math.min(1, (performance.now() - fly.t0) / fly.ms), e = d3.easeCubicInOut(t);
      rot = [fly.from[0] + fly.dl * e, fly.from[1] + fly.dp * e, 0];
      if (t >= 1) fly = null;
      dirty = true;
    }
    if (HQ.tick) HQ.tick();
    if (dirty) { dirty = false; draw(); }
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- interaction
  function down(ev) {
    canvas.setPointerCapture(ev.pointerId);
    var r = canvas.getBoundingClientRect(), h = hitAt(ev.clientX - r.left, ev.clientY - r.top);
    if (h && h.pin && HQ.probeTo) {   // grab the HQ pin: test any spot (see app.js, the tug of war)
      drag = { pin: true, moved: true, dy: h.y + 21 - (ev.clientY - r.top) };
      canvas.classList.add("dragging"); setHover(null);
      return;
    }
    drag = { x: ev.clientX, y: ev.clientY, rot: rot.slice(), moved: false };
    fly = null;
  }
  function pointAt(px, py) {   // the globe point under a screen point, or null off the disc
    var R = R0 * zoom, cx = W / 2, cy = H / 2 + 6;
    if (Math.hypot(px - cx, py - cy) > R * 0.995) return null;
    var ll = projection.invert([px, py]);
    return ll ? S.toXYZ(ll[1], ll[0]) : null;
  }
  function move(ev) {
    var r = canvas.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
    if (drag && drag.pin) {
      var x = pointAt(px, py + drag.dy);
      if (x) HQ.probeTo(x);
      return;
    }
    if (drag) {
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 3) { drag.moved = true; canvas.classList.add("dragging"); setHover(null); }
      if (drag.moved) {
        var k = 180 / Math.PI / (R0 * zoom);
        rot = [drag.rot[0] + dx * k, Math.max(-89, Math.min(89, drag.rot[1] - dy * k)), 0];
        dirty = true;
      }
      return;
    }
    setHover(hitAt(px, py), px, py);
  }
  function up(ev) {
    if (drag && drag.pin) {
      drag = null; canvas.classList.remove("dragging");
      HQ.probeRelease();
      return;
    }
    if (drag && !drag.moved) {
      var r = canvas.getBoundingClientRect(), h = hitAt(ev.clientX - r.left, ev.clientY - r.top);
      if (h && h.year) HQ.setYear(h.year, h.branch || undefined);
    }
    var was = drag && drag.moved;
    drag = null;
    canvas.classList.remove("dragging");
    if (was) dirty = true;
  }
  function hitAt(px, py) {
    var best = null, bd = 1e9;
    for (var i = hits.length - 1; i >= 0; i--) {
      var h = hits[i], d = h.box
        ? (px >= h.box[0] && px <= h.box[2] && py >= h.box[1] && py <= h.box[3] ? -1 : 99)
        : Math.hypot(h.x - px, h.y - py) - h.r;
      if (d < 6 && d < bd) { bd = d; best = h; }
    }
    return best;
  }
  function setHover(h, px, py) {
    var tip = document.getElementById("tip");
    if ((hover && hover.kind) !== (h && h.kind)) dirty = true;
    hover = h;
    canvas.classList.toggle("pointing", !!(h && h.year));
    canvas.classList.toggle("grabbable", !!(h && h.pin));
    if (!h) { tip.hidden = true; return; }
    tip.innerHTML = h.html();
    tip.hidden = false;
    tip.style.left = px + "px"; tip.style.top = py + "px";
  }

  // ---------------------------------------------------------------- drawing helpers
  function view() {   // centre, east and north unit vectors of the current rotation
    var lo = -rot[0] * D2R, la = -rot[1] * D2R, cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
    return { c: [cl * co, cl * so, sl], e: [-so, co, 0], n: [-sl * co, -sl * so, cl] };
  }
  function proj(x, V, R, cx, cy) {
    var d = x[0] * V.c[0] + x[1] * V.c[1] + x[2] * V.c[2];
    return { x: cx + R * (x[0] * V.e[0] + x[1] * V.e[1] + x[2] * V.e[2]), y: cy - R * (x[0] * V.n[0] + x[1] * V.n[1] + x[2] * V.n[2]), vis: d > 0, d: d };
  }
  function geo(x) { var a = S.toLatLon(x); return [a[1], a[0]]; }

  // Population dots, grouped by (colour, brightness) so each group is one fill.
  function dotGroups(P, labels) {
    var cacheKey = labels ? "_g" + labels.length : "_g";
    var store = labels || P;
    if (store[cacheKey] && store[cacheKey].P === P) return store[cacheKey];
    var n = P.n, nb = 8, lo = Math.log10(2000), hi = Math.log10(4e6), k = labels ? 4 : 1;
    var bucket = new Uint8Array(n), count = new Uint32Array(k * nb);
    for (var i = 0; i < n; i++) {
      var b = Math.floor((Math.log10(P.w[i] + 1) - lo) / (hi - lo) * nb);
      b = b < 0 ? 0 : b >= nb ? nb - 1 : b;
      var g = (labels ? labels[i] : 0) * nb + b;
      bucket[i] = g; count[g]++;
    }
    var start = new Uint32Array(k * nb + 1);
    for (g = 0; g < k * nb; g++) start[g + 1] = start[g] + count[g];
    var fill = start.slice(0, k * nb), order = new Uint32Array(n);
    for (i = 0; i < n; i++) order[fill[bucket[i]]++] = i;
    var out = { P: P, order: order, start: start, nb: nb, k: k };
    store[cacheKey] = out;
    return out;
  }

  function drawDots(c, P, labels, V, R, cx, cy, scale, fade) {
    if (!P) return;
    var gr = dotGroups(P, labels), X = P.xyz, order = gr.order;
    var size = Math.max(1.1, R * 0.5 * D2R * 0.62) * (scale || 1), half = size / 2;
    var c0 = V.c[0], c1 = V.c[1], c2 = V.c[2], e0 = V.e[0], e1 = V.e[1], e2 = V.e[2], n0 = V.n[0], n1 = V.n[1], n2 = V.n[2];
    for (var g = 0; g < gr.k * gr.nb; g++) {
      var s = gr.start[g], e = gr.start[g + 1];
      if (s === e) continue;
      var b = g % gr.nb, col = labels ? CLUSTER[(g / gr.nb) | 0] : "#ff8a3d";
      c.globalAlpha = ((labels ? 0.14 : 0.07) + 0.8 * Math.pow(b / (gr.nb - 1), 1.5)) * (fade || 1);
      c.fillStyle = col;
      c.beginPath();
      for (var j = s; j < e; j++) {
        var i = order[j], q = 3 * i, x = X[q], y = X[q + 1], z = X[q + 2];
        var d = x * c0 + y * c1 + z * c2;
        if (d <= 0.02) continue;
        c.rect(cx + R * (x * e0 + y * e1 + z * e2) - half, cy - R * (x * n0 + y * n1 + z * n2) - half, size, size);
      }
      c.fill();
    }
    c.globalAlpha = 1;
  }

  function pin(c, px, py, col, sz, ring) {
    sz = sz || 1;
    c.save();
    c.translate(px, py);
    c.scale(sz, sz);
    c.fillStyle = "rgba(0,0,0,.28)";
    c.beginPath(); c.ellipse(0, 0, 6, 2.2, 0, 0, 2 * Math.PI); c.fill();
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(-3, -7, -11, -13, -11, -21);
    c.arc(0, -21, 11, Math.PI, 0);
    c.bezierCurveTo(11, -13, 3, -7, 0, 0);
    c.fillStyle = col; c.fill();
    c.lineWidth = 2; c.strokeStyle = ring || "#fff"; c.stroke();
    c.beginPath(); c.arc(0, -21, 4.2, 0, 2 * Math.PI); c.fillStyle = "#fff"; c.fill();
    c.restore();
  }
  G.pin = pin;

  function label(c, px, py, text, col) {
    c.font = "600 12px " + getComputedStyle(document.body).fontFamily;
    var w = c.measureText(text).width + (col ? 23 : 14);
    c.fillStyle = "rgba(11,17,40,.78)";
    roundRect(c, px, py - 10, w, 20, 10); c.fill();
    if (col) { c.fillStyle = col; c.beginPath(); c.arc(px + 9, py, 3.5, 0, 2 * Math.PI); c.fill(); }
    c.fillStyle = "#fff"; c.textBaseline = "middle";
    c.fillText(text, px + (col ? 16 : 7), py + 0.5);
  }
  // Each label tries the right of its marker, then the left; if both collide, it stays quiet
  // (the marker still has its hover tip).
  function placeLabels(c, L) {
    var placed = [];
    c.font = "600 12px " + getComputedStyle(document.body).fontFamily;
    L.forEach(function (l) {
      var w = c.measureText(l[2]).width + (l[3] ? 23 : 14), x = l[0], y = l[1];
      var tries = [x, x - w - 2 * (x - l[4])];
      for (var i = 0; i < tries.length; i++) {
        var b = { x: tries[i], y: y - 10, w: w, h: 20 };
        var hit = placed.some(function (p) { return b.x < p.x + p.w + 4 && p.x < b.x + b.w + 4 && b.y < p.y + p.h + 2 && p.y < b.y + b.h + 2; });
        if (!hit) { placed.push(b); label(c, b.x, y, l[2], l[3]); return; }
      }
    });
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  G.roundRect = roundRect;

  var DASH = { modelled: [0.5, 4.5], observed: [], projected: [7, 5] };

  // The trail of the p=1 HQ. Returns hit targets for the nodes and seams.
  function drawTrail(c, pr, gpath, V, R, cx, cy, opts) {
    var st = HQ.state, D = HQ.D, T = HQ.trail, out = [], fork = HQ.FORK;
    var lin = function (f) { return f.branch || "trunk"; };
    var colOf = function (f) { return f.branch ? HQ.BRANCH[f.branch].color : "#fff1cf"; };
    var selBranch = st.year > fork ? st.branch : null;
    c.lineCap = "round"; c.lineJoin = "round";
    var segs = [];
    D.frames.forEach(function (f) {
      if (!f.prev || !T[f.key] || !T[f.prev.key]) return;
      if (opts && opts.onlyBranch && f.branch && f.branch !== opts.onlyBranch) return;
      var past = f.year <= st.year && (!f.branch || f.branch === st.branch);
      var alpha = past ? 1 : f.branch && f.branch !== st.branch ? 0.38 : 0.5;
      segs.push({ f: f, a: T[f.prev.key].x, b: T[f.key].x, alpha: alpha, col: colOf(f), dash: f.seam ? [1.5, 3.5] : DASH[f.conf] || [] });
    });
    // halo first, then the line, so crossings stay readable
    [0, 1].forEach(function (pass) {
      segs.forEach(function (s) {
        c.beginPath();
        gpath({ type: "LineString", coordinates: [geo(s.a), geo(s.b)] });
        c.setLineDash(s.dash);
        c.globalAlpha = s.alpha * (pass ? 1 : 0.6);
        c.lineWidth = pass ? (s.f.seam ? 1.4 : 2.3) : 5;
        c.strokeStyle = pass ? (s.f.seam ? "#c8c4e4" : s.col) : "rgba(8,12,30,.7)";
        c.stroke();
      });
    });
    c.setLineDash([]);
    c.globalAlpha = 1;
    // nodes
    D.frames.forEach(function (f) {
      var t = T[f.key];
      if (!t) return;
      if (opts && opts.onlyBranch && f.branch && f.branch !== opts.onlyBranch) return;
      var p = proj(t.x, V, R, cx, cy);
      if (!p.vis) return;
      var past = f.year <= st.year && (!f.branch || f.branch === st.branch);
      c.globalAlpha = past ? 1 : 0.55;
      c.beginPath(); c.arc(p.x, p.y, 2.6, 0, 2 * Math.PI);
      c.fillStyle = colOf(f); c.fill();
      c.lineWidth = 1; c.strokeStyle = "rgba(8,12,30,.8)"; c.stroke();
      out.push({ x: p.x, y: p.y, r: 4, year: f.year, branch: f.branch, html: function () { return nodeTip(f); } });
    });
    c.globalAlpha = 1;
    // seams
    segs.forEach(function (s) {
      if (!s.f.seam) return;
      var m = d3.geoInterpolate(geo(s.a), geo(s.b))(0.5), mx = S.toXYZ(m[1], m[0]);
      var p = proj(mx, V, R, cx, cy);
      if (!p.vis) return;
      c.beginPath(); c.arc(p.x, p.y, 5, 0, 2 * Math.PI);
      c.fillStyle = "#0b1128"; c.fill(); c.lineWidth = 1.5; c.strokeStyle = "#fff"; c.stroke();
      c.beginPath(); c.moveTo(p.x - 2.5, p.y); c.lineTo(p.x + 2.5, p.y); c.stroke();
      var f = s.f, km = S.km(s.a, s.b);
      out.push({ x: p.x, y: p.y, r: 6, html: function () {
        return "<b>Seam, " + HQ.yearLabel(f.prev.year) + " → " + HQ.yearLabel(f.year) + "</b><br>" + HQ.esc(HQ.SERIES_LABEL[f.prev.sid]) + " hands over to " + HQ.esc(HQ.SERIES_LABEL[f.sid]) +
          ".<br>The point jumps <b>" + HQ.fmt(km) + " km</b> here. Drawn as a seam, not smoothed over.";
      } });
    });
    return out;
  }
  function nodeTip(f) {
    var t = HQ.trail[f.key], b = f.branch ? HQ.BRANCH[f.branch] : null;
    return "<b>" + HQ.yearLabel(f.year) + "</b>" + (b ? ' · <span style="color:' + b.color + '">' + b.code + " " + b.name + "</span>" : "") +
      '<br><span class="muted">' + HQ.esc(HQ.SERIES_LABEL[f.sid]) + "</span><br>" + f.conf + " · " + HQ.ll(t.x) +
      '<br><span class="muted">click to go there</span>';
  }

  function lifebuoy(c, px, py) {
    c.lineWidth = 4.5;
    c.beginPath(); c.arc(px, py, 8, 0, 2 * Math.PI); c.strokeStyle = "#fff"; c.stroke();
    for (var i = 0; i < 4; i++) {
      c.beginPath(); c.arc(px, py, 8, i * Math.PI / 2 + 0.2, i * Math.PI / 2 + Math.PI / 4 + 0.2); c.strokeStyle = "#e34948"; c.stroke();
    }
    c.lineWidth = 1; c.strokeStyle = "rgba(8,12,30,.6)";
    c.beginPath(); c.arc(px, py, 10.5, 0, 2 * Math.PI); c.stroke();
  }
  function ballot(c, px, py) {
    G.roundRect(c, px - 8, py - 8, 16, 15, 3);
    c.fillStyle = "#b05fd0"; c.fill(); c.lineWidth = 1.6; c.strokeStyle = "#fff"; c.stroke();
    c.beginPath(); c.moveTo(px - 4, py - 3); c.lineTo(px + 4, py - 3); c.lineWidth = 2; c.stroke();
    c.beginPath(); c.moveTo(px - 2, py - 11); c.lineTo(px + 3, py - 6); c.lineTo(px + 4.5, py - 13); c.lineTo(px - 0.5, py - 15); c.closePath();
    c.fillStyle = "#fff"; c.fill();
  }

  // ---------------------------------------------------------------- the tug of war
  // Blocks stand on the globe as little towers; ropes run from them to the HQ (or to the spot
  // being tested), bundled by region and continent. See blocks.js for the maths.
  function shade(hex, k) {   // k < 0 darkens, k > 0 mixes towards white
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var f = function (v) { return Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k); };
    return "rgb(" + f(r) + "," + f(g) + "," + f(b) + ")";
  }
  var FB = function () { return window.FairBlocks; };
  function contColor(k) { return FB().COLORS[k]; }

  function arc(c, a, b) { path({ type: "LineString", coordinates: [geo(a), geo(b)] }); }

  function drawRopes(c, V, R, cx, cy) {
    var w = HQ.webNow ? HQ.webNow() : null, out = [];
    if (!w) return out;
    var k = 0.034 * Math.sqrt(R / 460), offices = !!(HQ.view.offices && HQ.state.k > 1);
    c.lineCap = "round";
    var segs = w.segs.slice().sort(function (a, b) { return a.level - b.level || a.T - b.T; });
    [0, 1].forEach(function (pass) {
      segs.forEach(function (s) {
        var lw = Math.max(s.level ? 1.2 : 0.55, s.T * k);
        if (pass === 0 && s.level === 0) return;   // halos only under the cables
        c.beginPath(); arc(c, s.a, s.b);
        if (pass === 0) { c.globalAlpha = 0.35; c.lineWidth = lw + 2.5; c.strokeStyle = "#0b1128"; }
        else {
          c.globalAlpha = s.level === 0 ? 0.55 : s.level === 1 ? 0.8 : 0.88;
          c.lineWidth = lw;
          c.strokeStyle = offices ? CLUSTER[s.office] : contColor(s.cont);
        }
        c.stroke();
      });
    });
    c.globalAlpha = 1;
    w.knots.forEach(function (kn) {
      var p = proj(kn.x, V, R, cx, cy);
      if (!p.vis) return;
      var r = kn.level === 2 ? 4.5 : 3;
      c.beginPath(); c.arc(p.x, p.y, r, 0, 2 * Math.PI);
      c.fillStyle = contColor(kn.cont); c.fill(); c.lineWidth = 1.3; c.strokeStyle = "#fff"; c.stroke();
      out.push({ x: p.x, y: p.y, r: r + 2, html: function () { return HQ.knotTip ? HQ.knotTip(kn) : ""; } });
    });
    return out;
  }

  function drawTowers(c, V, R, cx, cy) {
    var B = HQ.blocksNow ? HQ.blocksNow() : null, out = [];
    if (!B) return out;
    var Vw = HQ.view, offices = Vw.offices && HQ.state.k > 1 ? Vw.offices : null, worst = Vw.worst;
    var w = Math.max(3.5, Math.min(15, R * 0.019)), hb = Math.max(1.2, Math.min(7, R * 0.0052));
    var dx = w * 0.42, dy = w * 0.3, lines = hb >= 2.2;
    var list = [];
    B.stacks.forEach(function (s) {
      var p = proj(s.x, V, R, cx, cy);
      if (p.d <= 0.03) return;
      list.push({ s: s, p: p });
    });
    list.sort(function (a, b) { return a.p.y - b.p.y; });
    list.forEach(function (o) {
      var s = o.s, p = o.p, H = s.n * hb, x0 = p.x - w / 2, yb = p.y, yt = yb - H;
      var col = contColor(s.cont), out1 = false;
      if (offices) {
        var bi = 0, bd = -2;
        offices.forEach(function (x, i) { var d = x[0] * s.x[0] + x[1] * s.x[1] + x[2] * s.x[2]; if (d > bd) { bd = d; bi = i; } });
        col = CLUSTER[bi];
      }
      if (worst && S.km(worst.x, s.x) > worst.km) { col = "#e34948"; out1 = true; }
      c.globalAlpha = Math.min(1, (p.d - 0.03) * 6);
      c.fillStyle = "rgba(20,15,10,.22)";
      c.beginPath(); c.ellipse(p.x + dx * 0.4, yb + 0.5, w * 0.75, w * 0.28, 0, 0, 2 * Math.PI); c.fill();
      // right side, front, top
      c.beginPath(); c.moveTo(x0 + w, yb); c.lineTo(x0 + w + dx, yb - dy); c.lineTo(x0 + w + dx, yt - dy); c.lineTo(x0 + w, yt); c.closePath();
      c.fillStyle = shade(col, -0.38); c.fill();
      c.fillStyle = col; c.fillRect(x0, yt, w, H);
      c.beginPath(); c.moveTo(x0, yt); c.lineTo(x0 + dx, yt - dy); c.lineTo(x0 + w + dx, yt - dy); c.lineTo(x0 + w, yt); c.closePath();
      c.fillStyle = shade(col, 0.45); c.fill();
      if (lines && s.n > 1) {
        c.beginPath();
        for (var k = 1; k < s.n; k++) {
          var y = Math.round(yb - k * hb) + 0.5;
          c.moveTo(x0, y); c.lineTo(x0 + w, y); c.lineTo(x0 + w + dx, y - dy);
        }
        c.lineWidth = 0.7; c.strokeStyle = shade(col, -0.5); c.globalAlpha *= 0.55; c.stroke();
      }
      if (out1) { c.globalAlpha = 1; c.lineWidth = 1.4; c.strokeStyle = "#fff"; c.strokeRect(x0 - 0.5, yt - 0.5, w + 1, H + 1); }
      c.globalAlpha = 1;
      out.push({ box: [x0 - 1, yt - dy - 1, x0 + w + dx + 1, yb + 2], x: p.x, y: yb, r: 0, html: function () { return HQ.stackTip ? HQ.stackTip(s, out1) : ""; } });
    });
    return out;
  }

  function drawBowl(c, V, R, cx, cy) {
    var rings = HQ.bowlNow ? HQ.bowlNow() : null;
    if (!rings) return;
    c.save();
    c.setLineDash([4, 3]); c.lineCap = "round";
    rings.forEach(function (rg, i) {
      c.beginPath(); path({ type: "MultiLineString", coordinates: rg.lines });
      c.lineWidth = 1.2; c.strokeStyle = "rgba(25, 30, 70," + (0.75 - i * 0.05) + ")"; c.stroke();
    });
    c.setLineDash([]);
    // one label per ring, at its highest visible point
    c.font = "600 10.5px " + getComputedStyle(document.body).fontFamily;
    c.textAlign = "center"; c.textBaseline = "middle";
    rings.forEach(function (rg) {
      var best = null;
      rg.lines.forEach(function (ln) { ln.forEach(function (ll, j) {
        if (j % 3) return;
        var p = proj(S.toXYZ(ll[1], ll[0]), V, R, cx, cy);
        if (p.d > 0.25 && (!best || p.y < best.y)) best = p;
      }); });
      if (!best) return;
      var t = "+" + HQ.fmt(rg.km) + " km", tw = c.measureText(t).width + 8;
      c.fillStyle = "rgba(251,246,234,.92)"; G.roundRect(c, best.x - tw / 2, best.y - 7, tw, 14, 7); c.fill();
      c.fillStyle = "#23223a"; c.fillText(t, best.x, best.y + 0.5);
    });
    c.textAlign = "start";
    c.restore();
  }

  function drawWorstCircle(c, worst) {
    var a = S.toLatLon(worst.x), deg = worst.km / 6371.0088 / D2R;
    c.beginPath(); path(d3.geoCircle().center([a[1], a[0]]).radius(deg)());
    c.setLineDash([6, 4]); c.lineWidth = 2; c.strokeStyle = "rgba(227,73,72,.9)"; c.stroke(); c.setLineDash([]);
  }

  function drawVoteRopes(c, vote) {
    var C = FAIR.capitals || [];
    c.beginPath();
    C.forEach(function (cap) { arc(c, S.toXYZ(cap.lat, cap.lon), vote); });
    c.lineWidth = 0.9; c.strokeStyle = "rgba(176,95,208,.75)"; c.stroke();
  }

  // The spot under test: the settle path, a ghost of the real HQ (drawn by the caller), the
  // probe pin and the net pull as a red arrow.
  function drawProbe(c, V, R, cx, cy, put, labels) {
    var ex = HQ.ex, x = ex.probe;
    if (ex.path && ex.path.length > 1) {
      c.beginPath();
      ex.path.forEach(function (q, i) { if (i) arc(c, ex.path[i - 1], q); });
      c.setLineDash([2, 3]); c.lineWidth = 1.6; c.strokeStyle = "#fff"; c.stroke(); c.setLineDash([]);
      ex.path.forEach(function (q) {
        var p = put(q); if (!p) return;
        c.beginPath(); c.arc(p.x, p.y, 2.4, 0, 2 * Math.PI); c.fillStyle = "#ffd27a"; c.fill();
      });
    }
    var pp = put(x);
    if (!pp) return;
    var pl = HQ.probePulls ? HQ.probePulls() : null;
    if (pl) {
      var net = pl.net, m = Math.hypot(net[0], net[1], net[2]);
      if (m > 0.004) {
        var u = [net[0] / m, net[1] / m, net[2] / m], q = S.unit([x[0] + 0.01 * u[0], x[1] + 0.01 * u[1], x[2] + 0.01 * u[2]]);
        var p1 = proj(q, V, R, cx, cy), vx = p1.x - pp.x, vy = p1.y - pp.y, vn = Math.hypot(vx, vy) || 1;
        var L = Math.min(150, 26 + 300 * m), ex2 = pp.x + vx / vn * L, ey2 = pp.y + vy / vn * L;
        c.lineCap = "round";
        c.beginPath(); c.moveTo(pp.x, pp.y); c.lineTo(ex2, ey2);
        c.lineWidth = 10; c.strokeStyle = "rgba(11,17,40,.6)"; c.stroke();
        c.lineWidth = 7.5; c.strokeStyle = "#fff"; c.stroke();
        c.lineWidth = 4.5; c.strokeStyle = "#e34948"; c.stroke();
        var ang = Math.atan2(ey2 - pp.y, ex2 - pp.x);
        c.beginPath(); c.moveTo(ex2 + 9 * Math.cos(ang), ey2 + 9 * Math.sin(ang));
        c.lineTo(ex2 + 9 * Math.cos(ang + 2.4), ey2 + 9 * Math.sin(ang + 2.4));
        c.lineTo(ex2 + 9 * Math.cos(ang - 2.4), ey2 + 9 * Math.sin(ang - 2.4)); c.closePath();
        c.fillStyle = "#e34948"; c.fill(); c.lineWidth = 1.8; c.strokeStyle = "#fff"; c.stroke();
        labels.push([ex2 + 10 * Math.cos(ang) + (Math.cos(ang) < 0 ? -64 : 4), ey2 + 10 * Math.sin(ang), "net pull", "#e34948", ex2]);
      }
    }
    pin(c, pp.x, pp.y, "#f0a43a");
    hits.push({ x: pp.x, y: pp.y - 21, r: 12, pin: true, html: function () { return "<b>Testing this spot</b><br>" + HQ.ll(x); } });
    var extra = HQ.probeExtraKm ? HQ.probeExtraKm() : null;
    labels.push([pp.x + 14, pp.y - 21, extra == null ? "testing" : extra < 0.5 ? "back at the fair HQ" : "+" + HQ.fmt(extra) + " km average trip", "#f0a43a", pp.x]);
  }

  // ---------------------------------------------------------------- the frame
  // Ocean, land, dots and shading only change with the view or the population, so they
  // are cached in an offscreen canvas; dial ticks then only redraw the trail and the pins.
  function drawBase(c, R, cx, cy, V, Vw, moving) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    var gp = d3.geoPath(projection, c);
    var glow = c.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.22);
    glow.addColorStop(0, "rgba(120,170,255,.38)"); glow.addColorStop(1, "rgba(120,170,255,0)");
    c.fillStyle = glow; c.beginPath(); c.arc(cx, cy, R * 1.25, 0, 2 * Math.PI); c.fill();
    var sea = c.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
    sea.addColorStop(0, "#2f6aa0"); sea.addColorStop(0.6, "#174575"); sea.addColorStop(1, "#0d2b4f");
    c.beginPath(); gp(sphere); c.fillStyle = sea; c.fill();
    c.beginPath(); gp(graticule); c.lineWidth = 0.6; c.strokeStyle = "rgba(255,255,255,.07)"; c.stroke();
    c.beginPath(); gp(moving ? landLo : land); c.fillStyle = "#efe3c6"; c.fill();
    c.lineWidth = 0.7; c.strokeStyle = "#b99d70"; c.stroke();
    if (!moving) { c.beginPath(); gp(borders); c.lineWidth = 0.5; c.strokeStyle = "rgba(140,110,70,.35)"; c.stroke(); }
    drawDots(c, Vw.P, Vw.labels, V, R, cx, cy, 1, HQ.ex && HQ.ex.layers.blocks ? 0.4 : 1);
    var sh = c.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.1, cx, cy, R * 1.02);
    sh.addColorStop(0, "rgba(255,255,255,.10)"); sh.addColorStop(0.55, "rgba(255,255,255,0)"); sh.addColorStop(1, "rgba(5,10,35,.42)");
    c.beginPath(); gp(sphere); c.fillStyle = sh; c.fill();
  }

  function draw() {
    var t0 = performance.now();
    var c = ctx, R = R0 * zoom, cx = W / 2, cy = H / 2 + 6, V = view(), Vw = HQ.view, st = HQ.state;
    projection.rotate(rot).scale(R).translate([cx, cy]);
    var bs = baseState, drg = G.isDragging() || !!fly;
    if (!bs || bs.r0 !== rot[0] || bs.r1 !== rot[1] || bs.R !== R || bs.W !== W || bs.H !== H || bs.P !== Vw.P || bs.labels !== Vw.labels || bs.drg !== drg || bs.fade !== HQ.ex.layers.blocks) {
      var tb = performance.now();
      drawBase(bctx, R, cx, cy, V, Vw, drg);
      baseState = { r0: rot[0], r1: rot[1], R: R, W: W, H: H, P: Vw.P, labels: Vw.labels, drg: drg, fade: HQ.ex.layers.blocks };
      G.stats.baseDraws++; G.stats.lastBaseMs = performance.now() - tb;
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.drawImage(base, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    hits = [];

    var ex = HQ.ex, L = ex.layers;
    if (L.bowl) drawBowl(c, V, R, cx, cy);
    if (Vw.worst) drawWorstCircle(c, Vw.worst);
    if (hover && hover.kind === "vote" && Vw.vote) drawVoteRopes(c, Vw.vote);
    if (L.ropes) hits = hits.concat(drawRopes(c, V, R, cx, cy));
    if (L.blocks) hits = hits.concat(drawTowers(c, V, R, cx, cy));
    hits = hits.concat(drawTrail(c, projection, path, V, R, cx, cy));

    var put = function (x) { var p = proj(x, V, R, cx, cy); return p.vis ? p : null; };
    var labels = [];
    // ghost pins: the other futures, same year
    if (st.year > HQ.FORK) {
      ["ssp1", "ssp3", "ssp5"].forEach(function (b) {
        if (b === st.branch) return;
        var t = HQ.trail[b + "/" + st.year], p = t && put(t.x);
        if (!p) return;
        pin(c, p.x, p.y, HQ.BRANCH[b].color, 0.62);
        var f = HQ.D.byKey[b + "/" + st.year];
        hits.push({ x: p.x, y: p.y - 13, r: 8, year: st.year, branch: b, html: function () { return nodeTip(f) + "<br>(a different future: p = 1, everyone)"; } });
        labels.push([p.x + 9, p.y - 14, HQ.BRANCH[b].code, HQ.BRANCH[b].color, p.x]);
      });
    }
    if (Vw.offices) Vw.offices.forEach(function (x, i) {
      var p = put(x); if (!p) return;
      c.beginPath(); c.arc(p.x, p.y, 10, 0, 2 * Math.PI); c.fillStyle = CLUSTER[i]; c.fill();
      c.lineWidth = 2; c.strokeStyle = "#fff"; c.stroke();
      c.fillStyle = "#fff"; c.font = "700 11px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(String(i + 1), p.x, p.y + 0.5); c.textAlign = "start";
      var T = HQ.nearestTown(x);
      hits.push({ x: p.x, y: p.y, r: 10, html: function () {
        return "<b>Office " + (i + 1) + "</b><br>near " + HQ.esc(T ? T.name + ", " + T.country : "?") + "<br>" + HQ.ll(x) + '<br><span class="muted">everyone coloured like this goes here</span>';
      } });
    });
    if (Vw.vote) {
      var pv = put(Vw.vote);
      if (pv) {
        ballot(c, pv.x, pv.y);
        hits.push({ x: pv.x, y: pv.y, r: 9, kind: "vote", html: function () {
          return "<b>One country, one vote</b><br>The fair point of " + (FAIR.capitals || []).length + " capitals, each counted once (p = " + HQ.state.p + ").<br>" + HQ.ll(Vw.vote) +
            "<br>" + HQ.fmt(S.km(Vw.vote, Vw.hq)) + " km from one person, one vote" +
            '<br><span class="muted">purple ropes: one per capital, all equally strong</span>';
        } });
        labels.push([pv.x + 12, pv.y, "one country, one vote", "#b05fd0", pv.x]);
      }
    }
    if (Vw.worst) {
      var pw = put(Vw.worst.x);
      if (pw) {
        lifebuoy(c, pw.x, pw.y);
        hits.push({ x: pw.x, y: pw.y, r: 10, html: function () {
          return "<b>Worst-off (" + (Vw.worst.q === 0.999 ? "99.9" : "99") + "%)</b><br>Minimises the trip that covers " + (Vw.worst.q === 0.999 ? "99.9" : "99") +
            "% of people: " + HQ.fmt(Vw.worst.km) + " km.<br>" + HQ.ll(Vw.worst.x);
        } });
        labels.push([pw.x + 13, pw.y, "worst-off " + (Vw.worst.q === 0.999 ? "99.9" : "99") + "%", "#e34948", pw.x]);
      }
    }
    if (ex.probe) drawProbe(c, V, R, cx, cy, put, labels);
    if (Vw.hq) {
      var ph = put(Vw.hq);
      if (ph && ex.probe) {
        c.globalAlpha = 0.45; pin(c, ph.x, ph.y, "#4b92db", 0.8); c.globalAlpha = 1;
      } else if (ph) {
        pin(c, ph.x, ph.y, "#4b92db");
        hits.push({ x: ph.x, y: ph.y - 21, r: 12, pin: true, html: function () {
          var T = HQ.nearestTown(Vw.hq);
          return "<b>The fair HQ, " + HQ.yearLabel(st.year) + "</b><br>p = " + st.p + (Vw.M !== "all" ? ", " + (Vw.M === "urban" ? "city folk" : "country folk") + " only" : "") +
            "<br>" + HQ.ll(Vw.hq) + (T ? "<br>near " + HQ.esc(T.name) + ", " + HQ.esc(T.country) : "") +
            '<br><span class="muted">drag the pin to test another spot</span>';
        } });
        labels.push([ph.x + 14, ph.y - 21, "fair HQ" + (st.p !== 1 ? " · p = " + st.p : ""), null, ph.x]);
      }
    }
    placeLabels(c, labels.reverse());   // the HQ was pushed last; it gets first pick
    G.stats.draws++; G.stats.lastMs = performance.now() - t0;
  }

  // A small, self-contained render for the postcard.
  G.renderMini = function (c, cx, cy, R, centre) {
    var pr = d3.geoOrthographic().clipAngle(90).precision(0.4);
    var r = centre ? targetRot(centre) : rot;
    pr.rotate(r).scale(R).translate([cx, cy]);
    var gp = d3.geoPath(pr, c);
    var lo = -r[0] * D2R, la = -r[1] * D2R, cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
    var V = { c: [cl * co, cl * so, sl], e: [-so, co, 0], n: [-sl * co, -sl * so, cl] };
    var glow = c.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.2);
    glow.addColorStop(0, "rgba(120,170,255,.4)"); glow.addColorStop(1, "rgba(120,170,255,0)");
    c.fillStyle = glow; c.beginPath(); c.arc(cx, cy, R * 1.22, 0, 2 * Math.PI); c.fill();
    var sea = c.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
    sea.addColorStop(0, "#2f6aa0"); sea.addColorStop(0.6, "#174575"); sea.addColorStop(1, "#0d2b4f");
    c.beginPath(); gp(sphere); c.fillStyle = sea; c.fill();
    c.beginPath(); gp(graticule); c.lineWidth = 0.6; c.strokeStyle = "rgba(255,255,255,.08)"; c.stroke();
    c.beginPath(); gp(land); c.fillStyle = "#efe3c6"; c.fill(); c.lineWidth = 0.7; c.strokeStyle = "#b99d70"; c.stroke();
    drawDots(c, HQ.view.P, null, V, R, cx, cy, 1);
    var sh = c.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.1, cx, cy, R * 1.02);
    sh.addColorStop(0, "rgba(255,255,255,.10)"); sh.addColorStop(0.55, "rgba(255,255,255,0)"); sh.addColorStop(1, "rgba(5,10,35,.42)");
    c.beginPath(); gp(sphere); c.fillStyle = sh; c.fill();
    drawTrail(c, pr, gp, V, R, cx, cy, { onlyBranch: HQ.state.branch });
    var p = HQ.view.hq && proj(HQ.view.hq, V, R, cx, cy);
    if (p && p.vis) pin(c, p.x, p.y, "#4b92db", 1.3);
  };
})();
