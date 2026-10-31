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

test('matchesArrangement leaves a guitar/bass part on a full-band pack to the guitar views', () => {
    // Auto is first-match-wins and `drums` sorts before `highway_3d`; the drum
    // view refuses non-drum parts, so claiming Lead here would show
    // "Pick the Drums part" instead of the guitar highway.
    const mod = freshPlugin();
    assert.equal(mod.matchesArrangement({ has_drum_tab: true, arrangement: 'Lead' }), false);
    assert.equal(mod.matchesArrangement({ has_drum_tab: true, arrangement: 'Bass' }), false);
});

test('matchesArrangement claims a drum-tab-only pack and the Drums part of a full-band pack', () => {
    const mod = freshPlugin();
    assert.equal(mod.matchesArrangement({ has_drum_tab: true, arrangement: '' }), true);
    assert.equal(mod.matchesArrangement({ has_drum_tab: true, arrangement: 'Drums' }), true);
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

test('_midiAutoChoice: the drum kit beats an auto-picked device; a hand pick or explicit None is kept', () => {
    const m = freshPlugin();
    const store = {};
    global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    const ins = [{ name: 'Loupedeck Live', key: 'web-midi::loupe' }, { name: 'Alesis Drum Module', key: 'web-midi::kit' }];
    assert.equal(m._midiAutoChoice('web-midi::loupe', ins), 'web-midi::kit', 'auto-picked Loupedeck saved earlier -> the kit');
    assert.equal(m._midiAutoChoice(null, ins), 'web-midi::kit', 'never picked -> the kit');
    assert.equal(m._midiAutoChoice('', ins), null, 'explicit None stays off');
    store.drums_midi_manual = '1';
    assert.equal(m._midiAutoChoice('web-midi::loupe', ins), 'web-midi::loupe', 'picked by hand -> kept');
    delete store.drums_midi_manual;
    const noKit = [{ name: 'Loupedeck Live', key: 'web-midi::loupe' }, { name: 'Arturia KeyStep', key: 'web-midi::keys' }];
    assert.equal(m._midiAutoChoice('web-midi::keys', noKit), 'web-midi::keys', 'no kit: keep the saved device');
    assert.equal(m._midiAutoChoice(null, noKit), 'web-midi::loupe', 'never picked -> first input');
    assert.equal(m._midiAutoChoice('web-midi::gone', noKit), null, 'saved device unplugged: wait for it');
});

test('_kitSource: exact Clone Hero name, drum-looking names, no loose substring matches', () => {
    const m = freshPlugin();
    const ins = [{ name: 'Launch Control XL', key: 'a' }, { name: 'Loupedeck Live', key: 'b' }];
    assert.equal(m._kitSource(ins, 'CH 2'), null);
    assert.equal(m._kitSource([...ins, { name: 'CH 2', key: 'c' }], 'CH 2').key, 'c');
    assert.equal(m._kitSource([...ins, { name: 'Alesis Drum Module · direct', key: 'x' }], 'Alesis Drum Module 0').key, 'x');
    assert.equal(m._kitSource([...ins, { name: 'Roland TD-17', key: 'd' }], '').key, 'd');
    assert.equal(m._kitSource([...ins, { name: 'Yamaha DTX-PRO', key: 'e' }], '').key, 'e');
});

test('Clone Hero kit map: default map until a Learn map is saved, with velocity thresholds', () => {
    const m = freshPlugin();
    m._applyKitMapping({ mapping: { 24: 'hihat', 38: 'snare', 49: 'ride' }, min_velocity: { 38: 10 }, device: 'CH 2' });
    assert.equal(m._midiToLaneIdx(24), m.DRUM_LANES.findIndex((l) => l.id === 'hihat'));
    assert.equal(m._belowKitThreshold(38, 5), true);
    assert.equal(m._belowKitThreshold(38, 50), false);
    assert.match(m._mapSourceText(), /Clone Hero profile "CH 2"/);
    m._saveCfg('customMapping', { 38: 'snare' });
    assert.equal(m._baseMapping()[24], undefined, 'a Learn map wins');
    assert.equal(m._belowKitThreshold(38, 5), false, 'thresholds only with the profile map');
    assert.equal(m._mapSourceText(), 'your Learn map');
});

test('_drumTabFor: a Drums arrangement with notes wins over the sloppak drum tab', () => {
    const mod = freshPlugin();
    const dt = { hits: [{ t: 1, p: 'kick' }] };
    const drums = { arrangement: 'Drums' };
    assert.equal(mod._drumTabFor({ drumTab: dt, songInfo: drums, notes: [{ t: 1, s: 1, f: 12 }] }), null);
    assert.equal(mod._drumTabFor({ drumTab: dt, songInfo: drums, notes: [] }), dt, 'empty chart: fall back to the tab');
    assert.equal(mod._drumTabFor({ drumTab: dt, songInfo: { arrangement: 'Lead' }, notes: [{ t: 1, s: 0, f: 3 }] }), dt);
    assert.equal(mod._drumTabFor({ songInfo: drums, notes: [] }), null);
    assert.equal(mod._drumTabFor({ drumTab: { hits: 'x' } }), null);
});

test('hit feedback settings: score on unless turned off, effects / words / shake on, HUD x1.25', () => {
    const mod = freshPlugin();
    const cfg = mod._cfg();
    assert.equal(cfg.hitDetection, true, 'an unset Score switch means on');
    assert.deepEqual(mod._fxSettings(), { level: 'full', words: true, shake: true, hudScale: mod.HUD_SCALE_DEFAULT, groove: true });
    // A player who turned the score off keeps it off.
    global.window = {};
    global.localStorage = { getItem: (k) => ({ drums_hit_detect: 'false', drums_fx_v1: 'subtle', drums_judge_words_v1: 'false',
        drums_shake_v1: 'false', drums_hud_scale_v1: '9' })[k] ?? null, setItem: () => {} };
    const file = require.resolve('../screen.js');
    delete require.cache[file];
    const mod2 = require(file);
    assert.equal(mod2._cfg().hitDetection, false);
    assert.deepEqual(mod2._fxSettings(), { level: 'subtle', words: false, shake: false, hudScale: 2, groove: true });
});

test('_saveCfg validates the hit feedback settings', () => {
    const mod = freshPlugin();
    mod._saveCfg('fx', 'loud');
    assert.equal(mod._cfg().fx, 'full');
    mod._saveCfg('fx', 'off');
    assert.equal(mod._cfg().fx, 'off');
    mod._saveCfg('hudScale', 0.2);
    assert.equal(mod._cfg().hudScale, 0.75);
    mod._saveCfg('hudScale', 'x');
    assert.equal(mod._cfg().hudScale, mod.HUD_SCALE_DEFAULT);
    assert.deepEqual(mod.FX_IDS, ['full', 'subtle', 'off']);
});

test('_timingRgb: green on time, blue early, orange late', () => {
    const mod = freshPlugin();
    assert.equal(mod._timingRgb(0), mod.FX2D.onTime);
    assert.equal(mod._timingRgb(-60), mod.FX2D.early);
    assert.equal(mod._timingRgb(60), mod.FX2D.late);
    assert.equal(mod._timingRgb(NaN), mod.FX2D.onTime);
    const pool = mod._newSparkPool(8);
    assert.equal(pool.born.length, 8);
    assert.ok(pool.born.every(b => b < 0), 'an empty pool has nothing alive');
});

test('_drumTabFor: a tab derived from a legacy Drums arrangement is played over its notes', () => {
    const mod = freshPlugin();
    const dt = { hits: [{ t: 1, p: 'kick' }], derived: 'legacy_arrangement', star_power: [] };
    const notes = [{ t: 1, s: 1, f: 12 }];
    assert.equal(mod._drumTabFor({ drumTab: dt, songInfo: { arrangement: 'Drums' }, notes }), dt);
    assert.equal(mod._drumTabFor({ drumTab: dt, songInfo: { arrangement: 'Lead' }, notes }), dt);
    assert.equal(mod._drumTabFor({ drumTab: { ...dt, derived: 'other' }, songInfo: { arrangement: 'Drums' }, notes }), null);
});

// ── review fixes: velocity, script retry, input offset, star power pad ────

test('_engineVelocity: MIDI 1..127 -> 0..1, so velocity 1 is the softest hit (not full strength)', () => {
    const mod = freshPlugin();
    assert.equal(mod._engineVelocity(127), 1);
    assert.ok(Math.abs(mod._engineVelocity(1) - 1 / 127) < 1e-12);
    assert.ok(mod._engineVelocity(1) < 0.35, 'below the engine ghost threshold');
    assert.equal(mod._engineVelocity(64), 64 / 127);
    assert.equal(mod._engineVelocity(200), 1);
    assert.equal(mod._engineVelocity(undefined), undefined, 'no velocity -> no dynamics judgement');
});

// A tiny DOM for the script loader: <script> elements in <head>, found by src.
function fakeScriptDom() {
    const head = [];
    const doc = {
        addEventListener: () => {},
        querySelectorAll: (sel) => {
            const m = /^script\[src="(.*)"\]$/.exec(sel);
            return m ? head.filter(s => s.src === m[1]) : [];
        },
        querySelector: (sel) => doc.querySelectorAll(sel)[0] || null,
        createElement: () => {
            const el = { src: '', onload: null, onerror: null };
            el.remove = () => { const i = head.indexOf(el); if (i >= 0) head.splice(i, 1); };
            return el;
        },
        head: { appendChild: (el) => { head.push(el); } },
    };
    return { doc, head };
}

test('_loadScoring: a failed script load can be retried (the dead <script> element is removed)', async () => {
    const { doc, head } = fakeScriptDom();
    global.window = {};
    global.localStorage = { getItem: () => null, setItem: () => {} };
    global.document = doc;
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);

    // First try: engine.js loads, session.js fails (network error).
    const p1 = mod._loadScoring();
    assert.equal(head.length, 2);
    window.DrumsEngine = { fake: 'engine' };
    head[0].onload();
    head[1].onerror();
    await assert.rejects(p1, /Failed to load/);
    assert.equal(head.length, 1, 'the failed session.js element is gone');

    // Retry: session.js is requested again (not resolved on the stale tag).
    const p2 = mod._loadScoring();
    assert.equal(head.length, 2);
    assert.match(head[1].src, /session\.js/);
    window.DrumsSession = { fake: 'session' };
    head[1].onload();
    const r = await p2;
    assert.equal(r.E, window.DrumsEngine);
    assert.equal(r.H, window.DrumsSession);
});

test('_loadScoring: a script that loads but never registers is dropped so a retry reloads it', async () => {
    const { doc, head } = fakeScriptDom();
    global.window = {};
    global.localStorage = { getItem: () => null, setItem: () => {} };
    global.document = doc;
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    const p1 = mod._loadScoring();
    head[0].onload(); head[1].onload();            // e.g. an HTML error page served as JS
    await assert.rejects(p1, /did not register/);
    assert.equal(head.length, 0);
    const p2 = mod._loadScoring();
    assert.equal(head.length, 2, 'both files requested again');
    window.DrumsEngine = {}; window.DrumsSession = {};
    head[0].onload(); head[1].onload();
    await p2;
});

test('_setInputOffset saves, clamps and hands the offset to every live view', () => {
    const mod = freshPlugin();
    const seen = [];
    mod._instances.add({ _inputOffsetChanged: () => seen.push(mod._cfg().inputOffsetMs) });
    assert.equal(mod._setInputOffset(23), 23);
    assert.equal(mod._setInputOffset('-400'), -250);
    assert.deepEqual(seen, [23, -250]);
    mod._instances.clear();
});

test('star power pad: drums_sp_pad_v1, off by default, any MIDI note 0..127', () => {
    const mod = freshPlugin();
    assert.equal(mod.STORE_KEYS.spPad, 'drums_sp_pad_v1');
    assert.equal(mod._cfg().spPad, -1);
    assert.equal(mod._spPadName(), '');
    mod._saveCfg('spPad', '44');
    assert.equal(mod._cfg().spPad, 44);
    assert.equal(mod._spPadName(), 'hi-hat pedal');
    mod._saveCfg('spPad', 99);
    assert.equal(mod._spPadName(), 'MIDI note 99');
    mod._saveCfg('spPad', 300);
    assert.equal(mod._cfg().spPad, -1);
    mod._saveCfg('spPad', 'x');
    assert.equal(mod._cfg().spPad, -1);
    assert.equal(mod.SP_PAD_CHOICES[0][0], -1);
});

// ── Public band API (window.feedBackDrums) ──
function fakeInst(canvas, extra) {
    return Object.assign({
        _canvas: () => canvas,
        _isVisible: () => true,
        _inSplit: () => false,
        _setOwnDifficulty() {},
        _engineState: () => ({ score: 7 }),
    }, extra || {});
}

test('band API: input target overrides focus and visibility', () => {
    const mod = freshPlugin();
    const c1 = {}, c2 = {};
    const a = fakeInst(c1), b = fakeInst(c2, { _isVisible: () => false });
    mod._instances.add(a); mod._instances.add(b);
    mod._setActiveInstance(a);
    assert.equal(mod._routeTarget(), a);
    mod._setInputTarget(c2);
    assert.equal(mod._routeTarget(), b);
});

test('band API: null target restores default routing', () => {
    const mod = freshPlugin();
    const c1 = {}, c2 = {};
    const a = fakeInst(c1), b = fakeInst(c2);
    mod._instances.add(a); mod._instances.add(b);
    mod._setInputTarget(c2);
    mod._setInputTarget(null);
    assert.equal(mod._routeTarget(), a);
});

test('band API: unknown canvas falls back to default routing', () => {
    const mod = freshPlugin();
    const a = fakeInst({});
    mod._instances.add(a);
    mod._setInputTarget({});
    assert.equal(mod._routeTarget(), a);
});

test('band API: setDifficulty with canvas sets that instance only, even unsplit', () => {
    const mod = freshPlugin();
    const c1 = {}, c2 = {};
    const got = [];
    const a = fakeInst(c1, { _setOwnDifficulty: (id) => got.push(['a', id]) });
    const b = fakeInst(c2, { _setOwnDifficulty: (id) => got.push(['b', id]) });
    mod._instances.add(a); mod._instances.add(b);
    window.feedBackDrums.setDifficulty('hard', c2);
    window.feedBackDrums.setDifficulty('bogus', c2);
    assert.deepEqual(got, [['b', 'hard']]);
});

test('band API: setDifficulty without canvas is global; getInstanceState reads engine state', () => {
    const mod = freshPlugin();
    const c1 = {};
    let changed = 0;
    mod._instances.add(fakeInst(c1, { _difficultyChanged: () => changed++ }));
    window.feedBackDrums.setDifficulty('easy');
    assert.equal(mod._difficultyPref(), 'easy');
    assert.equal(changed, 1);
    assert.deepEqual(window.feedBackDrums.getInstanceState(c1), { score: 7 });
    assert.equal(window.feedBackDrums.getInstanceState({}), null);
});

test('band API: setDifficulty with an unmatched canvas leaves the global difficulty alone', () => {
    const mod = freshPlugin();
    let changed = 0;
    mod._instances.add(fakeInst({}, { _difficultyChanged: () => changed++ }));
    window.feedBackDrums.setDifficulty('medium');
    assert.equal(mod._difficultyPref(), 'medium');
    changed = 0;
    // A lane canvas the plugin never mounted on (or one already torn down).
    window.feedBackDrums.setDifficulty('easy', {});
    assert.equal(mod._difficultyPref(), 'medium');
    assert.equal(changed, 0);
});

// ── Band difficulty memory, clearDifficulty, setMidiInput ──
test('band API: setDifficulty remembers the band difficulty for a canvas, even before an instance owns it', () => {
    const mod = freshPlugin();
    const before = mod._difficultyPref();
    const c = {};
    window.feedBackDrums.setDifficulty('hard', c);
    assert.equal(mod._bandDifficultyFor(c), 'hard');
    assert.equal(mod._difficultyPref(), before);
});

test('band API: unknown ids are not remembered', () => {
    const mod = freshPlugin();
    const c = {};
    window.feedBackDrums.setDifficulty('bogus', c);
    assert.equal(mod._bandDifficultyFor(c), null);
});

test('_resolveOwnDifficulty prefers the panel in split, the band pin otherwise', () => {
    const mod = freshPlugin();
    assert.equal(mod._resolveOwnDifficulty({ inSplit: true, bandId: 'easy', panelId: 'hard' }), 'hard');
    assert.equal(mod._resolveOwnDifficulty({ inSplit: false, bandId: 'easy', panelId: 'hard' }), 'easy');
    assert.equal(mod._resolveOwnDifficulty({ inSplit: false, bandId: null, panelId: null }), null);
    assert.equal(mod._resolveOwnDifficulty({ inSplit: false, bandId: 'nope', panelId: null }), null);
});

test('band API: clearDifficulty forgets the pin and hands the instance back to the global level', () => {
    const mod = freshPlugin();
    const c = {};
    let cleared = 0;
    mod._instances.add(fakeInst(c, { _clearOwnDifficulty: () => cleared++ }));
    window.feedBackDrums.setDifficulty('hard', c);
    window.feedBackDrums.clearDifficulty(c);
    assert.equal(mod._bandDifficultyFor(c), null);
    assert.equal(cleared, 1);
});

test('band API: setMidiInput saves the pick as a manual choice', () => {
    const mod = freshPlugin();
    const writes = {};
    global.document.querySelectorAll = () => [];   // the async connect refreshes device lists
    global.localStorage.setItem = (k, v) => { writes[k] = v; };
    assert.equal(window.feedBackDrums.setMidiInput('webmidi:kit'), undefined);
    assert.equal(mod._cfg().midiInputId, 'webmidi:kit');
    assert.equal(writes.drums_midi_manual, '1');
    window.feedBackDrums.setMidiInput('');
    assert.equal(mod._cfg().midiInputId, '');
    assert.equal(writes.drums_midi_manual, '');
    const snap = JSON.stringify(writes);
    window.feedBackDrums.setMidiInput(42);
    assert.equal(JSON.stringify(writes), snap);
    assert.equal(mod._cfg().midiInputId, '');
});

// ── Public bus events (drums:hit / miss / overhit / star power) ──
test('_bandEventDetail adds the canvas and keeps the payload', () => {
    const mod = freshPlugin();
    const c = {};
    const d = { type: 'hit', points: 60 };
    const out = mod._bandEventDetail(d, c);
    assert.deepEqual(out, { type: 'hit', points: 60, canvas: c });
    assert.equal(out.canvas, c);
    assert.deepEqual(d, { type: 'hit', points: 60 }, 'the input is not mutated');
});

// ── Band score display switch (setScoreHudHidden) ──
test('band API: setScoreHudHidden remembers per canvas and refuses junk', () => {
    const mod = freshPlugin();
    const api = window.feedBackDrums;
    const c = {}, other = {};
    assert.equal(api.isScoreHudHidden(c), false);
    assert.equal(api.setScoreHudHidden(c, true), true);
    assert.equal(api.isScoreHudHidden(c), true);
    assert.equal(mod._scoreHudHiddenFor(c), true);
    assert.equal(api.isScoreHudHidden(other), false);
    assert.equal(api.setScoreHudHidden(c, 'yes'), false);
    assert.equal(api.isScoreHudHidden(c), true, 'junk changes nothing');
    assert.equal(api.setScoreHudHidden(null, true), false);
    assert.equal(api.setScoreHudHidden('canvas', true), false);
    assert.equal(api.isScoreHudHidden(null), false);
    assert.equal(api.setScoreHudHidden(c, false), true);
    assert.equal(api.isScoreHudHidden(c), false);
    assert.equal(mod._scoreHudHiddenFor(c), false);
});

test('_shouldDrawScoreHud and _shouldShowEndCard follow the hide switch', () => {
    const mod = freshPlugin();
    assert.equal(mod._shouldDrawScoreHud({ hitDetection: true, hidden: false }), true);
    assert.equal(mod._shouldDrawScoreHud({ hitDetection: true, hidden: true }), false);
    assert.equal(mod._shouldDrawScoreHud({ hitDetection: false, hidden: false }), false);
    assert.equal(mod._shouldShowEndCard({ hasSession: true, ssActive: false, hidden: false }), true);
    assert.equal(mod._shouldShowEndCard({ hasSession: true, ssActive: false, hidden: true }), false);
    assert.equal(mod._shouldShowEndCard({ hasSession: true, ssActive: true, hidden: false }), false);
    assert.equal(mod._shouldShowEndCard({ hasSession: false, ssActive: false, hidden: false }), false);
});

test('hidden score display: the run still records its personal best (not in split view)', () => {
    const store = {};
    global.window = {};
    global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    global.document = { addEventListener: () => {} };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    window.feedBack = { on() {}, currentSong: { filename: 'song.sloppak', title: 'Song' } };
    const session = (notesHit, score, bonus) => ({ getState: () => ({ notesHit, notesMissed: 0, score }), getBonus: () => ({ total: bonus }) });
    const badge = { text: 'HARD' };
    // When: a hidden lane in single view skips the card but records the best; split view does neither.
    assert.equal(mod._shouldRecordBestOnly({ hasSession: true, ssActive: false, hidden: true }), true);
    assert.equal(mod._shouldRecordBestOnly({ hasSession: true, ssActive: false, hidden: false }), false, 'the card records it');
    assert.equal(mod._shouldRecordBestOnly({ hasSession: true, ssActive: true, hidden: true }), false, 'split view unchanged');
    assert.equal(mod._shouldRecordBestOnly({ hasSession: false, ssActive: false, hidden: true }), false);
    // What: engine score + bonuses, under the card's key.
    assert.deepEqual(mod._drumsRunTotal(session(5, 1000, 50), badge), { song: window.feedBack.currentSong, diff: 'HARD', total: 1050 });
    assert.equal(mod._drumsRunTotal(session(0, 0, 0), badge), null, 'nothing played');
    assert.deepEqual(mod._recordRunBest(session(5, 1000, 50), badge), { prev: null, isBest: true });
    assert.equal(store['drums_best_v1:song.sloppak|HARD'], '1050');
    assert.deepEqual(mod._recordRunBest(session(5, 900, 0), badge), { prev: 1050, isBest: false });
    assert.equal(store['drums_best_v1:song.sloppak|HARD'], '1050');
    assert.equal(mod._recordRunBest(session(0, 0, 0), badge), null);
    assert.equal(mod._drumsRunTotal(session(3, 10, 0), null).diff, 'EXPERT');
});

test('_modalOpen finds an open modal dialog', () => {
    const mod = freshPlugin();
    let seen = null;
    const docOf = (nodes) => ({ querySelectorAll: (s) => { seen = s; return nodes; } });
    assert.equal(mod._modalOpen(docOf([{}])), true);
    assert.equal(seen, '[aria-modal="true"], .feedBack-modal');
    assert.equal(mod._modalOpen(docOf([])), false);
    assert.equal(mod._modalOpen(null), false);
    assert.equal(mod._modalOpen({}), false);
    assert.equal(mod._modalOpen({ querySelectorAll: () => { throw new Error('boom'); } }), false);
});

test('_modalOpen ignores hidden modals and counts visible ones', () => {
    const mod = freshPlugin();
    const docOf = (nodes, style) => ({
        querySelectorAll: () => nodes,
        defaultView: { getComputedStyle: () => style || {} },
    });
    const vis = (extra) => Object.assign({ getClientRects: () => [1], offsetParent: {} }, extra);
    assert.equal(mod._modalOpen(docOf([vis()])), true, 'visible');
    assert.equal(mod._modalOpen(docOf([vis({ hidden: true })])), false, 'hidden attribute');
    assert.equal(mod._modalOpen(docOf([vis({ closest: () => ({}) })])), false, 'hidden ancestor');
    assert.equal(mod._modalOpen(docOf([vis({ getClientRects: () => [], offsetParent: null })])), false, 'no box');
    assert.equal(mod._modalOpen(docOf([vis()], { display: 'none' })), false, 'display:none');
    assert.equal(mod._modalOpen(docOf([vis()], { visibility: 'hidden' })), false, 'visibility:hidden');
    assert.equal(mod._modalOpen(docOf([vis({ hidden: true }), vis()])), true, 'one visible among hidden');
    assert.equal(mod._modalOpen(docOf([vis({ getClientRects: () => [], offsetParent: {} })])), true, 'offsetParent alone is enough');
});

test('drum, star power and difficulty keys stand down under a modal', () => {
    const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'screen.js'), 'utf8');
    for (const name of ['_onKeyDown', '_onSpKey', '_onDiffKey']) {
        const start = src.indexOf(`${name} = (e) =>`);
        assert.ok(start >= 0, `${name} handler found`);
        const body = src.slice(start);
        const modal = body.indexOf('_modalOpen(document)');
        const prevent = body.indexOf('e.preventDefault()');
        assert.ok(modal >= 0, `${name} checks _modalOpen(document)`);
        assert.ok(modal < prevent, `${name} checks the modal before preventDefault`);
    }
});

