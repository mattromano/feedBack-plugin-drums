'use strict';
// HUD modes (setScoreHudHidden(canvas, true | false | 'score'), hudModes()):
// 'score' hides only the lane's score number, stars and accuracy; the streak,
// multiplier, score pops, combo rings, FULL COMBO, early/late meter, star power
// meter and difficulty badge stay.
// Run: node --test tests/hud-modes.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const H = require(path.join(__dirname, '..', 'assets', 'highway3d.js'));
const S = require(path.join(__dirname, '..', 'assets', 'session.js'));
const E = require(path.join(__dirname, '..', 'assets', 'engine.js'));

function freshPlugin() {
    global.window = {};
    global.localStorage = { getItem: () => null, setItem: () => {} };
    global.document = { addEventListener: () => {}, querySelectorAll: () => [], getElementById: () => null };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    return { mod, api: window.feedBackDrums };
}

test('hudModes() lists the partial modes setScoreHudHidden takes', () => {
    const { api } = freshPlugin();
    assert.deepEqual(api.hudModes(), ['score']);
    api.hudModes().push('junk');
    assert.deepEqual(api.hudModes(), ['score'], 'a fresh array each call');
});

test("setScoreHudHidden(canvas, 'score'): a per-canvas mode; true / false unchanged", () => {
    const { mod, api } = freshPlugin();
    const c = {}, other = {};
    assert.equal(api.setScoreHudHidden(c, 'score'), true);
    assert.equal(api.isScoreHudHidden(c), 'score');
    assert.equal(mod._scoreHudModeFor(c), 'score');
    assert.equal(mod._scoreHudHiddenFor(c), false, 'not fully hidden');
    assert.equal(mod._scoreHudModeFor(other), false);
    assert.equal(api.setScoreHudHidden(c, 'stars'), false, 'an unknown mode is junk');
    assert.equal(api.isScoreHudHidden(c), 'score', 'junk changes nothing');
    assert.equal(api.setScoreHudHidden(c, true), true);
    assert.equal(api.isScoreHudHidden(c), true);
    assert.equal(mod._scoreHudModeFor(c), true);
    assert.equal(api.setScoreHudHidden(c, 'score'), true);
    assert.equal(api.setScoreHudHidden(c, false), true);
    assert.equal(api.isScoreHudHidden(c), false);
    assert.equal(mod._scoreHudModeFor(c), false);
    assert.equal(api.setScoreHudHidden(null, 'score'), false);
});

test("'score' mode still draws the lane HUD; true hides it", () => {
    const { mod } = freshPlugin();
    assert.equal(mod._shouldDrawScoreHud({ hitDetection: true, hidden: 'score' }), true);
    assert.equal(mod._shouldDrawScoreHud({ hitDetection: true, hidden: true }), false);
    assert.equal(mod._shouldDrawScoreHud({ hitDetection: false, hidden: 'score' }), false);
});

test("2D HUD boxes: 'score' drops the score and stars, keeps multiplier, streak and star power", () => {
    const { mod } = freshPlugin();
    assert.deepEqual(mod._hud2DBoxes(false), ['mult', 'score', 'streak', 'stars', 'sp']);
    assert.deepEqual(mod._hud2DBoxes('score'), ['mult', 'streak', 'sp']);
});

// ── 3D view ──
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

test("3D drawHud with hideScore 'score': no score, stars or accuracy; streak, multiplier, star power, timing, pops stay", () => {
    const texts = [];
    const ctx = stub();
    ctx.fillText = (t) => texts.push(String(t));
    ctx.strokeText = () => {};
    ctx.measureText = (t) => ({ width: String(t).length * 7 });
    const hudCanvas = stub();
    hudCanvas.getContext = () => ctx;
    const prevDoc = global.document;
    global.document = { createElement: () => stub(), addEventListener: () => {} };
    let wall = 0;
    const s = S.createSession(E, { now: () => wall });
    s.load({ notes: [{ t: 1, s: 1, f: 14 }, { t: 2, s: 1, f: 14 }], chords: [], beats: [] });
    const view = H.createView(stub(), stub(), { context: stub(), hudCanvas });
    view.resize(1280, 720, 1);
    try {
        const difficulty = { text: 'EXPERT', color: '#fff' };
        // the control first: the score column draws this number
        for (let t = 0; t <= 0.99; t += 1 / 60) { wall = t * 1000; s.update(t); }
        wall = 1000; s.hit(1.0, 1); s.update(1.0);
        const bonus = s.getBonus ? s.getBonus() : null;
        const score = S.formatScore(s.getState().score + (bonus ? bonus.total : 0));
        assert.ok(s.getState().score > 0);
        texts.length = 0;
        view.render({ time: 1.0, session: s, wallNow: 1000, difficulty, hideScore: 'score' });
        assert.ok(!texts.includes(score), 'no score number: ' + score);
        assert.ok(!texts.some(t => t.startsWith('Accuracy')), 'no accuracy line');
        assert.ok(texts.includes('NOTE STREAK'), 'streak label');
        assert.ok(texts.includes('1'), 'streak count');
        assert.ok(texts.some(t => /^x\d/.test(t)), 'multiplier badge');
        assert.ok(texts.some(t => t.startsWith('STAR POWER')), 'star power meter');
        assert.ok(texts.some(t => t.startsWith('TIMING')), 'early/late meter');
        assert.ok(texts.includes('EXPERT'), 'difficulty badge');
        assert.ok(texts.some(t => t.startsWith('+')), 'score pop');
        assert.ok(view.difficultyRect, 'badge click target');
        // full hide is unchanged
        texts.length = 0;
        view.render({ time: 1.0, session: s, wallNow: 1000, difficulty, hideScore: true });
        assert.deepEqual(texts, ['EXPERT']);
        // nothing hidden: the score column is back
        texts.length = 0;
        view.render({ time: 1.0, session: s, wallNow: 1000, difficulty, hideScore: false });
        assert.ok(texts.includes(score));
        assert.ok(texts.some(t => t.startsWith('Accuracy')));
    } finally { view.dispose(); global.document = prevDoc; }
});
