'use strict';
// Coverage for pure helpers in screen.js: MIDI mapping, lane presets,
// drum-tab hit conversion, custom-mapping validation, arrangement matching.
// Runs under the org reusable CI as `node tests/screen.test.js`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshPlugin() {
    global.window = {};
    global.localStorage = { getItem: () => null, setItem: () => {} };
    global.document = { addEventListener: () => {} };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    return require(file);
}

test('noteToMidi maps string/fret to a MIDI number (24 semitones per string)', () => {
    const mod = freshPlugin();
    assert.equal(mod.noteToMidi(0, 0), 0);
    assert.equal(mod.noteToMidi(1, 12), 36);
});

test('_rgbStr formats rgb()/rgba() from 0..1 channel floats', () => {
    const mod = freshPlugin();
    assert.equal(mod._rgbStr(1, 0, 0), 'rgb(255,0,0)');
    assert.equal(mod._rgbStr(1, 0, 0, 0.5), 'rgba(255,0,0,0.5)');
});

test('_validateCustomMapping keeps only in-range MIDI keys with known lane ids', () => {
    const mod = freshPlugin();
    const clean = mod._validateCustomMapping({ '38': 'snare', '200': 'kick', '40': 'nope-lane' });
    assert.deepEqual({ ...clean }, { 38: 'snare' }); // clean has a null prototype
});

test('_validateCustomMapping rejects non-objects, arrays, and prototype-poisoning keys', () => {
    const mod = freshPlugin();
    assert.equal(mod._validateCustomMapping(null), null);
    assert.equal(mod._validateCustomMapping('nope'), null);
    assert.equal(mod._validateCustomMapping([1, 2]), null);
    // Empty after filtering -> null, not {}.
    assert.equal(mod._validateCustomMapping({ '__proto__': 'kick' }), null);
    assert.equal(mod._validateCustomMapping({}), null);
});

test('_drumTabHitsToNotes converts known piece-ids to {t,s,f} and sorts by time', () => {
    const mod = freshPlugin();
    const notes = mod._drumTabHitsToNotes([
        { p: 'snare', t: 1.0, v: 120 },
        { p: 'kick', t: 0.5, v: 80 },
    ]);
    assert.equal(notes.length, 2);
    assert.equal(notes[0].t, 0.5);
    assert.equal(notes[0]._piece, 'kick');
    assert.equal(notes[0].ac, false); // v=80 < 100
    assert.equal(notes[1].ac, true);  // v=120 >= 100
});

test('_drumTabHitsToNotes drops unknown piece-ids and non-finite/negative timestamps', () => {
    const mod = freshPlugin();
    const notes = mod._drumTabHitsToNotes([
        { p: 'cowbell', t: 1.0 },       // unknown piece
        { p: 'snare', t: -1 },           // negative time
        { p: 'snare', t: NaN },          // non-finite
        { p: 'snare', t: 2.0 },          // kept
    ]);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].t, 2.0);
});

test('_drumTabHitsToNotes emits a leading grace note for flams', () => {
    const mod = freshPlugin();
    const notes = mod._drumTabHitsToNotes([{ p: 'snare', t: 1.0, v: 100, f: true }]);
    assert.equal(notes.length, 2);
    const [grace, main] = notes;
    assert.equal(grace._noScore, true);
    assert.ok(grace.t < main.t);
    assert.equal(main.t, 1.0);
});

test('_drumTabHitsToNotes ignores a non-array payload', () => {
    const mod = freshPlugin();
    assert.deepEqual(mod._drumTabHitsToNotes(null), []);
    assert.deepEqual(mod._drumTabHitsToNotes('nope'), []);
});

test('lane preset switch rebuilds DRUM_LANES and the default map', () => {
    const mod = freshPlugin();
    mod._applyLanePreset('rb4');
    assert.deepEqual(mod.DRUM_LANES.map(l => l.id), ['hihat', 'snare', 'tom1', 'tom3', 'crash', 'ride', 'kick']);
    // In rb4, mid-tom notes 45/47 fold into tom1 (no separate tom2 lane).
    assert.equal(mod._midiToLaneIdx(45), mod.DRUM_LANES.findIndex(l => l.id === 'tom1'));

    mod._applyLanePreset('phase_shift_8');
    assert.deepEqual(mod.DRUM_LANES.map(l => l.id),
        ['hihat', 'snare', 'tom1', 'tom2', 'tom3', 'crash', 'ride', 'kick']);
});

test('_applyLanePreset falls back to phase_shift_8 for an unknown preset name', () => {
    const mod = freshPlugin();
    mod._applyLanePreset('not-a-real-preset');
    assert.deepEqual(mod.DRUM_LANES.map(l => l.id),
        ['hihat', 'snare', 'tom1', 'tom2', 'tom3', 'crash', 'ride', 'kick']);
});

