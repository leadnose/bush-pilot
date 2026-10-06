/* Bush Pilot - procedural world: terrain profile, airstrips, lakes, trees, clouds. */
var World = (function () {
  'use strict';
  function hash1(i, seed) {
    var h = Math.imul(i | 0, 374761393) ^ Math.imul(seed | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function valueNoise(x, seed) {
    var i = Math.floor(x), f = x - i;
    var a = hash1(i, seed), b = hash1(i + 1, seed);
    var u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }
  function fbm(x, seed, oct) {
    var s = 0, amp = 1, fr = 1, n = 0;
    for (var o = 0; o < oct; o++) {
      s += amp * (valueNoise(x * fr + o * 13.7, seed + o * 101) * 2 - 1);
      n += amp; amp *= 0.5; fr *= 2;
    }
    return s / n;
  }
  function smoothstep(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var STRIPS = [
    { name: 'Raven Creek Base', x: 0, len: 650, elev: 80, base: true },
    { name: 'Moose Flats', x: 3800, len: 450, elev: 110, note: 'Easy hop over low hills.' },
    { name: 'Caribou Lake Lodge', x: 7400, len: 420, elev: 160, note: 'One real ridge to clear.' },
    { name: 'Ptarmigan Mine', x: 11400, len: 360, elev: 720, note: 'Short strip on a high bench.' },
    { name: 'Glacier Camp', x: 15800, len: 400, elev: 560, note: 'Steep approach off a tall ridge.' },
    { name: "Tanana Crossing", x: 21200, len: 500, elev: 220, note: 'Long valley after big mountains.' },
    { name: "Kluane Outpost", x: 27200, len: 450, elev: 640, note: 'Deep in the range.' },
    { name: "Yukon Bar", x: 33800, len: 560, elev: 300, note: 'The long haul over the high peaks.' }
  ];
  // ridge height (m) added between consecutive strips
  var RIDGES = [220, 420, 700, 900, 950, 1250, 1200];

  function makeWorld(seed) {
    seed = seed || 1;
    var x0 = -2000, x1 = 38000, dx = 10, n = Math.floor((x1 - x0) / dx) + 1;
    var h = new Float32Array(n), wl = new Float32Array(n);
    var i, x, k;
    function nearStripIdx(kk, margin) {
      var xx = x0 + kk * dx;
      for (var q = 0; q < STRIPS.length; q++) if (Math.abs(xx - STRIPS[q].x) <= STRIPS[q].len / 2 + margin) return true;
      return false;
    }
    function ridgeCenter(r) {
      var a = STRIPS[r], b = STRIPS[r + 1];
      return a.x + ((r >= 6 ? 0.2 : r >= 4 ? 0.25 : 0.30) + 0.06 * (hash1(r, seed + 71) - 0.5)) * (b.x - a.x);
    }
    // base terrain: rolling noise whose amplitude grows eastward, plus one ridge per interval
    for (i = 0; i < n; i++) {
      x = x0 + i * dx;
      var t = smoothstep(1500, 26000, x);
      var env = 90 + 480 * t * (0.6 + 0.4 * (fbm(x / 9000, seed + 7, 2) + 1) / 2);
      var nz = (fbm(x / 2600, seed + 11, 5) + 1) / 2;
      var shaped = Math.pow(nz, 1.4);
      var detail = 45 * fbm(x / 350, seed + 23, 3) * (0.3 + 0.7 * t);
      var ridge = 0;
      for (var r = 0; r < RIDGES.length; r++) {
        var cx = ridgeCenter(r), w = 650 + 160 * r;
        var u = (x - cx) / w;
        ridge += RIDGES[r] * Math.exp(-u * u) * (0.85 + 0.15 * fbm(x / 900, seed + 61 + r, 2));
      }
      h[i] = Math.max(20, 30 + env * shaped + detail + ridge);
    }
    // flatten airstrips, blending into surrounding terrain
    STRIPS.forEach(function (s) {
      var half = s.len / 2, trans = 600;
      var ia = Math.max(0, Math.floor((s.x - half - trans - x0) / dx)), ib = Math.min(n - 1, Math.ceil((s.x + half + trans - x0) / dx));
      for (var kk = ia; kk <= ib; kk++) {
        var xx = x0 + kk * dx, d = Math.abs(xx - s.x);
        if (d <= half) h[kk] = s.elev;
        else { var wgt = 1 - smoothstep(half, half + trans, d); h[kk] = h[kk] + (s.elev - h[kk]) * wgt; }
      }
    });
    // departure ramp east of the base (you always take off eastward), approach cap west of every strip
    for (k = 0; k < n; k++) {
      x = x0 + k * dx;
      STRIPS.forEach(function (s) {
        var e = s.x + s.len / 2, wst = s.x - s.len / 2;
        if (s.base && x > e) { var d = x - e; h[k] = Math.min(h[k], s.elev + d * 0.09 + Math.max(0, d - 2500) * 0.55); }
        if (x < wst) { var d2 = wst - x; h[k] = Math.min(h[k], s.elev + d2 * 0.22 + Math.max(0, d2 - 2200) * 0.7); }
      });
    }
    // lakes: carve a basin at the lowest point of each valley (well away from strips) and fill it
    for (var li = 0; li + 1 < STRIPS.length; li++) {
      var ka = Math.ceil((STRIPS[li].x + STRIPS[li].len / 2 + 1300 - x0) / dx), kb = Math.floor((STRIPS[li + 1].x - STRIPS[li + 1].len / 2 - 1300 - x0) / dx);
      if (kb <= ka) continue;
      var mn = 1e9, im = ka;
      for (k = ka; k <= kb; k++) if (h[k] < mn) { mn = h[k]; im = k; }
      var site = x0 + im * dx, lw = 120 + 90 * hash1(li, seed + 83);
      for (k = Math.max(0, im - 80); k <= Math.min(n - 1, im + 80); k++) { var uu = (x0 + k * dx - site) / lw; h[k] -= 22 * Math.exp(-uu * uu); }
      mn = h[im];
      for (var depth = 12; depth >= 4; depth -= 4) {
        var level = mn + depth, lo = im, hi = im, bad = false;
        while (lo - 1 >= 0 && h[lo - 1] < level) { lo--; if (nearStripIdx(lo, 250) || im - lo > 160) { bad = true; break; } }
        while (!bad && hi + 1 < n && h[hi + 1] < level) { hi++; if (nearStripIdx(hi, 250) || hi - im > 160) { bad = true; break; } }
        if (bad) continue;
        for (k = lo; k <= hi; k++) wl[k] = level;
        break;
      }
    }

    function idx(xq) { return (xq - x0) / dx; }
    function nearStripIdx(k, margin) { var xx = x0 + k * dx; for (var q = 0; q < STRIPS.length; q++) if (Math.abs(xx - STRIPS[q].x) <= STRIPS[q].len / 2 + margin) return true; return false; }
    function sample(arr, xq) {
      var f = idx(xq); if (f <= 0) return arr[0]; if (f >= n - 1) return arr[n - 1];
      var i0 = Math.floor(f), fr = f - i0; return arr[i0] + (arr[i0 + 1] - arr[i0]) * fr;
    }
    function groundAt(xq) { return sample(h, xq); }
    function waterLevelAt(xq) { var f = Math.round(idx(xq)); if (f < 0 || f >= n) return 0; return wl[f]; }
    function heightAt(xq) { var g = groundAt(xq), w = waterLevelAt(xq); return w > g ? w : g; }
    function isWater(xq) { var f = Math.round(idx(xq)); if (f < 0 || f >= n) return false; return wl[f] > h[f]; }
    function slopeAt(xq) { return (heightAt(xq + 5) - heightAt(xq - 5)) / 10; }
    function treeLine(xq) { return 640 + 130 * fbm(xq / 5000, seed + 31, 2); }
    function snowLine(xq) { return 1000 + 170 * fbm(xq / 4000, seed + 37, 2); }
    function stripAt(xq, margin) {
      margin = margin || 0;
      for (var k = 0; k < STRIPS.length; k++) if (Math.abs(xq - STRIPS[k].x) <= STRIPS[k].len / 2 + margin) return STRIPS[k];
      return null;
    }
    function nearStrip(xq, margin) { return stripAt(xq, margin) !== null; }
    function maxHeightBetween(a, b) {
      var ia = Math.max(0, Math.floor(idx(Math.min(a, b)))), ib = Math.min(n - 1, Math.ceil(idx(Math.max(a, b)))), mx = -1e9;
      for (var k = ia; k <= ib; k++) mx = Math.max(mx, h[k]);
      return mx;
    }

    // trees
    var trees = [];
    for (i = 0; i < n; i++) {
      x = x0 + i * dx;
      if (wl[i] > h[i] || nearStrip(x, 45)) continue;
      var tl = treeLine(x);
      if (h[i] > tl) continue;
      var dens = Math.min(1, Math.max(0.12, (tl - h[i]) / 250));
      var cnt = hash1(i, seed + 41) < 0.6 * dens ? (hash1(i, seed + 59) < 0.4 * dens ? 2 : 1) : 0;
      for (var c = 0; c < cnt; c++) {
        var tx = x + hash1(i * 3 + c, seed + 43) * dx;
        trees.push({ x: tx, y: groundAt(tx), h: 5 + 8 * hash1(i * 3 + c, seed + 47), shade: hash1(i * 3 + c, seed + 53) });
      }
    }
    // clouds (layer space, parallax 0.7)
    var rng = mulberry32(seed * 9973 + 17), clouds = [];
    for (i = 0; i < 70; i++) {
      var alt = 500 + rng() * 1500;
      clouds.push({ x: x0 + rng() * (x1 - x0), ly: alt * 0.7, w: 70 + rng() * 180, h: 18 + rng() * 30, seed: Math.floor(rng() * 1000) });
    }

    return {
      x0: x0, x1: x1, dx: dx, n: n, h: h, wl: wl, seed: seed,
      strips: STRIPS, trees: trees, clouds: clouds,
      heightAt: heightAt, groundAt: groundAt, waterLevelAt: waterLevelAt, isWater: isWater, slopeAt: slopeAt,
      treeLine: treeLine, snowLine: snowLine, stripAt: stripAt, nearStrip: nearStrip, maxHeightBetween: maxHeightBetween,
      fbm: fbm, hash1: hash1
    };
  }
  return { makeWorld: makeWorld, STRIPS: STRIPS, fbm: fbm, hash1: hash1, mulberry32: mulberry32, smoothstep: smoothstep };
})();
if (typeof module !== 'undefined') module.exports = World;
