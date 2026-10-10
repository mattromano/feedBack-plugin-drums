'use strict';
// Tests for the bundled drum kits: assets/kits.js (sampled kits) and the kit table in screen.js.
// Run: node tests/kits.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const K = require(path.join(__dirname, '..', 'assets', 'kits.js'));
const SOUNDS = path.join(__dirname, '..', 'assets', 'sounds');

function freshPlugin() {
    global.window = {};
    global.localStorage = { getItem: () => null, setItem: () => {} };
    global.document = { addEventListener: () => {} };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    return require(file);
}

test('kits: every kit resolves to bundled sound files (nothing from a CDN)', () => {
    const mod = freshPlugin();
    assert.equal(mod.DEFAULT_KIT, 'crocell');
    assert.ok(mod.KIT_IDS.includes(mod.DEFAULT_KIT));
    assert.deepEqual([...mod.KIT_IDS].sort(), Object.keys(mod.DRUM_KITS).sort());
    assert.ok(fs.existsSync(path.join(SOUNDS, 'WebAudioFontPlayer.js')));
    for (const id of mod.KIT_IDS) {
        if (mod._kitIsSampled(id)) {
            const dir = mod.DRUM_KITS[id].dir;
            assert.ok(K.KIT_DIR_RE.test(dir), dir);
            assert.equal(mod._kitBaseUrl(dir), '/api/plugins/drums/assets/sounds/kits/' + dir + '/');
            const raw = JSON.parse(fs.readFileSync(path.join(SOUNDS, 'kits', dir, 'kit.json'), 'utf8'));
            const m = K.validateKitManifest(raw);
            assert.ok(m, id);
            for (const n of mod.DRUM_MIDI_NOTES) assert.ok(m.notes[n], id + ' note ' + n);
            for (const f of m.files) assert.ok(fs.existsSync(path.join(SOUNDS, 'kits', dir, f)), f);
            assert.deepEqual(m.chokes[42], [46]);
            continue;
        }
        const sf = mod._kitSf(id);
        assert.equal(mod._drumWafVar(38, sf), '_drum_38_0_' + sf);
        for (const n of mod.DRUM_MIDI_NOTES) {
            const url = mod._drumWafUrl(n, sf);
            assert.ok(url.startsWith('/api/plugins/drums/assets/sounds/'), url);
            const file = url.replace('/api/plugins/drums/assets/sounds/', '');
            assert.ok(fs.existsSync(path.join(SOUNDS, file)), file);
        }
    }
    assert.equal(mod._kitSf('nope'), mod._kitSf('jclive'));
    assert.equal(mod._kitSf('crocell'), mod._kitSf('jclive'), 'sampled kits fall back to the JCLive GM set');
});

test('kits: a saved kit choice is validated', () => {
    global.window = {};
    global.localStorage = { getItem: (k) => (k === 'drums_kit_v1' ? 'fluid' : null), setItem: () => {} };
    global.document = { addEventListener: () => {} };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    assert.equal(mod._cfg().kit, 'fluid');
    mod._saveCfg('kit', 'virtuosity');
    assert.equal(mod._cfg().kit, 'virtuosity');
    mod._saveCfg('kit', '../etc');
    assert.equal(mod._cfg().kit, 'crocell');
});

