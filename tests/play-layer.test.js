'use strict';
// The play-layer APIs RockHeroSmith builds on (play-layer contract §4/§6):
// feedBackDrums.midiInput / setPadSound / getPadSound / mountQuickSettings,
// the drums:bonus bus event, the fallback gate for the drums HUD / end card /
// personal best, the gear button's rail slot and Play as with soloKindFor.
// Run: node tests/play-layer.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshPlugin(store) {
    const data = store || {};
    global.window = {};
    global.localStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
    };
    global.document = { addEventListener: () => {}, querySelectorAll: () => [], getElementById: () => null };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    return { mod, api: window.feedBackDrums, store: data };
}

// A minimal element for mountQuickSettings: innerHTML is kept as a string and
// every selector gets one stub control (data-mode buttons from the markup).
function fakeEl() {
    const stubs = {};
    const el = {
        innerHTML: '',
        querySelector(sel) {
            if (!this.innerHTML.includes(sel.replace(/^\./, '').split('[')[0])) return null;
            if (!stubs[sel]) stubs[sel] = { value: '', checked: false, textContent: '', disabled: false, hidden: false, dataset: {}, setAttribute(k, v) { this[k] = v; } };
            return stubs[sel];
        },
        querySelectorAll(sel) {
            if (sel !== '.drums-qs-sound') return [];
            const out = [];
            const re = /data-mode="([^"]+)"/g;
            let m;
            while ((m = re.exec(this.innerHTML))) {
                const key = 'mode:' + m[1];
                if (!stubs[key]) stubs[key] = { dataset: { mode: m[1] }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
                out.push(stubs[key]);
            }
            return out;
        },
    };
    return { el, stubs };
}

// ── midiInput ──
test('_midiInputInfo: the open input, else the saved / auto-picked one, else null', () => {
    const { mod } = freshPlugin();
    const sources = [{ key: 'web:kit', name: 'Alesis Nitro' }, { key: 'web:keys', name: 'Keys' }];
    assert.deepEqual(mod._midiInputInfo({ current: { key: 'web:keys', name: 'Keys' }, saved: 'web:kit', sources, autoKey: 'web:kit' }),
        { key: 'web:keys', name: 'Keys', connected: true }, 'the open input wins');
    assert.deepEqual(mod._midiInputInfo({ current: null, saved: 'web:kit', sources, autoKey: 'web:kit' }),
        { key: 'web:kit', name: 'Alesis Nitro', connected: true });
    assert.deepEqual(mod._midiInputInfo({ current: null, saved: 'web:gone', sources, autoKey: null }),
        { key: 'web:gone', name: '', connected: false }, 'saved but unplugged');
    assert.equal(mod._midiInputInfo({ current: null, saved: '', sources, autoKey: null }), null, 'explicit None');
    assert.equal(mod._midiInputInfo({ current: null, saved: null, sources: [], autoKey: null }), null, 'nothing saved, nothing there');
    assert.deepEqual(mod._midiInputInfo({ current: null, saved: null, sources, autoKey: 'web:kit' }),
        { key: 'web:kit', name: 'Alesis Nitro', connected: true }, 'never picked: what auto-connect would open');
});

test('feedBackDrums.midiInput reads the saved input from core midi-input', () => {
    const { api } = freshPlugin({ drums_midi_input: 'web:kit' });
    assert.equal(typeof api.midiInput, 'function');
    assert.deepEqual(api.midiInput(), { key: 'web:kit', name: '', connected: false }, 'no domain: saved, not connected');
    window.slopsmith = { midiInput: { version: 1, listSources: () => [{ sourceId: 'k', label: 'TD-17', logicalSourceKey: 'web:kit' }] } };
    assert.deepEqual(api.midiInput(), { key: 'web:kit', name: 'TD-17', connected: true });
});

