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

// ── settings page / end-of-song card ──────────────────────────────────────

test('best score: per song and difficulty, only replaced by a higher score', () => {
    const store = {};
    global.window = {};
    global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    global.document = { addEventListener: () => {} };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    const key = mod._bestKey({ filename: 'song.sloppak', title: 'Song' }, 'HARD');
    assert.equal(key, 'drums_best_v1:song.sloppak|HARD');
    assert.equal(mod._bestKey({ title: 'Song' }, ''), 'drums_best_v1:Song|EXPERT');
    assert.deepEqual(mod._recordBest(key, 1000), { prev: null, isBest: true });
    assert.deepEqual(mod._recordBest(key, 900), { prev: 1000, isBest: false });
    assert.equal(store[key], '1000');
    assert.deepEqual(mod._recordBest(key, 1200), { prev: 1000, isBest: true });
    assert.equal(store[key], '1200');
    store[key] = 'junk';
    assert.deepEqual(mod._recordBest(key, 5), { prev: null, isBest: true }, 'unreadable best is replaced');
});

test('MIDI status: hits are counted before routing, with the reason a hit was dropped', () => {
    const mod = freshPlugin();
    mod._midiOnMessage({ data: [0x99, 38, 100] });
    assert.equal(mod._midiDiag.hits, 1);
    assert.match(mod._midiDiag.last, /note 38 vel 100 ch 10 \(no drum view on screen\)/);
    mod._midiOnMessage({ data: [0x89, 38, 0] });     // note-off: not a hit
    mod._midiOnMessage({ data: [0x99, 38, 0] });     // velocity-0 note-on: not a hit
    assert.equal(mod._midiDiag.hits, 1);
});

test('Learn: the next pad hit is assigned to the waiting lane', () => {
    const mod = freshPlugin();
    const cfg = mod._cfg();
    assert.equal(mod._learnConsume(60), false, 'nothing waiting');
    const snare = mod.DRUM_LANES.findIndex(l => l.id === 'snare');
    cfg.learnLane = snare;
    global.document.querySelectorAll = () => [];
    assert.equal(mod._learnConsume(60), true);
    assert.equal(cfg.learnLane, null);
    assert.equal(cfg.customMapping[60], 'snare');
    assert.equal(mod._midiToLaneIdx(60), snare);
});

test('calibration hooks: wide hit window, input offset setter, config snapshot', () => {
    const mod = freshPlugin();
    assert.equal(mod._timingParams(), null, 'Normal preset: engine defaults');
    global.window.__drumsCalibrationWindow = 0.4;
    assert.deepEqual(mod._timingParams(), { hitWindow: { maxWindow: 0.4, minWindow: 0.4, isDynamic: false } });
    delete global.window.__drumsCalibrationWindow;
    global.document.querySelectorAll = () => [];
    assert.equal(global.window.__drumsSetInputOffset(37.4), 37);
    assert.equal(mod._cfg().inputOffsetMs, 37);
    assert.equal(global.window.__drumsSetInputOffset(900), 250, 'clamped');
    assert.equal(global.window.__drumsGetConfig().inputOffsetMs, 250);
});

test('split view: kit hits go to the focused drum view on screen, else the first one on screen', () => {
    const mod = freshPlugin();
    const view = (name, visible) => ({ name, hits: [], _isVisible: () => visible,
        _handleDrumHit(n, v, ts) { this.hits.push([n, v, ts]); } });
    const hidden = view('main (hidden)', false);
    const panel = view('panel 2', true);
    mod._instances.add(hidden);
    mod._instances.add(panel);
    mod._setActiveInstance(hidden);          // focus is on the hidden main-player view
    assert.equal(mod._routeTarget(), panel);
    mod._midiOnMessage({ data: [0x99, 38, 100], timeStamp: 1234.5 });
    assert.deepEqual(panel.hits, [[38, 100, 1234.5]], 'the MIDI arrival time is passed along');
    assert.deepEqual(hidden.hits, []);
    const other = view('panel 1', true);
    mod._instances.add(other);
    mod._setActiveInstance(other);           // a visible focused view wins
    assert.equal(mod._routeTarget(), other);
    mod._instances.clear();
    const page = { _handleDrumHit() {} };   // the settings page has no _isVisible
    mod._instances.add(page);
    mod._setActiveInstance(page);
    assert.equal(mod._routeTarget(), page, 'nothing on screen: the focused one');
    mod._instances.clear();
    mod._setActiveInstance(null);
    assert.equal(mod._routeTarget(), null);
});