// ── Controller drumming (gamepad source wiring, feedBackDrums.setController) ──
const ASSETS = path.join(__dirname, '..', 'assets');
const GP = require(path.join(ASSETS, 'gamepad.js'));
const GPS = require(path.join(ASSETS, 'gamepad-source.js'));
const GPC = require(path.join(ASSETS, 'gamepad-controls.js'));

function memStore(init) {
    const m = new Map(Object.entries(init || {}));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, m };
}

// A fake core gamepad-input domain (as tests/gamepad-source.test.js).
function fakeGi(pads) {
    const held = new Map();
    const gi = {
        version: 1, changeFns: [], pads,
        get claimCount() { return held.size; },
        list() {
            return pads.map((p, index) => ({ index, id: p.id, mapping: p.mapping, connected: p.connected !== false,
                claimedBy: held.has(index) ? held.get(index).owner : null }));
        },
        claim(index, owner) {
            if (!pads[index]) return null;
            const c = held.get(index);
            if (c) return c.owner === owner ? c.handle : null;
            const rec = { owner, listeners: [] };
            const n = pads.slice(0, index + 1).filter((p) => p.id === pads[index].id).length;
            rec.handle = {
                index, id: pads[index].id, controllerKey: pads[index].id + '#' + n,
                addListener(fn) { if (!rec.listeners.includes(fn)) rec.listeners = rec.listeners.concat(fn); },
                removeListener(fn) { rec.listeners = rec.listeners.filter((f) => f !== fn); },
                release() { if (held.get(index) !== rec) return; held.delete(index); gi.change('release', index); },
            };
            held.set(index, rec);
            gi.change('claim', index);
            return rec.handle;
        },
        owner(i) { const c = held.get(i); return c ? c.owner : null; },
        on(name, fn) { gi.changeFns.push(fn); return () => { gi.changeFns = gi.changeFns.filter((f) => f !== fn); }; },
        change(type, index) { for (const fn of gi.changeFns.slice()) fn({ type, index }); },
        button(index, value, padIndex = 0, t = performance.now() / 1000) {
            const c = held.get(padIndex);
            const ev = { type: 'button', index, value, pressed: value >= 0.5, t };
            if (c) for (const fn of c.listeners.slice()) fn(ev);
        },
    };
    return gi;
}

