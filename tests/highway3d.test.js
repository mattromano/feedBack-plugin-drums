'use strict';
// Unit tests for highway3d.js (keyboard input, the pieces the 3D view exports without WebGL) and
// screen.js view selection. The Three.js scene itself needs a browser (see README "3D view").
// Run: node tests/highway3d.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const H = require(path.join(__dirname, '..', 'assets', 'highway3d.js'));
const S = require(path.join(__dirname, '..', 'assets', 'session.js'));
const E = require(path.join(__dirname, '..', 'assets', 'engine.js'));

test('highway3d.js exports the view factory and keyboard helpers', () => {
    assert.equal(typeof H.createView, 'function');
    assert.equal(H.TRACK.lanes, S.LANE_NAMES.length);
    assert.throws(() => H.createView({}, { getContext: () => null }), /WebGL2/);
});

test('keyToPad: keyboard fallback layout (physical keys)', () => {
    const k = (code, extra) => H.keyToPad(Object.assign({ code, key: '' }, extra || {}));
    assert.equal(k('Space'), null, 'Space stays play/pause');
    assert.deepEqual(k('KeyB'), { pad: 0, cymbal: false });
    assert.deepEqual(k('KeyF'), { pad: 1, cymbal: false });
    assert.deepEqual(k('KeyJ'), { pad: 2, cymbal: false });
    assert.deepEqual(k('KeyK'), { pad: 3, cymbal: false });
    assert.deepEqual(k('KeyL'), { pad: 4, cymbal: false });
    assert.deepEqual(k('KeyJ', { shiftKey: true }), { pad: 2, cymbal: true });
    assert.deepEqual(k('KeyL', { shiftKey: true }), { pad: 4, cymbal: true });
    assert.deepEqual(k('KeyU'), { pad: 2, cymbal: true });
    assert.deepEqual(k('KeyI'), { pad: 3, cymbal: true });
    assert.deepEqual(k('KeyO'), { pad: 4, cymbal: true });
    assert.deepEqual(k('KeyF', { shiftKey: true }), { pad: 1, cymbal: false }, 'red has no cymbal');
    assert.deepEqual(k('KeyB', { shiftKey: true }), { pad: 0, cymbal: false });
    assert.deepEqual(k('Enter'), { action: 'activate' });
    assert.deepEqual(k('NumpadEnter'), { action: 'activate' });
});

test('keyToPad: falls back to e.key, ignores modifiers and unmapped keys', () => {
    assert.deepEqual(H.keyToPad({ key: 'K' }), { pad: 3, cymbal: false });
    assert.deepEqual(H.keyToPad({ key: 'b' }), { pad: 0, cymbal: false });
    assert.equal(H.keyToPad({ key: ' ' }), null);
    assert.deepEqual(H.keyToPad({ key: 'Enter' }), { action: 'activate' });
    assert.equal(H.keyToPad({ code: 'KeyF', ctrlKey: true }), null);
    assert.equal(H.keyToPad({ code: 'KeyJ', metaKey: true }), null);
    assert.equal(H.keyToPad({ code: 'KeyJ', altKey: true }), null);
    assert.equal(H.keyToPad({ code: 'KeyQ', key: 'q' }), null);
    assert.equal(H.keyToPad({ code: 'ArrowLeft', key: 'ArrowLeft' }), null);
    assert.equal(H.keyToPad(null), null);
});


test('synthMidiForPad picks a GM sound for keyboard hits', () => {
    assert.equal(H.synthMidiForPad(0, false), 36);
    assert.equal(H.synthMidiForPad(1, false), 38);
    assert.equal(H.synthMidiForPad(2, true), 42);
    assert.equal(H.synthMidiForPad(2, false), 48);
    assert.equal(H.synthMidiForPad(3, true), 51);
    assert.equal(H.synthMidiForPad(3, false), 45);
    assert.equal(H.synthMidiForPad(4, true), 49);
    assert.equal(H.synthMidiForPad(4, false), 41);
    assert.equal(H.synthMidiForPad(9, false), null);
    // every pad maps back to itself through GM
    for (const [pad, cym] of [[0, false], [1, false], [2, true], [2, false], [3, true], [3, false], [4, true], [4, false]]) {
        assert.deepEqual(E.padFromMidi(H.synthMidiForPad(pad, cym)), { pad, cymbal: cym });
    }
});


