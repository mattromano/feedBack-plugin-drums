'use strict';
// Freestyle play style: nothing is judged (no score, misses, star power or end
// card); hits are only rated by how close they land to the song's beat
// (grooveTap), which drives a groove meter (grooveMeter / grooveWord).
// Run: node --test tests/freestyle.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const S = require(path.join(__dirname, '..', 'assets', 'session.js'));
const E = require(path.join(__dirname, '..', 'assets', 'engine.js'));
const H3 = require(path.join(__dirname, '..', 'assets', 'highway3d.js'));

const w = (t, midi) => ({ t, s: Math.floor(midi / 24), f: midi % 24 });
// 120 BPM: a beat every 0.5 s, a measure every 4.
const beats = (n) => Array.from({ length: n }, (_, i) => ({ time: i * 0.5, measure: i % 4 === 0 ? i / 4 : -1 }));
const norm = (n) => S.normalizeBeats(beats(n));

// ── grooveTap ──────────────────────────────────────────────────────────────

test('grooveTap: on a beat or an 8th is locked, close is in, between is off', () => {
    const b = norm(8);
    assert.deepEqual(S.grooveTap(1.0, b, []), { offsetMs: 0, grade: 'locked' });
    assert.deepEqual(S.grooveTap(1.25, b, []), { offsetMs: 0, grade: 'locked' }, 'the 8th between beats');
    assert.deepEqual(S.grooveTap(1.015, b, []), { offsetMs: 15, grade: 'locked' });
    assert.deepEqual(S.grooveTap(0.97, b, []), { offsetMs: -30, grade: 'in' });
    const mid = S.grooveTap(1.125, b, []);   // a 16th: 125 ms from the beat and the 8th
    assert.equal(mid.grade, 'off');
    assert.equal(Math.abs(mid.offsetMs), 125);
});

test('grooveTap: any chart note counts as a target, whatever pad it is on', () => {
    const b = norm(8);
    assert.equal(S.grooveTap(1.125, b, [1.125]).grade, 'locked', 'a 16th the chart plays');
    assert.equal(S.grooveTap(1.13, [], [1.1, 1.2]).offsetMs, 30, 'notes only (no beat grid)');
    assert.equal(S.grooveTap(1, [], []), null, 'nothing to compare with');
    assert.equal(S.grooveTap(NaN, b, []), null);
});

// ── grooveMeter / grooveWord ───────────────────────────────────────────────

function feed(m, taps, t0, step) {
    let t = t0;
    for (const tap of taps) { m = S.grooveMeter(m, tap, t); t += step; }
    return { m, t };
}

test('grooveMeter: in-time hits build the groove up to locked, after the hold', () => {
    const locked = { grade: 'locked', offsetMs: 0 };
    let { m, t } = feed(null, Array(5).fill(locked), 0, 0.25);
    assert.ok(m.level > 0.4 && m.level < 0.75);
    assert.equal(m.state, 'warming', 'not before the new state held');
    ({ m, t } = feed(m, Array(3).fill(locked), t, 0.25));
    assert.equal(m.state, 'grooving');
    ({ m, t } = feed(m, Array(8).fill(locked), t, 0.25));
    assert.ok(m.level >= 0.75);
    assert.equal(m.state, 'locked');
    assert.deepEqual(S.grooveWord(m.state, m.lean), { word: 'LOCKED IN', color: '#5dffa8' });
});

test('grooveMeter: loose hits keep you in the pocket but only tight ones lock you in', () => {
    let { m } = feed(null, Array(30).fill({ grade: 'in', offsetMs: 35 }), 0, 0.25);
    assert.equal(m.state, 'grooving');
    assert.ok(m.level <= 0.7);
    assert.equal(S.grooveWord(m.state, m.lean).word, 'IN THE POCKET');
});

test('grooveMeter: a run of off hits drifts, and the lean says rushing or dragging', () => {
    const late = { grade: 'off', offsetMs: 90 };
    let { m } = feed(null, Array(10).fill(late), 0, 0.25);
    assert.equal(m.state, 'drifting');
    assert.ok(m.lean > S.GROOVE.leanMs);
    assert.equal(S.grooveWord(m.state, m.lean).word, 'DRAGGING');
    assert.equal(S.grooveWord('drifting', -60).word, 'RUSHING');
    assert.equal(S.grooveWord('drifting', 5).word, 'DRIFTING');
    assert.equal(S.grooveWord('warming', 0), null);
    assert.equal(S.grooveWord('idle', 0), null);
});