const XBOX = { id: 'Xbox 360 Controller (STANDARD GAMEPAD)', mapping: 'standard' };
const KIT = { id: 'Harmonix Drum Kit', mapping: '' };
const KIT_BINDING = { kind: 'kit', map: {
    red_pad: { type: 'button', index: 1 }, yellow_pad: { type: 'button', index: 2 }, blue_pad: { type: 'button', index: 3 },
    green_pad: { type: 'button', index: 4 }, kick: { type: 'button', index: 5 }, yellow_cymbal: { type: 'button', index: 6 },
    pause: { type: 'button', index: 9 },
} };
const tick = () => new Promise((r) => setImmediate(r));

// The real plugin with real 2D instances: fake DOM / canvas, the scoring and
// gamepad modules preloaded (no <script> loads), a recording bus, an optional
// fake gamepad-input domain. createSession is wrapped to record pro / offset.
function realPlugin({ gi, store } = {}) {
    const listeners = {};
    const emitted = [];
    const judgments = [];
    const sessions = [];
    global.window = {
        addEventListener(n, f) { (listeners[n] = listeners[n] || []).push(f); },
        removeEventListener(n, f) { listeners[n] = (listeners[n] || []).filter((x) => x !== f); },
        dispatchEvent(ev) { if (ev.type === 'drums:judgment') judgments.push(ev.detail); return true; },
        devicePixelRatio: 1,
    };
    global.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
    global.localStorage = store || memStore();
    global.document = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], activeElement: null };
    const busFns = {};
    window.feedBack = {
        on(n, f) { (busFns[n] = busFns[n] || []).push(f); },
        off(n, f) { busFns[n] = (busFns[n] || []).filter((x) => x !== f); },
        emit(n, d) { emitted.push([n, d]); },
    };
    if (gi) window.feedBack.gamepadInput = gi;
    const H = require(path.join(ASSETS, 'session.js'));
    window.DrumsEngine = require(path.join(ASSETS, 'engine.js'));
    window.DrumsSession = Object.assign({}, H, {
        createSession(E, opts) {
            const s = H.createSession(E, opts);
            const rec = { opts, pro: [], offset: [] };
            sessions.push(rec);
            const sp = s.setProDrums, so = s.setInputOffset;
            s.setProDrums = (on) => { rec.pro.push(on); return sp.call(s, on); };
            s.setInputOffset = (ms) => { rec.offset.push(ms); return so.call(s, ms); };
            return s;
        },
    });
    window.DrumsHighway3D = require(path.join(ASSETS, 'highway3d.js'));
    window.DrumsGamepad = GP;
    window.DrumsGamepadSource = GPS;
    window.DrumsGamepadControls = GPC;
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    document.getElementById = () => null;   // after load: no Drums screen to wait for
    const keydown = (e) => { for (const f of (listeners.keydown || []).slice()) f(e); };
    const fire = (n, detail) => { for (const f of (busFns[n] || []).slice()) f({ detail }); };
    return { mod, api: window.feedBackDrums, listeners, emitted, judgments, sessions, keydown, fire };
}
function fakeCtx() {
    const fn = function () { return proxy; };
    const proxy = new Proxy(fn, {
        get(t, k) { if (k === 'measureText') return () => ({ width: 10 }); if (k === Symbol.toPrimitive) return () => 0; return proxy; },
        set() { return true; }, apply() { return proxy; },
    });
    return proxy;
}
function fakeCanvas() {
    return { getContext: () => fakeCtx(), getBoundingClientRect: () => ({ width: 400, height: 300 }), width: 400, height: 300,
        offsetParent: {}, parentNode: null, isConnected: true, getClientRects: () => [1], offsetLeft: 0, offsetTop: 0 };
}
// A drum chart: snares (GM 38 = string 1, fret 14) at 2 s and 3 s. The arrays are
// shared, as core's bundle keeps them across frames (a new array reloads the chart).
const DRUM_NOTES = [{ t: 2, s: 1, f: 14 }, { t: 3, s: 1, f: 14 }];
const NO_CHORDS = [], NO_BEATS = [];
function drumBundle(extra) {
    return Object.assign({ isReady: true, isPlaying: true, currentTime: 2, notes: DRUM_NOTES,
        chords: NO_CHORDS, beats: NO_BEATS, songInfo: { arrangement: 'Drums' } }, extra || {});
}
async function liveView(canvas) {
    const inst = window.feedBackViz_drums2d();
    inst.init(canvas || fakeCanvas());
    await tick(); await tick();   // scoring session + keyboard helpers
    return inst;
}

test('routeTarget skips a controller-pinned instance even when focused or pinned as the input target', () => {
    const mod = freshPlugin();
    const c1 = {}, c2 = {};
    const a = fakeInst(c1, { _controllerPinned: () => true }), b = fakeInst(c2);
    mod._instances.add(a); mod._instances.add(b);
    mod._setActiveInstance(a);
    assert.equal(mod._routeTarget(), b, 'focused but pinned');
    mod._setInputTarget(c1);
    assert.equal(mod._routeTarget(), b, 'input target but pinned');
    mod._instances.delete(b);
    assert.equal(mod._routeTarget(), null, 'only a pinned lane: no target');
    mod._setInputTarget(null);
    assert.equal(mod._routeTarget(), null);
});