test('split view: _setDifficulty hands a split panel its own difficulty, others the global one', () => {
    const mod = freshPlugin();
    global.document.querySelectorAll = () => [];
    let own = null;
    const panel = { _inSplit: () => true, _setOwnDifficulty: (id) => { own = id; }, _difficultyChanged() {} };
    mod._setDifficulty('hard', panel);
    assert.equal(own, 'hard');
    assert.equal(mod._cfg().difficulty, 'expert', 'the global difficulty is untouched');
    mod._setDifficulty('easy');
    assert.equal(mod._cfg().difficulty, 'easy');
    assert.equal(mod.PANEL_DIFF_PREFIX, 'drums_difficulty_panel');
});

test('velocity curve: linear keeps velocity, soft lifts and hard lowers light hits, ends fixed', () => {
    const mod = freshPlugin();
    for (const v of [1, 40, 100, 127]) assert.equal(mod._curveVelocity(v, 'linear'), v);
    assert.ok(mod._curveVelocity(40, 'soft') > 40);
    assert.ok(mod._curveVelocity(40, 'hard') < 40);
    assert.equal(mod._curveVelocity(127, 'soft'), 127);
    assert.equal(mod._curveVelocity(127, 'hard'), 127);
    assert.ok(mod._curveVelocity(1, 'hard') >= 1);
    assert.equal(mod._cfg().velCurve, 'linear');
    mod._saveCfg('velCurve', 'bogus');
    assert.equal(mod._cfg().velCurve, 'linear');
    assert.equal(mod._cfg().room, 0.35, 'Room default');
    mod._saveCfg('room', 3);
    assert.equal(mod._cfg().room, 1);
});

test('_soundNote: a note the kit has no sound for plays its lane sound (Alesis hi-hat on note 24)', () => {
    const mod = freshPlugin();
    mod._saveCfg('customMapping', { 24: 'hihat', 36: 'kick' });
    assert.equal(mod._soundNote(24), 42);
    assert.equal(mod._soundNote(99), 99, 'unmapped: unchanged');
    assert.equal(mod.LANE_SOUND_NOTE.crash, 49);
});

test('hi-hat pedal: one-note modules get closed / semi-open / open from CC4', () => {
    const mod = freshPlugin();
    global.performance = global.performance || { now: () => 0 };
    mod._hhReset();
    assert.equal(mod._hhArticulation(46, 46, true), 46, 'no CC4 yet: note as sent');
    mod._hhPedalMove(127);
    assert.equal(mod._hhArticulation(46, 46, true), 42, 'pedal down: closed');
    mod._hhPedalMove(80);
    assert.equal(mod._hhArticulation(46, 46, true), mod.HH_SEMI_NOTE, 'half way: semi-open');
    assert.equal(mod._hhArticulation(46, 46, false), 46, 'kit without a semi-open sound: open');
    mod._hhPedalMove(0);
    assert.equal(mod._hhArticulation(42, 42, true), 42, 'a closed-hat note stays closed');
    assert.equal(mod._hhArticulation(46, 46, true), 46, 'pedal up: open');
    assert.equal(mod._hhArticulation(38, 38, true), 38, 'not a hi-hat pad');
    mod._saveCfg('hhPedal', 'off');
    assert.equal(mod._hhArticulation(42, 42, true), 42, 'pedal off: notes only');
});

test('hi-hat pedal: modules that split 42 / 46 are trusted, and the CC4 direction is learnt', () => {
    const mod = freshPlugin();
    global.performance = global.performance || { now: () => 0 };
    mod._hhReset();
    // this module sends CC4 0 when closed and 127 when open (reversed)
    for (const [v, n] of [[0, 42], [5, 42], [127, 46], [120, 46]]) { mod._hhPedalMove(v); mod._hhLearn(n); }
    assert.equal(mod._hh.closedHigh, false);
    mod._hhPedalMove(0);   // closed in this module's direction
    assert.equal(mod._hhArticulation(42, 42, true), 42);
    mod._hhPedalMove(60);  // half
    assert.equal(mod._hhArticulation(46, 46, true), mod.HH_SEMI_NOTE);
    mod._hhPedalMove(127); // open
    assert.equal(mod._hhArticulation(46, 46, true), 46);
    assert.equal(mod._hhArticulation(42, 42, true), 42, 'a closed note stays closed');
});

