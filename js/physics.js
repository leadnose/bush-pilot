/* Bush Pilot - 2D flight model.
 * Units: metres, seconds, kilograms, radians. +x is east (right), +y is up.
 * Loadable from the browser (global `Physics`) and from node (module.exports).
 */
var Physics = (function () {
  'use strict';
  var DEG = Math.PI / 180;
  var G = 9.81;
  var RHO0 = 1.225;          // sea-level air density
  var SCALE_H = 5000;        // exaggerated density scale height, so altitude bites
  var FUEL_DENSITY = 0.72;   // kg per litre of avgas
  var KSTAB = 6.0;           // pitch stability (rad/s^2 per rad of alpha error at vref)
  var KDAMP = 3.5;           // pitch damping
  var KPATH = 1.6;           // flight-path feedback: damps the phugoid, keeps hands-off flight near level

  var PLANES = [
    {
      id: 'j3cub', name: 'Piper J-3 Cub', price: 0,
      blurb: 'The classic. 65 hp, slow and forgiving, tiny payload.',
      emptyMass: 345, pilotMass: 80, wingArea: 16.6, power: 48000, propEff: 0.70,
      cd0: 0.050, kInduced: 0.060, cl0: 0.30, clAlpha: 5.0, alphaStall: 14 * DEG,
      alphaTrim: 3 * DEG, alphaRange: 9 * DEG, alphaRangeDown: 8 * DEG,
      tankCap: 45, burnRate: 0.025, maxLandVs: 3.2, maxLandSpeed: 38, vref: 25,
      length: 6.8, gearHeight: 1.5, maxPayload: 100,
      colors: { body: '#f0c020', trim: '#1a1a1a', glass: '#a8d8ea' }
    },
    {
      id: 'pa18', name: 'Piper PA-18 Super Cub', price: 7500,
      blurb: '150 hp bush legend. Climbs hard, carries three times the load.',
      emptyMass: 430, pilotMass: 80, wingArea: 16.6, power: 112000, propEff: 0.72,
      cd0: 0.048, kInduced: 0.060, cl0: 0.38, clAlpha: 5.0, alphaStall: 15 * DEG,
      alphaTrim: 3 * DEG, alphaRange: 10 * DEG, alphaRangeDown: 8 * DEG,
      tankCap: 136, burnRate: 0.045, maxLandVs: 3.6, maxLandSpeed: 45, vref: 27,
      length: 6.9, gearHeight: 1.6, maxPayload: 280,
      colors: { body: '#e6e6dc', trim: '#c0281e', glass: '#a8d8ea' }
    },
    {
      id: 'beaver', name: 'de Havilland DHC-2 Beaver', price: 32000,
      blurb: '450 hp radial. The workhorse of the North. Hauls anything.',
      emptyMass: 1360, pilotMass: 80, wingArea: 23.2, power: 336000, propEff: 0.74,
      cd0: 0.046, kInduced: 0.055, cl0: 0.42, clAlpha: 5.2, alphaStall: 15 * DEG,
      alphaTrim: 3 * DEG, alphaRange: 10 * DEG, alphaRangeDown: 8 * DEG,
      tankCap: 360, burnRate: 0.11, maxLandVs: 4.2, maxLandSpeed: 55, vref: 35,
      length: 9.2, gearHeight: 2.0, maxPayload: 850,
      colors: { body: '#e8a820', trim: '#1e3c78', glass: '#a8d8ea' }
    }
  ];

  var UPGRADES = [
    { id: 'engine', name: 'Engine tune', desc: '+12% power per level', maxLevel: 3, price: [900, 1800, 3400],
      apply: function (s, l) { s.power *= 1 + 0.12 * l; } },
    { id: 'prop', name: 'Climb propeller', desc: '+6% thrust efficiency per level', maxLevel: 2, price: [700, 1500],
      apply: function (s, l) { s.propEff *= 1 + 0.06 * l; } },
    { id: 'stol', name: 'STOL kit', desc: 'Flaps, vortex generators, big tires: more lift, lower stall speed', maxLevel: 2, price: [1200, 2600],
      apply: function (s, l) { s.cl0 += 0.10 * l; s.alphaStall += 1 * DEG * l; s.cd0 += 0.003 * l; } },
    { id: 'gear', name: 'Heavy-duty gear', desc: 'Survive harder touchdowns (+0.8 m/s per level)', maxLevel: 2, price: [800, 1600],
      apply: function (s, l) { s.maxLandVs += 0.8 * l; } },
    { id: 'tank', name: 'Long-range tanks', desc: '+30% fuel capacity per level (fuel has weight!)', maxLevel: 2, price: [600, 1200],
      apply: function (s, l) { s.tankCap = Math.round(s.tankCap * (1 + 0.3 * l)); } },
    { id: 'light', name: 'Lightweight build', desc: '-5% empty weight per level', maxLevel: 2, price: [1500, 3000],
      apply: function (s, l) { s.emptyMass = Math.round(s.emptyMass * (1 - 0.05 * l)); } }
  ];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrapAngle(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; }

  function buildSpec(plane, levels) {
    var s = JSON.parse(JSON.stringify(plane));
    levels = levels || {};
    UPGRADES.forEach(function (u) { var l = levels[u.id] || 0; if (l > 0) u.apply(s, Math.min(l, u.maxLevel)); });
    return s;
  }

  function mass(s, spec) { return spec.emptyMass + spec.pilotMass + s.fuel * FUEL_DENSITY + s.cargo; }
  function clMax(spec) { return spec.cl0 + spec.clAlpha * spec.alphaStall; }
  function stallSpeed(spec, m, altitude) {
    var rho = RHO0 * Math.exp(-Math.max(0, altitude || 0) / SCALE_H);
    return Math.sqrt(2 * m * G / (rho * spec.wingArea * clMax(spec)));
  }

  function liftCoef(a, spec) {
    var as = spec.alphaStall, asn = -as * 0.75;
    if (a <= as && a >= asn) return spec.cl0 + spec.clAlpha * a;
    if (a > as) {
      var cm = spec.cl0 + spec.clAlpha * as, over = a - as;
      if (over < 15 * DEG) return cm * (1 - 0.5 * over / (15 * DEG));
      return cm * 0.5 * Math.max(0, Math.cos(Math.min(1, (over - 15 * DEG) / (60 * DEG)) * Math.PI / 2));
    }
    var cmin = spec.cl0 + spec.clAlpha * asn, under = asn - a;
    if (under < 15 * DEG) return cmin * (1 - 0.5 * under / (15 * DEG));
    return cmin * 0.5 * Math.max(0, Math.cos(Math.min(1, (under - 15 * DEG) / (60 * DEG)) * Math.PI / 2));
  }

  function dragCoef(a, cl, spec) {
    var cd = spec.cd0 + spec.kInduced * cl * cl;
    var over = Math.max(0, a - spec.alphaStall, -spec.alphaStall * 0.75 - a);
    if (over > 0) { var so = Math.sin(Math.min(over, Math.PI / 2)); cd += 0.03 + 1.2 * so * so; }
    return cd;
  }

  function createState(spec, x, terrain, fuel, cargo) {
    return {
      x: x, y: terrain.heightAt(x) + spec.gearHeight, vx: 0, vy: 0,
      pitch: 10.5 * DEG, omega: 0, elev: 0, throttle: false,
      fuel: fuel, cargo: cargo, onGround: true, crashed: false, airTime: 0,
      v: 0, alpha: 0, cl: 0, stalled: false, thrust: 0, lift: 0, mass: mass({ fuel: fuel, cargo: cargo }, spec), rho: RHO0, t: 0,
      prop: 0
    };
  }

  function crash(s, ev, why) { s.crashed = true; ev.crash = why; s.throttle = false; }

  /* input: { elevator: -1..1 (positive = nose up), throttle: bool } */
  function step(s, spec, input, terrain, dt) {
    var ev = {};
    if (s.crashed) return ev;
    var m = mass(s, spec);
    var rate = 6 * dt;
    s.elev += clamp((input.elevator || 0) - s.elev, -rate, rate);
    s.throttle = !!input.throttle && s.fuel > 0;
    if (s.fuel > 0) {
      s.fuel -= spec.burnRate * (s.throttle ? 1 : 0.08) * dt;
      if (s.fuel <= 0) { s.fuel = 0; s.throttle = false; ev.fuelOut = true; }
    }
    var rho = RHO0 * Math.exp(-Math.max(0, s.y) / SCALE_H);
    var v = Math.hypot(s.vx, s.vy);
    var gamma = v > 1.5 ? Math.atan2(s.vy, s.vx) : s.pitch;
    var alpha = wrapAngle(s.pitch - gamma);
    var cl = liftCoef(alpha, spec), cd = dragCoef(alpha, cl, spec);
    var q = 0.5 * rho * v * v;
    var L = q * spec.wingArea * cl, D = q * spec.wingArea * cd;
    var T = s.throttle ? spec.power * spec.propEff / Math.max(v, 20) * (rho / RHO0) : 0;
    var cp = Math.cos(s.pitch), sp = Math.sin(s.pitch), cg = Math.cos(gamma), sg = Math.sin(gamma);
    var fx = T * cp - D * cg - L * sg;
    var fy = T * sp - D * sg + L * cg - m * G;
    var qn = clamp((v / spec.vref) * (v / spec.vref), 0, 1.5);
    s.alpha = alpha; s.cl = cl; s.v = v; s.thrust = T; s.lift = L; s.mass = m; s.rho = rho;
    s.stalled = alpha > spec.alphaStall || alpha < -spec.alphaStall * 0.75;
    s.prop += (s.throttle ? 45 : (s.fuel > 0 ? 18 : Math.min(18, v * 0.5))) * dt;

    var gY = terrain.heightAt(s.x), slope = terrain.slopeAt(s.x), sa = Math.atan(slope);
    var alphaCmd = spec.alphaTrim + (s.elev > 0 ? s.elev * spec.alphaRange : s.elev * spec.alphaRangeDown);

    if (s.onGround) {
      var ca = Math.cos(sa), sna = Math.sin(sa);
      var N = fx * sna - fy * ca;            // force pressing wheels into ground
      var vt = s.vx * ca + s.vy * sna;       // speed along the ground
      if (N < -0.03 * m * G && vt > 5) {
        s.onGround = false; ev.tookOff = true; s.airTime = 0;
      } else {
        var Ft = fx * ca + fy * sna;
        var mu = 0.045 + (s.throttle ? 0 : 0.10); // pilot brakes when throttle is off
        var at = Ft / m, fdec = mu * Math.max(N, 0) / m;
        var vn = vt + at * dt;
        if (vt > 0.01) { vn -= fdec * dt; if (vn < 0) vn = 0; }
        else if (vt < -0.01) { vn += fdec * dt; if (vn > 0) vn = 0; }
        else vn = Math.abs(at) > fdec ? (at - Math.sign(at) * fdec) * dt : 0;
        vt = vn;
        s.vx = vt * ca; s.vy = vt * sna;
        s.x += s.vx * dt;
        gY = terrain.heightAt(s.x); slope = terrain.slopeAt(s.x); sa = Math.atan(slope);
        s.y = gY + spec.gearHeight;
        if (terrain.isWater(s.x)) crash(s, ev, 'Rolled into a lake');
        else if (Math.abs(sa) > 12 * DEG && Math.abs(vt) > 3) crash(s, ev, 'Ran into rough terrain');
        var minP = sa + 1.5 * DEG, maxP = sa + 12 * DEG;
        if (Math.abs(vt) < 6) {
          var rest = sa + 10.5 * DEG;
          s.pitch += (rest - s.pitch) * Math.min(1, 4 * dt); s.omega = 0;
        } else {
          var aG = s.pitch - sa;
          var acc = KSTAB * Math.max(qn, 0.1) * (alphaCmd - aG) - KDAMP * s.omega;
          s.omega += acc * dt; s.pitch += s.omega * dt;
          if (s.pitch < minP) { s.pitch = minP; s.omega = Math.max(0, s.omega); }
          if (s.pitch > maxP) { s.pitch = maxP; s.omega = Math.min(0, s.omega); }
        }
      }
    }
    if (!s.onGround && !s.crashed) {
      s.airTime += dt;
      s.vx += fx / m * dt; s.vy += fy / m * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      var acc2 = KSTAB * Math.max(qn, 0.05) * (alphaCmd - alpha) - KDAMP * s.omega - KPATH * Math.min(qn, 1) * gamma;
      if (alpha > spec.alphaStall) acc2 -= 3 * Math.max(qn, 0.1) * (alpha - spec.alphaStall) / (10 * DEG);
      var lowq = 1 - Math.min(1, qn / 0.25);
      acc2 -= lowq * 1.2 * Math.cos(s.pitch);
      s.omega += acc2 * dt; s.pitch = wrapAngle(s.pitch + s.omega * dt);

      gY = terrain.heightAt(s.x); slope = terrain.slopeAt(s.x); sa = Math.atan(slope);
      var gearY = s.y - spec.gearHeight;
      if (gearY <= gY) {
        var relVs = s.vy - s.vx * slope;
        var water = terrain.isWater(s.x);
        var rel = s.pitch - sa;
        var ok = !water && -relVs <= spec.maxLandVs && Math.abs(sa) < 8 * DEG && rel > -2 * DEG && rel < 16 * DEG && v <= spec.maxLandSpeed && s.vx > 0;
        if (ok) {
          s.onGround = true; s.y = gY + spec.gearHeight;
          var ca2 = Math.cos(sa), sna2 = Math.sin(sa), vt2 = s.vx * ca2 + s.vy * sna2;
          s.vx = vt2 * ca2; s.vy = vt2 * sna2; s.omega = 0;
          s.pitch = clamp(s.pitch, sa + 1.5 * DEG, sa + 12 * DEG);
          ev.landed = { vs: -relVs, speed: v, minor: s.airTime < 1.5 };
        } else {
          var why = water ? "Ditched in a lake"
            : Math.abs(sa) >= 8 * DEG ? "Flew into a mountainside"
            : -relVs > spec.maxLandVs ? "Hit the ground at " + (-relVs).toFixed(1) + " m/s"
            : v > spec.maxLandSpeed ? 'Touched down too fast'
            : s.vx <= 0 ? 'Fell out of the sky'
            : 'Nosed into the ground';
          crash(s, ev, why);
        }
      } else {
        var hl = spec.length * 0.5;
        var nx = s.x + Math.cos(s.pitch) * hl, ny = s.y + Math.sin(s.pitch) * hl;
        if (ny < terrain.heightAt(nx)) crash(s, ev, 'Flew into terrain');
        else {
          var tx = s.x - Math.cos(s.pitch) * hl, ty = s.y - Math.sin(s.pitch) * hl - 0.2;
          if (ty < terrain.heightAt(tx)) crash(s, ev, 'Tail struck terrain');
        }
      }
    }
    s.t += dt;
    return ev;
  }

  return {
    DEG: DEG, G: G, RHO0: RHO0, SCALE_H: SCALE_H, FUEL_DENSITY: FUEL_DENSITY,
    PLANES: PLANES, UPGRADES: UPGRADES,
    buildSpec: buildSpec, createState: createState, step: step, mass: mass,
    liftCoef: liftCoef, stallSpeed: stallSpeed, clMax: clMax, wrapAngle: wrapAngle
  };
})();
if (typeof module !== 'undefined') module.exports = Physics;