test('free source wanted only with a playing unpinned view and no band pins', async () => {
    const w = { wanters: 1, inputTargetPinned: false, controllerPins: false, controlsOpen: false };
    const mod = freshPlugin();
    assert.equal(mod._freePadWanted(w), true);
    assert.equal(mod._freePadWanted({ ...w, wanters: 0 }), false);
    assert.equal(mod._freePadWanted({ ...w, wanters: new Set() }), false);
    assert.equal(mod._freePadWanted({ ...w, inputTargetPinned: true }), false);
    assert.equal(mod._freePadWanted({ ...w, controllerPins: true }), false);
    assert.equal(mod._freePadWanted({ ...w, controlsOpen: true }), false);
    // Live: claims while playing, releases on pause, and stands down for any band pin.
    const gi = fakeGi([XBOX]);
    const { api, mod: m } = realPlugin({ gi });
    const v = await liveView();
    v.draw(drumBundle({ isPlaying: false }));
    await tick();
    assert.equal(gi.claimCount, 0, 'paused: no claim');
    v.draw(drumBundle());
    await tick();
    assert.equal(gi.claimCount, 1, 'playing: claimed');
    assert.equal(gi.owner(0), 'drums');
    v.draw(drumBundle({ isPlaying: false }));
    assert.equal(gi.claimCount, 0, 'paused again: released');
    v.draw(drumBundle());
    assert.equal(gi.claimCount, 1);
    m._setPadControlsOpen(true);
    assert.equal(gi.claimCount, 0, 'the Controllers card open releases it');
    m._setPadControlsOpen(false);
    assert.equal(gi.claimCount, 1);
    api.setInputTarget({});
    assert.equal(gi.claimCount, 0, 'a band input target releases it');
    api.setInputTarget(null);
    assert.equal(gi.claimCount, 1);
    api.setController('Other#1', {});
    assert.equal(gi.claimCount, 0, 'a controller lane (even with no instance yet) releases it');
    assert.equal(m._bandControllerCanvases.size, 1);
    v.destroy();
});

test('free pad hit reaches the route target\'s _handlePadHit with pad, cymbal and time', async () => {
    const gi = fakeGi([XBOX]);
    const { mod } = realPlugin({ gi });
    const v = await liveView();
    v.draw(drumBundle());
    await tick();
    const got = [];
    const other = fakeInst({}, { _handlePadHit: (...a) => got.push(a), _activateSp: (t) => got.push(['sp', t]) });
    mod._instances.add(other);
    mod._setActiveInstance(other);
    gi.button(7, 1, 0, 12.5);   // RT = blue pad (5-Fret blue)
    gi.button(0, 1, 0, 12.75);  // A = kick
    gi.button(3, 1, 0, 13);     // Y = star power
    assert.deepEqual(got, [[3, false, 12500], [0, false, 12750], ['sp', 13000]]);
    mod._instances.delete(other);
    v.destroy();
});

test('effectivePro: pro off for a pad without cymbals, on for a kit with them, cfg off wins', () => {
    const mod = freshPlugin();
    assert.equal(mod._effectivePro({ proCymbals: true, controller: null }), true);
    assert.equal(mod._effectivePro({ proCymbals: true, controller: { hasCymbals: false } }), false);
    assert.equal(mod._effectivePro({ proCymbals: true, controller: { hasCymbals: true } }), true);
    assert.equal(mod._effectivePro({ proCymbals: false, controller: { hasCymbals: true } }), false);
    assert.equal(mod._effectivePro({ proCymbals: false, controller: null }), false);
});

test('effectiveOffset: the controller\'s offset, else 0 for one without, else cfg', () => {
    const mod = freshPlugin();
    const offsets = { 'Kit#1': 35, 'Wild#1': 900, 'Bad#1': 'x' };
    assert.equal(mod._effectiveOffset({ cfgMs: 40, controller: { controllerKey: 'Kit#1' }, offsets }), 35);
    assert.equal(mod._effectiveOffset({ cfgMs: 40, controller: { controllerKey: 'Wild#1' }, offsets }), 250, 'clamped like the global offset');
    assert.equal(mod._effectiveOffset({ cfgMs: 40, controller: { controllerKey: 'Bad#1' }, offsets }), 0);
    assert.equal(mod._effectiveOffset({ cfgMs: 40, controller: { controllerKey: 'Pad#1' }, offsets }), 0);
    assert.equal(mod._effectiveOffset({ cfgMs: 40, controller: { controllerKey: 'constructor' }, offsets }), 0);
    assert.equal(mod._effectiveOffset({ cfgMs: 40, controller: { controllerKey: 'Pad#1' }, offsets: null }), 0);
    assert.equal(mod._effectiveOffset({ cfgMs: 40, controller: null, offsets }), 40);
});

// The last pro / offset a recorded session was given (createSession, then setters).
const lastPro = (rec) => (rec.pro.length ? rec.pro[rec.pro.length - 1] : rec.opts.proDrums);
const lastOffset = (rec) => (rec.offset.length ? rec.offset[rec.offset.length - 1] : rec.opts.inputOffsetMs);
const XKEY = XBOX.id + '#1';
const xboxOffsetStore = () => memStore({ [GP.SETTINGS_KEY]: JSON.stringify({ offsetMs: { [XKEY]: -20 } }), drums_input_offset_ms: '-40' });

test('an idle claimed pad leaves pro and the global offset until its first pad hit, and that hit scores', async () => {
    const gi = fakeGi([XBOX]);
    const { sessions } = realPlugin({ gi, store: xboxOffsetStore() });
    const v = await liveView();
    v.draw(drumBundle({ currentTime: 1.9 }));
    await tick();
    assert.equal(gi.claimCount, 1, 'claimed while playing');
    const s = sessions[0];
    assert.equal(lastPro(s), true, 'pro stays on for an idle pad');
    assert.equal(lastOffset(s), -40, 'global offset');
    // Slightly early (the pro switch rebuilds the chart from the last frame on).
    v.draw(drumBundle({ currentTime: 1.94 }));
    gi.button(4, 1);   // LB = red pad (snare): the engaging hit
    assert.equal(lastPro(s), false, 'engaged: an Xbox pad plays without pro cymbals');
    assert.equal(lastOffset(s), -20, 'with its own offset');
    v.draw(drumBundle({ currentTime: 2.2 }));
    v.draw(drumBundle({ currentTime: 2.4 }));
    assert.equal(v._engineState().notesHit, 1, 'the engaging hit scored');
    v.destroy();
});

test('parking (setWanted false) leaves effective pro and offset unchanged', async () => {
    const gi = fakeGi([XBOX]);
    const { sessions } = realPlugin({ gi, store: xboxOffsetStore() });
    const v = await liveView();
    v.draw(drumBundle());
    await tick();
    gi.button(0, 1);   // engage
    const s = sessions[0];
    assert.equal(lastPro(s), false);
    assert.equal(lastOffset(s), -20);
    const engagedAt = s.pro.length;
    v.draw(drumBundle({ isPlaying: false }));   // pause: parked
    assert.equal(gi.claimCount, 0);
    assert.equal(lastPro(s), false, 'pro stays off while parked');
    assert.equal(lastOffset(s), -20, 'offset stays while parked');
    v.draw(drumBundle());
    assert.equal(gi.claimCount, 1);
    assert.equal(lastPro(s), false);
    assert.ok(!s.pro.slice(engagedAt).includes(true), 'pro never flipped back');
    assert.equal(sessions.length, 1, 'never a new session');
    v.destroy();
});

const NEXT_SONG = [{ t: 5, s: 1, f: 14 }];
test('a new chart after an engaged song is back on the global settings until a hit', async () => {
    const gi = fakeGi([XBOX]);
    const { sessions } = realPlugin({ gi, store: xboxOffsetStore() });
    const v = await liveView();
    v.draw(drumBundle());
    await tick();
    gi.button(0, 1);
    const s = sessions[0];
    assert.equal(lastPro(s), false);
    v.draw(drumBundle({ isReady: false }));   // song change
    v.draw(drumBundle({ notes: NEXT_SONG }));
    assert.equal(lastPro(s), true);
    assert.equal(lastOffset(s), -40);
    gi.button(0, 0); gi.button(0, 1);
    assert.equal(lastPro(s), false, 'engaged again by a hit');
    v.destroy();
});

test('an engaged pad unplugged while parked: back on the global settings', async () => {
    const gi = fakeGi([XBOX]);
    const { sessions } = realPlugin({ gi, store: xboxOffsetStore() });
    const v = await liveView();
    v.draw(drumBundle());
    await tick();
    gi.button(0, 1);
    v.draw(drumBundle({ isPlaying: false }));
    const s = sessions[0];
    assert.equal(lastPro(s), false);
    gi.change('disconnect', 0);
    assert.equal(lastPro(s), true);
    assert.equal(lastOffset(s), -40);
    v.destroy();
});

test('an engaged, parked pad stops driving unpinned views once a band pin exists', async () => {
    const gi = fakeGi([XBOX]);
    const { api, sessions } = realPlugin({ gi, store: xboxOffsetStore() });
    const v = await liveView();
    v.draw(drumBundle());
    await tick();
    gi.button(0, 1);
    assert.equal(lastPro(sessions[0]), false);
    api.setController('Other#1', fakeCanvas());   // a band lane: the free pad parks
    assert.equal(gi.claimCount, 0);
    assert.equal(lastPro(sessions[0]), true, 'the MIDI lane gets pro cymbals back');
    assert.equal(lastOffset(sessions[0]), -40);
    const fresh = await liveView();
    assert.equal(sessions[1].opts.proDrums, true, 'a fresh unpinned view starts with pro on');
    assert.equal(sessions[1].opts.inputOffsetMs, -40, 'and the global offset');
    fresh.destroy(); v.destroy();
});

test('setController before init pins the instance that inits on the canvas; bad arguments return false; clearController restores routing', async () => {
    const gi = fakeGi([XBOX, KIT]);
    const { api, mod } = realPlugin({ gi, store: memStore({ [GP.BINDINGS_KEY]: JSON.stringify({ [KIT.id + '#1']: KIT_BINDING }) }) });
    assert.equal(api.setController('', {}), false);
    assert.equal(api.setController(5, {}), false);
    assert.equal(api.setController('Kit#1', null), false);
    assert.equal(api.setController('Kit#1', 'canvas'), false);
    assert.equal(mod._bandControllerCanvases.size, 0);
    const lane = fakeCanvas();
    assert.equal(api.setController(KIT.id + '#1', lane), true);
    const pinned = await liveView(lane);
    const free = await liveView();
    await tick();
    assert.equal(pinned._controllerPinned(), true);
    assert.equal(gi.owner(1), 'drums', 'the lane claimed its kit at once (not playing yet)');
    assert.equal(gi.owner(0), null, 'and nothing else');
    mod._setActiveInstance(pinned);
    assert.equal(mod._routeTarget(), free);
    // Calling again changes the controller.
    assert.equal(api.setController(XBOX.id + '#1', lane), true);
    await tick();
    assert.equal(gi.owner(1), null);
    assert.equal(gi.owner(0), 'drums');
    api.clearController(lane);
    assert.equal(gi.claimCount, 0, 'the lane released its controller');
    assert.equal(pinned._controllerPinned(), false);
    assert.equal(mod._bandControllerCanvases.size, 0);
    mod._setActiveInstance(pinned);
    assert.equal(mod._routeTarget(), pinned, 'back in kit / keyboard routing');
    pinned.destroy(); free.destroy();
});