test('D is the difficulty key, never a drum key', () => {
    assert.equal(H.keyToPad({ code: 'KeyD', key: 'd' }), null);
    assert.deepEqual(S.isDifficultyKey({ code: 'KeyD', key: 'd' }), { dir: 1 });
    for (const code of ['KeyB', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'KeyU', 'KeyI', 'KeyO', 'Enter']) {
        assert.equal(S.isDifficultyKey({ code, key: code }), null, code);
        assert.notEqual(H.keyToPad({ code, key: '' }), null, code);
    }
});

// ── screen.js view selection ──────────────────────────────────────────────

test('screen.js _resolveView: 3D when WebGL2 is available unless 2D is chosen', () => {
    global.window = {};
    global.localStorage = { getItem: () => null, setItem: () => {} };
    global.document = { addEventListener: () => {} };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    assert.equal(mod._resolveView('auto', true), '3d');
    assert.equal(mod._resolveView('auto', false), '2d');
    assert.equal(mod._resolveView('3d', true), '3d');
    assert.equal(mod._resolveView('3d', false), '2d');
    assert.equal(mod._resolveView('2d', true), '2d');
    assert.deepEqual([...mod._VALID_VIEWS].sort(), ['2d', '3d', 'auto']);
    assert.equal(typeof window.feedBackViz_drums, 'function');
    assert.equal(window.feedBackViz_drums.contextType, undefined, 'no static webgl2: Auto must not skip it without WebGL2');
    assert.equal(window.feedBackViz_drums3d.contextType, 'webgl2');
    assert.equal(typeof window.feedBackViz_drums.matchesArrangement, 'function');
    assert.equal(mod._cfg().view, 'auto');
    assert.equal(mod._cfg().keyboard, true);
    mod._saveCfg('view', 'vr');
    assert.equal(mod._cfg().view, 'auto', 'unknown views are not saved');
});

// ── hit / miss FX (the scene runs on a stub three.js: no WebGL in Node) ─────

// An auto-vivifying stand-in for three.js objects: any property is another stub, calls and `new`
// return stubs, assignments stick, and arithmetic sees 0.
function stub() {
    const store = Object.create(null);
    const p = new Proxy(function () {}, {
        get(_, k) {
            if (k in store) return store[k];
            if (k === Symbol.toPrimitive) return () => 0;
            if (k === 'then' || typeof k === 'symbol') return undefined;
            return (store[k] = stub());
        },
        set(_, k, v) { store[k] = v; return true; },
        apply() { return p; },
        construct() { return stub(); },
    });
    return p;
}

function sceneHarness(notes, opts, fx) {
    const prevDoc = global.document;
    global.document = { createElement: () => stub(), addEventListener: () => {} };
    let wall = 0;
    const s = S.createSession(E, { now: () => wall });
    s.load({ notes, chords: [], beats: [] });
    const view = H.createView(stub(), stub(), Object.assign({ context: stub() }, opts || {}));
    view.resize(1280, 720, 1);
    let t = 0;
    const to = (t1) => {
        for (; t < t1 - 1e-9; t = Math.min(t1, t + 1 / 60)) {
            wall = t * 1000; s.update(t); view.render({ time: t, session: s, wallNow: wall, fx });
        }
        wall = t1 * 1000; s.update(t1); view.render({ time: t1, session: s, wallNow: wall, fx });
        t = t1;
        return view.fxSnapshot();
    };
    const done = () => { view.dispose(); global.document = prevDoc; };
    return { s, view, to, done, hit: (time, pad) => { wall = time * 1000; return s.hit(time, pad); } };
}

test('trailAlpha / trailZ: judged gems keep moving past the strikeline and fade out over HIT_FX.behind', () => {
    assert.equal(H.HIT_FX.behind, 0.4);
    assert.equal(H.trailAlpha(-0.3), 1, 'still approaching');
    assert.equal(H.trailAlpha(0), 1);
    const a1 = H.trailAlpha(0.1), a2 = H.trailAlpha(0.2), a3 = H.trailAlpha(0.35);
    assert.ok(1 > a1 && a1 > a2 && a2 > a3 && a3 > 0, 'fades monotonically');
    assert.equal(H.trailAlpha(0.4), 0);
    assert.equal(H.trailAlpha(1), 0);
    const speed = H.TRACK.length / H.TRACK.defaultLookahead;
    assert.equal(H.trailZ(-0.5, speed), -0.5 * speed, 'approaching gems scroll at track speed');
    let prev = 0;
    for (let k = 1; k <= 8; k++) {
        const z = H.trailZ(k * 0.05, speed);
        assert.ok(z > prev, 'keeps travelling toward the back of the highway');
        assert.ok(z <= H.TRACK.behind + 1e-9, 'and stays on the visible track');
        prev = z;
    }
    assert.ok(Math.abs(H.trailZ(0.4, speed) - H.TRACK.behind) < 1e-9, 'leaves out the back as it fades out');
    // continuous speed across the strikeline
    const v0 = H.trailZ(0.001, speed) / 0.001;
    assert.ok(Math.abs(v0 - speed) / speed < 0.05, 'no jump in speed at the strikeline');
});