test('sample kits: validateKitManifest normalises and rejects bad input', () => {
    const v = K.validateKitManifest;
    assert.equal(v(null), null);
    assert.equal(v({}), null);
    assert.equal(v({ notes: [] }), null);
    assert.equal(v({ notes: { 38: { layers: [] } } }), null);
    assert.equal(v({ notes: { 38: { layers: [{ lo: 1, hi: 127, files: ['../screen.js'] }] } } }), null);
    const m = v({
        gain: 9,
        notes: {
            38: { layers: [
                { lo: 80, hi: 127, files: ['snare_v2_a.ogg', 'snare_v2_b.ogg'] },
                { lo: 60, hi: 1, files: ['snare_v1_a.ogg', 'Bad Name.ogg', '/abs.ogg', 'x.wav', 7] },
                { lo: 1, hi: 127, files: [] },
            ] },
            200: { layers: [{ files: ['a.ogg'] }] },
            abc: { layers: [{ files: ['a.ogg'] }] },
            42: { layers: [{ files: ['hh.ogg'] }], gain: -2 },
        },
        chokes: { 42: [46, 'x', 300], 44: 'nope', 1000: [46] },
    });
    assert.deepEqual(Object.keys(m.notes).sort(), ['38', '42']);
    assert.deepEqual(m.notes[38].layers.map((l) => [l.lo, l.hi, l.files]), [
        [1, 60, ['snare_v1_a.ogg']],
        [80, 127, ['snare_v2_a.ogg', 'snare_v2_b.ogg']],
    ]);
    assert.deepEqual(m.notes[42].layers[0], { lo: 1, hi: 127, files: ['hh.ogg'], gain: 1 });
    assert.equal(m.notes[42].gain, 0);
    assert.equal(m.gain, 4);
    assert.deepEqual(m.chokes, { 42: [46] });
    assert.deepEqual(m.files.sort(), ['hh.ogg', 'snare_v1_a.ogg', 'snare_v2_a.ogg', 'snare_v2_b.ogg']);
});

test('sample kits: pickKitLayer picks the layer by velocity, nearest when in a gap', () => {
    const L = [{ lo: 1, hi: 40, id: 'pp' }, { lo: 41, hi: 90, id: 'mf' }, { lo: 100, hi: 127, id: 'ff' }];
    const pick = (vel) => K.pickKitLayer(L, vel).id;
    assert.equal(pick(1), 'pp');
    assert.equal(pick(40), 'pp');
    assert.equal(pick(41), 'mf');
    assert.equal(pick(93), 'mf');
    assert.equal(pick(98), 'ff');
    assert.equal(pick(500), 'ff');
    assert.equal(pick('x'), 'pp');
    assert.equal(K.pickKitLayer([], 100), null);
    assert.equal(K.pickKitLayer(null, 100), null);
});

test('sample kits: kitHitGain rises gently across a layer', () => {
    const l = { lo: 41, hi: 81, gain: 1 };
    assert.equal(K.kitHitGain(l, 41), 0.6);
    assert.equal(K.kitHitGain(l, 81), 1);
    assert.ok(Math.abs(K.kitHitGain(l, 61) - 0.8) < 1e-9);
    assert.equal(K.kitHitGain({ lo: 5, hi: 5 }, 5), 1);
    assert.equal(K.kitHitGain({ lo: 1, hi: 127, gain: 0.5 }, 127), 0.5);
    assert.equal(K.kitHitGain(null, 100), 0);
});

test('sample kits: the player round-robins and a closed hi-hat chokes the open one', () => {
    const started = [];
    const ctx = {
        currentTime: 0,
        createBufferSource() {
            const src = { buffer: null, connect() {}, start(t) { started.push([this.buffer, t]); }, stop(t) { this.stopped = t; } };
            return src;
        },
        createGain() { return { gain: { value: 1, cancelScheduledValues() {}, setTargetAtTime(v) { this.target = v; } }, connect() {}, disconnect() {} }; },
    };
    const kit = {
        manifest: K.validateKitManifest({ notes: {
            46: { layers: [{ files: ['ohh.ogg'] }] },
            42: { layers: [{ files: ['hh_a.ogg', 'hh_b.ogg'] }] },
        }, chokes: { 42: [46] } }),
        buffers: { 'ohh.ogg': 'O', 'hh_a.ogg': 'A', 'hh_b.ogg': 'B' },
    };
    const P = K.createPlayer(ctx);
    assert.equal(P.play(kit, 46, 100, 0, {}), true);
    assert.equal(P.play(kit, 42, 100, 0, {}), true);
    assert.equal(P.play(kit, 42, 100, 0, {}), true);
    assert.deepEqual(started.map(s => s[0]), ['O', 'B', 'A'], 'round-robin over the layer');
    assert.equal(P.play(kit, 99, 100, 0, {}), false, 'unknown note');
});
