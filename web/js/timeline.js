// The year slider: one lane until the fork, then three futures. Drag along it to scrub, drag
// onto a lane to pick a future, arrow keys to step (up/down switch futures), space to play.
(function () {
  "use strict";
  var HQ = window.HQ = window.HQ || {};
  var T = HQ.Timeline = {};
  var svg, x, lanes, W = 1000, H = 118, ML = 14, MR = 210, TRUNK = 44;
  var LANE = { ssp1: 20, ssp3: 44, ssp5: 68 };
  var DASH = { modelled: "0.5 5", observed: null, projected: "7 5" };

  T.init = function (el) {
    svg = d3.select(el);
    el.addEventListener("pointerdown", function (ev) { el.setPointerCapture(ev.pointerId); scrub(ev); el.focus(); });
    el.addEventListener("pointermove", function (ev) { if (ev.buttons & 1) scrub(ev); });
    el.addEventListener("keydown", key);
    T.update();
  };

  function scrub(ev) {
    var r = svg.node().getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
    var yr = HQ.nearestYear(x.invert(px)), br;
    if (yr > HQ.FORK && px <= x(2100) + 8) {
      br = ["ssp1", "ssp3", "ssp5"].reduce(function (a, b) { return Math.abs(LANE[b] - py) < Math.abs(LANE[a] - py) ? b : a; });
    }
    if (px > x(2100) + 8) {   // the labels on the right pick a future without moving the year
      br = ["ssp1", "ssp3", "ssp5"].reduce(function (a, b) { return Math.abs(LANE[b] - py) < Math.abs(LANE[a] - py) ? b : a; });
      yr = HQ.state.year;
    }
    HQ.setYear(yr, br);
    if (br) HQ.syncBranchButtons();
  }
  function key(ev) {
    var st = HQ.state, ys = HQ.years, i = ys.indexOf(st.year), order = ["ssp1", "ssp3", "ssp5"], bi = order.indexOf(st.branch);
    if (ev.key === "ArrowRight") HQ.setYear(ys[Math.min(ys.length - 1, i + 1)]);
    else if (ev.key === "ArrowLeft") HQ.setYear(ys[Math.max(0, i - 1)]);
    else if (ev.key === "Home") HQ.setYear(ys[0]);
    else if (ev.key === "End") HQ.setYear(ys[ys.length - 1]);
    else if (ev.key === "ArrowUp") { HQ.setYear(st.year, order[Math.max(0, bi - 1)]); HQ.syncBranchButtons(); }
    else if (ev.key === "ArrowDown") { HQ.setYear(st.year, order[Math.min(2, bi + 1)]); HQ.syncBranchButtons(); }
    else if (ev.key === " ") HQ.togglePlay();
    else return;
    ev.preventDefault();
  }

  function laneY(f) { return f.branch ? LANE[f.branch] : TRUNK; }
  function forkPath(b) {
    var f = HQ.FORK, y = LANE[b];
    return "M" + x(f) + "," + TRUNK + " C" + x(f + 6) + "," + TRUNK + " " + x(f + 4) + "," + y + " " + x(f + 12) + "," + y;
  }

  T.update = function () {
    if (!svg) return;
    var st = HQ.state, D = HQ.D, fork = HQ.FORK;
    W = svg.node().clientWidth || 1000;
    x = HQ.timeScale(ML, W - MR);
    var y0 = HQ.years[0], deep = y0 < 1850;
    svg.attr("viewBox", "0 0 " + W + " " + H).attr("aria-valuemin", y0);
    svg.attr("aria-valuenow", st.year).attr("aria-valuetext", HQ.yearLabel(st.year) + (st.year > fork ? ", " + HQ.BRANCH[st.branch].code + " " + HQ.BRANCH[st.branch].name : ""));
    svg.selectAll("*").remove();

    // eras: antiquity has its own strip, on a squeezed scale (see HQ.timeScale)
    var eras = (deep ? [[y0, 1847.5, "antiquity (HYDE 3.3)", "antiquity"]] : []).concat(
      [[deep ? 1847.5 : 1850, 1972.5, "modelled (HYDE-based)", "modelled"], [1972.5, 2022.5, "observed (GHSL)", "observed"], [2022.5, 2100, "projected", "projected"]]);
    eras.forEach(function (e, i) {
      svg.append("rect").attr("x", x(e[0])).attr("y", 4).attr("width", Math.max(0, x(e[1]) - x(e[0]))).attr("height", 80)
        .attr("fill", e[2].indexOf("observed") === 0 ? "rgba(255,255,255,.05)" : i === 0 && deep ? "rgba(255,255,255,.035)" : "rgba(255,255,255,.02)")
        .attr("rx", i === 0 ? 8 : 0);
      var t = svg.append("text").attr("x", x(e[0]) + 6).attr("y", 112).attr("font-size", 11).attr("fill", "#8f8bb0").text(e[2]);
      if (t.node().getComputedTextLength() > x(e[1]) - x(e[0]) - 10) t.text(e[3]);   // narrow band: the short name
    });
    // ticks: 25 years apart from 1850, a handful of landmarks before
    var ticks = deep ? [-10000, 0, 1000] : [];
    for (var y = 1850; y <= 2100; y += 25) ticks.push(y);
    ticks.forEach(function (y) {
      svg.append("line").attr("x1", x(y)).attr("x2", x(y)).attr("y1", 84).attr("y2", 89).attr("stroke", "#6d6990");
      svg.append("text").attr("x", x(y)).attr("y", 100).attr("text-anchor", y === y0 ? "start" : "middle").attr("font-size", 11).attr("fill", "#b9b5d6")
        .text(HQ.yearLabel(y));
    });
    // trunk segments by confidence
    D.trunk.forEach(function (f) {
      if (!f.prev) return;
      var past = f.year <= st.year;
      svg.append("line").attr("x1", x(f.prev.year)).attr("x2", x(f.year)).attr("y1", TRUNK).attr("y2", TRUNK)
        .attr("stroke", f.seam ? "#c8c4e4" : "#fff1cf").attr("stroke-width", f.seam ? 1.5 : 3).attr("stroke-linecap", "round")
        .attr("stroke-dasharray", f.seam ? "1.5 3.5" : DASH[f.conf]).attr("stroke-opacity", past ? 1 : 0.45);
    });
    // the fork and three futures
    ["ssp1", "ssp3", "ssp5"].forEach(function (b) {
      var fs = D.frames.filter(function (f) { return f.sid === b; });
      if (!fs.length) return;
      var sel = b === st.branch, col = HQ.BRANCH[b].color, last = fs[fs.length - 1].year;
      svg.append("path").attr("d", forkPath(b)).attr("fill", "none").attr("stroke", "#c8c4e4").attr("stroke-width", 1.5).attr("stroke-dasharray", "1.5 3.5");
      svg.append("line").attr("x1", x(fork + 12)).attr("x2", x(last)).attr("y1", LANE[b]).attr("y2", LANE[b])
        .attr("stroke", col).attr("stroke-width", sel ? 3.2 : 2).attr("stroke-dasharray", "7 5").attr("stroke-linecap", "round")
        .attr("stroke-opacity", sel ? 1 : 0.5);
      var g = svg.append("g").attr("transform", "translate(" + (x(2100) + 14) + "," + LANE[b] + ")").style("cursor", "pointer");
      g.append("circle").attr("r", 5).attr("fill", col).attr("stroke", sel ? "#fff" : "none").attr("stroke-width", 1.5);
      g.append("text").attr("x", 11).attr("y", 4).attr("font-size", 12).attr("font-weight", sel ? 700 : 500)
        .attr("fill", sel ? "#fff" : "#b9b5d6").text(HQ.BRANCH[b].code + " " + HQ.BRANCH[b].name);
    });
    // seams, with their size once the trail knows it
    D.frames.forEach(function (f) {
      if (!f.seam || (f.branch && f.branch !== st.branch)) return;
      var a = HQ.trail[f.prev.key], b = HQ.trail[f.key], xm = x((f.prev.year + f.year) / 2), ym = f.branch ? TRUNK : TRUNK;
      var g = svg.append("g").attr("transform", "translate(" + xm + "," + ym + ")");
      g.append("circle").attr("r", 5.5).attr("fill", "#0b1128").attr("stroke", "#fff").attr("stroke-width", 1.4);
      g.append("line").attr("x1", -2.6).attr("x2", 2.6).attr("stroke", "#fff").attr("stroke-width", 1.4);
      var km = a && b ? FairSolver.km(a.x, b.x) : null;
      g.append("title").text("Seam " + HQ.yearLabel(f.prev.year) + " → " + HQ.yearLabel(f.year) + ": " + HQ.SERIES_LABEL[f.prev.sid] + " → " + HQ.SERIES_LABEL[f.sid] +
        (km != null ? ". The HQ jumps " + HQ.fmt(km) + " km across it." : "."));
      if (km != null) g.append("text").attr("y", -10).attr("text-anchor", "middle").attr("font-size", 10).attr("fill", "#c8c4e4").text(HQ.fmt(km) + " km");
    });
    // frame ticks
    D.frames.forEach(function (f) {
      svg.append("circle").attr("cx", x(f.year)).attr("cy", laneY(f)).attr("r", 1.6)
        .attr("fill", f.branch ? HQ.BRANCH[f.branch].color : "#fff1cf").attr("opacity", 0.8);
    });
    // the handle(s)
    var hx = x(st.year);
    svg.append("line").attr("x1", hx).attr("x2", hx).attr("y1", 6).attr("y2", 84).attr("stroke", "#ffd27a").attr("stroke-opacity", 0.5);
    if (st.year > fork) {
      ["ssp1", "ssp3", "ssp5"].forEach(function (b) {
        if (b === st.branch || !D.byKey[b + "/" + st.year]) return;
        svg.append("circle").attr("cx", hx).attr("cy", LANE[b]).attr("r", 5).attr("fill", HQ.BRANCH[b].color).attr("stroke", "#0b1128").attr("stroke-width", 1.5);
      });
    }
    var hy = st.year > fork ? LANE[st.branch] : TRUNK;
    svg.append("circle").attr("cx", hx).attr("cy", hy).attr("r", 9).attr("fill", "#ffd27a").attr("stroke", "#0b1128").attr("stroke-width", 2.5);
    svg.append("circle").attr("cx", hx).attr("cy", hy).attr("r", 3).attr("fill", st.year > fork ? HQ.BRANCH[st.branch].color : "#0b1128");
  };
})();