test('_midiToLaneIdx/_songNoteToLaneIdx resolve unmapped notes to -1', () => {
    const mod = freshPlugin();
    assert.equal(mod._midiToLaneIdx(999), -1);
    assert.equal(mod._songNoteToLaneIdx(999), -1);
});

test('_midiResolveSaved matches by stored key first, falls back to legacy bare id', () => {
    const mod = freshPlugin();
    const sources = [{ id: 'dev1', key: 'webmidi:dev1' }];
    assert.equal(mod._midiResolveSaved('webmidi:dev1', sources), 'webmidi:dev1');
    assert.equal(mod._midiResolveSaved('dev1', sources), 'webmidi:dev1');
    assert.equal(mod._midiResolveSaved('nope', sources), null);
});

test('matchesArrangement trusts has_drum_tab regardless of arrangement name', () => {
    const mod = freshPlugin();
    assert.equal(mod.matchesArrangement({ has_drum_tab: true, arrangement: 'Lead' }), true);
});

test('matchesArrangement matches drum-pattern arrangement names', () => {
    const mod = freshPlugin();
    assert.equal(mod.matchesArrangement({ arrangement: 'Drums' }), true);
    assert.equal(mod.matchesArrangement({ arrangement: 'Lead Guitar' }), false);
});

test('matchesArrangement rejects falsy songInfo', () => {
    const mod = freshPlugin();
    assert.equal(mod.matchesArrangement(null), false);
});

test('PIECE_DEFAULT_MIDI covers the canonical piece set used by _drumTabHitsToNotes', () => {
    const mod = freshPlugin();
    assert.equal(mod.PIECE_DEFAULT_MIDI.kick, 36);
    assert.equal(mod.PIECE_DEFAULT_MIDI.snare, 38);
});

// ── scoring: drum_tab gameplay flags (feedpak 1.20.0) ──────────────────────

test('_drumTabHitsToNotes: authored accents (a) win over velocity; a hit without v is no accent', () => {
    const mod = freshPlugin();
    // pre-1.20.0 tab: written velocity >= 100 is the accent, missing v is not
    let notes = mod._drumTabHitsToNotes([{ p: 'snare', t: 1, v: 110 }, { p: 'snare', t: 2 }, { p: 'snare', t: 3, v: 120, g: true }]);
    assert.deepEqual(notes.map(n => [n.ac, n.mt]), [[true, false], [false, false], [false, true]], 'never accent + ghost');
    // a tab that marks accents: only `a` counts, whatever the velocity
    notes = mod._drumTabHitsToNotes([{ p: 'snare', t: 1, v: 127 }, { p: 'snare', t: 2, a: true }]);
    assert.deepEqual(notes.map(n => n.ac), [false, true]);
});

test('_drumTabHitsToNotes: a double kick (x2) becomes GM 35, the engine\'s Expert+ kick', () => {
    const mod = freshPlugin();
    const notes = mod._drumTabHitsToNotes([{ p: 'kick', t: 1 }, { p: 'kick', t: 1.1, x2: true }, { p: 'snare', t: 1.2, x2: true }]);
    assert.deepEqual(notes.map(n => n.s * 24 + n.f), [36, mod.KICK2X_MIDI, 38], 'x2 only means something on a kick');
    assert.equal(mod.KICK2X_MIDI, 35);
});

test('drum_tab gameplay metadata plays through session.js: levels, Expert / Expert+, star power', () => {
    const mod = freshPlugin();
    const H = require(path.join(__dirname, '..', 'assets', 'session.js'));
    const tab = {
        hits: [{ t: 1, p: 'kick' }, { t: 1, p: 'crash_l', a: true }, { t: 1.25, p: 'kick', x2: true }, { t: 1.5, p: 'snare' }],
        star_power: [{ start_time: 1, end_time: 2 }],
        fills: [{ start_time: 6, end_time: 8 }],
        levels: { easy: { hits: [{ t: 1, p: 'crash_l' }], generated: true } },
    };
    const notes = mod._drumTabHitsToNotes(tab.hits);
    const meta = H.parseDrumTabMeta(tab, mod._drumTabHitsToNotes);
    assert.deepEqual(meta.starPower, [{ start: 1, end: 2 }]);
    const opts = H.difficultyOptions({ meta, has2x: H.hasKick2x(notes, []) });
    assert.deepEqual(opts.filter(o => o.available).map(o => o.id), ['easy', 'expert', 'expert_plus']);
    assert.equal(H.difficultyChart('expert', notes, [], meta).notes.length, 3, 'Expert drops the double kick');
    assert.equal(H.difficultyChart('expert_plus', notes, [], meta).notes.length, 4);
    assert.deepEqual(H.difficultyChart('easy', notes, [], meta).notes.map(n => n.s * 24 + n.f), [49]);
});