// ── Pad sound ──
test('setPadSound / getPadSound: volume is the saved pad volume, mute keeps it', () => {
    const { api, mod, store } = freshPlugin();
    assert.deepEqual(api.getPadSound(), { muted: false, volume: 0.7 });
    assert.deepEqual(api.setPadSound({ volume: 0.4 }), { muted: false, volume: 0.4 });
    assert.equal(store.drums_synth_vol, '0.4');
    assert.equal(mod._cfg().synthVolume, 0.4);
    assert.deepEqual(api.setPadSound({ muted: true }), { muted: true, volume: 0.4 }, 'mute leaves the volume');
    assert.equal(store.drums_synth_vol, '0.4');
    assert.deepEqual(api.setPadSound({ volume: 2 }), { muted: true, volume: 1 }, 'clamped');
    assert.deepEqual(api.setPadSound({ muted: 'yes', volume: NaN }), { muted: true, volume: 1 }, 'junk changes nothing');
    assert.deepEqual(api.setPadSound(), { muted: true, volume: 1 });
    assert.deepEqual(api.setPadSound({ muted: false }), { muted: false, volume: 1 });
});

test('window.__drumsMutePads stays an alias of the pad mute', () => {
    const { api } = freshPlugin();
    window.__drumsMutePads = true;
    assert.equal(api.getPadSound().muted, true);
    api.setPadSound({ muted: false });
    assert.equal(window.__drumsMutePads, false);
    api.setPadSound({ muted: true });
    assert.equal(window.__drumsMutePads, true);
});

test('muted pads: no pad hit sound and no auto notes', () => {
    const { api, mod } = freshPlugin();
    const played = [];
    const ctx = { currentTime: 10, state: 'running' };
    const player = { play: (kit, midi) => { const s = { midi, stop() { this.stopped = true; } }; played.push(s); return s; } };
    mod._testSynth({ ctx, autoGain: {}, synthGain: {}, kit: { manifest: { notes: {} } }, player });
    global.performance = { now: () => 0 };
    api.setPadSound({ muted: true });
    mod._synthDrumHit(38, 100);
    assert.equal(played.length, 0, 'pad hit silent');
    const audio = { paused: false, currentTime: 0, playbackRate: 1, addEventListener() {} };
    global.document.getElementById = (id) => (id === 'audio' ? audio : null);
    window.highway = { getTime: () => 0.98 };
    const w = (t, midi) => ({ t, s: (midi / 24) | 0, f: midi % 24 });
    mod._autoSchedule([w(1.0, 36)], [], { kick: true, cymbals: false }, 1);
    assert.equal(played.length, 0, 'auto kick silent');
    api.setPadSound({ muted: false });
    mod._synthDrumHit(38, 100);
    assert.equal(played.length, 1, 'unmuted: the pad sounds');
});

// ── drums:bonus ──
test('the solo bonus goes out on the bus with the band events', () => {
    const { mod } = freshPlugin();
    assert.ok(mod._BAND_EVENT_TYPES.has('bonus'));
    const c = {};
    assert.deepEqual(mod._bandEventDetail({ type: 'bonus', points: 800, reason: 'solo' }, c), { type: 'bonus', points: 800, reason: 'solo', canvas: c });
});

// ── Fallback gate ──
test('_rhsAdoptsSolo: only a RockHeroSmith that says it adopts solo plays', () => {
    const { mod } = freshPlugin();
    assert.equal(mod._rhsAdoptsSolo(), false, 'no RockHeroSmith');
    window.rockHeroSmith = { version: 1, playSolo() {} };
    assert.equal(mod._rhsAdoptsSolo(), false, 'an older RockHeroSmith without adoptsSolo');
    window.rockHeroSmith.adoptsSolo = () => false;
    assert.equal(mod._rhsAdoptsSolo(), false, 'adopt pref off');
    window.rockHeroSmith.adoptsSolo = () => true;
    assert.equal(mod._rhsAdoptsSolo(), true);
    window.rockHeroSmith.adoptsSolo = () => { throw new Error('boom'); };
    assert.equal(mod._rhsAdoptsSolo(), false);
});

