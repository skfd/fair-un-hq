// Real data in web/data/ wins. If the pipeline has not produced it yet, fall back to a
// synthetic dataset in the exact DATA.md shape, so the page still works on a fresh clone.
(function () {
  if (FAIR.cells) return;
  FAIR.isMock = true;
  var m = /[?&]mockcells=(\d+)/.exec(location.search);
  if (m) FAIR.MOCK_CELLS = +m[1];
  document.write('<script src="mock/mock-data.js"><\/script>');
})();