test('difficulty preference: drums_difficulty_v1, default Expert, junk ignored, same ids as session.js', () => {
    const H = require(path.join(__dirname, '..', 'assets', 'session.js'));
    let mod = freshPlugin();
    assert.deepEqual(mod.DIFFICULTY_IDS, Array.from(H.DIFFICULTIES));
    assert.deepEqual(mod.AUTO_LEVEL_IDS, Array.from(H.AUTO_LEVELS));
    assert.equal(mod.STORE_KEYS.difficulty, 'drums_difficulty_v1');
    assert.equal(mod._difficultyPref(), 'expert');
    const store = { drums_difficulty_v1: 'hard' };
    const load = () => {
        global.window = {};
        global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
        global.document = { addEventListener: () => {}, querySelectorAll: () => [] };
        const file = path.join(__dirname, '..', 'screen.js');
        delete require.cache[require.resolve(file)];
        return require(file);
    };
    mod = load();
    assert.equal(mod._difficultyPref(), 'hard');
    store.drums_difficulty_v1 = 'insane';
    assert.equal(load()._difficultyPref(), 'expert');
    mod = load();
    mod._setDifficulty('expert_plus');
    assert.equal(store.drums_difficulty_v1, 'expert_plus');
    mod._setDifficulty('<script>');
    assert.equal(store.drums_difficulty_v1, 'expert', 'invalid ids are not persisted');
});

test('assists: _autoAt follows the difficulty ceiling; _saveCfg validates the new settings', () => {
    const mod = freshPlugin();
    const cfg = mod._cfg();
    assert.equal(cfg.autoKick, 'off');
    assert.equal(cfg.timing, 'normal');
    assert.equal(cfg.proCymbals, true);
    assert.equal(cfg.inputOffsetMs, 0);
    mod._saveCfg('autoKick', 'medium');
    mod._saveCfg('autoCymbals', 'all');
    assert.deepEqual(mod._autoAt('easy'), { kick: true, cymbals: true });
    assert.deepEqual(mod._autoAt('hard'), { kick: false, cymbals: true });
    mod._saveCfg('autoKick', 'nonsense');
    mod._saveCfg('timing', 'turbo');
    mod._saveCfg('synthVolume', 7);
    mod._saveCfg('inputOffsetMs', 9000);
    assert.equal(cfg.autoKick, 'off');
    assert.equal(cfg.timing, 'normal');
    assert.equal(cfg.synthVolume, 1);
    assert.equal(cfg.inputOffsetMs, 250);
    assert.equal(mod._timingParams(), null);
    mod._saveCfg('timing', 'relaxed');
    assert.equal(mod._timingParams().hitWindow.maxWindow, 0.26);
    assert.deepEqual(mod.TIMING_IDS, Object.keys(mod.TIMING_PRESETS));
});

test('assists: _laneIsAuto maps 2D lanes (kick; hi-hat/crash/ride)', () => {
    const mod = freshPlugin();
    const idx = (id) => mod.DRUM_LANES.findIndex(l => l.id === id);
    const a = { kick: true, cymbals: false };
    assert.equal(mod._laneIsAuto(idx('kick'), a), true);
    assert.equal(mod._laneIsAuto(idx('hihat'), a), false);
    assert.equal(mod._laneIsAuto(idx('ride'), { cymbals: true }), true);
    assert.equal(mod._laneIsAuto(idx('snare'), { kick: true, cymbals: true }), false);
});

test('auto notes: _autoNotesBetween returns the auto kick / cymbal notes in (from, to] with velocities', () => {
    const mod = freshPlugin();
    const n = (t, midi, extra) => Object.assign({ t, s: Math.floor(midi / 24), f: midi % 24 }, extra || {});
    const notes = [n(1, 36), n(1, 42), n(1.5, 38), n(2, 36, { ac: true }), n(2, 49), n(3, 35, { mt: true }), n(3, 44)];
    const chords = [{ t: 2.5, notes: [{ s: 1, f: 12 }, { s: 1, f: 14 }] }];   // kick + snare
    const k = mod._autoNotesBetween(notes, chords, 1, 3, { kick: true });
    assert.deepEqual(k, [{ t: 2, midi: 36, vel: 118 }, { t: 3, midi: 35, vel: 55 }, { t: 2.5, midi: 36, vel: 100 }]);
    const c = mod._autoNotesBetween(notes, [], 0, 3, { cymbals: true });
    assert.deepEqual(c.map(x => x.midi), [42, 49], 'hat pedal 44 is not an auto note');
    assert.deepEqual(mod._autoNotesBetween(notes, chords, 0, 3, { kick: false, cymbals: false }), []);
    assert.deepEqual(mod._autoNotesBetween(notes, chords, 3, 3, { kick: true }), [], 'empty window');
    assert.equal(mod._cfg().autoVolume, 0.8);
});
