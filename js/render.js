/* Bush Pilot - canvas renderer: scenery, aircraft, HUD, UI helpers. */
var Render = (function () {
  'use strict';
  var DEG = Math.PI / 180;
  var FONT = '"Consolas","Menlo","DejaVu Sans Mono",monospace';
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) { t = clamp(t, 0, 1); return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t]; }
  function rgb(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }
  function rgba(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')'; }

  var SNOW = [244, 247, 250], ROCK = [112, 110, 106], ROCK_DARK = [74, 72, 70], TUNDRA = [146, 130, 74], TUNDRA_RED = [158, 96, 58];
  var FOREST = [54, 92, 58], FOREST_DARK = [34, 60, 40], SOIL = [44, 38, 34], GRAVEL = [138, 122, 98];

  function surfaceColor(world, x, h, slope) {
    var steep = clamp((Math.abs(slope) - 0.45) / 0.9, 0, 1);
    var snow = world.snowLine(x), tree = world.treeLine(x);
    var jitter = 0.5 + 0.5 * world.fbm(x / 60, 5, 2);
    var c;
    if (h > snow + 30) c = mix(SNOW, ROCK, steep * 0.95);
    else if (h > snow - 70) {
      var t = (h - (snow - 70)) / 100;
      c = mix(mix(ROCK, TUNDRA, 0.35), SNOW, t * (0.6 + 0.4 * jitter));
      c = mix(c, ROCK_DARK, steep * 0.7);
    } else if (h > tree) {
      var t2 = clamp((h - tree) / Math.max(60, snow - 70 - tree), 0, 1);
      c = mix(TUNDRA_RED, TUNDRA, t2 * 0.7 + 0.3 * jitter);
      c = mix(c, ROCK, steep);
    } else c = mix(mix(FOREST, FOREST_DARK, jitter * 0.5), ROCK_DARK, steep * 0.85);
    return c;
  }

  function drawFarLayer(ctx, W, H, world, cam, p, vs, base, amp, cLow, cHigh, seed) {
    var sc = cam.scale * vs, step = 6, horizon = H * 0.58;
    var minY = H, maxY = 0;
    ctx.beginPath(); ctx.moveTo(-10, H + 10);
    for (var px = -10; px <= W + 10; px += step) {
      var xw = (px - W / 2) / cam.scale + cam.x * p;
      var nz = 0.5 + 0.5 * world.fbm(xw / 2400, seed, 4);
      var hl = base + amp * Math.pow(nz, 1.4);
      var y = horizon - (hl - cam.y * p) * sc;
      ctx.lineTo(px, y); if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    ctx.lineTo(W + 10, H + 10); ctx.closePath();
    var g = ctx.createLinearGradient(0, minY, 0, maxY + 60);
    g.addColorStop(0, rgb(cHigh)); g.addColorStop(1, rgb(cLow));
    ctx.fillStyle = g; ctx.fill();
  }

  function drawClouds(ctx, W, H, world, cam) {
    var p = 0.7, sc = cam.scale;
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    for (var i = 0; i < world.clouds.length; i++) {
      var c = world.clouds[i];
      var cx = (c.x - cam.x * p) * sc + W / 2;
      if (cx < -c.w * sc || cx > W + c.w * sc) continue;
      var cy = H / 2 - (c.ly - cam.y * p) * sc;
      if (cy < -300 || cy > H + 300) continue;
      for (var k = 0; k < 4; k++) {
        var fx = world.hash1(c.seed * 7 + k, 3), fy = world.hash1(c.seed * 7 + k, 5);
        ctx.beginPath();
        ctx.ellipse(cx + (fx - 0.5) * c.w * sc * 0.8, cy - fy * c.h * sc * 0.5, c.w * sc * (0.25 + 0.2 * fx), c.h * sc * (0.5 + 0.3 * fy), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawTree(ctx, x, y, hpx, shade) {
    var w = hpx * 0.42;
    var c = mix(FOREST_DARK, [28, 78, 52], shade);
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(x - hpx * 0.04, y - hpx * 0.25, hpx * 0.08, hpx * 0.25);
    ctx.fillStyle = rgb(c);
    ctx.beginPath(); ctx.moveTo(x, y - hpx); ctx.lineTo(x - w * 0.55, y - hpx * 0.55); ctx.lineTo(x + w * 0.55, y - hpx * 0.55); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y - hpx * 0.8); ctx.lineTo(x - w * 0.8, y - hpx * 0.38); ctx.lineTo(x + w * 0.8, y - hpx * 0.38); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y - hpx * 0.62); ctx.lineTo(x - w, y - hpx * 0.2); ctx.lineTo(x + w, y - hpx * 0.2); ctx.closePath(); ctx.fill();
  }

  function lowerBound(arr, x) { var lo = 0, hi = arr.length; while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m].x < x) lo = m + 1; else hi = m; } return lo; }

  function drawStrip(ctx, s, world, cam, W, H, time, sc, sx, sy) {
    var x1 = s.x - s.len / 2, x2 = s.x + s.len / 2, y = sy(s.elev);
    var th = Math.max(3, 0.8 * sc);
    ctx.fillStyle = rgb(GRAVEL);
    ctx.fillRect(sx(x1), y - th * 0.5, (x2 - x1) * sc, th);
    ctx.fillStyle = '#f4f4f0';
    for (var mx = x1; mx <= x2; mx += 50) ctx.fillRect(sx(mx) - 0.6 * sc, y - th * 0.5 - Math.max(1, 0.3 * sc), Math.max(2, 1.2 * sc), Math.max(1, 0.3 * sc));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx(x1), y - th * 0.5 - Math.max(1, 0.5 * sc), Math.max(3, 3 * sc), Math.max(2, 0.5 * sc));
    ctx.fillRect(sx(x2) - Math.max(3, 3 * sc), y - th * 0.5 - Math.max(1, 0.5 * sc), Math.max(3, 3 * sc), Math.max(2, 0.5 * sc));
    // windsock
    var wx = sx(x2 - 25), wy = y - th * 0.5;
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = Math.max(1, 0.15 * sc);
    ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx, wy - 6 * sc); ctx.stroke();
    ctx.fillStyle = '#ff7a1a';
    var flap = Math.sin(time * 3) * 0.3 * sc;
    ctx.beginPath(); ctx.moveTo(wx, wy - 6 * sc); ctx.lineTo(wx + 3 * sc, wy - 5.6 * sc + flap); ctx.lineTo(wx + 3 * sc, wy - 4.9 * sc + flap); ctx.lineTo(wx, wy - 5 * sc); ctx.closePath(); ctx.fill();
    // cabin
    var cx = sx(x2 + 55), cy = sy(world.heightAt(x2 + 55));
    var cw = 7 * sc, ch = 3.4 * sc;
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(cx - cw / 2, cy - ch, cw, ch);
    ctx.fillStyle = '#3a2a1a';
    ctx.beginPath(); ctx.moveTo(cx - cw * 0.6, cy - ch); ctx.lineTo(cx, cy - ch - 2.2 * sc); ctx.lineTo(cx + cw * 0.6, cy - ch); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd27a'; ctx.fillRect(cx - cw * 0.3, cy - ch * 0.75, cw * 0.18, ch * 0.3); ctx.fillRect(cx + cw * 0.12, cy - ch * 0.75, cw * 0.18, ch * 0.3);
    ctx.fillStyle = '#555'; ctx.fillRect(cx + cw * 0.25, cy - ch - 3 * sc, 0.5 * sc, 1.2 * sc);
    ctx.fillStyle = 'rgba(220,220,220,0.35)';
    for (var k = 0; k < 4; k++) { var ph = (time * 0.4 + k * 0.25) % 1; ctx.beginPath(); ctx.arc(cx + cw * 0.3 + Math.sin(ph * 6) * sc * 0.6, cy - ch - 3 * sc - ph * 6 * sc, (0.4 + ph * 1.2) * sc, 0, Math.PI * 2); ctx.fill(); }
    // fuel drums
    ctx.fillStyle = '#b02a2a';
    for (var d = 0; d < 3; d++) ctx.fillRect(cx + cw * 0.7 + d * 1.1 * sc, cy - 1.1 * sc, 0.9 * sc, 1.1 * sc);
    if (s.base) {
      var hx = sx(x1 - 70), hy = sy(world.heightAt(x1 - 70)), hw = 16 * sc, hh = 5.5 * sc;
      ctx.fillStyle = '#8c8f94'; ctx.fillRect(hx - hw / 2, hy - hh, hw, hh);
      ctx.fillStyle = '#5a5e64';
      ctx.beginPath(); ctx.moveTo(hx - hw / 2, hy - hh); ctx.quadraticCurveTo(hx, hy - hh - 3.5 * sc, hx + hw / 2, hy - hh); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a2d31'; ctx.fillRect(hx - hw * 0.3, hy - hh * 0.85, hw * 0.6, hh * 0.85);
      if (sc > 2.2) { ctx.fillStyle = '#e8e8e8'; ctx.font = 'bold ' + Math.max(8, 1.0 * sc) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('RAVEN CREEK AIR', hx, hy - hh - 0.6 * sc); }
    }
    // label
    ctx.font = '13px ' + FONT; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(s.name + '  ' + s.elev + ' m', sx(s.x) + 1, y - th - 25);
    ctx.fillStyle = '#ffffff'; ctx.fillText(s.name + '  ' + s.elev + ' m', sx(s.x), y - th - 26);
    ctx.textAlign = 'left';
  }

  function drawPlane(ctx, spec, p, sc, px, py, engineOn) {
    ctx.save();
    ctx.translate(px, py); ctx.rotate(-p.pitch);
    var k = sc * spec.length / 6.8; ctx.scale(k, k);
    var c = spec.colors;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // struts and gear
    ctx.strokeStyle = '#333'; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.moveTo(1.2, -1.25); ctx.lineTo(0.55, 0.45); ctx.moveTo(-0.1, -1.25); ctx.lineTo(0.35, 0.45); ctx.stroke();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 0.1;
    ctx.beginPath(); ctx.moveTo(0.95, 0.5); ctx.lineTo(0.6, 1.2); ctx.moveTo(0.15, 0.5); ctx.lineTo(0.6, 1.2); ctx.moveTo(-3.05, -0.25); ctx.lineTo(-3.15, 0.3); ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(0.6, 1.18, 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-3.15, 0.36, 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#888'; ctx.beginPath(); ctx.arc(0.6, 1.18, 0.12, 0, Math.PI * 2); ctx.fill();
    // horizontal stabilizer + elevator
    ctx.fillStyle = c.body; ctx.strokeStyle = c.trim; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.rect(-3.45, -0.46, 0.85, 0.14); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.translate(-3.45, -0.39); ctx.rotate(p.elev * 0.45);
    ctx.beginPath(); ctx.rect(-0.55, -0.06, 0.55, 0.12); ctx.fill(); ctx.stroke(); ctx.restore();
    // fin
    ctx.beginPath(); ctx.moveTo(-2.45, -0.55); ctx.lineTo(-3.0, -1.55); ctx.lineTo(-3.5, -1.55); ctx.lineTo(-3.45, -0.42); ctx.closePath(); ctx.fill(); ctx.stroke();
    // fuselage
    ctx.beginPath();
    ctx.moveTo(3.4, -0.05); ctx.lineTo(3.15, -0.6); ctx.lineTo(2.3, -0.75); ctx.lineTo(1.6, -1.05); ctx.lineTo(0.3, -1.08);
    ctx.lineTo(-3.3, -0.5); ctx.lineTo(-3.5, -0.42); ctx.lineTo(-3.5, -0.2); ctx.lineTo(-0.3, 0.5); ctx.lineTo(1.2, 0.58); ctx.lineTo(2.6, 0.5); ctx.lineTo(3.4, 0.15);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // window
    ctx.fillStyle = c.glass;
    ctx.beginPath(); ctx.moveTo(2.25, -0.72); ctx.lineTo(1.6, -1.0); ctx.lineTo(0.5, -1.02); ctx.lineTo(0.5, -0.5); ctx.lineTo(2.0, -0.45); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(1.3, -0.72, 0.17, 0, Math.PI * 2); ctx.fill(); // pilot head
    // stripe
    ctx.fillStyle = c.trim;
    if (spec.id === 'j3cub') {
      ctx.beginPath(); ctx.moveTo(2.9, -0.22); ctx.lineTo(1.0, -0.12); ctx.lineTo(1.3, 0.1); ctx.lineTo(-3.1, -0.2); ctx.lineTo(-3.1, -0.33); ctx.lineTo(1.0, -0.2); ctx.lineTo(0.8, -0.38); ctx.lineTo(2.9, -0.36); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(3.0, -0.1); ctx.lineTo(-3.2, -0.22); ctx.lineTo(-3.2, -0.38); ctx.lineTo(3.0, -0.3); ctx.closePath(); ctx.fill();
    }
    // wing
    ctx.fillStyle = c.body; ctx.strokeStyle = c.trim;
    ctx.beginPath(); ctx.moveTo(-0.55, -1.3); ctx.lineTo(1.5, -1.42); ctx.lineTo(1.72, -1.3); ctx.lineTo(1.5, -1.18); ctx.lineTo(-0.55, -1.2); ctx.closePath(); ctx.fill(); ctx.stroke();
    // propeller
    if (engineOn) {
      ctx.fillStyle = 'rgba(70,70,70,0.35)';
      ctx.beginPath(); ctx.ellipse(3.55, 0.0, 0.1, 0.95, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.save(); ctx.translate(3.55, 0); ctx.rotate(p.prop); ctx.fillStyle = '#222'; ctx.fillRect(-0.06, -0.95, 0.12, 1.9); ctx.restore();
    }
    ctx.fillStyle = '#444'; ctx.beginPath(); ctx.arc(3.5, 0.02, 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawScene(ctx, W, H, scene, time) {
    var world = scene.world, cam = scene.cam, sc = cam.scale, p = scene.p, spec = scene.spec;
    function sx(x) { return (x - cam.x) * sc + W / 2; }
    function sy(y) { return H / 2 - (y - cam.y) * sc; }
    var i;
    // sky
    var altT = clamp(cam.y / 3500, 0, 1);
    var top = mix([96, 160, 216], [22, 50, 110], altT), bot = mix([206, 222, 232], [140, 178, 212], altT);
    var g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bot));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // sun
    var sunX = W * 0.78, sunY = H * 0.22;
    var sg = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 180);
    sg.addColorStop(0, 'rgba(255,245,200,0.95)'); sg.addColorStop(0.15, 'rgba(255,235,170,0.6)'); sg.addColorStop(1, 'rgba(255,235,170,0)');
    ctx.fillStyle = sg; ctx.fillRect(sunX - 180, sunY - 180, 360, 360);
    // distant ranges
    drawFarLayer(ctx, W, H, world, cam, 0.06, 0.045, 600, 2000, [186, 202, 224], [232, 238, 246], 1001);
    drawFarLayer(ctx, W, H, world, cam, 0.18, 0.09, 350, 1300, [132, 154, 186], [212, 222, 236], 2002);
    drawClouds(ctx, W, H, world, cam);

    // terrain columns
    var step = 3, cols = Math.ceil(W / step) + 2;
    var xs = new Array(cols + 1), ys = new Array(cols + 1), hs = new Array(cols + 1), ws = new Array(cols + 1), xw = new Array(cols + 1);
    for (i = 0; i <= cols; i++) {
      var px = i * step - 2, wx = cam.x + (px - W / 2) / sc;
      xs[i] = px; xw[i] = wx; hs[i] = world.groundAt(wx); ys[i] = sy(hs[i]); ws[i] = world.waterLevelAt(wx);
    }
    ctx.fillStyle = rgb(SOIL);
    ctx.beginPath(); ctx.moveTo(xs[0], H + 10);
    for (i = 0; i <= cols; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.lineTo(xs[cols], H + 10); ctx.closePath(); ctx.fill();
    var band = Math.max(10, 7 * sc), band2 = band * 2.4;
    for (var pass = 0; pass < 2; pass++) {
      var b = pass === 0 ? band2 : band;
      for (i = 0; i < cols; i++) {
        var slope = (hs[i + 1] - hs[i]) / (step / sc);
        var c = surfaceColor(world, (xw[i] + xw[i + 1]) / 2, (hs[i] + hs[i + 1]) / 2, slope);
        if (pass === 0) c = mix(c, SOIL, 0.55);
        ctx.fillStyle = rgb(c);
        ctx.beginPath(); ctx.moveTo(xs[i] - 0.5, ys[i]); ctx.lineTo(xs[i + 1] + 0.5, ys[i + 1]); ctx.lineTo(xs[i + 1] + 0.5, ys[i + 1] + b); ctx.lineTo(xs[i] - 0.5, ys[i] + b); ctx.closePath(); ctx.fill();
      }
    }
    // water
    for (i = 0; i < cols; i++) {
      if (ws[i] > hs[i]) {
        var wy = sy(ws[i]);
        var wg = ctx.createLinearGradient(0, wy, 0, ys[i]);
        wg.addColorStop(0, 'rgba(90,150,200,0.9)'); wg.addColorStop(1, 'rgba(20,50,90,0.95)');
        ctx.fillStyle = wg; ctx.fillRect(xs[i] - 0.5, wy, step + 1, Math.max(1, ys[i] - wy));
        ctx.fillStyle = 'rgba(255,255,255,' + (0.25 + 0.2 * Math.sin(time * 2 + xw[i] * 0.05)) + ')';
        ctx.fillRect(xs[i] - 0.5, wy, step + 1, 1.5);
      }
    }
    // trees
    var left = cam.x - W / 2 / sc - 20, right = cam.x + W / 2 / sc + 20;
    var ti = lowerBound(world.trees, left);
    for (; ti < world.trees.length && world.trees[ti].x < right; ti++) {
      var t = world.trees[ti], hpx = t.h * sc;
      if (hpx < 2.5) continue;
      drawTree(ctx, sx(t.x), sy(t.y) + 1, hpx, t.shade);
    }
    // strips
    for (i = 0; i < world.strips.length; i++) {
      var s = world.strips[i];
      if (s.x + s.len / 2 + 120 < left || s.x - s.len / 2 - 120 > right) continue;
      drawStrip(ctx, s, world, cam, W, H, time, sc, sx, sy);
    }
    // plane shadow and plane
    if (p && !p.crashed) {
      var gy = world.heightAt(p.x), agl = p.y - gy;
      var sa = 0.35 * clamp(1 - agl / 90, 0, 1);
      if (sa > 0.01) { ctx.fillStyle = 'rgba(0,0,0,' + sa + ')'; ctx.beginPath(); ctx.ellipse(sx(p.x), sy(gy) + 1, spec.length * 0.5 * sc, Math.max(1, 0.18 * sc), 0, 0, Math.PI * 2); ctx.fill(); }
      drawPlane(ctx, spec, p, sc, sx(p.x), sy(p.y), !!scene.throttle);
    }
    // particles
    if (scene.particles) for (i = 0; i < scene.particles.length; i++) {
      var q = scene.particles[i];
      ctx.fillStyle = q.color; ctx.globalAlpha = clamp(q.life / q.maxLife, 0, 1);
      ctx.beginPath(); ctx.arc(sx(q.x), sy(q.y), Math.max(1, q.r * sc), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- UI helpers ---------- */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function panel(ctx, x, y, w, h, title) {
    roundRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = 'rgba(12,18,26,0.84)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.stroke();
    if (title) text(ctx, title, x + 18, y + 32, { font: 'bold 20px ' + FONT, color: '#ffd56a' });
  }
  function text(ctx, s, x, y, o) {
    o = o || {};
    ctx.font = o.font || ('15px ' + FONT); ctx.fillStyle = o.color || '#e8eef4'; ctx.textAlign = o.align || 'left';
    ctx.fillText(s, x, y); ctx.textAlign = 'left';
  }
  function menu(ctx, x, y, w, items, sel, rowH) {
    rowH = rowH || 34;
    for (var i = 0; i < items.length; i++) {
      var it = items[i], ry = y + i * rowH;
      if (i === sel) { roundRect(ctx, x, ry - 22, w, rowH - 4, 5); ctx.fillStyle = 'rgba(255,213,106,0.18)'; ctx.fill(); ctx.strokeStyle = '#ffd56a'; ctx.stroke(); }
      text(ctx, (i === sel ? '> ' : '  ') + it.label, x + 12, ry, { color: it.disabled ? '#8a949e' : (i === sel ? '#ffffff' : '#d8e0e8'), font: (i === sel ? 'bold ' : '') + '16px ' + FONT });
      if (it.detail) text(ctx, it.detail, x + w - 12, ry, { align: 'right', color: it.disabled ? '#8a949e' : '#ffd56a' });
    }
  }
  function wrap(ctx, s, maxW, font) {
    ctx.font = font || ('15px ' + FONT);
    var words = s.split(' '), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      var m = ctx.measureText(test).width;
      if (m > maxW && cur) { lines.push(cur); cur = words[i]; } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /* ---------- HUD ---------- */
  function drawHUD(ctx, W, H, f, time) {
    var p = f.p, spec = f.spec, world = f.world;
    var gy = world.heightAt(p.x), agl = p.y - gy;
    var kmh = Math.round(p.v * 3.6);
    var stallV = Physics.stallSpeed(spec, p.mass, p.y);
    var nearStall = !p.onGround && (p.alpha > spec.alphaStall - 1.5 * DEG || (p.v < stallV * 1.08 && p.v > 3));
    var mono = '15px ' + FONT, bold = 'bold 15px ' + FONT;
    panel(ctx, 12, 12, 340, 168);
    var x = 28, y = 38, dy = 22;
    text(ctx, 'AIRSPEED', x, y, { font: mono, color: '#9fb3c8' });
    text(ctx, kmh + ' km/h', x + 110, y, { font: bold, color: nearStall ? '#ff6b57' : '#ffffff' });
    text(ctx, 'stall ' + Math.round(stallV * 3.6), x + 230, y, { font: '13px ' + FONT, color: '#8a949e' });
    y += dy;
    text(ctx, 'ALTITUDE', x, y, { font: mono, color: '#9fb3c8' });
    text(ctx, Math.round(p.y) + ' m', x + 110, y, { font: bold });
    text(ctx, 'AGL ' + Math.max(0, Math.round(agl - spec.gearHeight)), x + 230, y, { font: '13px ' + FONT, color: '#8a949e' });
    y += dy;
    var vs = p.onGround ? 0 : p.vy;
    text(ctx, 'CLIMB', x, y, { font: mono, color: '#9fb3c8' });
    text(ctx, (vs >= 0 ? '+' : '') + vs.toFixed(1) + ' m/s', x + 110, y, { font: bold, color: vs < -4 ? '#ffb347' : '#ffffff' });
    y += dy;
    text(ctx, 'THROTTLE', x, y, { font: mono, color: '#9fb3c8' });
    var thr = p.fuel <= 0 ? 'ENGINE OUT' : (f.throttle ? 'FULL' : 'IDLE');
    text(ctx, thr, x + 110, y, { font: bold, color: p.fuel <= 0 ? '#ff6b57' : (f.throttle ? '#7CFC9A' : '#ffd56a') });
    text(ctx, '[SPACE]', x + 230, y, { font: '13px ' + FONT, color: '#8a949e' });
    y += dy;
    text(ctx, 'FUEL', x, y, { font: mono, color: '#9fb3c8' });
    var fw = 150, ff = clamp(p.fuel / spec.tankCap, 0, 1);
    ctx.fillStyle = '#243040'; ctx.fillRect(x + 110, y - 13, fw, 14);
    ctx.fillStyle = ff < 0.2 ? '#ff6b57' : '#5bb8ff'; ctx.fillRect(x + 110, y - 13, fw * ff, 14);
    text(ctx, p.fuel.toFixed(0) + ' L', x + 270, y, { font: bold });
    y += dy;
    text(ctx, 'LOAD', x, y, { font: mono, color: '#9fb3c8' });
    text(ctx, p.cargo + ' kg cargo', x + 110, y, { font: bold });
    text(ctx, Math.round(p.mass) + ' kg total', x + 230, y, { font: '13px ' + FONT, color: '#8a949e' });
    y += dy;
    var dist = (f.dest.x - p.x) / 1000;
    text(ctx, 'DEST', x, y, { font: mono, color: '#9fb3c8' });
    text(ctx, f.dest.name, x + 110, y, { font: bold, color: '#7CFC9A' });
    text(ctx, (dist >= 0 ? dist.toFixed(1) + ' km' : 'PASSED'), x + 270, y, { font: bold, color: dist >= 0 ? '#ffffff' : '#ff6b57' });

    // stall warning
    if (nearStall && !p.crashed && Math.floor(time * 6) % 2 === 0) {
      text(ctx, 'STALL', W / 2, H * 0.42, { font: 'bold 44px ' + FONT, color: '#ff4d3a', align: 'center' });
    }
    drawMinimap(ctx, W - 12 - 400, 12, 400, 120, f);

    // approach marker
    var thresh = f.dest.x - f.dest.len / 2, ahead = thresh - p.x;
    if (ahead > -f.dest.len && ahead < 5000 && !p.onGround) {
      var sc = f.cam.scale, mx = (thresh - f.cam.x) * sc + W / 2;
      ctx.fillStyle = '#7CFC9A';
      if (mx < W - 30) {
        var my = H / 2 - (f.dest.elev - f.cam.y) * sc - 30 - Math.sin(time * 5) * 6;
        ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - 10, my - 18); ctx.lineTo(mx + 10, my - 18); ctx.closePath(); ctx.fill();
        text(ctx, 'THRESHOLD', mx, my - 24, { font: 'bold 12px ' + FONT, color: '#7CFC9A', align: 'center' });
      } else {
        var ey = H * 0.5;
        ctx.beginPath(); ctx.moveTo(W - 14, ey); ctx.lineTo(W - 34, ey - 12); ctx.lineTo(W - 34, ey + 12); ctx.closePath(); ctx.fill();
        text(ctx, f.dest.name + ' ' + (ahead / 1000).toFixed(1) + ' km', W - 40, ey + 5, { font: 'bold 13px ' + FONT, color: '#7CFC9A', align: 'right' });
      }
    }
    // messages
    var my2 = H * 0.2;
    for (var i = 0; i < f.messages.length; i++) {
      var m = f.messages[i], a = clamp(m.t, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = 'bold 17px ' + FONT;
      var tw = ctx.measureText(m.text).width + 30;
      roundRect(ctx, W / 2 - tw / 2, my2 - 20, tw, 30, 6); ctx.fillStyle = 'rgba(12,18,26,0.75)'; ctx.fill();
      text(ctx, m.text, W / 2, my2 + 2, { font: 'bold 17px ' + FONT, color: m.color || '#ffffff', align: 'center' });
      ctx.globalAlpha = 1; my2 += 36;
    }
    text(ctx, 'ESC pause   M sound', W - 14, H - 12, { font: '12px ' + FONT, color: 'rgba(255,255,255,0.6)', align: 'right' });
  }

  function drawMinimap(ctx, x, y, w, h, f) {
    var world = f.world, p = f.p;
    var xa = -500, xb = Math.max(6000, f.dest.x + 1500);
    panel(ctx, x, y, w, h);
    var ix = x + 10, iy = y + 10, iw = w - 20, ih = h - 30;
    var maxH = 300, n = 160, i;
    for (i = 0; i <= n; i++) maxH = Math.max(maxH, world.heightAt(xa + (xb - xa) * i / n));
    maxH = Math.max(maxH, p.y) * 1.12;
    function mx(wx) { return ix + (wx - xa) / (xb - xa) * iw; }
    function my(wy) { return iy + ih - wy / maxH * ih; }
    ctx.save();
    ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
    ctx.fillStyle = '#1b2a3a'; ctx.fillRect(ix, iy, iw, ih);
    ctx.beginPath(); ctx.moveTo(ix, iy + ih);
    for (i = 0; i <= n; i++) { var wx = xa + (xb - xa) * i / n; ctx.lineTo(mx(wx), my(world.heightAt(wx))); }
    ctx.lineTo(ix + iw, iy + ih); ctx.closePath();
    ctx.fillStyle = '#4a5a52'; ctx.fill();
    for (i = 0; i < world.strips.length; i++) {
      var s = world.strips[i];
      if (s.x < xa || s.x > xb) continue;
      ctx.fillStyle = s === f.dest ? '#7CFC9A' : '#d8d8d0';
      ctx.fillRect(mx(s.x - s.len / 2) - 1, my(s.elev) - 3, Math.max(3, (s.len / (xb - xa)) * iw) + 2, 3);
    }
    // altitude ladder
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    for (var a = 500; a < maxH; a += 500) { ctx.beginPath(); ctx.moveTo(ix, my(a)); ctx.lineTo(ix + iw, my(a)); ctx.stroke(); text(ctx, a + '', ix + iw - 4, my(a) - 2, { font: '10px ' + FONT, color: 'rgba(255,255,255,0.45)', align: 'right' }); }
    // plane
    var px = mx(p.x), py = my(p.y);
    ctx.fillStyle = p.crashed ? '#ff4d3a' : '#ffd56a';
    ctx.beginPath(); ctx.moveTo(px + 7, py); ctx.lineTo(px - 5, py - 4); ctx.lineTo(px - 5, py + 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    var ridge = p.x < f.dest.x ? Math.round(world.maxHeightBetween(p.x, f.dest.x)) : 0;
    text(ctx, 'ROUTE', ix, y + h - 8, { font: '11px ' + FONT, color: '#9fb3c8' });
    text(ctx, ridge > 0 ? 'highest terrain ahead ' + ridge + ' m' : 'destination passed', ix + iw, y + h - 8, { font: '11px ' + FONT, color: ridge > p.y - 30 && ridge > 0 ? '#ffb347' : '#9fb3c8', align: 'right' });
  }

  return { drawScene: drawScene, drawHUD: drawHUD, drawPlane: drawPlane, panel: panel, text: text, menu: menu, wrap: wrap, roundRect: roundRect, FONT: FONT, mix: mix, rgb: rgb };
})();
if (typeof module !== 'undefined') module.exports = Render;