test('_adoptedLane: RockHeroSmith adopts only the main #highway view, never split panels', () => {
    const { mod } = freshPlugin();
    const main = { id: 'highway' }, panel = { id: 'ss-highway-1' };
    assert.equal(mod._adoptedLane({ adopts: true, canvas: main, split: false }), true);
    assert.equal(mod._adoptedLane({ adopts: false, canvas: main, split: false }), false);
    assert.equal(mod._adoptedLane({ adopts: true, canvas: main, split: true }), false, 'split view keeps its HUD');
    assert.equal(mod._adoptedLane({ adopts: true, canvas: panel, split: false }), false, 'another canvas');
    assert.equal(mod._adoptedLane({ adopts: true, canvas: {}, split: false }), false);
    assert.equal(mod._adoptedLane({ adopts: true, canvas: null, split: false }), false);
});

test('with RockHeroSmith adopting solo plays, the main view has no own HUD, card or best', () => {
    const { mod } = freshPlugin();
    const main = { id: 'highway' }, other = {};
    assert.equal(mod._ownScoreHidden(main), false);
    window.rockHeroSmith = { version: 1, playSolo() {}, adoptsSolo: () => true };
    assert.equal(mod._ownScoreHidden(main), true);
    assert.equal(mod._rhsAdoptsLane(main), true);
    assert.equal(mod._ownScoreHidden(other), false, 'a canvas other than #highway keeps the drums HUD');
    assert.equal(mod._rhsAdoptsLane(other), false);
    assert.equal(mod._scoreHudHiddenFor(main), false, 'the band switch itself is unchanged');
    const f = () => {};
    window.slopsmithSplitscreen = { isActive: () => true, isCanvasFocused: f, panelChromeFor: f, settingsAnchorFor: f, onFocusChange: f, offFocusChange: f };
    assert.equal(mod._ownScoreHidden(main), false, 'split view: every panel keeps the drums HUD');
    assert.equal(mod._rhsAdoptsLane(main), false);
    delete window.slopsmithSplitscreen;
    assert.equal(mod._shouldRecordBestOnly({ hasSession: true, ssActive: false, hidden: true, adopted: true }), false);
    assert.equal(mod._shouldRecordBestOnly({ hasSession: true, ssActive: false, hidden: true, adopted: false }), true);
});

// ── Gear button in core's rail slot ──
test('_gearPlacement: split panel bar, else core\'s player slot, else #player-controls', () => {
    const { mod } = freshPlugin();
    const bar = {}, slot = {}, controls = {};
    assert.deepEqual(mod._gearPlacement({ split: true, ssAnchor: bar, slot, controls }), { anchor: bar, beforeClose: false });
    assert.deepEqual(mod._gearPlacement({ split: true, ssAnchor: null, slot, controls }), { anchor: controls, beforeClose: false }, 'split without a panel bar: appended to the controls');
    assert.deepEqual(mod._gearPlacement({ split: false, ssAnchor: null, slot, controls }), { anchor: slot, beforeClose: false });
    assert.deepEqual(mod._gearPlacement({ split: false, ssAnchor: null, slot: null, controls }), { anchor: controls, beforeClose: true });
    assert.equal(mod._gearPlacement({ split: false, ssAnchor: null, slot: null, controls: null }), null);
});

test('_playerSlot asks core for the rail slot when it has one', () => {
    const { mod } = freshPlugin();
    assert.equal(mod._playerSlot(), null);
    const slot = {};
    window.feedBack = { ui: { playerControlSlot: () => slot } };
    assert.equal(mod._playerSlot(), slot);
    window.feedBack = { ui: { playerControlSlot: () => { throw new Error('boom'); } } };
    assert.equal(mod._playerSlot(), null);
});

