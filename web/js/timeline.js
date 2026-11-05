// The year slider. Drag along it to scrub, arrow keys to step, space to play.
(function () {
  "use strict";
  var HQ = window.HQ = window.HQ || {};
  var T = HQ.Timeline = {};
  var svg, x, W = 1000, H = 118, ML = 14, MR = 22, TRUNK = 44;
  var DASH = { modelled: "0.5 5", observed: null, projected: "7 5" };

  T.init = function (el) {
    svg = d3.select(el);
    el.addEventListener("pointerdown", function (ev) { el.setPointerCapture(ev.pointerId); scrub(ev); el.focus(); });
    el.addEventListener("pointermove", function (ev) { if (ev.buttons & 1) scrub(ev); });
    el.addEventListener("keydown", key);
    T.update();
  };

  function scrub(ev) {
    var r = svg.node().getBoundingClientRect();
    HQ.setYear(HQ.nearestYear(x.invert(ev.clientX - r.left)));
  }
  function key(ev) {
    var st = HQ.state, ys = HQ.years, i = ys.indexOf(st.year);
    if (ev.key === "ArrowRight") HQ.setYear(ys[Math.min(ys.length - 1, i + 1)]);
    else if (ev.key === "ArrowLeft") HQ.setYear(ys[Math.max(0, i - 1)]);
    else if (ev.key === "Home") HQ.setYear(ys[0]);
    else if (ev.key === "End") HQ.setYear(ys[ys.length - 1]);
    else if (ev.key === " ") HQ.togglePlay();
    else return;
    ev.preventDefault();
  }

  T.update = function () {
    if (!svg) return;
    var st = HQ.state, D = HQ.D, end = HQ.TRUNK_END, future = HQ.BRANCH.ssp3;
    W = svg.node().clientWidth || 1000;
    x = HQ.timeScale(ML, W - MR);
    var y0 = HQ.years[0], deep = y0 < 1850;
    svg.attr("viewBox", "0 0 " + W + " " + H).attr("aria-valuemin", y0);
    svg.attr("aria-valuenow", st.year).attr("aria-valuetext", HQ.yearLabel(st.year) + (st.year > end ? ", " + future.code + " " + future.name : ""));
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
    // the one future, after the 2030 seam
    var fs = D.frames.filter(function (f) { return f.branch; });
    if (fs.length) svg.append("line").attr("x1", x(fs[0].year)).attr("x2", x(fs[fs.length - 1].year)).attr("y1", TRUNK).attr("y2", TRUNK)
      .attr("stroke", future.color).attr("stroke-width", 3.2).attr("stroke-dasharray", "7 5").attr("stroke-linecap", "round");
    // seams, with their size once the trail knows it
    D.frames.forEach(function (f) {
      if (!f.seam) return;
      var a = HQ.trail[f.prev.key], b = HQ.trail[f.key], xm = x((f.prev.year + f.year) / 2);
      var g = svg.append("g").attr("transform", "translate(" + xm + "," + TRUNK + ")");
      g.append("circle").attr("r", 5.5).attr("fill", "#0b1128").attr("stroke", "#fff").attr("stroke-width", 1.4);
      g.append("line").attr("x1", -2.6).attr("x2", 2.6).attr("stroke", "#fff").attr("stroke-width", 1.4);
      var km = a && b ? FairSolver.km(a.x, b.x) : null, label = f.gap ? f.gap.km : km;
      g.append("title").text("Seam " + HQ.yearLabel(f.prev.year) + " → " + HQ.yearLabel(f.year) + ": " + HQ.SERIES_LABEL[f.prev.sid] + " → " + HQ.SERIES_LABEL[f.sid] + "." +
        (f.gap ? " In " + HQ.yearLabel(f.gap.year) + " the two sources put the HQ " + HQ.fmt(f.gap.km) + " km apart." : "") +
        (km != null ? " The trail steps " + HQ.fmt(km) + " km across the join." : ""));
      if (label != null) g.append("text").attr("y", -10).attr("text-anchor", "middle").attr("font-size", 10).attr("fill", "#c8c4e4").text(HQ.fmt(label) + " km");
    });
    // frame ticks
    D.frames.forEach(function (f) {
      svg.append("circle").attr("cx", x(f.year)).attr("cy", TRUNK).attr("r", 1.6)
        .attr("fill", f.branch ? future.color : "#fff1cf").attr("opacity", 0.8);
    });
    // the handle
    var hx = x(st.year);
    svg.append("line").attr("x1", hx).attr("x2", hx).attr("y1", 6).attr("y2", 84).attr("stroke", "#ffd27a").attr("stroke-opacity", 0.5);
    svg.append("circle").attr("cx", hx).attr("cy", TRUNK).attr("r", 9).attr("fill", "#ffd27a").attr("stroke", "#0b1128").attr("stroke-width", 2.5);
    svg.append("circle").attr("cx", hx).attr("cy", TRUNK).attr("r", 3).attr("fill", st.year > end ? future.color : "#0b1128");
  };
})();
