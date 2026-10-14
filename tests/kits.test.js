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
            // Optional kits (built from multi-GB sources, not in the repo) only when built here.
            if (mod.DRUM_KITS[id].optional && !fs.existsSync(path.join(SOUNDS, 'kits', dir, 'kit.json'))) continue;
            assert.ok(K.KIT_DIR_RE.test(dir), dir);
            assert.equal(mod._kitBaseUrl(dir), '/api/plugins/drums/assets/sounds/kits/' + dir + '/');
            const raw = JSON.parse(fs.readFileSync(path.join(SOUNDS, 'kits', dir, 'kit.json'), 'utf8'));
            const m = K.validateKitManifest(raw);
            assert.ok(m, id);
            for (const n of mod.DRUM_MIDI_NOTES) assert.ok(m.notes[n], id + ' note ' + n);
            for (const f of m.files) assert.ok(fs.existsSync(path.join(SOUNDS, 'kits', dir, f)), f);
            assert.ok(m.chokes[42].includes(46), id + ': closed hi-hat chokes the open one');
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
    assert.deepEqual(m.notes[42].layers[0], { lo: 1, hi: 127, files: ['hh.ogg'], gain: 1, ref: null });
    assert.equal(m.room, null);
    assert.equal(v({ room: 0.5, notes: { 38: { layers: [{ files: ['a.ogg'], ref: 40.5 }] } } }).room, 0.5);
    assert.equal(v({ notes: { 38: { layers: [{ files: ['a.ogg'], ref: 40.5 }] } } }).notes[38].layers[0].ref, 40.5);
    assert.equal(v({ notes: { 38: { layers: [{ files: ['a.ogg'], ref: 400 }] } } }).notes[38].layers[0].ref, null);
    assert.equal(m.notes[42].gain, 0);
    assert.equal(m.gain, 4);
    assert.deepEqual(m.chokes, { 42: [46] });
    assert.deepEqual(m.files.sort(), ['hh.ogg', 'snare_v1_a.ogg', 'snare_v2_a.ogg', 'snare_v2_b.ogg']);
});

test('sample kits: pickKitLayer picks the layer by velocity, nearest when in a gap', () => {
    const L = [{ lo: 1, hi: 40, id: 'pp' }, { lo: 41, hi: 90, id: 'mf' }, { lo: 100, hi: 127, id: 'ff' }];
    const pick = (vel) => K.pickKitLayer(L, vel, () => 0.999).id;   // no boundary blending
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
    const open = P.play(kit, 46, 100, 0, {});
    assert.ok(open, 'returns the source it started');
    assert.ok(P.play(kit, 42, 100, 0, {}));
    assert.equal(open.stopped, 0.1, 'the closed hi-hat cut the open one');
    assert.ok(P.play(kit, 42, 100, 0, {}));
    assert.deepEqual(started.map(s => s[0]), ['O', 'B', 'A'], 'round-robin over the layer');
    assert.equal(P.play(kit, 99, 100, 0, {}), null, 'unknown note');
});

test('sample kits: pickKitLayer blends across a layer boundary by how close the velocity is', () => {
    const L = [{ lo: 1, hi: 60, id: 'a' }, { lo: 61, hi: 127, id: 'b' }];
    const share = (vel) => { let up = 0; for (let i = 0; i < 1000; i++) if (K.pickKitLayer(L, vel, () => i / 1000).id === 'b') up++; return up / 1000; };
    assert.equal(share(40), 0, 'far below the boundary: lower layer only');
    assert.equal(share(100), 1);
    assert.ok(share(58) > 0.1 && share(58) < 0.5, 'just below: sometimes the upper layer');
    assert.ok(share(63) > 0.5 && share(63) < 0.9, 'just above: sometimes the lower layer');
    assert.ok(share(60) < share(61), 'more upper-layer hits as velocity rises');
});

test('sample kits: levelled layers follow the velocity law across layers', () => {
    const law = K.KIT_VEL_LAW;
    // two layers levelled onto the law (gain = (ref / 127) ** law relative to a full-strength 1)
    const lo = { lo: 1, hi: 60, ref: 30, gain: 1 }, hi = { lo: 61, hi: 127, ref: 94, gain: 1 };
    const lvl = (l, v) => K.kitHitGain(l, v) * Math.pow(l.ref / 127, law);
    for (const v of [20, 60, 61, 100]) assert.ok(Math.abs(lvl(lo, v) - lvl(hi, v)) < 1e-12, 'same level from either layer at ' + v);
    assert.ok(Math.abs(20 * Math.log10(lvl(hi, 20) / lvl(hi, 127)) - 20 * law * Math.log10(20 / 127)) < 1e-9);
});