// ── Quick settings ──
test('_quickSettingsModel: kit, controller with cymbals, controller without', () => {
    const { mod } = freshPlugin();
    const kit = mod._quickSettingsModel({});
    assert.equal(kit.input, 'kit');
    assert.deepEqual(kit.controls, ['difficulty', 'autoKick', 'autoCymbals', 'proCymbals', 'timing', 'inputOffset', 'padVolume']);
    assert.equal(kit.offsetScope, 'global');
    assert.equal(kit.expertPlus, true, 'plain play offers Expert+');
    const pro = mod._quickSettingsModel({ controller: { controllerKey: 'pad#0', hasCymbals: true }, canvas: {} });
    assert.equal(pro.input, 'controller');
    assert.ok(pro.controls.includes('proCymbals'));
    assert.equal(pro.offsetScope, 'controller');
    assert.equal(pro.controllerKey, 'pad#0');
    assert.equal(pro.expertPlus, false, 'a band lane has no Expert+');
    const four = mod._quickSettingsModel({ controller: { controllerKey: 'pad#1', hasCymbals: false } });
    assert.ok(!four.controls.includes('proCymbals'));
    assert.ok(four.controls.includes('fourLane'), 'a controller without cymbals plays 4-lane');
    const modes = mod._quickSettingsModel({ soundModes: ['rockband', 'song', { id: 'kit' }, 7, { id: '' }] });
    assert.equal(modes.controls[modes.controls.length - 1], 'soundMode');
    assert.deepEqual(modes.soundModes, [{ id: 'rockband', label: 'Rock Band' }, { id: 'song', label: 'Song + pads' }, { id: 'kit', label: 'Kit only' }]);
    assert.deepEqual(mod._quickSettingsModel({ soundModes: [{ id: 'x', label: 'Custom' }] }).soundModes, [{ id: 'x', label: 'Custom' }]);
});

test('mountQuickSettings renders the controls and applies changes live', () => {
    const { api, mod, store } = freshPlugin();
    const calls = [];
    mod._instances.add({
        _canvas: () => null, _isVisible: () => true, _inSplit: () => false,
        _difficultyChanged: () => calls.push('diff'), _proCymbalsChanged: () => calls.push('pro'),
        _assistsChanged: () => calls.push('assist'), _inputOffsetChanged: () => calls.push('offset'),
        _timingSummary: () => ({ word: '+30 ms LATE', suggest: 30 }),
    });
    const { el, stubs } = fakeEl();
    const qs = api.mountQuickSettings(el);
    assert.equal(typeof qs.destroy, 'function');
    for (const cls of ['drums-difficulty-select', 'drums-auto-kick', 'drums-auto-cym', 'drums-chk-pro', 'drums-timing-select', 'drums-offset-input', 'drums-vol-slider', 'drums-qs-apply']) {
        assert.ok(el.innerHTML.includes(cls), cls);
    }
    assert.ok(el.innerHTML.includes('Expert+'));
    assert.ok(!el.innerHTML.includes('drums-qs-sound'), 'no sound modes without soundModes');
    stubs['.drums-difficulty-select'].value = 'hard';
    stubs['.drums-difficulty-select'].onchange.call(stubs['.drums-difficulty-select']);
    assert.equal(mod._difficultyPref(), 'hard');
    stubs['.drums-auto-kick'].value = 'all';
    stubs['.drums-auto-kick'].onchange.call(stubs['.drums-auto-kick']);
    assert.equal(mod._cfg().autoKick, 'all');
    stubs['.drums-chk-pro'].checked = false;
    stubs['.drums-chk-pro'].onchange.call(stubs['.drums-chk-pro']);
    assert.equal(mod._cfg().proCymbals, false);
    stubs['.drums-offset-input'].value = '20';
    stubs['.drums-offset-input'].onchange.call(stubs['.drums-offset-input']);
    assert.equal(mod._cfg().inputOffsetMs, 20);
    stubs['.drums-vol-slider'].value = '35';
    stubs['.drums-vol-slider'].oninput.call(stubs['.drums-vol-slider']);
    assert.equal(api.getPadSound().volume, 0.35);
    assert.equal(store.drums_synth_vol, '0.35');
    // early/late Apply takes the session's suggestion
    assert.ok(el.innerHTML.includes('+30 ms LATE'));
    stubs['.drums-qs-apply'].onclick();
    assert.equal(mod._cfg().inputOffsetMs, 30);
    assert.deepEqual([...new Set(calls)].sort(), ['assist', 'diff', 'offset', 'pro']);
    qs.destroy();
    assert.equal(el.innerHTML, '');
});

