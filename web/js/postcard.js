// "We've moved!" A 1200x800 postcard drawn on an offscreen canvas, returned as a PNG data URL.
(function () {
  "use strict";
  var HQ = window.HQ = window.HQ || {};
  var S = FairSolver;
  var HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
  var SERIF = 'Georgia, "Palatino Linotype", serif';
  var SANS = '"Segoe UI", system-ui, sans-serif';
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function movingDay(year, seed) {
    var d = new Date(Date.UTC(year, seed % 12, 1 + (seed >>> 4) % 28));
    return DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + year;
  }
  var JOKES = [
    "The movers say they'll arrive “between 9 and 5”. They mean years.",
    "The removal van is booked. It will be parked outside for the next five years.",
    "Please forward all post. Then forward it again, a little to the west.",
    "Bring a jumper. And a tape measure: we'll have moved again by the time you arrive.",
  ];

  function wrap(c, text, x, y, maxW, lh) {
    var words = text.split(" "), line = "";
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + " " + words[i] : words[i];
      if (c.measureText(t).width > maxW && line) { c.fillText(line, x, y); line = words[i]; y += lh; }
      else line = t;
    }
    if (line) c.fillText(line, x, y);
    return y + lh;
  }

  HQ.makePostcard = function () {
    var W = 1200, H = 800, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var c = cv.getContext("2d"), st = HQ.state, V = HQ.view, x = V.hq;
    var T = HQ.nearestTown(x), sea = HQ.atSea(x), F = V.F;
    var seed = HQ.hash(String(st.year) + (T ? T.name : ""));

    // card stock
    c.fillStyle = "#fbf6ea"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "#e2d7bf"; c.lineWidth = 2; c.strokeRect(14, 14, W - 28, H - 28);

    // the picture side
    var px = 40, py = 40, pw = 640, ph = 720;
    c.save();
    HQ.Globe.roundRect(c, px, py, pw, ph, 18); c.clip();
    var bg = c.createLinearGradient(0, py, 0, py + ph);
    bg.addColorStop(0, "#1d2752"); bg.addColorStop(1, "#0b1128");
    c.fillStyle = bg; c.fillRect(px, py, pw, ph);
    var r = seed;
    for (var i = 0; i < 140; i++) {
      r = (Math.imul(r, 1103515245) + 12345) >>> 0;
      var sx = px + (r % pw), sy = py + ((r >>> 10) % ph), sr = (r >>> 20) % 3 === 0 ? 1.4 : 0.8;
      c.fillStyle = "rgba(255,255,255," + (0.3 + ((r >>> 8) % 60) / 100) + ")";
      c.beginPath(); c.arc(sx, sy, sr, 0, 2 * Math.PI); c.fill();
    }
    HQ.Globe.renderMini(c, px + pw / 2, py + 430, 250, x);
    c.restore();
    // title over the picture
    c.fillStyle = "#ffd27a"; c.font = "26px " + HAND;
    c.fillText("Greetings from", px + 34, py + 66);
    c.fillStyle = "#fff"; c.font = "bold 58px " + SERIF;
    var title = sea ? "the HQ barge" : (T ? T.name : "somewhere fair");
    while (c.measureText(title).width > pw - 68) { var fs = parseInt(c.font.match(/(\d+)px/)[1], 10) - 4; c.font = "bold " + fs + "px " + SERIF; }
    c.fillText(title, px + 32, py + 130);
    c.fillStyle = "#c8c4e4"; c.font = "18px " + SANS;
    c.fillText("the fair UN HQ, " + st.year + (F.branch ? " (" + HQ.BRANCH[F.branch].code + ": " + HQ.BRANCH[F.branch].name + ")" : ""), px + 34, py + 164);

    // the divider
    c.strokeStyle = "#d9cdb2"; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(722, 70); c.lineTo(722, 730); c.stroke();

    // stamp
    var stx = 1000, sty = 52, sw = 150, shh = 176;
    c.fillStyle = "#fff"; c.fillRect(stx - 6, sty - 6, sw + 12, shh + 12);
    c.fillStyle = "#fbf6ea";
    for (var k = 0; k <= 15; k++) {
      [[stx - 6 + k * (sw + 12) / 15, sty - 6], [stx - 6 + k * (sw + 12) / 15, sty + shh + 6]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], 4, 0, 2 * Math.PI); c.fill(); });
    }
    for (k = 0; k <= 17; k++) {
      [[stx - 6, sty - 6 + k * (shh + 12) / 17], [stx + sw + 6, sty - 6 + k * (shh + 12) / 17]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], 4, 0, 2 * Math.PI); c.fill(); });
    }
    c.fillStyle = "#4b92db"; c.fillRect(stx, sty, sw, shh);
    c.beginPath(); c.arc(stx + sw / 2, sty + 74, 46, 0, 2 * Math.PI); c.fillStyle = "#16406b"; c.fill();
    c.fillStyle = "#efe3c6";
    c.beginPath(); c.ellipse(stx + sw / 2 - 12, sty + 62, 22, 14, -0.4, 0, 2 * Math.PI); c.fill();
    c.beginPath(); c.ellipse(stx + sw / 2 + 16, sty + 90, 14, 10, 0.5, 0, 2 * Math.PI); c.fill();
    HQ.Globe.pin(c, stx + sw / 2, sty + 80, "#ffd27a", 0.9, "#16406b");
    c.fillStyle = "#fff"; c.font = "bold 22px " + SERIF; c.textAlign = "center";
    c.fillText("p = " + st.p, stx + sw / 2, sty + 150);
    c.font = "12px " + SANS; c.fillText("FAIR POST · " + st.year, stx + sw / 2, sty + 168);
    c.textAlign = "start";

    // postmark
    c.save();
    c.translate(930, 150); c.rotate(-0.25);
    c.strokeStyle = "rgba(35,34,58,.55)"; c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, 58, 0, 2 * Math.PI); c.stroke();
    c.beginPath(); c.arc(0, 0, 42, 0, 2 * Math.PI); c.stroke();
    c.fillStyle = "rgba(35,34,58,.6)"; c.font = "bold 20px " + SANS; c.textAlign = "center";
    c.fillText(String(st.year), 0, 7);
    c.font = "bold 11px " + SANS;
    var ring = "WE'VE MOVED · WE'VE MOVED · ";
    for (k = 0; k < ring.length; k++) {
      c.save(); c.rotate(-Math.PI / 2 + k * 2 * Math.PI / ring.length); c.fillText(ring[k], 0, -46); c.restore();
    }
    c.restore();
    for (k = 0; k < 4; k++) {   // cancellation waves
      c.beginPath();
      for (var q = 0; q <= 60; q++) { var wx = 760 + q * 3, wy = 120 + k * 16 + Math.sin(q / 4) * 4; if (q) c.lineTo(wx, wy); else c.moveTo(wx, wy); }
      c.strokeStyle = "rgba(35,34,58,.35)"; c.lineWidth = 2; c.stroke();
    }

    // the message
    var prev = F.prev && HQ.trail[F.prev.key], cur = HQ.trail[F.key];
    var km = prev && cur ? S.km(prev.x, cur.x) : null, dy = F.prev ? F.year - F.prev.year : 5;
    var mday = km != null ? km / dy * 1000 / 365.25 : null;
    c.fillStyle = "#23223a"; c.font = "23px " + HAND;
    var mx = 750, my = 280, mw = 400, lh = 36;
    c.fillText("Dear humanity,", mx, my); my += lh + 4;
    var kmT = T ? HQ.fmt(T.km, T.km < 10 ? 1 : 0) : "";
    var where = sea ? "We've moved onto a barge, " + kmT + " km " + T.dir + " of " + T.name + ", " + T.country + "."
      : T ? "We've moved! The fairest spot is " + (T.km < 1 ? "right in " : kmT + " km " + T.dir + " of ") + T.name + ", " + T.country + "." : "We've moved somewhere fair.";
    c.font = "19px " + HAND;
    lh = 30;
    my = wrap(c, where, mx, my, mw, lh);
    if (mday != null) my = wrap(c, (st.p === 1 ? "We drift " : "Our everyone-counts-the-same twin drifts ") + HQ.fmt(km / dy, 1) + " km a year: that's " +
      HQ.fmt(mday, mday < 10 ? 1 : 0) + " metres a day, so pack light.", mx, my, mw, lh);
    my = wrap(c, "Moving day: " + movingDay(st.year + 1 + (seed % 3), seed) + ". " + JOKES[seed % JOKES.length], mx, my, mw, lh);
    my = wrap(c, "Wish you were here. (On average, you are.)", mx, my + 4, mw, lh);

    // address lines
    c.strokeStyle = "#cfc2a4"; c.lineWidth = 1.2;
    var ay = Math.min(700, Math.max(660, my + 16));
    ["To: everyone", "Planet Earth", "(all " + HQ.fmt(HQ.stats[F.key] ? HQ.stats[F.key].pop / 1e9 : V.P.W / 1e9, 1) + " billion of you)"].forEach(function (t, j) {
      c.beginPath(); c.moveTo(mx, ay + j * 34 + 8); c.lineTo(mx + mw, ay + j * 34 + 8); c.stroke();
      c.fillStyle = "#23223a"; c.font = "19px " + HAND; c.fillText(t, mx + 6, ay + j * 34);
    });
    if (my > ay - 30) { /* long message: the address lines just overlap a little, like real postcards */ }

    c.fillStyle = "#8a8699"; c.font = "12px " + SANS;
    c.fillText(HQ.ll(x) + " · population: " + HQ.SERIES_LABEL[F.sid] + " · towns: GeoNames (CC BY 4.0)", 44, 772);
    return cv.toDataURL("image/png");
  };
})();