test('a pinned lane stays claimed while paused; Start and a held Back go to the band bus, never togglePlay', async () => {
    const gi = fakeGi([XBOX]);
    const { api, emitted } = realPlugin({ gi });
    let toggles = 0;
    window.togglePlay = () => { toggles++; };
    const lane = fakeCanvas();
    api.setController(XBOX.id + '#1', lane);
    const v = await liveView(lane);
    await tick();
    v.draw(drumBundle({ isPlaying: false }));
    assert.equal(gi.claimCount, 1, 'held while paused');
    gi.button(9, 1); gi.button(9, 0);   // Start
    const band = emitted.filter(([n]) => n.startsWith('drums:band-'));
    assert.deepEqual(band.map(([n]) => n), ['drums:band-pause']);
    assert.deepEqual(band[0][1], { controllerKey: XBOX.id + '#1', canvas: lane });
    assert.equal(toggles, 0);
    v.destroy();
    assert.equal(gi.claimCount, 0, 'destroy releases it');
});

test('a pinned lane: a 1 s hold on Back emits drums:band-back-hold', async (t) => {
    const gi = fakeGi([XBOX]);
    const { api, emitted } = realPlugin({ gi });
    const lane = fakeCanvas();
    api.setController(XBOX.id + '#1', lane);
    const v = await liveView(lane);
    await tick();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        gi.button(8, 1);
        t.mock.timers.tick(GPS.BACK_HOLD_MS);
        gi.button(8, 0);
    } finally { t.mock.timers.reset(); }
    const band = emitted.filter(([n]) => n.startsWith('drums:band-'));
    assert.deepEqual(band, [['drums:band-back-hold', { controllerKey: XBOX.id + '#1', canvas: lane }]]);
    v.destroy();
});

test('free source Start calls a guarded togglePlay', async () => {
    const gi = fakeGi([XBOX]);
    realPlugin({ gi });
    const v = await liveView();
    v.draw(drumBundle());
    await tick();
    gi.button(9, 1); gi.button(9, 0);   // no togglePlay: nothing thrown
    let toggles = 0;
    window.togglePlay = () => { toggles++; throw new Error('boom'); };
    const warn = console.warn; const warned = [];
    console.warn = (...a) => warned.push(a);
    try { gi.button(9, 1); } finally { console.warn = warn; }
    assert.equal(toggles, 1);
    assert.equal(warned.length, 1);
    v.destroy();
});

test('pinned lane: Enter, difficulty and drum keys do nothing', async () => {
    const gi = fakeGi([XBOX]);
    const { api, keydown, sessions, mod } = realPlugin({ gi });
    const lane = fakeCanvas();
    api.setController(XBOX.id + '#1', lane);
    const v = await liveView(lane);
    v.draw(drumBundle());
    const before = mod._difficultyPref();
    let prevented = 0;
    const key = (code, k) => ({ code, key: k, target: null, preventDefault() { prevented++; }, stopImmediatePropagation() {} });
    keydown(key('Enter', 'Enter'));
    keydown(key('KeyD', 'd'));
    keydown(key('KeyF', 'f'));
    assert.equal(prevented, 0, 'no key handled on a controller lane');
    assert.equal(v._engineState().overhits, 0);
    assert.equal(mod._difficultyPref(), before);
    // The same keys on an unpinned view are taken (F = red pad, an overhit here).
    api.clearController(lane);
    keydown(key('KeyF', 'f'));
    assert.equal(prevented, 1);
    assert.equal(sessions.length, 1);
    v.destroy();
});

test('pinned lane: the session, drums:judgment and the timing suggestion use the controller\'s offset', async () => {
    const key = XBOX.id + '#1';
    const store = memStore({ [GP.SETTINGS_KEY]: JSON.stringify({ offsetMs: { [key]: 20 } }), drums_input_offset_ms: '-60' });
    const gi = fakeGi([XBOX]);
    const { api, judgments, sessions, mod } = realPlugin({ gi, store });
    assert.equal(mod._cfg().inputOffsetMs, -60);
    const lane = fakeCanvas();
    api.setController(key, lane);
    const v = await liveView(lane);
    await tick();
    assert.equal(sessions[0].opts.inputOffsetMs, 20, 'the session starts with the controller offset');
    v.draw(drumBundle({ currentTime: 2.02 }));
    gi.button(4, 1);   // LB = red pad (snare)
    v.draw(drumBundle({ currentTime: 2.1 }));
    v.draw(drumBundle({ currentTime: 2.2 }));
    assert.ok(judgments.length >= 1, 'a judged hit');
    assert.equal(judgments[0].inputOffsetMs, 20);
    assert.equal(judgments[0].canvas, lane);
    assert.equal(judgments[0].controllerKey, key, 'Calibrate tells controllers apart');
    assert.equal(judgments[0].input, 'controller');
    assert.equal(judgments[0].kickOffsetMs, 0, 'a snare hit');
    // The global offset changing leaves the lane on its controller's offset.
    mod._setInputOffset(10);
    assert.equal(sessions[0].offset[sessions[0].offset.length - 1], 20);
    // The timing meter's Apply sets the controller's offset, not the global one.
    v._applyTimingSuggestion(47.4);
    assert.equal(GP.loadSettings().offsetMs[key], 47);
    assert.equal(mod._cfg().inputOffsetMs, 10);
    assert.equal(sessions[0].offset[sessions[0].offset.length - 1], 47);
    v.draw(drumBundle({ currentTime: 3.04 }));
    gi.button(4, 0); gi.button(4, 1);
    v.draw(drumBundle({ currentTime: 3.1 }));
    v.draw(drumBundle({ currentTime: 3.3 }));
    assert.equal(judgments[judgments.length - 1].inputOffsetMs, 47);
    // On a view with no controller it is the global offset, as before.
    api.clearController(lane);
    GP.setOffset(key, 47);
    const free = await liveView();
    free._applyTimingSuggestion(-15);
    assert.equal(mod._cfg().inputOffsetMs, -15);
    free.destroy();
    v.destroy();
});

test('Calibrate: with Freestyle on, the calibration window still judges (drums:judgment)', async () => {
    const key = XBOX.id + '#1';
    // (Without the window this lane plays Freestyle and judges nothing.)
    const store = memStore({ drums_play_style_v1: 'freestyle', [GP.SETTINGS_KEY]: JSON.stringify({ offsetMs: { [key]: 20 } }) });
    const gi = fakeGi([XBOX]);
    const { api, judgments } = realPlugin({ gi, store });
    window.__drumsCalibrationWindow = 0.5;
    const lane = fakeCanvas();
    api.setController(key, lane);
    const v = await liveView(lane);
    await tick();
    v.draw(drumBundle({ currentTime: 2.02 }));
    gi.button(4, 1);   // LB = red pad (snare)
    v.draw(drumBundle({ currentTime: 2.1 }));
    v.draw(drumBundle({ currentTime: 2.2 }));
    assert.ok(judgments.length >= 1, 'a judged hit, not a Freestyle tap');
    assert.equal(judgments[0].controllerKey, key);
    delete window.__drumsCalibrationWindow;
    v.destroy();
});

test('Calibrate API: controller and kick offsets round-trip and reach live views', async () => {
    const key = XBOX.id + '#1';
    const gi = fakeGi([XBOX]);
    const { api, sessions, mod } = realPlugin({ gi, store: memStore() });
    const lane = fakeCanvas();
    api.setController(key, lane);
    const v = await liveView(lane);
    await tick();
    assert.equal(await api.setControllerOffset(key, 33), 33);
    assert.deepEqual(await api.getControllerOffsets(), { [key]: 33 });
    assert.equal(sessions[0].offset[sessions[0].offset.length - 1], 33, 'the live lane uses it');
    assert.equal(await api.setControllerOffset('', 5), null);
    assert.equal(await api.setControllerOffset(key, NaN), null);
    assert.equal(api.setKickOffset(-12), -12);
    assert.equal(api.getKickOffset(), -12);
    assert.equal(mod._cfg().kickOffsetMs, -12);
    assert.equal(api.setKickOffset('x'), null);
    v.destroy();
});

test('listControllers names, kinds, cymbals and keys (two identical pads #1, #2; unknown non-standard kind null)', async () => {
    const odd = { id: 'Mystery Pad (Vendor: 1234 Product: 5678)', mapping: '' };
    const gi = fakeGi([XBOX, KIT, XBOX, odd]);
    const { api } = realPlugin({ gi, store: memStore({ [GP.BINDINGS_KEY]: JSON.stringify({ [KIT.id + '#1']: KIT_BINDING }) }) });
    const list = await api.listControllers();
    assert.deepEqual(list.map((c) => [c.index, c.controllerKey, c.name, c.kind, c.hasCymbals, c.connected, c.claimedBy]), [
        [0, XBOX.id + '#1', 'Xbox 360 Controller', 'gamepad', false, true, null],
        [1, KIT.id + '#1', 'Harmonix Drum Kit', 'kit', true, true, null],
        [2, XBOX.id + '#2', 'Xbox 360 Controller 2', 'gamepad', false, true, null],
        [3, odd.id + '#1', 'Mystery Pad', null, false, true, null],
    ]);
    assert.equal(list[0].id, XBOX.id);
    assert.equal(list[0].mapping, 'standard');
    // No gamepad-input domain: an empty list, no gamepad load.
    const bare = realPlugin({});
    assert.deepEqual(await bare.api.listControllers(), []);
});

test('createMapper maps a standard pad\'s Start to pause; unknown key gives null', async () => {
    const gi = fakeGi([XBOX]);
    const { api } = realPlugin({ gi });
    const m = await api.createMapper(XBOX.id + '#1');
    assert.deepEqual(m.map({ type: 'button', index: 9, value: 1, pressed: true }), [{ action: 'pause', value: 1 }]);
    assert.equal(await api.createMapper('Nobody#1'), null);
    assert.equal(await api.createMapper(''), null);
});

test('a view with no chart never wants a claim', async () => {
    const gi = fakeGi([XBOX]);
    realPlugin({ gi });
    const v = await liveView();
    // A guitar part in a drum view (no drum tab): nothing to play.
    v.draw(drumBundle({ songInfo: { arrangement: 'Lead', arrangements: [{ index: 0, name: 'Lead' }] } }));
    assert.equal(v._padWant(), false);
    assert.equal(gi.claimCount, 0);
    // A drum part with no notes.
    v.draw(drumBundle({ isReady: false }));
    v.draw(drumBundle({ notes: [] }));
    await tick();
    assert.equal(v._padWant(), false);
    assert.equal(gi.claimCount, 0);
    v.draw(drumBundle());
    await tick();
    assert.equal(v._padWant(), true);
    assert.equal(gi.claimCount, 1);
    v.destroy();
    assert.equal(gi.claimCount, 0, 'the last wanter leaving releases it');
});