test('hi-hat pedal: a hi-hat pad on an unknown note (Alesis 24) follows the pedal; CC4 reaches it', () => {
    const mod = freshPlugin();
    global.performance = global.performance || { now: () => 0 };
    mod._hhReset();
    mod._saveCfg('customMapping', { 24: 'hihat' });
    mod._hhPedalMove(0);
    assert.equal(mod._hhArticulation(24, 42, true), 46);
    // CC4 through the MIDI router (a drum view must be live)
    const view = { _handleDrumHit() {} };
    mod._instances.add(view);
    mod._setActiveInstance(view);
    mod._midiOnMessage({ data: [0xB9, 4, 127] });
    assert.equal(mod._hh.value, 127);
    assert.equal(mod._hhArticulation(24, 42, true), 42);
});

test('MIDI monitor: _midiMonSummary gives per-note velocity stats and controller ranges', () => {
    const mod = freshPlugin();
    const log = [[0, 0x99, 38, 20], [5, 0x99, 38, 90], [9, 0x99, 38, 60], [12, 0x89, 38, 0], [13, 0x99, 38, 0],
        [20, 0xB9, 4, 127], [30, 0xB9, 4, 0], [40, 0xA9, 49, 100], [50, 0xD9, 7, 0]];
    const s = mod._midiMonSummary(log);
    assert.deepEqual(s.notes[38], { count: 3, ch: 10, min: 20, median: 60, max: 90 });
    assert.deepEqual(s.ctrls.cc4, { count: 2, min: 0, max: 127 });
    assert.equal(s.ctrls.polyAT49.count, 1);
    assert.equal(s.ctrls.chanAT.max, 7);
    assert.equal(s.other.noteOff, 2, 'note-off and note-on velocity 0');
});

test('MIDI monitor: records raw messages only while on, skipping clock / active sensing', () => {
    const mod = freshPlugin();
    global.performance = global.performance || { now: () => 0 };
    mod._midiOnMessage({ data: [0x99, 36, 100], timeStamp: 10 });
    assert.equal(mod._midiMon.log.length, 0);
    mod._midiMonStart();
    mod._midiOnMessage({ data: [0xFE] });
    mod._midiOnMessage({ data: [0xB9, 4, 64], timeStamp: mod._midiMon.t0 + 12.34 });
    assert.deepEqual(mod._midiMon.log, [[12.3, 0xB9, 4, 64]]);
});

test('direct MIDI: nothing is registered when the route says it is not available (macOS / Linux)', async () => {
    const mod = freshPlugin();
    let registered = 0;
    global.window.slopsmith = { midiInput: { version: 1, registerProvider: () => { registered++; }, listSources: () => [] } };
    global.WebSocket = function () {};
    global.fetch = async () => ({ ok: true, json: async () => ({ available: false, inputs: [] }) });
    assert.equal(await mod._directMidiInit(), false);
    assert.equal(registered, 0);
    delete global.fetch; delete global.WebSocket;
});

test('direct MIDI: inputs Web MIDI already lists are left to it; messages carry their mapped arrival time', async () => {
    const mod = freshPlugin();
    const mi = { version: 1, listSources: () => [{ providerId: 'web-midi', label: 'Loupedeck' }], discover() {} };
    global.fetch = async () => ({ ok: true, json: async () => ({ available: true, inputs: [{ id: 0, name: 'Loupedeck' }, { id: 2, name: 'Alesis Drum Module' }] }) });
    let now = 1000;
    global.performance = { now: () => now };
    global.location = { protocol: 'http:', host: 'localhost:8000' };
    const sockets = [];
    global.WebSocket = function (url) { this.url = url; this.readyState = 1; this.sent = []; this.send = (m) => this.sent.push(JSON.parse(m)); this.close = () => { this.closed = true; }; sockets.push(this); };
    const p = mod._directMidiProvider(mi);
    assert.equal(p.providerId, mod.DIRECT_PROVIDER);
    const list = await p.enumerate();
    assert.deepEqual(list, [{ sourceId: 'native-2', label: 'Alesis Drum Module · direct', availability: 'available' }]);
    const opening = p.open('native-2');
    const ws = sockets[0];
    assert.equal(ws.url, 'ws://localhost:8000/ws/plugins/drums/midi?id=2');
    ws.onmessage({ data: JSON.stringify({ open: true, id: 2, t: 5 }) });
    const handle = await opening;
    const got = [];
    handle.addListener((data, ts) => got.push([Array.from(data), ts]));
    // a ping sent at page time 1000 answered at server time 50000, back at page time 1004 (rtt 4)
    now = 1004;
    ws.onmessage({ data: JSON.stringify({ pong: 1000, t: 50000 }) });
    ws.onmessage({ data: JSON.stringify({ d: [0x99, 38, 90], t: 50100 }) });
    assert.deepEqual(got, [[[0x99, 38, 90], 1102]], 'server 50100 = page 1102 (offset from the ping midpoint)');
    p.close('native-2');
    assert.ok(ws.closed);
    delete global.fetch; delete global.WebSocket; delete global.location;
});

