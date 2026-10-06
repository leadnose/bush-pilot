/* Bush Pilot - game states, input, missions, economy, main loop. */
var BushPilot = (function () {
  'use strict';
  var DEG = Math.PI / 180;
  var TIME_SCALE = 2.5;          // simulated seconds per real second
  var FUEL_PRICE = 1.6;          // $ per litre
  var RECOVERY_FEE = 150;
  var SAVE_KEY = 'bushpilot-save-v1';
  var CARGO = ['Mail sacks', 'Medical supplies', 'Groceries', 'Mining parts', 'Fuel drums', 'Survey gear', 'Sled dogs', 'Lumber',
    'A generator', 'Snowmachine parts', 'Fishing gear', 'Propane bottles', 'Research samples', 'A wood stove', 'An outboard motor', 'A satellite dish'];
  var FONT = Render.FONT;

  var canvas, ctx, W = 1280, H = 720;
  var keys = {};
  var G = { state: 'title', save: null, world: null, jobs: [], sel: 0, fuelSel: 20, flight: null, scene: null, result: null,
    confirmReset: false, paused: false, pauseSel: 0, time: 0, last: 0, help: false };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

  /* ---------- save ---------- */
  function defaultSave() {
    return { v: 1, cash: 300, planeId: 'j3cub', owned: ['j3cub'], upgrades: {}, stats: { flights: 0, delivered: 0, crashes: 0, earned: 0 }, invert: false, muted: false, jobSeed: 1 };
  }
  function loadSave() {
    try { var raw = localStorage.getItem(SAVE_KEY); if (raw) { var s = JSON.parse(raw); if (s && s.v === 1) return Object.assign(defaultSave(), s); } } catch (e) {}
    return defaultSave();
  }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.save)); } catch (e) {} }

  function planeById(id) { for (var i = 0; i < Physics.PLANES.length; i++) if (Physics.PLANES[i].id === id) return Physics.PLANES[i]; return Physics.PLANES[0]; }
  function currentPlane() { return planeById(G.save.planeId); }
  function levelsFor(id) { return G.save.upgrades[id] || {}; }
  function specFor(id) { return Physics.buildSpec(planeById(id), levelsFor(id)); }
  function currentSpec() { return specFor(G.save.planeId); }
  function repairCost() { return Math.round(0.05 * (currentPlane().price + 4000)); }

  function makeParkedScene() {
    var spec = currentSpec();
    var p = Physics.createState(spec, -300, G.world, spec.tankCap * 0.5, 0);
    return { world: G.world, spec: spec, p: p, cam: { x: -250, y: G.world.heightAt(-300) + 45, scale: 4 }, particles: [], throttle: false };
  }

  /* ---------- missions ---------- */
  function computePay(dest, kg) {
    var dist = dest.x / 1000, ridge = Math.max(0, G.world.maxHeightBetween(0, dest.x) - 80);
    return Math.round((60 + dist * (14 + 0.22 * kg) * (1 + ridge / 900)) / 10) * 10;
  }
  function estimateFuel(dest, spec) {
    var litres = dest.x / (spec.vref * 1.1) * spec.burnRate * 1.3 + 3;
    return Math.min(spec.tankCap, Math.ceil(litres / 5) * 5);
  }
  function generateJobs() {
    var rng = World.mulberry32(G.save.jobSeed * 7919 + 13), spec = currentSpec(), strips = World.STRIPS, jobs = [];
    for (var i = 0; i < 4; i++) {
      var di;
      if (i === 0) di = 1 + Math.floor(rng() * 2);
      else di = 1 + Math.floor(Math.pow(rng(), i === 3 ? 0.7 : 1.3) * (strips.length - 1));
      di = clamp(di, 1, strips.length - 1);
      var kg = i < 3 ? Math.max(10, Math.round((15 + rng() * spec.maxPayload * 1.1) / 5) * 5)
        : Math.round((spec.maxPayload * 1.1 + rng() * Math.max(100, spec.maxPayload)) / 5) * 5;
      var dest = strips[di];
      jobs.push({ dest: di, cargo: CARGO[Math.floor(rng() * CARGO.length)], cargoKg: kg, pay: computePay(dest, kg), ridge: Math.round(G.world.maxHeightBetween(0, dest.x)) });
    }
    return jobs;
  }
  function maxFuelAffordable(spec) { return clamp(Math.floor(G.save.cash / FUEL_PRICE), 10, spec.tankCap); }

  /* ---------- flight ---------- */
  function addMsg(text, secs, color) { if (G.flight) G.flight.messages.push({ text: text, t: secs, color: color }); }

  function startFlight(job) {
    var spec = currentSpec(), fuel = clamp(G.fuelSel, 5, spec.tankCap);
    var cost = Math.min(G.save.cash, Math.round(fuel * FUEL_PRICE));
    G.save.cash -= cost; persist();
    var p = Physics.createState(spec, -290, G.world, fuel, job.cargoKg);
    G.flight = { world: G.world, spec: spec, p: p, job: job, dest: World.STRIPS[job.dest], throttle: false,
      cam: { x: p.x + 90, y: p.y + 40, scale: 4 }, particles: [], t: 0, status: 'flying', endTimer: 0, touchdown: null,
      messages: [], maxAlt: p.y, fuelCost: cost, startFuel: fuel, crashReason: '' };
    addMsg('Cleared for takeoff. SPACE = full throttle, hold UP to rotate at about 70 km/h.', 7);
    G.state = 'flying'; G.paused = false;
  }

  function spawnCrash(f) {
    var p = f.p;
    for (var i = 0; i < 70; i++) {
      var a = Math.random() * Math.PI, sp = 4 + Math.random() * 18, fire = Math.random() < 0.35;
      f.particles.push({ x: p.x + (Math.random() - 0.5) * 4, y: p.y + (Math.random() - 0.5) * 2, vx: Math.cos(a) * sp + p.vx * 0.3, vy: Math.sin(a) * sp + 4,
        r: fire ? 0.6 + Math.random() * 1.2 : 0.3 + Math.random() * 0.6, life: 1.5 + Math.random() * 2.5, maxLife: 3,
        color: fire ? (Math.random() < 0.5 ? '#ff8c1a' : '#ffcf3a') : (Math.random() < 0.5 ? '#555' : f.spec.colors.body), smoke: !fire && Math.random() < 0.6 });
    }
  }
  function updateParticles(f, dt) {
    var w = f.world;
    for (var i = f.particles.length - 1; i >= 0; i--) {
      var q = f.particles[i];
      q.life -= dt;
      if (q.life <= 0) { f.particles.splice(i, 1); continue; }
      if (q.smoke) { q.vy += 3 * dt; q.vx *= 0.98; q.r += 0.8 * dt; }
      else { q.vy -= 9.81 * dt; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      var gy = w.heightAt(q.x);
      if (q.y < gy + 0.2) { q.y = gy + 0.2; q.vy = Math.abs(q.vy) * 0.3; q.vx *= 0.7; }
    }
  }

  function updateCamera(f, dt) {
    var p = f.p, cam = f.cam, agl = p.y - f.world.heightAt(p.x);
    var targetScale = 4.2 - 1.9 * clamp((agl - 40) / 700, 0, 1);
    if (H < 620) targetScale *= 0.8;
    cam.scale += (targetScale - cam.scale) * Math.min(1, 1.5 * dt);
    cam.x = p.x + 0.2 * W / cam.scale;
    var ty = p.y + (0.25 - 0.2 * clamp(agl / 200, 0, 1)) * H / cam.scale;
    cam.y += (ty - cam.y) * Math.min(1, 3 * dt);
  }

  function updateFlight(dt) {
    var f = G.flight, p = f.p;
    if (f.status !== 'flying') {
      f.endTimer += dt; updateParticles(f, dt * TIME_SCALE);
      if (f.endTimer > (f.status === 'crashed' ? 2.6 : 1.4)) finishFlight();
      return;
    }
    var raw = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    var elev = G.save.invert ? -raw : raw;
    var sim = dt * TIME_SCALE, steps = Math.ceil(sim / 0.02), h = sim / steps;
    for (var i = 0; i < steps; i++) {
      var ev = Physics.step(p, f.spec, { elevator: elev, throttle: f.throttle }, f.world, h);
      if (ev.fuelOut) { f.throttle = false; addMsg('ENGINE OUT - fuel exhausted. Glide and find somewhere flat.', 6, '#ff6b57'); Sound.fuelOut(); }
      if (ev.tookOff) addMsg('Airborne. Ease off the stick and climb at about 90 km/h.', 4);
      if (ev.landed && !ev.landed.minor) {
        f.touchdown = ev.landed;
        var q = ev.landed.vs;
        addMsg(q < 1 ? 'Greaser!' : q > f.spec.maxLandVs * 0.7 ? 'Hard landing!' : 'Touchdown.', 3, q < 1 ? '#7CFC9A' : q > f.spec.maxLandVs * 0.7 ? '#ffb347' : '#ffffff');
        Sound.touchdown(q);
      }
      if (ev.crash) { f.status = 'crashed'; f.crashReason = ev.crash; spawnCrash(f); Sound.crash(); Sound.silence(); break; }
    }
    f.t += sim;
    f.maxAlt = Math.max(f.maxAlt, p.y);
    if (f.status === 'flying' && p.onGround && p.v < 0.3 && p.t > 2) {
      var strip = f.world.stripAt(p.x, 60);
      if (strip === f.dest) { f.status = 'delivered'; f.endTimer = 0; Sound.silence(); }
      else if (p.fuel <= 0) { f.status = 'stranded'; f.endTimer = 0; Sound.silence(); }
    }
    updateCamera(f, dt); updateParticles(f, sim);
    for (var m = f.messages.length - 1; m >= 0; m--) { f.messages[m].t -= dt; if (f.messages[m].t <= 0) f.messages.splice(m, 1); }
    var stallV = Physics.stallSpeed(f.spec, p.mass, p.y);
    Sound.update(dt, { running: p.fuel > 0 && !p.crashed, throttle: f.throttle && p.fuel > 0, speed: p.v,
      stallWarn: !p.onGround && !p.crashed && (p.alpha > f.spec.alphaStall - 1.5 * DEG || (p.v < stallV * 1.08 && p.v > 3)) });
  }

  function finishFlight() {
    var f = G.flight, s = G.save, r = { title: '', lines: [], color: '#ffd56a' };
    s.stats.flights++;
    var used = (f.startFuel - f.p.fuel).toFixed(1);
    if (f.status === 'delivered') {
      var td = f.touchdown ? f.touchdown.vs : 0, factor = 1, note = 'Clean landing.';
      if (td < 1.0) { factor = 1.1; note = 'Greaser landing bonus +10%.'; }
      else if (td > f.spec.maxLandVs * 0.7) { factor = 0.8; note = 'Hard landing - cargo damaged, -20%.'; }
      var earned = Math.round(f.job.pay * factor);
      s.cash += earned; s.stats.delivered++; s.stats.earned += earned;
      r.title = 'CARGO DELIVERED'; r.color = '#7CFC9A';
      r.lines = [f.job.cargoKg + ' kg of ' + f.job.cargo.toLowerCase() + ' delivered to ' + f.dest.name + '.',
        'Touchdown ' + td.toFixed(1) + ' m/s. ' + note,
        'Fuel used ' + used + ' L (' + money(f.fuelCost) + ' paid). Max altitude ' + Math.round(f.maxAlt) + ' m.',
        'Payment: ' + money(earned)];
      Sound.cash();
    } else if (f.status === 'crashed') {
      var cost = Math.min(s.cash, repairCost()); s.cash -= cost; s.stats.crashes++;
      r.title = 'CRASHED'; r.color = '#ff6b57';
      r.lines = [f.crashReason + '.', 'The cargo is scattered across the tundra. You are flown back to base.', 'Repairs: ' + money(cost) + '.'];
    } else if (f.status === 'stranded') {
      var fee = Math.min(s.cash, RECOVERY_FEE); s.cash -= fee;
      r.title = 'STRANDED'; r.color = '#ffb347';
      r.lines = ['Out of fuel and stopped off the destination strip.', 'A friend flies out with a jerry can and tows you home.', 'Recovery fee: ' + money(fee) + '. Mission failed.'];
    } else {
      var fee2 = Math.min(s.cash, RECOVERY_FEE); s.cash -= fee2;
      r.title = 'MISSION ABANDONED'; r.color = '#ffb347';
      r.lines = ['You gave up on the delivery.', 'Recovery fee: ' + money(fee2) + '.'];
    }
    r.lines.push('Cash: ' + money(s.cash));
    s.jobSeed++; persist();
    G.result = r; G.state = 'result';
  }

  /* ---------- menus ---------- */
  function hangarItems() {
    return [
      { label: 'Job board', detail: G.jobs.length + ' jobs posted' },
      { label: 'Upgrade shop', detail: currentPlane().name },
      { label: 'Aircraft dealer', detail: G.save.owned.length + ' owned' },
      { label: 'Pitch control: UP arrow = nose ' + (G.save.invert ? 'DOWN' : 'UP'), detail: 'toggle' },
      { label: 'Sound: ' + (G.save.muted ? 'off' : 'on'), detail: 'toggle' },
      { label: G.confirmReset ? 'Reset progress - press ENTER again to confirm' : 'Reset progress', detail: '' }
    ];
  }
  function upgradeItems() {
    var lv = levelsFor(G.save.planeId);
    return Physics.UPGRADES.map(function (u) {
      var l = lv[u.id] || 0, maxed = l >= u.maxLevel, price = maxed ? 0 : u.price[l];
      return { label: u.name + '  [' + l + '/' + u.maxLevel + ']', detail: maxed ? 'MAX' : money(price), disabled: !maxed && price > G.save.cash, u: u, level: l, price: price, maxed: maxed };
    });
  }
  function dealerItems() {
    return Physics.PLANES.map(function (pl) {
      var owned = G.save.owned.indexOf(pl.id) >= 0, cur = pl.id === G.save.planeId;
      return { label: pl.name, detail: cur ? 'FLYING' : owned ? 'owned' : money(pl.price), disabled: !owned && pl.price > G.save.cash, plane: pl, owned: owned, cur: cur };
    });
  }

  function onKey(key) {
    var st = G.state;
    if (key === 'm' || key === 'M') { G.save.muted = Sound.toggleMute(); persist(); return; }
    if (st === 'title') { if (key === 'Enter' || key === ' ') { G.state = 'hangar'; G.sel = 0; Sound.select(); } return; }
    if (st === 'flying') {
      if (G.paused) {
        if (key === 'ArrowUp' || key === 'ArrowDown') { G.pauseSel = 1 - G.pauseSel; Sound.ui(); }
        else if (key === 'Enter') { if (G.pauseSel === 0) G.paused = false; else { G.flight.status = 'abandoned'; G.paused = false; Sound.silence(); finishFlight(); } }
        else if (key === 'Escape') G.paused = false;
        return;
      }
      if (G.flight.status !== 'flying') return;
      if (key === ' ' || key === 't' || key === 'T') { if (G.flight.p.fuel > 0) { G.flight.throttle = !G.flight.throttle; } }
      else if (key === 'Escape') { G.paused = true; G.pauseSel = 0; Sound.silence(); }
      return;
    }
    if (st === 'result') { if (key === 'Enter' || key === ' ' || key === 'Escape') { G.jobs = generateJobs(); G.scene = makeParkedScene(); G.state = 'hangar'; G.sel = 0; Sound.select(); } return; }

    // list navigation shared by menu screens
    var items = st === 'hangar' ? hangarItems() : st === 'jobs' ? G.jobs : st === 'upgrades' ? upgradeItems() : st === 'dealer' ? dealerItems() : null;
    if (items && (key === 'ArrowUp' || key === 'ArrowDown')) {
      G.sel = (G.sel + (key === 'ArrowUp' ? -1 : 1) + items.length) % items.length; G.confirmReset = false; Sound.ui(); return;
    }
    if (st === 'hangar') {
      if (key === 'Enter') {
        Sound.select();
        switch (G.sel) {
          case 0: G.state = 'jobs'; G.sel = 0; break;
          case 1: G.state = 'upgrades'; G.sel = 0; break;
          case 2: G.state = 'dealer'; G.sel = Physics.PLANES.indexOf(currentPlane()); break;
          case 3: G.save.invert = !G.save.invert; persist(); break;
          case 4: G.save.muted = !G.save.muted; Sound.setMuted(G.save.muted); persist(); break;
          case 5: if (G.confirmReset) { G.save = defaultSave(); persist(); G.jobs = generateJobs(); G.scene = makeParkedScene(); G.confirmReset = false; } else G.confirmReset = true; break;
        }
      } else if (key === 'Escape') { G.state = 'title'; G.confirmReset = false; }
      else G.confirmReset = false;
      return;
    }
    if (st === 'jobs') {
      if (key === 'Enter') { var job = G.jobs[G.sel]; G.fuelSel = Math.min(estimateFuel(World.STRIPS[job.dest], currentSpec()), maxFuelAffordable(currentSpec())); G.state = 'briefing'; Sound.select(); }
      else if (key === 'Escape') { G.state = 'hangar'; G.sel = 0; }
      return;
    }
    if (st === 'briefing') {
      var spec = currentSpec(), maxF = maxFuelAffordable(spec);
      if (key === 'ArrowLeft') { G.fuelSel = clamp(G.fuelSel - 5, 5, maxF); Sound.ui(); }
      else if (key === 'ArrowRight') { G.fuelSel = clamp(G.fuelSel + 5, 5, maxF); Sound.ui(); }
      else if (key === 'Enter') { Sound.select(); startFlight(G.jobs[G.sel]); }
      else if (key === 'Escape') G.state = 'jobs';
      return;
    }
    if (st === 'upgrades') {
      if (key === 'Enter') {
        var it = upgradeItems()[G.sel];
        if (!it.maxed && it.price <= G.save.cash) {
          G.save.cash -= it.price;
          if (!G.save.upgrades[G.save.planeId]) G.save.upgrades[G.save.planeId] = {};
          G.save.upgrades[G.save.planeId][it.u.id] = it.level + 1;
          persist(); G.scene = makeParkedScene(); Sound.cash();
        }
      } else if (key === 'Escape') { G.state = 'hangar'; G.sel = 1; }
      return;
    }
    if (st === 'dealer') {
      if (key === 'Enter') {
        var d = dealerItems()[G.sel];
        if (d.owned) { G.save.planeId = d.plane.id; persist(); G.jobs = generateJobs(); G.scene = makeParkedScene(); Sound.select(); }
        else if (d.plane.price <= G.save.cash) { G.save.cash -= d.plane.price; G.save.owned.push(d.plane.id); G.save.planeId = d.plane.id; persist(); G.jobs = generateJobs(); G.scene = makeParkedScene(); Sound.cash(); }
      } else if (key === 'Escape') { G.state = 'hangar'; G.sel = 2; }
      return;
    }
  }

  /* ---------- drawing ---------- */
  function header() {
    var s = G.save;
    Render.panel(ctx, 12, 12, W - 24, 46);
    Render.text(ctx, 'RAVEN CREEK AIR SERVICE', 28, 42, { font: 'bold 18px ' + FONT, color: '#ffd56a' });
    Render.text(ctx, 'Cash ' + money(s.cash) + '    Aircraft: ' + currentPlane().name + '    Delivered ' + s.stats.delivered + '   Crashes ' + s.stats.crashes, W - 28, 42, { align: 'right' });
  }
  function footer(t) { Render.text(ctx, t, W / 2, H - 22, { align: 'center', color: 'rgba(255,255,255,0.7)', font: '13px ' + FONT }); }

  function drawTitle() {
    var pw = 760, px = W / 2 - pw / 2, py = H * 0.12;
    Render.panel(ctx, px, py, pw, 420);
    Render.text(ctx, 'BUSH PILOT', W / 2, py + 70, { font: 'bold 56px ' + FONT, color: '#ffd56a', align: 'center' });
    Render.text(ctx, 'Raven Creek Air Service - freight over the Alaska and Yukon ranges', W / 2, py + 105, { align: 'center', color: '#c8d4e0' });
    var y = py + 160, lines = [
      ['UP / DOWN', 'elevator (nose up / nose down)'],
      ['SPACE', 'throttle on / off - that is all the engine control you get'],
      ['ENTER / ESC', 'select / back, pause in flight'],
      ['M', 'sound on / off']];
    for (var i = 0; i < lines.length; i++) {
      Render.text(ctx, lines[i][0], W / 2 - 60, y, { align: 'right', font: 'bold 16px ' + FONT, color: '#ffffff' });
      Render.text(ctx, lines[i][1], W / 2 - 40, y, { color: '#c8d4e0' }); y += 28;
    }
    y += 10;
    var tips = Render.wrap(ctx, 'Haul cargo from the base to bush strips eastward. Cargo and fuel both add weight: heavy planes take off late, climb slowly and stall faster. Air thins with altitude, so the high passes are hard to clear. Deliver and land in one piece to earn cash for upgrades and bigger aircraft.', pw - 80);
    for (i = 0; i < tips.length; i++) { Render.text(ctx, tips[i], W / 2, y, { align: 'center', color: '#aab8c6', font: '14px ' + FONT }); y += 20; }
    if (Math.floor(G.time * 2) % 2 === 0) Render.text(ctx, 'Press ENTER', W / 2, py + 395, { align: 'center', font: 'bold 20px ' + FONT, color: '#ffffff' });
  }

  function drawHangar() {
    header();
    var px = 40, py = 80;
    Render.panel(ctx, px, py, 560, 290, 'HANGAR');
    Render.menu(ctx, px + 10, py + 72, 540, hangarItems(), G.sel);
    var spec = currentSpec(), m0 = spec.emptyMass + spec.pilotMass;
    var sx = W - 40 - 440, sy = 80;
    Render.panel(ctx, sx, sy, 440, 290, spec.name.toUpperCase());
    var info = [
      ['Empty weight', spec.emptyMass + ' kg (+ ' + spec.pilotMass + ' kg pilot)'],
      ['Engine', Math.round(spec.power / 746) + ' hp'],
      ['Fuel tank', spec.tankCap + ' L (' + Math.round(spec.tankCap * Physics.FUEL_DENSITY) + ' kg full)'],
      ['Stall speed', Math.round(Physics.stallSpeed(spec, m0 + 20, 0) * 3.6) + ' km/h empty, ' + Math.round(Physics.stallSpeed(spec, m0 + spec.maxPayload + spec.tankCap * 0.72, 0) * 3.6) + ' km/h loaded'],
      ['Gear limit', spec.maxLandVs.toFixed(1) + ' m/s touchdown'],
      ['Comfortable payload', spec.maxPayload + ' kg']];
    for (var i = 0; i < info.length; i++) { Render.text(ctx, info[i][0], sx + 20, sy + 70 + i * 30, { color: '#9fb3c8' }); Render.text(ctx, info[i][1], sx + 190, sy + 70 + i * 30); }
    footer('UP/DOWN choose   ENTER select   ESC title');
  }

  function drawJobs() {
    header();
    var px = 40, py = 80, pw = W - 80;
    Render.panel(ctx, px, py, pw, 110 + G.jobs.length * 62, 'JOB BOARD - all flights depart Raven Creek Base');
    var spec = currentSpec();
    for (var i = 0; i < G.jobs.length; i++) {
      var j = G.jobs[i], d = World.STRIPS[j.dest], y = py + 70 + i * 62, sel = i === G.sel;
      Render.roundRect(ctx, px + 14, y - 8, pw - 28, 54, 6);
      ctx.fillStyle = sel ? 'rgba(255,213,106,0.16)' : 'rgba(255,255,255,0.04)'; ctx.fill();
      if (sel) { ctx.strokeStyle = '#ffd56a'; ctx.stroke(); }
      var heavy = j.cargoKg > spec.maxPayload;
      Render.text(ctx, j.cargo + ' to ' + d.name, px + 30, y + 14, { font: 'bold 17px ' + FONT, color: sel ? '#ffffff' : '#d8e0e8' });
      Render.text(ctx, (d.x / 1000).toFixed(1) + ' km east   strip ' + d.len + ' m at ' + d.elev + ' m   highest terrain ' + j.ridge + ' m   ' + (d.note || ''), px + 30, y + 36, { font: '13px ' + FONT, color: '#9fb3c8' });
      Render.text(ctx, j.cargoKg + ' kg' + (heavy ? '  HEAVY for this plane' : ''), px + pw - 200, y + 14, { align: 'right', font: 'bold 15px ' + FONT, color: heavy ? '#ffb347' : '#d8e0e8' });
      Render.text(ctx, money(j.pay), px + pw - 30, y + 14, { align: 'right', font: 'bold 18px ' + FONT, color: '#7CFC9A' });
    }
    footer('UP/DOWN choose   ENTER take job   ESC back');
  }

  function drawBriefing() {
    header();
    var j = G.jobs[G.sel], d = World.STRIPS[j.dest], spec = currentSpec();
    var pw = 760, px = W / 2 - pw / 2, py = 80;
    Render.panel(ctx, px, py, pw, 440, 'BRIEFING - ' + j.cargo + ' to ' + d.name);
    var fuel = G.fuelSel, fuelKg = fuel * Physics.FUEL_DENSITY, tom = spec.emptyMass + spec.pilotMass + fuelKg + j.cargoKg;
    var est = estimateFuel(d, spec), cost = Math.min(G.save.cash, Math.round(fuel * FUEL_PRICE));
    var y = py + 72;
    function row(a, b, c) { Render.text(ctx, a, px + 24, y, { color: '#9fb3c8' }); Render.text(ctx, b, px + 250, y, { color: c || '#ffffff', font: 'bold 15px ' + FONT }); y += 28; }
    row('Destination', d.name + ', ' + (d.x / 1000).toFixed(1) + ' km east, strip ' + d.len + ' m at ' + d.elev + ' m');
    row('Highest terrain en route', j.ridge + ' m  (you must fly above this)', j.ridge > 1200 ? '#ffb347' : '#ffffff');
    row('Cargo', j.cargoKg + ' kg  ' + j.cargo.toLowerCase());
    row('Payment on delivery', money(j.pay), '#7CFC9A');
    y += 10;
    Render.text(ctx, 'FUEL LOAD   < LEFT / RIGHT >', px + 24, y, { font: 'bold 16px ' + FONT, color: '#ffd56a' }); y += 30;
    var bw = pw - 48;
    ctx.fillStyle = '#243040'; ctx.fillRect(px + 24, y - 16, bw, 20);
    ctx.fillStyle = '#5bb8ff'; ctx.fillRect(px + 24, y - 16, bw * fuel / spec.tankCap, 20);
    var ex = px + 24 + bw * Math.min(1, est / spec.tankCap);
    ctx.fillStyle = '#ffd56a'; ctx.fillRect(ex - 1, y - 22, 2, 32);
    Render.text(ctx, 'suggested ' + est + ' L', ex, y - 26, { align: ex > px + pw - 120 ? 'right' : 'left', font: '12px ' + FONT, color: '#ffd56a' });
    y += 30;
    row('Fuel', fuel + ' L of ' + spec.tankCap + ' L  =  ' + Math.round(fuelKg) + ' kg,  costs ' + money(cost), fuel < est ? '#ffb347' : '#ffffff');
    row('Takeoff weight', Math.round(tom) + ' kg  (empty ' + spec.emptyMass + ' + pilot ' + spec.pilotMass + ' + fuel ' + Math.round(fuelKg) + ' + cargo ' + j.cargoKg + ')',
      j.cargoKg + fuelKg > spec.maxPayload + spec.tankCap * 0.72 * 0.5 ? '#ffb347' : '#ffffff');
    row('Stall speed at this weight', Math.round(Physics.stallSpeed(spec, tom, 0) * 3.6) + ' km/h at sea level, ' + Math.round(Physics.stallSpeed(spec, tom, j.ridge) * 3.6) + ' km/h at ' + j.ridge + ' m');
    row('Endurance at full throttle', Math.round(fuel / spec.burnRate / 60) + ' min  (about ' + Math.round(fuel / spec.burnRate * spec.vref * 1.1 / 1000) + ' km, less when climbing)');
    y += 6;
    var tips = Render.wrap(ctx, 'Remember: you cannot turn around. Land on the gravel and come to a full stop. Touchdown harder than ' + spec.maxLandVs.toFixed(1) + ' m/s or faster than ' + Math.round(spec.maxLandSpeed * 3.6) + ' km/h wrecks the plane. Throttle off applies the brakes.', pw - 48, '13px ' + FONT);
    for (var i = 0; i < tips.length; i++) { Render.text(ctx, tips[i], px + 24, y, { font: '13px ' + FONT, color: '#aab8c6' }); y += 18; }
    footer('LEFT/RIGHT fuel   ENTER start engine   ESC back');
  }

  function drawUpgrades() {
    header();
    var px = 40, py = 80, items = upgradeItems();
    Render.panel(ctx, px, py, 620, 110 + items.length * 34, 'UPGRADE SHOP - ' + currentPlane().name);
    Render.menu(ctx, px + 10, py + 72, 600, items, G.sel);
    var u = items[G.sel].u, sx = W - 40 - 520, sy = 80;
    Render.panel(ctx, sx, sy, 520, 300, u.name.toUpperCase());
    var lines = Render.wrap(ctx, u.desc, 480), y = sy + 70;
    for (var i = 0; i < lines.length; i++) { Render.text(ctx, lines[i], sx + 20, y); y += 22; }
    y += 10;
    var cur = currentSpec(), lv = Object.assign({}, levelsFor(G.save.planeId)); lv[u.id] = Math.min(u.maxLevel, (lv[u.id] || 0) + 1);
    var nxt = Physics.buildSpec(currentPlane(), lv), m0 = cur.emptyMass + cur.pilotMass + 60;
    function cmp(label, a, b, unit) { Render.text(ctx, label, sx + 20, y, { color: '#9fb3c8' }); Render.text(ctx, a + unit, sx + 240, y); Render.text(ctx, '->  ' + b + unit, sx + 340, y, { color: a === b ? '#8a949e' : '#7CFC9A' }); y += 26; }
    Render.text(ctx, 'Next level effect', sx + 20, y, { font: 'bold 15px ' + FONT, color: '#ffd56a' }); y += 28;
    cmp('Power', Math.round(cur.power * cur.propEff / 1000), Math.round(nxt.power * nxt.propEff / 1000), ' kW to prop');
    cmp('Stall speed', Math.round(Physics.stallSpeed(cur, m0, 0) * 3.6), Math.round(Physics.stallSpeed(nxt, nxt.emptyMass + nxt.pilotMass + 60, 0) * 3.6), ' km/h');
    cmp('Fuel capacity', cur.tankCap, nxt.tankCap, ' L');
    cmp('Empty weight', cur.emptyMass, nxt.emptyMass, ' kg');
    cmp('Gear limit', cur.maxLandVs.toFixed(1), nxt.maxLandVs.toFixed(1), ' m/s');
    footer('UP/DOWN choose   ENTER buy   ESC back');
  }

  function drawDealer() {
    header();
    var px = 40, py = 80, items = dealerItems();
    Render.panel(ctx, px, py, 560, 110 + items.length * 34, 'AIRCRAFT DEALER');
    Render.menu(ctx, px + 10, py + 72, 540, items, G.sel);
    var pl = items[G.sel].plane, spec = Physics.buildSpec(pl, levelsFor(pl.id)), sx = W - 40 - 560, sy = 80;
    Render.panel(ctx, sx, sy, 560, 340, pl.name.toUpperCase());
    var y = sy + 66, lines = Render.wrap(ctx, pl.blurb, 520);
    for (var i = 0; i < lines.length; i++) { Render.text(ctx, lines[i], sx + 20, y, { color: '#c8d4e0' }); y += 22; }
    y += 8;
    var m0 = spec.emptyMass + spec.pilotMass;
    var info = [['Engine', Math.round(spec.power / 746) + ' hp'], ['Empty weight', spec.emptyMass + ' kg'], ['Comfortable payload', spec.maxPayload + ' kg'],
      ['Fuel tank', spec.tankCap + ' L'], ['Stall speed', Math.round(Physics.stallSpeed(spec, m0 + 20, 0) * 3.6) + ' - ' + Math.round(Physics.stallSpeed(spec, m0 + spec.maxPayload + spec.tankCap * 0.72, 0) * 3.6) + ' km/h'],
      ['Gear limit', spec.maxLandVs.toFixed(1) + ' m/s'], ['Price', pl.price ? money(pl.price) : 'yours']];
    for (i = 0; i < info.length; i++) { Render.text(ctx, info[i][0], sx + 20, y, { color: '#9fb3c8' }); Render.text(ctx, info[i][1], sx + 230, y); y += 26; }
    // preview sprite
    var fake = { pitch: 0, elev: 0, prop: 0 };
    Render.drawPlane(ctx, spec, fake, 9, sx + 400, sy + 300, false);
    footer('UP/DOWN choose   ENTER buy / fly this aircraft   ESC back');
  }

  function drawResult() {
    var r = G.result, pw = 760, px = W / 2 - pw / 2, py = H * 0.2;
    Render.panel(ctx, px, py, pw, 120 + r.lines.length * 28);
    Render.text(ctx, r.title, W / 2, py + 48, { font: 'bold 34px ' + FONT, color: r.color, align: 'center' });
    for (var i = 0; i < r.lines.length; i++) Render.text(ctx, r.lines[i], W / 2, py + 95 + i * 28, { align: 'center', font: (i === r.lines.length - 1 ? 'bold ' : '') + '16px ' + FONT });
    Render.text(ctx, 'ENTER to return to base', W / 2, py + 105 + r.lines.length * 28, { align: 'center', color: '#ffd56a' });
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    var pw = 420, px = W / 2 - pw / 2, py = H / 2 - 90;
    Render.panel(ctx, px, py, pw, 180, 'PAUSED');
    Render.menu(ctx, px + 10, py + 80, pw - 20, [{ label: 'Resume flight' }, { label: 'Abandon mission', detail: money(RECOVERY_FEE) + ' recovery' }], G.pauseSel);
  }

  /* ---------- main loop ---------- */
  function update(dt) {
    G.time += dt;
    if (G.state === 'flying' && !G.paused) updateFlight(dt);
  }
  function draw() {
    var scene = (G.state === 'flying' || G.state === 'result') && G.flight ? G.flight : G.scene;
    Render.drawScene(ctx, W, H, scene, G.time);
    switch (G.state) {
      case 'title': drawTitle(); break;
      case 'hangar': drawHangar(); break;
      case 'jobs': drawJobs(); break;
      case 'briefing': drawBriefing(); break;
      case 'upgrades': drawUpgrades(); break;
      case 'dealer': drawDealer(); break;
      case 'flying': Render.drawHUD(ctx, W, H, G.flight, G.time); if (G.paused) drawPause(); break;
      case 'result': drawResult(); break;
    }
  }
  function frame(now) {
    var dt = Math.min(0.1, (now - G.last) / 1000 || 0); G.last = now;
    update(dt); draw();
    window.requestAnimationFrame(frame);
  }
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }

  function boot(cv) {
    canvas = cv; ctx = canvas.getContext('2d');
    resize(); window.addEventListener('resize', resize);
    G.save = loadSave(); G.world = World.makeWorld(1); G.jobs = generateJobs(); G.scene = makeParkedScene();
    Sound.setMuted(G.save.muted);
    window.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ' || k === 'Enter' || k === 'Escape') e.preventDefault();
      Sound.init();
      if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = true;
      if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = true;
      if (e.repeat) return;
      if (k === 'w' || k === 'W') k = 'ArrowUp'; if (k === 's' || k === 'S') k = 'ArrowDown';
      if (k === 'a' || k === 'A') k = 'ArrowLeft'; if (k === 'd' || k === 'D') k = 'ArrowRight';
      onKey(k);
    });
    window.addEventListener('keyup', function (e) {
      var k = e.key;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = false;
      if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = false;
    });
    window.addEventListener('blur', function () { keys.up = keys.down = false; });
    window.requestAnimationFrame(frame);
  }

  return { boot: boot, G: G, onKey: onKey, update: update, draw: draw, keys: keys, startFlight: startFlight, generateJobs: generateJobs, finishFlight: finishFlight };
})();
if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('game')) BushPilot.boot(document.getElementById('game'));
if (typeof module !== 'undefined') module.exports = BushPilot;
