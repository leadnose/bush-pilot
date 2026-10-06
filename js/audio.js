/* Bush Pilot - procedural WebAudio sounds (engine, wind, stall horn, thumps). */
var Sound = (function () {
  'use strict';
  var ac = null, ready = false, muted = false, N = null, stallPhase = 0;
  function init() {
    if (ready) return; ready = true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ac = new AC();
      var master = ac.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ac.destination);
      var eng1 = ac.createOscillator(); eng1.type = 'sawtooth'; eng1.frequency.value = 40;
      var eng2 = ac.createOscillator(); eng2.type = 'square'; eng2.frequency.value = 20;
      var ef = ac.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 500;
      var eg = ac.createGain(); eg.gain.value = 0;
      eng1.connect(ef); eng2.connect(ef); ef.connect(eg); eg.connect(master); eng1.start(); eng2.start();
      var buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      var ns = ac.createBufferSource(); ns.buffer = buf; ns.loop = true;
      var nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 600; nf.Q.value = 0.6;
      var ng = ac.createGain(); ng.gain.value = 0;
      ns.connect(nf); nf.connect(ng); ng.connect(master); ns.start();
      var so = ac.createOscillator(); so.type = 'square'; so.frequency.value = 880;
      var sg = ac.createGain(); sg.gain.value = 0; so.connect(sg); sg.connect(master); so.start();
      N = { master: master, eng1: eng1, eng2: eng2, ef: ef, eg: eg, ng: ng, nf: nf, buf: buf, sg: sg };
    } catch (e) { ac = null; N = null; }
  }
  function update(dt, st) {
    if (!ac || !N) return;
    if (ac.state === 'suspended') { try { ac.resume(); } catch (e) {} }
    var t = ac.currentTime;
    var running = st.running;
    var f = running ? (st.throttle ? 72 + 40 * Math.min(1, st.speed / 40) : 30) : 0;
    N.eng1.frequency.setTargetAtTime(Math.max(f, 1), t, 0.15);
    N.eng2.frequency.setTargetAtTime(Math.max(f / 2, 0.5), t, 0.15);
    N.eg.gain.setTargetAtTime(running ? (st.throttle ? 0.2 : 0.06) : 0, t, 0.1);
    N.ef.frequency.setTargetAtTime(st.throttle ? 900 : 400, t, 0.2);
    var wg = Math.min(0.22, Math.pow(st.speed / 55, 2) * 0.22);
    N.ng.gain.setTargetAtTime(wg, t, 0.1);
    N.nf.frequency.setTargetAtTime(300 + st.speed * 12, t, 0.1);
    if (st.stallWarn) { stallPhase += dt; var on = (stallPhase % 0.3) < 0.15; N.sg.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.01); }
    else N.sg.gain.setTargetAtTime(0, t, 0.01);
  }
  function silence() { if (!ac || !N) return; var t = ac.currentTime; N.eg.gain.setTargetAtTime(0, t, 0.05); N.ng.gain.setTargetAtTime(0, t, 0.05); N.sg.gain.setTargetAtTime(0, t, 0.01); }
  function blip(freq, dur, gain, type) {
    if (!ac || !N) return;
    try {
      var o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g); g.connect(N.master); o.start(); o.stop(ac.currentTime + dur);
    } catch (e) {}
  }
  function crash() {
    if (!ac || !N) return;
    try {
      var s = ac.createBufferSource(); s.buffer = N.buf;
      var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 350;
      var g = ac.createGain(); g.gain.setValueAtTime(0.7, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 1.4);
      s.connect(f); f.connect(g); g.connect(N.master); s.start(); s.stop(ac.currentTime + 1.5);
    } catch (e) {}
    blip(60, 0.8, 0.4, 'sine');
  }
  function touchdown(vs) { blip(70, 0.25, Math.min(0.5, 0.08 + vs * 0.1), 'sine'); }
  function toggleMute() { muted = !muted; if (N) N.master.gain.value = muted ? 0 : 1; return muted; }
  function setMuted(m) { muted = !!m; if (N) N.master.gain.value = muted ? 0 : 1; }
  return {
    init: init, update: update, silence: silence, crash: crash, touchdown: touchdown, toggleMute: toggleMute, setMuted: setMuted,
    ui: function () { blip(620, 0.06, 0.04, 'square'); }, select: function () { blip(880, 0.1, 0.05, 'square'); },
    cash: function () { blip(660, 0.12, 0.06, 'triangle'); setTimeout(function () { blip(990, 0.18, 0.06, 'triangle'); }, 110); },
    fuelOut: function () { blip(220, 0.7, 0.12, 'sawtooth'); }
  };
})();
if (typeof module !== 'undefined') module.exports = Sound;