test('sample kits: a voice limit per piece fades out the oldest ring; choke() cuts a note', () => {
    const srcs = [];
    const ctx = {
        currentTime: 0,
        createBufferSource() { const s = { connect() {}, start() {}, stop(t) { this.stopped = t; } }; srcs.push(s); return s; },
        createGain() { return { gain: { value: 1, cancelScheduledValues() {}, setTargetAtTime() {} }, connect() {}, disconnect() {} }; },
    };
    const kit = {
        manifest: K.validateKitManifest({ notes: { 38: { layers: [{ files: ['s.ogg'] }] }, 49: { layers: [{ files: ['c.ogg'] }] } } }),
        buffers: { 's.ogg': 1, 'c.ogg': 2 },
    };
    const P = K.createPlayer(ctx);
    for (let i = 0; i < 5; i++) P.play(kit, 38, 100, 0, {});
    assert.equal(K.voiceLimit(38), 4);
    assert.ok(srcs[0].stopped > 0, 'the fifth snare hit fades out the first');
    assert.equal(srcs[1].stopped, undefined);
    for (let i = 0; i < 6; i++) P.play(kit, 49, 100, 0, {});
    assert.equal(K.voiceLimit(49), 6, 'cymbals ring longer together');
    assert.ok(srcs.slice(5).every((s) => s.stopped === undefined));
    P.choke([49], 0);
    assert.ok(srcs.slice(5).every((s) => s.stopped === 0.1));
});

test('sample kits: loadKit decodes the first hit of every layer first, the rest in the background', async () => {
    const fetched = [];
    global.fetch = async (url) => {
        fetched.push(url);
        if (url.includes('kit.json')) {
            return { ok: true, json: async () => ({ notes: { 38: { layers: [{ lo: 1, hi: 60, files: ['a1.ogg', 'a2.ogg'] }, { lo: 61, hi: 127, files: ['b1.ogg', 'b2.ogg'] }] } } }) };
        }
        return { ok: true, arrayBuffer: async () => url };
    };
    const ctx = { decodeAudioData: async (b) => 'decoded:' + b };
    const kit = await K.loadKit(ctx, '/k/', '?v=1');
    assert.deepEqual(Object.keys(kit.buffers).sort(), ['a1.ogg', 'b1.ogg'], 'playable after the first hits');
    await kit.complete;
    assert.deepEqual(Object.keys(kit.buffers).sort(), ['a1.ogg', 'a2.ogg', 'b1.ogg', 'b2.ogg']);
    assert.equal(fetched[0], '/k/kit.json?v=1');
    delete global.fetch;
});

test('kits: an optional kit is listed once its folder is there, its room scale applies', () => {
    const mod = freshPlugin();
    assert.equal(mod.DRUM_KITS.drs.optional, true);
    assert.ok(!mod.DRUM_KITS.crocell.optional, 'the default kit always ships');
    assert.ok(!mod._kitOptions('crocell').includes('value="drs"'), 'not listed before it is found');
    assert.ok(mod._kitOptions('drs').includes('value="drs"'), 'listed when already picked');
    mod._optionalKits.drs = true;
    assert.ok(mod._kitOptions('crocell').includes('value="drs"'));
});

test('kits: GM kits get a level per piece; every GM note of every GM kit has one', () => {
    const mod = freshPlugin();
    for (const id of mod.KIT_IDS) {
        if (mod._kitIsSampled(id)) continue;
        assert.ok(mod.GM_NOTE_DB[id], id);
        for (const n of mod.DRUM_MIDI_NOTES) {
            if (n === 58) continue;   // alternate floor tom: unmeasured, 0 dB
            assert.ok(Number.isFinite(mod.GM_NOTE_DB[id][n]), id + ' note ' + n);
        }
    }
    assert.ok(Math.abs(mod._gmNoteGain('sblive', 49) - Math.pow(10, -9.5 / 20)) < 1e-12);
    assert.equal(mod._gmNoteGain('crocell', 38), 1);
    assert.equal(mod._gmDuration(49), 4.5, 'cymbals ring their natural length');
    assert.equal(mod._gmDuration(38), 1.0);
});