test('no gamepad-input domain (older core): no source, nothing thrown or logged', async () => {
    const { api } = realPlugin({});
    const warn = console.warn, log = console.log, err = console.error; const said = [];
    console.warn = console.log = console.error = (...a) => said.push(a);
    try {
        const lane = fakeCanvas();
        const v = await liveView();
        for (let i = 0; i < 5; i++) v.draw(drumBundle());
        assert.equal(api.setController('Pad#1', lane), true);
        const p = await liveView(lane);
        for (let i = 0; i < 5; i++) p.draw(drumBundle());
        api.clearController(lane);
        v.destroy(); p.destroy();
    } finally { console.warn = warn; console.log = log; console.error = err; }
    assert.deepEqual(said, []);
});

test('spHint for a standard pad, another controller and none', () => {
    const mod = freshPlugin();
    const fills = { activation: [1] };
    assert.equal(mod._spHint({ meta: fills, controller: { standardLayout: true } }), 'Hit the marked note at the end of the fill to activate');
    assert.equal(mod._spHint({ meta: null, controller: { standardLayout: true } }), 'Press Y to activate star power');
    assert.equal(mod._spHint({ meta: { activation: [] }, controller: { standardLayout: false } }), 'Press Star power to activate star power');
    assert.equal(mod._spHint({ meta: null, controller: null, spPadName: '' }), 'Press Enter to activate star power');
    assert.equal(mod._spHint({ meta: null, controller: null, spPadName: 'hi-hat pedal' }), 'Press Enter or hit hi-hat pedal to activate star power');
});

test('a controller-pinned hidden lane records no best', () => {
    const mod = freshPlugin();
    assert.equal(mod._shouldRecordBestOnly({ hasSession: true, ssActive: false, hidden: true, controllerPinned: true }), false);
    assert.equal(mod._shouldRecordBestOnly({ hasSession: true, ssActive: false, hidden: true, controllerPinned: false }), true);
    assert.equal(mod._shouldRecordBestOnly({ hasSession: true, ssActive: false, hidden: true }), true, 'free pad / kit: as today');
});

test('openControls shows plugin-drums and Back returns to returnTo once', () => {
    const mod = freshPlugin();
    const shown = [];
    window.showScreen = (id) => shown.push(id);
    let scrolled = 0;
    document.querySelector = (sel) => (sel === 'section[aria-labelledby="dr-h-pads"]' ? { scrollIntoView: () => { scrolled++; } } : null);
    window.feedBackDrums.openControls({ returnTo: 'plugin-rockherosmith' });
    assert.deepEqual(shown, ['plugin-drums']);
    assert.equal(scrolled, 1);
    mod._pageBack();
    mod._pageBack();
    assert.deepEqual(shown, ['plugin-drums', 'plugin-rockherosmith', 'home']);
    window.feedBackDrums.openControls();
    mod._pageBack();
    assert.deepEqual(shown.slice(-2), ['plugin-drums', 'home'], 'default home');
});

test('_loadGamepad loads gamepad.js and gamepad-source.js with the asset version', async () => {
    const { doc, head } = fakeScriptDom();
    global.window = {};
    global.localStorage = { getItem: () => null, setItem: () => {} };
    global.document = doc;
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    const p = mod._loadGamepad();
    assert.deepEqual(head.map((s) => s.src), ['/api/plugins/drums/assets/gamepad.js?v=4.12.0', '/api/plugins/drums/assets/gamepad-source.js?v=4.12.0']);
    window.DrumsGamepad = GP; window.DrumsGamepadSource = GPS;
    head[0].onload(); head[1].onload();
    const r = await p;
    assert.equal(r.G, GP);
    assert.equal(r.S, GPS);
});

test('a pinned lane keeps its pin when highway swaps its canvas; teardown forgets the new one', async () => {
    const gi = fakeGi([XBOX]);
    const { api, mod, fire } = realPlugin({ gi });
    const lane = fakeCanvas(), swapped = fakeCanvas();
    api.setController(XKEY, lane);
    const v = await liveView(lane);
    await tick();
    fire('highway:canvas-replaced', { oldCanvas: lane, newCanvas: swapped });
    assert.equal(v._controllerPinned(), true);
    assert.equal(mod._bandControllerFor(swapped), XKEY);
    assert.equal(mod._bandControllerFor(lane), null);
    assert.deepEqual([...mod._bandControllerCanvases], [swapped]);
    const other = await liveView();
    mod._setActiveInstance(v);
    assert.equal(mod._routeTarget(), other, 'still out of kit routing');
    v.destroy();
    assert.equal(mod._bandControllerCanvases.size, 0);
    other.destroy();
});

test('a pinned lane ignores pad presses while paused (no score; the sound is skipped by the same early return)', async () => {
    const gi = fakeGi([XBOX]);
    const { api } = realPlugin({ gi });
    const lane = fakeCanvas();
    api.setController(XKEY, lane);
    const v = await liveView(lane);
    await tick();
    v.draw(drumBundle({ isPlaying: false, currentTime: 2.0 }));
    gi.button(4, 1); gi.button(4, 0);   // LB on the band's pause menu, right on the 2 s snare
    gi.button(0, 1); gi.button(0, 0);   // A
    v.draw(drumBundle({ isPlaying: false, currentTime: 2.0 }));
    let st = v._engineState();
    assert.deepEqual([st.notesHit, st.overhits], [0, 0], 'paused: nothing scored');
    v.draw(drumBundle({ currentTime: 3.0 }));   // playing
    gi.button(4, 1);
    v.draw(drumBundle({ currentTime: 3.2 }));
    st = v._engineState();
    assert.equal(st.notesHit, 1, 'playing: the press scores');
    v.destroy();
});

test('listControllers: identical ids are numbered over connected controllers, as core does', async () => {
    const off = { ...XBOX, connected: false };
    const gi = fakeGi([off, XBOX, XBOX]);
    const { api } = realPlugin({ gi });
    const list = await api.listControllers();
    assert.deepEqual(list.map((c) => [c.index, c.controllerKey, c.name]), [
        [1, XKEY, 'Xbox 360 Controller'],
        [2, XBOX.id + '#2', 'Xbox 360 Controller 2'],
    ], 'a disconnected one without a core key is left out');
    // With core's list().controllerKey (Plan 3 core) it is used as is, also when disconnected.
    const list0 = gi.list;
    gi.list = () => list0().map((e, i) => ({ ...e, controllerKey: [XBOX.id + '#2', XKEY, XBOX.id + '#3'][i] }));
    const keyed = await api.listControllers();
    assert.deepEqual(keyed.map((c) => [c.index, c.controllerKey, c.connected, c.name]), [
        [0, XBOX.id + '#2', false, 'Xbox 360 Controller 2'],
        [1, XKEY, true, 'Xbox 360 Controller'],
        [2, XBOX.id + '#3', true, 'Xbox 360 Controller 2'],
    ]);
});

test('timing Apply on a pinned lane without the gamepad module leaves the global offset alone', async () => {
    const { api, mod } = realPlugin({ store: memStore({ drums_input_offset_ms: '12' }) });
    delete window.DrumsGamepad;
    const lane = fakeCanvas();
    api.setController(XKEY, lane);
    const v = await liveView(lane);
    v._applyTimingSuggestion(80);
    assert.equal(mod._cfg().inputOffsetMs, 12);
    v.destroy();
});

test('createMapper with no gamepad-input domain resolves null without loading gamepad.js', async () => {
    const { api } = realPlugin({});
    delete window.DrumsGamepad;
    delete window.DrumsGamepadSource;
    let queried = 0;
    document.querySelector = () => { queried++; return null; };
    assert.equal(await api.createMapper(XKEY), null);
    assert.equal(queried, 0, 'no script load attempted');
});

test('the Drums screen Back survives a throwing showScreen', () => {
    const mod = freshPlugin();
    window.showScreen = () => { throw new Error('boom'); };
    const warn = console.warn; const warned = [];
    console.warn = (...a) => warned.push(a);
    try { mod._pageBack(); } finally { console.warn = warn; }
    assert.equal(warned.length, 1);
});

// ── The Controllers card on the Drums screen ──

function cardElement(tag) {
    const el = {
        tagName: String(tag).toUpperCase(), children: [], style: { setProperty() {} }, dataset: {}, listeners: {}, parentNode: null,
        textContent: '', value: '', disabled: false, hidden: false, className: '',
        appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = el; el.children.push(c); return c; },
        append(...cs) { for (const c of cs) el.appendChild(c); },
        replaceChildren(...cs) { for (const c of el.children.slice()) c.remove(); for (const c of cs) el.appendChild(c); },
        remove() { const p = el.parentNode; if (p) { p.children.splice(p.children.indexOf(el), 1); el.parentNode = null; } },
        setAttribute() {},
        addEventListener(type, fn) { (el.listeners[type] || (el.listeners[type] = [])).push(fn); },
        fire(type) { for (const fn of (el.listeners[type] || []).slice()) fn({ type, target: el }); },
    };
    return el;
}
function cardFind(root, dr) {
    if (root.dataset && root.dataset.dr === dr) return root;
    for (const c of root.children) { const r = cardFind(c, dr); if (r) return r; }
    return null;
}
function cardCount(root, dr) {
    return (root.dataset && root.dataset.dr === dr ? 1 : 0) + root.children.reduce((n, c) => n + cardCount(c, dr), 0);
}
// Gives the Drums screen's page a Controllers list over a fake Controllers list element.
function pageWithList(mod) {
    const list = cardElement('div');
    mod._testPage({ querySelector: (sel) => (sel.includes('"padList"') ? list : null), querySelectorAll: () => [] });
    return list;
}
const PAD2 = { id: 'Second Pad (STANDARD GAMEPAD)', mapping: 'standard' };

test('opening the Drums screen releases the free claim and keeps pinned claims; the card never claims a pinned controller; leaving lets the free source claim again', async () => {
    const gi = fakeGi([XBOX, PAD2]);
    const { api, mod } = realPlugin({ gi });
    document.createElement = cardElement;
    const list = pageWithList(mod);
    const v = await liveView();
    v.draw(drumBundle());
    await tick();
    assert.equal(gi.owner(0), 'drums', 'the free source holds the first pad');
    mod._padCardOpen();
    await tick(); await tick();
    assert.equal(gi.owner(0), 'drums.controls', 'the free claim is released and the card has the pad');
    assert.equal(gi.owner(1), 'drums.controls');
    assert.equal(cardCount(list, 'padCard'), 2);
    mod._padCardClose();
    assert.equal(gi.owner(1), null, 'the card let go');
    assert.equal(gi.owner(0), 'drums', 'the free source claims again');
    assert.equal(list.children.length, 0);
    // A band lane pins the second pad: it keeps its claim while the card is open.
    const lane = fakeCanvas();
    api.setController(PAD2.id + '#1', lane);
    const pinned = await liveView(lane);
    await tick();
    assert.equal(gi.owner(1), 'drums', 'the lane\'s claim');
    assert.equal(gi.owner(0), null, 'a band pin: the free source claims nothing');
    mod._padCardOpen();
    await tick(); await tick();
    assert.equal(gi.owner(1), 'drums', 'the pinned claim is kept');
    assert.equal(gi.owner(0), 'drums.controls');
    assert.equal(cardCount(list, 'padCard'), 1, 'only the unpinned controller has a card');
    mod._padCardClose();
    assert.equal(gi.owner(1), 'drums');
    assert.equal(gi.owner(0), null);
    api.clearController(lane);
    assert.equal(gi.owner(0), 'drums', 'no pin left: the free source claims again');
    pinned.destroy(); v.destroy();
});