test('auto notes: scheduled from the audio clock, forward only, cancelled on a seek', () => {
    const mod = freshPlugin();
    let wall = 0;
    global.performance = { now: () => wall };
    const audio = { paused: false, currentTime: 0, playbackRate: 1, addEventListener() {} };
    global.document.getElementById = (id) => (id === 'audio' ? audio : null);
    let chart = 0.98;
    global.window.highway = { getTime: () => chart };   // core's interpolated chart clock
    const played = [];
    const ctx = { currentTime: 10, state: 'running' };
    const player = { play: (kit, midi, vel, when) => { const src = { midi, when, stop() { this.stopped = true; } }; played.push(src); return src; } };
    mod._testSynth({ ctx, autoGain: {}, synthGain: {}, kit: { manifest: { notes: {} } }, player });
    const w = (t, midi) => ({ t, s: (midi / 24) | 0, f: midi % 24 });
    const notes = [w(1.0, 36), w(1.05, 38), w(1.2, 36), w(1.5, 36)];
    const auto = { kick: true, cymbals: false };
    mod._autoSchedule(notes, [], auto, 1);            // t 0.98 -> schedules (0.98, 1.08]
    assert.deepEqual(played.map((p) => [p.midi, +(p.when - 10).toFixed(3)]), [[36, 0.02]], 'kick 20 ms ahead; snare not auto');
    wall = 16; chart = 0.996;
    mod._autoSchedule(notes, [], auto, 1);            // (1.08, 1.096]: nothing new, no repeat
    assert.equal(played.length, 1);
    mod._autoSchedule(notes, [], auto, 2);            // another panel can't take over right away
    wall = 32; chart = 1.15; ctx.currentTime = 10.17;
    mod._autoSchedule(notes, [], auto, 1);
    assert.deepEqual(played.map((p) => p.midi), [36, 36]);
    assert.ok(Math.abs(played[1].when - (10.17 + 0.05)) < 1e-9, '1.2 kick 50 ms after now');
    chart = 0.5; wall = 48;                            // seek back: pending notes are cancelled
    mod._autoSchedule(notes, [], auto, 1);
    assert.ok(played[1].stopped, 'the queued kick was stopped');
    audio.paused = true;
    mod._autoSchedule(notes, [], auto, 1);
    assert.ok(!Number.isFinite(mod._autoSched.to), 'paused: schedule reset');
    delete global.window.highway;
});

test('not drums: arrangement check and the message (pick the Drums part / no drums at all)', () => {
    const mod = freshPlugin();
    const arrs = [{ index: 0, name: 'Lead' }, { index: 1, name: 'Drums' }];
    assert.equal(mod._isDrumsArrangement({ arrangement: 'Drums' }), true);
    assert.equal(mod._isDrumsArrangement({ arrangement_index: 1, arrangements: arrs }), true);
    assert.equal(mod._isDrumsArrangement({ arrangement: 'Lead', arrangement_index: 0, arrangements: arrs }), false);
    assert.equal(mod._isDrumsArrangement(null), false);
    assert.equal(mod._notDrumsMessage({ arrangement: 'Lead', arrangements: arrs }), 'Pick the Drums part: Lead is not drums');
    assert.equal(mod._notDrumsMessage({ arrangement: 'Lead', arrangements: [{ index: 0, name: 'Lead' }] }), 'This song has no drums');
});