test('grooveMeter: no hits at all stays idle; it fades back to idle when you stop', () => {
    let m = null;
    for (let t = 0; t < 10; t += 0.5) m = S.grooveMeter(m, null, t);
    assert.equal(m.state, 'idle');
    assert.equal(m.level, 0);
    ({ m } = feed(m, Array(14).fill({ grade: 'locked', offsetMs: 0 }), 10, 0.25));
    assert.equal(m.state, 'locked');
    m = S.grooveMeter(m, null, 20);
    assert.equal(m.state, 'idle', 'idle right away, no hold');
    m = S.grooveMeter(m, null, 22);
    assert.equal(m.level, 0);
});

test('grooveMeter: a one-off change does not flicker the state', () => {
    let { m, t } = feed(null, Array(8).fill({ grade: 'locked', offsetMs: 0 }), 0, 0.25);
    assert.equal(m.state, 'grooving');
    m.level = 0.9;
    m = S.grooveMeter(m, { grade: 'in', offsetMs: 30 }, t);         // locked is pending...
    assert.equal(m.pending, 'locked');
    m.level = 0.5;
    m = S.grooveMeter(m, { grade: 'in', offsetMs: 30 }, t + 0.3);   // ...and gone again within the hold
    m = S.grooveMeter(m, null, t + 1);
    assert.equal(m.state, 'grooving');
});

// ── a Freestyle session ────────────────────────────────────────────────────

function freestyleSession(extra) {
    let wall = 0;
    const s = S.createSession(E, Object.assign({ now: () => wall, freestyle: true }, extra || {}));
    const notes = [];
    for (let i = 0; i < 16; i++) notes.push(w(1 + i * 0.25, i % 2 ? 42 : 38));
    s.load({ notes, chords: [], beats: beats(24) });
    s.setMeta({ starPower: [{ start: 1, end: 3 }] });
    return { s, tick: (ms) => { wall += ms; } };
}

test('freestyle session: hits are rated as taps, nothing is judged or scored', () => {
    const { s, tick } = freestyleSession();
    const seen = [];
    s.setOnHit(() => seen.push('onHit'));
    s.setOnEvent((d) => seen.push(d.type));
    assert.equal(s.freestyle, true);
    s.update(0.9);
    const r = s.hit(1.0, 1, {});
    assert.deepEqual(r, { type: 'tap', offsetMs: 0, grade: 'locked' });
    // Play past every note, hitting none of them, and an overhit-style strike between notes.
    for (let t = 1; t < 6; t += 0.05) { tick(50); s.update(t); }
    s.hit(5.1, 3, { cymbal: true });
    const types = new Set(s.drainEvents().map(e => e.type));
    assert.ok(types.has('press') && types.has('tap'));
    for (const bad of ['hit', 'miss', 'overhit', 'combo-break', 'sp-phrase', 'sp-ready', 'sp-activate', 'solo-end', 'bonus-pop']) {
        assert.ok(!types.has(bad), bad + ' is never sent');
    }
    assert.deepEqual(seen, [], 'no judgment listeners fire');
    const st = s.getState();
    assert.equal(st.score, 0);
    assert.equal(st.combo, 0);
    assert.equal(s.engine.noteState(s.gems[0].id) === 'miss', false, 'notes are never marked missed');
    assert.equal(s.isStarPowerNote(s.gems[0].id), false, 'no star power phrases');
    assert.equal(s.activate(2), false);
    assert.equal(s.getBonus(), null);
});

test('freestyle session: the groove meter and its state-change events', () => {
    const { s, tick } = freestyleSession();
    assert.equal(s.groove().state, 'idle');
    for (let i = 0; i < 16; i++) {
        tick(250);
        s.update(1 + i * 0.25);
        s.hit(1 + i * 0.25, i % 2 ? 2 : 1, { cymbal: !!(i % 2) });
    }
    const g = s.groove();
    assert.equal(g.state, 'locked');
    assert.equal(g.word.word, 'LOCKED IN');
    const groove = s.drainEvents().filter(e => e.type === 'groove').map(e => e.state);
    assert.deepEqual(groove.slice(-2), ['grooving', 'locked']);
});

test('freestyle session: auto notes still sound and flash; switching back to scored judges again', () => {
    const { s, tick } = freestyleSession({ auto: { kick: false, cymbals: true } });
    s.update(0.9);
    tick(16); s.update(1.3);
    const autoHits = s.drainEvents().filter(e => e.type === 'hit');
    assert.ok(autoHits.length && autoHits.every(e => e.auto), 'auto cymbals cross the line as auto hits');
    s.setFreestyle(false);
    assert.equal(s.freestyle, false);
    assert.equal(s.groove(), null);
    tick(16); s.update(1.45);
    assert.equal(s.hit(1.5, 1, {}).type, 'hit', 'the snare at 1.5 s is judged again');
});