test('opening the Drums screen without core\'s gamepad-input shows a note and loads nothing', async () => {
    const { mod } = realPlugin({});
    document.createElement = cardElement;
    const list = pageWithList(mod);
    mod._padCardOpen();
    await tick();
    assert.match(list.textContent, /newer feedBack/);
    mod._padCardClose();
});

// A page whose every [data-dr] lookup is a fake element (the real screen.html isn't loaded); padList is `list`.
function fullPage(mod, list) {
    const els = new Map();
    const get = (sel) => {
        if (sel.includes('"padList"')) return list;
        if (!els.has(sel)) {
            const e = cardElement('div');
            e.options = []; e.checked = false; e.style = { setProperty() {}, removeProperty() {} }; e.classList = { add() {}, remove() {}, contains: () => false };
            e.querySelector = () => null; e.querySelectorAll = () => [];
            els.set(sel, e);
        }
        return els.get(sel);
    };
    mod._testPage({ querySelector: get, querySelectorAll: () => [], classList: { contains: () => false } });
}

test('a saved binding refreshes the sources: the card drives the free source and every instance', async () => {
    const gi = fakeGi([XBOX]);
    const { mod, sessions } = realPlugin({ gi });
    document.createElement = cardElement;
    document.getElementById = () => null;
    const list = cardElement('div');
    fullPage(mod, list);
    const v = await liveView();
    v.draw(drumBundle());
    await tick();
    gi.button(0, 1);   // the free pad hits: engaged, standard layout, no cymbals -> pro off
    const s = sessions[0];
    assert.equal(s.pro[s.pro.length - 1], false);
    gi.button(0, 0);
    mod._pageSetVisible(true);   // the screen opens: through the real hook
    await tick(); await tick();
    assert.equal(gi.owner(0), 'drums.controls');
    assert.equal(cardCount(list, 'padCard'), 1);
    let refreshed = 0;
    const spy = { _refreshPad: () => { refreshed++; } };
    mod._instances.add(spy);
    // Set the pad up as a kit with every action (cymbals included) through the card.
    cardFind(list, 'setupKit').fire('click');
    for (let i = 0; i < 10; i++) gi.button(10 + i, 1, 0, i + 1);
    mod._instances.delete(spy);
    assert.equal(GP.loadBindings()[XBOX.id + '#1'].kind, 'kit');
    assert.equal(refreshed, 1, 'the card\'s save refreshed every instance');
    assert.equal(s.pro[s.pro.length - 1], true, 'the free source re-resolved: a kit with cymbals plays pro');
    // Rebinding goes through the same hook.
    mod._instances.add(spy);
    cardFind(list, 'padRebindAction').value = 'kick';
    cardFind(list, 'padRebind').fire('click');
    gi.button(40, 1, 0, 99);
    mod._instances.delete(spy);
    assert.equal(refreshed, 2);
    mod._pageSetVisible(false);   // leaving: the card is gone and the free source claims again
    assert.equal(list.children.length, 0);
    assert.equal(gi.owner(0), 'drums');
    v.destroy();
});

test('a pinned lane re-resolves its binding when the card saves one (instance _refreshPad)', async () => {
    const gi = fakeGi([KIT]);
    const store = memStore({ [GP.BINDINGS_KEY]: JSON.stringify({ [KIT.id + '#1']: KIT_BINDING }) });
    const { api, mod, sessions } = realPlugin({ gi, store });
    const lane = fakeCanvas();
    api.setController(KIT.id + '#1', lane);
    const pinned = await liveView(lane);
    pinned.draw(drumBundle());
    await tick();
    const s = sessions[sessions.length - 1];
    assert.equal(s.opts.proDrums, true, 'the kit binds a yellow cymbal');
    const noCym = { kind: 'kit', map: Object.assign({}, KIT_BINDING.map) };
    delete noCym.map.yellow_cymbal;
    GP.saveBinding(KIT.id + '#1', noCym);
    pinned._refreshPad();
    assert.equal(s.pro[s.pro.length - 1], false, 'the lane now plays with pro drums off');
    pinned.destroy();
});

test('_drumsPlayAs: a drum chart plays any part on the Drum Highway; a Drums arrangement by index', () => {
    const mod = freshPlugin();
    assert.deepEqual({ ...mod._drumsPlayAs({ filename: 'a', has_drum_tab: true, arrangements: [{ index: 0, name: 'Lead' }] }) }, { viz: 'drums' });
    assert.deepEqual({ ...mod._drumsPlayAs({ filename: 'b', arrangements: [{ index: 0, name: 'Lead' }, { index: 1, name: 'Drums' }] }) },
        { viz: 'drums', arrangement: 1 });
    assert.equal(mod._drumsPlayAs({ filename: 'c', arrangements: [{ index: 0, name: 'Lead' }] }), null);
    assert.equal(mod._drumsPlayAs({ has_drum_tab: true }), null);   // no file to play
});

test('_registerDrumsPlayAs registers a play-as entry that plays through core playSongAs', () => {
    const mod = freshPlugin();
    const specs = [];
    const plays = [];
    const fb = {
        libraryCardActions: { register: (spec) => { specs.push(spec); return () => {}; } },
        ui: { playSongAs: (fn, o) => { plays.push([fn, o]); return true; } },
    };
    mod._registerDrumsPlayAs(fb);
    assert.equal(specs.length, 1);
    const s = specs[0];
    assert.equal(s.id, 'drums.play-as');
    assert.equal(s.placement, 'play-as');
    assert.equal(s.applies({ filename: 'x', has_drum_tab: true }), true);
    assert.equal(s.applies({ filename: 'x', arrangements: [{ index: 0, name: 'Bass' }] }), false);
    s.run({ filename: 'x y', arrangements: [{ index: 2, name: 'Drums' }] });
    assert.deepEqual(plays, [['x y', { viz: 'drums', arrangement: 2 }]]);
    assert.equal(mod._registerDrumsPlayAs({}), null);   // older core: nothing to register with
});

test('the drums play-as entry asks for the difficulty and saves the pick', () => {
    const mod = freshPlugin();
    const specs = [];
    const fb = { libraryCardActions: { register: (spec) => { specs.push(spec); return () => {}; } }, ui: { playSongAs: () => true } };
    mod._registerDrumsPlayAs(fb);
    const c = specs[0].choices();
    assert.deepEqual(c.items.map((i) => i.key), ['easy', 'medium', 'hard', 'expert', 'expert_plus']);
    assert.equal(c.default, mod._difficultyPref());
    specs[0].run({ filename: 'x', has_drum_tab: true }, { choice: 'hard' });
    assert.equal(mod._difficultyPref(), 'hard');
    assert.equal(specs[0].choices().default, 'hard');
});

test('with RockHeroSmith installed, Drums plays solo on its stage without Expert+', () => {
    const mod = freshPlugin();
    const specs = [];
    const solo = [];
    global.window.rockHeroSmith = { version: 1, playSolo: (item, o) => { solo.push([item.filename, o]); return 'started'; } };
    mod._registerDrumsPlayAs({ libraryCardActions: { register: (s) => { specs.push(s); return () => {}; } }, ui: { playSongAs: () => { throw new Error('direct'); } } });
    assert.deepEqual(specs[0].choices().items.map((i) => i.key), ['easy', 'medium', 'hard', 'expert']);
    specs[0].run({ filename: 'x', has_drum_tab: true }, { choice: 'hard' });
    assert.deepEqual(solo, [['x', { kind: 'drums', difficulty: 'hard' }]]);
    delete global.window.rockHeroSmith;
});

test('_engineState reports the lane\'s effective pro drums state', async () => {
    const { mod } = realPlugin();
    const v = await liveView();
    v.draw(drumBundle());
    assert.equal(v._engineState().proDrums, true);
    mod._setProCymbals(false);
    v.draw(drumBundle({ currentTime: 1.1 }));
    assert.equal(v._engineState().proDrums, false);
    assert.equal(v._engineState().proDrums, false, 'a copy, not the engine\'s object');
    v.destroy();
});

// ── setInputOffset / getInputOffset (public, for scorecard's Apply) ──
test('setInputOffset / getInputOffset without a canvas: the saved global offset, live in every session', async () => {
    const store = memStore({ drums_input_offset_ms: '-40' });
    const { api, sessions, mod } = realPlugin({ store });
    assert.equal(api.getInputOffset(), -40);
    const v = await liveView();
    assert.equal(api.setInputOffset(25), 25);
    assert.equal(api.getInputOffset(), 25);
    assert.equal(store.getItem('drums_input_offset_ms'), '25', 'saved like the settings field');
    assert.equal(mod._cfg().inputOffsetMs, 25);
    assert.equal(lastOffset(sessions[0]), 25, 'applied live');
    assert.equal(api.setInputOffset(900), 250, 'clamped');
    assert.equal(api.setInputOffset('10'), null, 'junk');
    assert.equal(api.setInputOffset(NaN), null);
    assert.equal(api.getInputOffset(), 250, 'junk changes nothing');
    v.destroy();
});

test('setInputOffset(ms, canvas): the main lane writes the global offset; another lane only its live session', async () => {
    const store = memStore({ drums_input_offset_ms: '-40' });
    const { api, sessions, mod } = realPlugin({ store });
    const main = fakeCanvas();
    main.id = 'highway';
    const vm = await liveView(main);
    const lane = fakeCanvas();
    const vl = await liveView(lane);
    const sMain = sessions[0], sLane = sessions[1];
    assert.equal(api.getInputOffset(lane), -40, 'a lane starts on the global offset');
    // main lane: the global offset (saved), every session follows
    assert.equal(api.setInputOffset(30, main), 30);
    assert.equal(store.getItem('drums_input_offset_ms'), '30');
    assert.equal(api.getInputOffset(main), 30);
    assert.equal(lastOffset(sMain), 30);
    assert.equal(lastOffset(sLane), 30);
    // another lane: that session only, not saved
    assert.equal(api.setInputOffset(15, lane), 15);
    assert.equal(api.getInputOffset(lane), 15);
    assert.equal(lastOffset(sLane), 15);
    assert.equal(lastOffset(sMain), 30);
    assert.equal(mod._cfg().inputOffsetMs, 30, 'global unchanged');
    assert.equal(store.getItem('drums_input_offset_ms'), '30');
    // the lane keeps its own offset when the global one changes
    api.setInputOffset(5);
    assert.equal(lastOffset(sMain), 5);
    assert.equal(lastOffset(sLane), 15);
    // a canvas with no drum view: nothing to set (the main view still reads the global)
    assert.equal(api.setInputOffset(10, fakeCanvas()), null);
    assert.equal(api.getInputOffset(fakeCanvas()), null);
    vm.destroy(); vl.destroy();
    const idle = fakeCanvas();
    idle.id = 'highway';
    assert.equal(api.getInputOffset(idle), 5, 'the main view with no drum view: the global offset');
    assert.equal(api.setInputOffset(7, idle), 7);
    assert.equal(api.getInputOffset(), 7);
});