test('mountQuickSettings on a band lane: lane difficulty, controller offset, sound modes', () => {
    const { api, mod } = freshPlugin();
    const canvas = {};
    let own = null;
    let offsetChanged = 0;
    mod._instances.add({
        _canvas: () => canvas, _isVisible: () => true, _inSplit: () => false,
        _setOwnDifficulty: (id) => { own = id; }, _inputOffsetChanged: () => offsetChanged++,
        _controllerInfo: () => ({ controllerKey: 'pad#0', hasCymbals: false }),
    });
    const offsets = {};
    window.DrumsGamepad = { setOffset: (k, v) => { offsets[k] = v; }, loadSettings: () => ({ offsetMs: offsets }) };
    const picked = [];
    const { el, stubs } = fakeEl();
    const qs = api.mountQuickSettings(el, { canvas, soundModes: ['rockband', 'song', 'kit'], soundMode: 'rockband', onSoundMode: (id) => picked.push(id) });
    assert.ok(!el.innerHTML.includes('Expert+'), 'no Expert+ on a band lane');
    assert.ok(!el.innerHTML.includes('drums-chk-pro'), '4-lane controller');
    assert.ok(el.innerHTML.includes('4-lane'));
    assert.ok(el.innerHTML.includes('Song + pads') && el.innerHTML.includes('Kit only') && el.innerHTML.includes('Rock Band'));
    const globalDiff = mod._difficultyPref();
    stubs['.drums-qs-difficulty'].value = 'easy';
    stubs['.drums-qs-difficulty'].onchange.call(stubs['.drums-qs-difficulty']);
    assert.equal(own, 'easy');
    assert.equal(mod._bandDifficultyFor(canvas), 'easy');
    assert.equal(mod._difficultyPref(), globalDiff, 'the global difficulty is left alone');
    stubs['.drums-ctl-offset-input'].value = '-40';
    stubs['.drums-ctl-offset-input'].onchange.call(stubs['.drums-ctl-offset-input']);
    assert.equal(offsets['pad#0'], -40);
    assert.equal(mod._cfg().inputOffsetMs, 0, 'the kit offset is unchanged');
    assert.ok(offsetChanged > 0);
    const btns = el.querySelectorAll('.drums-qs-sound');
    assert.equal(btns.length, 3);
    assert.equal(btns[0].attrs['aria-pressed'] || (el.innerHTML.match(/data-mode="rockband"[^>]*aria-pressed="true"/) ? 'true' : ''), 'true');
    btns[2].onclick.call(btns[2]);
    assert.deepEqual(picked, ['kit']);
    assert.equal(btns[2].attrs['aria-pressed'], 'true');
    assert.equal(btns[0].attrs['aria-pressed'], 'false');
    qs.destroy();
});

test('mountQuickSettings without an element is a no-op handle', () => {
    const { api } = freshPlugin();
    const h = api.mountQuickSettings(null);
    assert.equal(typeof h.destroy, 'function');
    h.destroy();
});

// ── Play as: kit or controller through RockHeroSmith ──
test('Play as asks RockHeroSmith which solo kind to play', async () => {
    const { mod } = freshPlugin();
    const specs = [];
    const solo = [];
    window.rockHeroSmith = { version: 1, playSolo: (item, o) => { solo.push(o); return 'started'; }, soloKindFor: () => 'kit' };
    mod._registerDrumsPlayAs({ libraryCardActions: { register: (s) => { specs.push(s); return () => {}; } }, ui: {} });
    assert.equal(await specs[0].run({ filename: 'x', has_drum_tab: true }, { choice: 'hard' }), 'started');
    assert.deepEqual(solo, [{ kind: 'kit', difficulty: 'hard' }]);
    window.rockHeroSmith.soloKindFor = () => null;   // no kit, no controller: RockHeroSmith shows setup
    await specs[0].run({ filename: 'x', has_drum_tab: true }, { choice: 'expert_plus' });
    assert.deepEqual(solo[1], { kind: 'drums', difficulty: 'expert' });
    delete window.rockHeroSmith.soloKindFor;   // an older RockHeroSmith
    await specs[0].run({ filename: 'x', has_drum_tab: true }, {});
    assert.equal(solo[2].kind, 'drums');
});