test('scored sessions are unchanged: no taps, no groove', () => {
    const s = S.createSession(E, { now: () => 0 });
    s.load({ notes: [w(1, 38)], chords: [], beats: beats(8) });
    s.update(0.95);
    assert.equal(s.freestyle, false);
    assert.equal(s.hit(1, 1, {}).type, 'hit');
    assert.equal(s.groove(), null);
    assert.ok(!s.drainEvents().some(e => e.type === 'tap' || e.type === 'groove'));
});

// ── views ──────────────────────────────────────────────────────────────────

test('beatPulse peaks on the beat and decays before the next', () => {
    const b = norm(8);
    assert.equal(H3.beatPulse(b, 1.0), 1);
    assert.ok(H3.beatPulse(b, 1.25) < 0.1);
    assert.ok(H3.beatPulse(b, 1.05) > H3.beatPulse(b, 1.2));
    assert.equal(H3.beatPulse([], 1), 0);
    assert.equal(H3.beatPulse(b, 100), 0, 'past the grid');
});

function freshPlugin(store) {
    global.window = {};
    global.localStorage = { getItem: (k) => (store && k in store ? store[k] : null), setItem: () => {} };
    global.document = { addEventListener: () => {}, querySelectorAll: () => [], getElementById: () => null };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    return require(file);
}

test('play style setting: Scored by default; only "freestyle" turns it on', () => {
    let mod = freshPlugin();
    assert.equal(mod._cfg().playStyle, 'scored');
    assert.deepEqual(mod.PLAY_STYLE_IDS, ['scored', 'freestyle']);
    mod = freshPlugin({ drums_play_style_v1: 'freestyle' });
    assert.equal(mod._cfg().playStyle, 'freestyle');
    mod._saveCfg('playStyle', 'junk');
    assert.equal(mod._cfg().playStyle, 'scored');
    assert.equal(mod.STORE_KEYS.playStyle, 'drums_play_style_v1');
});

test('_freestyleFor: a band lane always plays scored', () => {
    const mod = freshPlugin();
    assert.equal(mod._freestyleFor({ playStyle: 'freestyle', mode: false, rhsOwns: false }), true);
    assert.equal(mod._freestyleFor({ playStyle: 'freestyle', mode: true, rhsOwns: false }), false);
    assert.equal(mod._freestyleFor({ playStyle: 'freestyle', mode: 'score', rhsOwns: false }), false);
    assert.equal(mod._freestyleFor({ playStyle: 'freestyle', mode: false, rhsOwns: true }), false, 'a RockHeroSmith solo / band scores');
    assert.equal(mod._freestyleFor({ playStyle: 'scored', mode: false, rhsOwns: false }), false);
});

test('Freestyle timing feedback: on by default, off with the setting, handed to the 3D view', () => {
    let mod = freshPlugin();
    assert.equal(mod._cfg().freestyleTiming, true);
    assert.equal(mod._fxSettings().groove, true);
    mod = freshPlugin({ drums_freestyle_timing_v1: 'false' });
    assert.equal(mod._cfg().freestyleTiming, false);
    assert.equal(mod._fxSettings().groove, false);
    assert.equal(H3.normalizeFx({}).groove, true);
    assert.equal(H3.normalizeFx({ groove: false }).groove, false);
});

test('feedBackDrums.isFreestyle() follows the setting (RockHeroSmith skips adopting a Freestyle play)', () => {
    freshPlugin();
    assert.equal(window.feedBackDrums.isFreestyle(), false);
    freshPlugin({ drums_play_style_v1: 'freestyle' });
    assert.equal(window.feedBackDrums.isFreestyle(), true);
});

test('freestyle draws no 2D score HUD; taps find their 2D lane', () => {
    const mod = freshPlugin();
    assert.equal(mod._shouldDrawScoreHud({ hitDetection: true, hidden: false, freestyle: true }), false);
    assert.equal(mod._shouldDrawScoreHud({ hitDetection: true, hidden: false }), true, 'scored unchanged');
    assert.equal(mod._padGm(0, false), 36);
    assert.equal(mod._padGm(2, true), 42);
    assert.equal(mod._padGm(4, false), 41);
    assert.equal(mod._padGm(9, false), -1);
    assert.equal(mod._beatPulse(norm(8), 1.0), 1);
});