test('setInputOffset(ms, canvas) on a controller lane sets that controller\'s offset, live', async () => {
    const key = XBOX.id + '#1';
    const store = memStore({ [GP.SETTINGS_KEY]: JSON.stringify({ offsetMs: { [key]: 20 } }), drums_input_offset_ms: '-60' });
    const gi = fakeGi([XBOX]);
    const { api, sessions, mod } = realPlugin({ gi, store });
    const lane = fakeCanvas();
    api.setController(key, lane);
    const v = await liveView(lane);
    await tick();
    assert.equal(api.getInputOffset(lane), 20);
    assert.equal(api.setInputOffset(47, lane), 47);
    assert.equal(GP.loadSettings().offsetMs[key], 47, 'the controller\'s saved offset (as mountQuickSettings)');
    assert.equal(mod._cfg().inputOffsetMs, -60, 'global unchanged');
    assert.equal(lastOffset(sessions[0]), 47);
    assert.equal(api.getInputOffset(lane), 47);
    v.destroy();
});

// ── RockHeroSmith owns the lane: no drums end card or best (rockHeroSmith.ownsLane) ──
test('_rhsOwnsLane: ownsLane(canvas) when RockHeroSmith has it, else the adoptsSolo fallback', () => {
    const mod = freshPlugin();
    const main = { id: 'highway' }, lane = {};
    assert.equal(mod._rhsOwnsLane(lane), false, 'no RockHeroSmith');
    window.rockHeroSmith = { version: 1, playSolo() {}, adoptsSolo: () => false, ownsLane: (c) => c === lane };
    assert.equal(mod._rhsOwnsLane(lane), true, 'a one-player Band-setup session, or the adopt pref off');
    assert.equal(mod._rhsOwnsLane(main), false);
    window.rockHeroSmith.ownsLane = () => 1;
    assert.equal(mod._rhsOwnsLane(lane), true, 'truthy');
    window.rockHeroSmith.ownsLane = () => { throw new Error('boom'); };
    window.rockHeroSmith.adoptsSolo = () => true;
    assert.equal(mod._rhsOwnsLane(main), true, 'a throwing ownsLane falls back to adoptsSolo');
    delete window.rockHeroSmith.ownsLane;
    assert.equal(mod._rhsOwnsLane(main), true, 'older RockHeroSmith: adoptsSolo on the main view');
    assert.equal(mod._rhsOwnsLane(lane), false);
    window.rockHeroSmith.adoptsSolo = () => false;
    assert.equal(mod._rhsOwnsLane(main), false);
});

test('song end: a lane RockHeroSmith owns gets no drums end card and no drums_best_v1 write', async () => {
    const run = async (rhs) => {
        const gi = fakeGi([XBOX]);
        const store = memStore();
        const { api, fire } = realPlugin({ gi, store });
        window.feedBack.currentSong = { filename: 'song.sloppak', title: 'Song' };
        const lane = fakeCanvas();
        const v = await liveView(lane);
        api.setScoreHudHidden(lane, 'score');   // no card either way: the best-only path
        if (rhs) window.rockHeroSmith = rhs(lane);
        v.draw(drumBundle({ currentTime: 1.9 }));
        await tick();
        v.draw(drumBundle({ currentTime: 1.98 }));
        gi.button(4, 1);
        v.draw(drumBundle({ currentTime: 2.2 }));
        v.draw(drumBundle({ currentTime: 2.4 }));
        assert.ok(v._engineState().notesHit >= 1, 'a scored hit');
        fire('song:ended', {});
        v.destroy();
        return { best: [...store.m.keys()].filter((k) => k.startsWith('drums_best_v1')) };
    };
    assert.equal((await run(null)).best.length, 1, 'no RockHeroSmith: the best is recorded');
    assert.equal((await run((lane) => ({ version: 1, playSolo() {}, adoptsSolo: () => false, ownsLane: (c) => c === lane }))).best.length, 0,
        'RockHeroSmith scores on the lane: no drums best');
    assert.equal((await run(() => ({ version: 1, playSolo() {}, adoptsSolo: () => false, ownsLane: () => false }))).best.length, 1,
        'RockHeroSmith on another canvas');
});

// ── Overhit setting, kick offset, results breakdown ─────────────────────────

test('overhits setting: validated, and sent to the engine with the timing window', () => {
    const mod = freshPlugin();
    const cfg = mod._cfg();
    assert.equal(cfg.overhits, 'penalize');
    assert.equal(mod._timingParams(), null, 'defaults: engine defaults');
    mod._saveCfg('overhits', 'ignore');
    assert.deepEqual(mod._timingParams(), { overhits: 'ignore' });
    mod._saveCfg('timing', 'forgiving');
    mod._saveCfg('overhits', 'lenient');
    assert.deepEqual(mod._timingParams(), { hitWindow: { maxWindow: 0.20, minWindow: 0.20, isDynamic: false }, overhits: 'lenient' });
    mod._saveCfg('overhits', 'sometimes');
    assert.equal(cfg.overhits, 'penalize');
    assert.deepEqual(mod.OVERHIT_IDS, Object.keys(mod.OVERHIT_MODES));
    mod._saveCfg('kickOffsetMs', -9000);
    assert.equal(cfg.kickOffsetMs, -250);
    mod._saveCfg('kickOffsetMs', 'x');
    assert.equal(cfg.kickOffsetMs, 0);
});

test('overhits and kick offset controls render with the current values', () => {
    const mod = freshPlugin();
    const html = mod._settingControlHtml('overhits', { overhits: 'lenient' });
    assert.match(html, /class="drums-overhits-select"/);
    assert.match(html, /<option value="lenient" selected>/);
    assert.match(mod._settingControlHtml('kickOffset', { kickOffset: -25 }), /class="drums-kick-offset-input"[^>]*value="-25"/);
    const kit = mod._quickSettingsModel({});
    assert.ok(kit.controls.includes('overhits') && kit.controls.includes('kickOffset'));
});

test('_overhitSummary: overhits by pad, the early-kick hint and whether the run counts', () => {
    const mod = freshPlugin();
    const st = (o) => Object.assign({ overhits: 0, overhitsIgnored: 0, overhitsByPad: { kick: 0, red: 0, yellow: 0, blue: 0, green: 0 }, overhitMode: 'penalize' }, o);
    const pt = (gap, sug) => ({ kick: { count: 20, median: -40 }, hands: { count: 20, median: -40 - gap }, kickVsHands: gap, suggestKick: sug });
    const a = mod._overhitSummary(st({ overhits: 15, overhitsByPad: { kick: 12, red: 3, yellow: 0, blue: 0, green: 0 } }), pt(-25, -25));
    assert.equal(a.byPad, 'kick 12 · snare 3');
    assert.equal(a.hint, 'Your kick lands 25 ms before your hands');
    assert.equal(a.suggestKick, -25);
    assert.equal(a.counts, true);
    const late = mod._overhitSummary(st({}), pt(30, 10));
    assert.equal(late.hint, 'Your kick lands 30 ms after your hands');
    const off = mod._overhitSummary(st({ overhitMode: 'ignore', overhitsIgnored: 7 }), null);
    assert.equal(off.counts, false);
    assert.equal(off.note, 'Overhits off: 7 extra hits ignored, not counted toward your best');
    assert.equal(off.hint, null);
    const len = mod._overhitSummary(st({ overhitMode: 'lenient', overhitsIgnored: 4 }), null);
    assert.equal(len.counts, true);
    assert.equal(len.note, '4 flams / fill hits forgiven');
    assert.equal(mod._overhitSummary(st({}), null).byPad, '');
});

test('a run with overhits off does not record a best score', () => {
    const store = {};
    global.window = {};
    global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    global.document = { addEventListener: () => {} };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    window.feedBack = { on() {}, currentSong: { filename: 'song.sloppak', title: 'Song' } };
    const session = (mode) => ({ getState: () => ({ notesHit: 5, notesMissed: 0, score: 1000, overhitMode: mode }), getBonus: () => ({ total: 0 }) });
    assert.equal(mod._recordRunBest(session('ignore'), { text: 'HARD' }), null);
    assert.equal(store['drums_best_v1:song.sloppak|HARD'], undefined);
    assert.deepEqual(mod._recordRunBest(session('lenient'), { text: 'HARD' }), { prev: null, isBest: true });
});

test('hi-hat pedal: Ignore by default; Play pedal notes and Second kick map note 44', () => {
    const mod = freshPlugin();
    const E = require('../assets/engine.js');
    assert.equal(mod._cfg().pedalRole, 'ignore');
    const pad = mod._padFromMidiFor(E);
    assert.equal(pad(44), null, 'ignored: neither a hit nor an overhit');
    assert.deepEqual({ ...pad(38) }, { pad: 1, cymbal: false }, 'other notes as GM');
    assert.equal(mod._pedalAsKick(44), false);
    mod._saveCfg('pedalRole', 'notes');
    assert.deepEqual({ ...pad(44) }, { pad: 2, cymbal: true }, 'a hi-hat pedal note (yellow cymbal)');
    assert.equal(mod._pedalAsKick(44), false);
    mod._saveCfg('pedalRole', 'kick');
    assert.deepEqual({ ...pad(44) }, { pad: 0, cymbal: false }, 'the kick');
    assert.equal(mod._pedalAsKick(44), true, 'and it sounds as the kick');
    assert.equal(mod._pedalAsKick(36), false);
    mod._saveCfg('customMapping', { 44: 'snare' });
    assert.equal(mod._pedalAsKick(44), false, 'a Learn mapping for 44 wins');
    mod._saveCfg('pedalRole', 'stomp');
    assert.equal(mod._cfg().pedalRole, 'ignore', 'unknown roles fall back to Ignore');
    assert.deepEqual(mod.PEDAL_ROLE_IDS, ['ignore', 'notes', 'kick']);
});

test('_directMidiList: callers asking at the same time share one request', async () => {
    const mod = freshPlugin();
    let calls = 0;
    let release;
    global.fetch = () => { calls++; return new Promise((r) => { release = () => r({ ok: true, json: async () => ({ available: true, inputs: [{ id: 0, name: 'Kit' }] }) }); }); };
    const a = mod._directMidiList(), b = mod._directMidiList(), c = mod._directMidiList();
    assert.equal(calls, 1, 'one request for three callers');
    release();
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    assert.deepEqual([ra.length, rb.length, rc.length], [1, 1, 1]);
    const later = mod._directMidiList();
    assert.equal(calls, 2, 'a later call asks again');
    release();
    await later;
    delete global.fetch;
});