// A tiny <select> stand-in for the split view picker tests.
function fakeSelect(entries, value) {
    const sel = { options: [], value, changes: 0 };
    sel.dispatchEvent = () => { sel.changes++; };
    const mk = ([v, text]) => ({ value: v, textContent: text, hidden: false, disabled: false, isConnected: true,
        get previousElementSibling() { const i = sel.options.indexOf(this); return i > 0 ? sel.options[i - 1] : null; },
        after(o) { sel.options.splice(sel.options.indexOf(o), 1); sel.options.splice(sel.options.indexOf(this) + 1, 0, o); } });
    sel.options = entries.map(mk);
    sel.insertBefore = (o, ref) => { sel.options.splice(sel.options.indexOf(o), 1); sel.options.splice(sel.options.indexOf(ref), 0, o); };
    return sel;
}

test('one drum highway: a split picker shows Drums once, on the Drum Highway', () => {
    const mod = freshPlugin();
    global.Event = function (type) { this.type = type; };
    const sel = fakeSelect([['0', 'Lead'], ['1', 'Drums'], ['__viz__:drums:0', 'Lead (Drum Highway)'],
        ['__viz__:drums:1', 'Drums (Drum Highway)'], ['__viz__:highway_3d:1', 'Drums (3D Highway)'], ['__viz__:highway_3d:0', 'Lead (3D Highway)']], '0');
    mod._tidyPanelSelect(sel);
    const vis = sel.options.filter((o) => !o.hidden).map((o) => o.value);
    assert.deepEqual(vis, ['0', '__viz__:drums:1', '__viz__:highway_3d:0']);
    assert.equal(sel.options.find((o) => o.value === '__viz__:drums:1').textContent, 'Drums', 'named like the arrangement');
    assert.equal(sel.changes, 0, 'nothing moved');
    // a Drums arrangement picked in the 3D guitar view moves to the Drum Highway
    const s2 = fakeSelect([['0', 'Lead'], ['1', 'Drums'], ['__viz__:drums:1', 'Drums (Drum Highway)'], ['__viz__:highway_3d:1', 'Drums (3D Highway)']], '__viz__:highway_3d:1');
    mod._tidyPanelSelect(s2);
    assert.equal(s2.value, '__viz__:drums:1');
    assert.equal(s2.changes, 1);
    // a Drum Highway panel stuck on Lead moves to this song's Drums
    const s3 = fakeSelect([['0', 'Lead'], ['1', 'Drums'], ['__viz__:drums:0', 'Lead (Drum Highway)'], ['__viz__:drums:1', 'Drums (Drum Highway)']], '__viz__:drums:0');
    mod._tidyPanelSelect(s3);
    assert.equal(s3.value, '__viz__:drums:1');
    // a song without drums keeps the saved Drum Highway entry (it shows "This song has no drums")
    const s4 = fakeSelect([['0', 'Lead'], ['__viz__:drums:0', 'Lead (Drum Highway)'], ['__viz__:highway_3d:0', 'Lead (3D Highway)']], '__viz__:drums:0');
    mod._tidyPanelSelect(s4);
    assert.equal(s4.value, '__viz__:drums:0');
    assert.equal(s4.options.find((o) => o.value === '__viz__:drums:0').hidden, false, 'the selected entry is never hidden');
    // other selects are left alone
    const other = fakeSelect([['a', 'A'], ['b', 'B']], 'a');
    mod._tidyPanelSelect(other);
    assert.ok(other.options.every((o) => !o.hidden));
    assert.equal(mod._panelArrIndex('__viz__:drums:12'), 12);
    assert.equal(mod._panelArrIndex('lyrics'), -1);
});

test('one drum highway: the main player shows a Drums arrangement on the Drum Highway, then gives the view back', () => {
    const mod = freshPlugin();
    const picker = { value: 'highway_3d' };
    global.document.getElementById = (id) => (id === 'viz-picker' ? picker : null);
    let si = { arrangement: 'Drums' };
    const installed = [];
    global.window.highway = { setRenderer: (r) => installed.push(r), getSongInfo: () => si };
    let restored = null;
    global.window.setViz = (id) => { restored = id; };
    mod._drumsTakeover();
    assert.equal(installed.length, 1);
    assert.equal(typeof installed[0].draw, 'function', 'a Drum Highway renderer');
    mod._drumsTakeover();
    assert.equal(installed.length, 1, 'only once per song');
    si = { arrangement: 'Lead' };
    mod._drumsTakeover();
    assert.equal(restored, 'highway_3d', 'the picked view is back');
    picker.value = 'drum_highway_3d';
    si = { arrangement: 'Drums' };
    mod._drumsTakeover();
    assert.equal(installed.length, 1, "core's own drum view is a drum view: left alone");
    delete global.window.highway; delete global.window.setViz;
});
