// First script on the page: the one global every data file writes into (see DATA.md).
window.FAIR = window.FAIR || {};
FAIR.series = FAIR.series || {};
FAIR.addSeries = FAIR.addSeries || function (s) { FAIR.series[s.id] = s; };