test('hitPop: a hit gem grows and fades over HIT_FX.vanishMs, then is gone', () => {
    const a = H.hitPop(0), b = H.hitPop(0.5), c = H.hitPop(0.95);
    assert.equal(a.alpha, 1);
    assert.equal(a.grow, 1);
    assert.ok(b.alpha < 1 && c.alpha < b.alpha, 'fades');
    assert.ok(b.grow > 1 && c.grow > b.grow, 'grows');
    assert.equal(H.hitPop(1), null);
    assert.equal(H.hitPop(3), null);
});

test('normalizeFx: unknown values fall back to the defaults, the HUD scale is clamped', () => {
    assert.deepEqual(H.normalizeFx(null), { level: 'full', words: true, shake: true, hudScale: H.FX_DEFAULTS.hudScale });
    assert.deepEqual(H.normalizeFx({ level: 'subtle', words: false, shake: false, hudScale: 9 }),
        { level: 'subtle', words: false, shake: false, hudScale: 2 });
    assert.equal(H.normalizeFx({ level: 'loud' }).level, 'full');
    assert.equal(H.normalizeFx({ hudScale: 0.1 }).hudScale, 0.75);
});

test('3D view: a hit gem pops at the strikeline and is gone; a missed gem greys out and drifts past', () => {
    const h = sceneHarness([{ t: 1, s: 1, f: 14 }, { t: 2, s: 1, f: 14 }]);
    try {
        let snap = h.to(0.98);
        assert.equal(snap.trail.length, 0, 'nothing judged yet');
        assert.equal(h.hit(1.0, 1).type, 'hit');
        snap = h.to(1.0);
        assert.equal(snap.trail.length, 1, 'popping');
        assert.equal(snap.trail[0].state, 'hit');
        assert.ok(snap.sparksLive > 0, 'hit sparks');
        assert.ok(snap.flash[0] > 0 && snap.flashHit[0], 'green lane flash on the red lane');
        assert.equal(snap.judge, 'PERFECT', 'judgment word');
        snap = h.to(1.05);
        assert.equal(snap.trail.length, 1);
        assert.ok(snap.trail[0].alpha > 0 && snap.trail[0].alpha < 1, 'fading as it pops');
        assert.ok(snap.trail[0].z <= 0, 'stays at the strikeline');
        assert.equal(h.to(1.2).trail.length, 0, 'gone: hit gems vanish');
        assert.equal(h.to(1.5).flash[0], 0, 'the lane flash is over');
        // the note at t=2 is never played: it greys out, carries on and fades
        snap = h.to(2.25);
        assert.equal(snap.trail.length, 1);
        assert.equal(snap.trail[0].state, 'miss');
        assert.ok(snap.trail[0].alpha > 0 && snap.trail[0].alpha < 1);
        assert.ok(snap.flash[0] > 0 && !snap.flashHit[0], 'red lane flash');
        assert.equal(snap.judge, 'MISS');
        assert.equal(h.to(2.5).trail.length, 0);
    } finally { h.done(); }
});

test('3D view: with effects off, a hit gem trails past the strikeline as before and no words show', () => {
    const h = sceneHarness([{ t: 1, s: 1, f: 14 }, { t: 2, s: 1, f: 14 }], null, { level: 'off', words: false });
    try {
        let snap = h.to(0.98);
        assert.equal(snap.trail.length, 0, 'nothing judged yet');
        assert.equal(h.hit(1.0, 1).type, 'hit');
        snap = h.to(1.0);
        assert.equal(snap.trail.length, 1);
        assert.equal(snap.trail[0].state, 'hit');
        assert.equal(snap.sparksLive, 0, 'no sparks with effects off');
        assert.ok(snap.flash[0] > 0 && snap.flashHit[0], 'green lane flash on the red lane');
        assert.equal(snap.judge, null);
        snap = h.to(1.2);
        assert.equal(snap.trail.length, 1, 'still drawn past the strikeline');
        const g = snap.trail[0];
        assert.equal(g.state, 'hit');
        assert.ok(g.alpha > 0 && g.alpha < 1, 'with reduced opacity: ' + g.alpha);
        assert.ok(g.z > 0, 'behind the strikeline (toward the camera)');
        assert.ok(h.to(1.3).trail[0].alpha < g.alpha, 'fading');
        assert.equal(h.to(1.45).trail.length, 0, 'gone after the window');
        assert.equal(h.to(1.5).flash[0], 0, 'the lane flash is over');
        // the note at t=2 is never played: it turns red, carries on and fades too
        snap = h.to(2.25);
        assert.equal(snap.trail.length, 1);
        assert.equal(snap.trail[0].state, 'miss');
        assert.ok(snap.trail[0].alpha > 0 && snap.trail[0].alpha < 1);
        assert.ok(snap.flash[0] > 0 && !snap.flashHit[0], 'red lane flash');
        assert.equal(h.to(2.5).trail.length, 0);
    } finally { h.done(); }
});

test('3D view: spark bursts grow with the streak, combo rings / milestone bursts / score pops come from a fixed pool', () => {
    const notes = [];
    for (let i = 0; i < 30; i++) notes.push({ t: 1 + i * 0.25, s: 1, f: 14 });
    const hudCanvas = stub();
    const h = sceneHarness(notes, { hudCanvas });
    try {
        h.to(0.99);
        h.hit(1.0, 1);
        const one = h.to(1.0);
        const first = one.sparksBorn;
        assert.equal(one.pops, 1, 'a score pop');
        assert.ok(!one.ring && !one.bursts);
        let snap = null;
        for (let i = 1; i < 25; i++) {
            h.to(1 + i * 0.25 - 0.01); h.hit(1 + i * 0.25, 1);
            snap = h.to(1 + i * 0.25);
            if (i === 9) assert.ok(snap.ring, 'combo ring at a 10 streak');
            if (i === 12) assert.ok(!snap.ring, 'the ring is short-lived');
        }
        assert.equal(h.s.getState().combo, 25);
        assert.ok(snap.sparksBorn > first, 'a 25 streak throws a bigger burst than the first hit');
        assert.ok(snap.pops > 0 && snap.pops <= snap.popPool, 'score pops are pooled');
        assert.equal(snap.bursts, 1, 'the 25 streak milestone burst');
        // break the streak: a red wash, a camera shake and a STREAK LOST callout
        const br = h.to(1 + 26 * 0.25);
        assert.ok(br.breakWash, 'streak-break wash');
        assert.ok(br.shake, 'camera shake on a 10+ streak break');
        assert.equal(br.callout, 'STREAK LOST');
    } finally { h.done(); }
});

test('3D view: the multiplier going up gets a callout; an overhit gets a red mark', () => {
    const notes = [];
    for (let i = 0; i < 12; i++) notes.push({ t: 1 + i * 0.25, s: 1, f: 14 });
    const h = sceneHarness(notes);
    try {
        for (let i = 0; i < 10; i++) { h.to(1 + i * 0.25 - 0.01); h.hit(1 + i * 0.25, 1); }
        assert.equal(h.to(1 + 9 * 0.25).callout, 'x2 MULTIPLIER');
        const before = h.to(3.6).pops;
        h.hit(3.6, 3);   // nothing to hit there: an overhit
        assert.ok(h.to(3.62).pops > before, 'overhit mark');
    } finally { h.done(); }
});

test('drawHud with frame.hideScore draws only the difficulty badge and keeps its click target', () => {
    const texts = [];
    const ctx = stub();
    ctx.fillText = (t) => texts.push(String(t));
    ctx.measureText = (t) => ({ width: String(t).length * 7 });
    const hudCanvas = stub();
    hudCanvas.getContext = () => ctx;
    const h = sceneHarness([{ t: 1, s: 1, f: 14 }], { hudCanvas });
    try {
        const difficulty = { text: 'EXPERT', color: '#fff' };
        const frame = (hideScore) => ({ time: 0.5, session: h.s, wallNow: 500, difficulty, hideScore, message: 'msg' });
        h.view.render(frame(false));
        assert.ok(texts.includes('EXPERT'));
        assert.ok(texts.some(t => t.startsWith('STAR POWER')), 'score column drawn');
        assert.ok(texts.some(t => t.startsWith('Accuracy')));
        assert.ok(h.view.difficultyRect, 'badge click target');
        texts.length = 0;
        h.view.render(frame(true));
        assert.deepEqual(texts, ['EXPERT'], 'only the badge');
        const r = h.view.difficultyRect;
        assert.ok(r && r.w > 0 && r.h > 0, 'the badge click target stays valid');
        assert.equal(h.view.timingRect, null);
        assert.equal(h.view.timingSuggest, null);
    } finally { h.done(); }
});
