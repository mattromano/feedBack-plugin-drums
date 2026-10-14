/*
 * kits.js: sampled drum kits for the feedBack drums plugin's synth (MIT, original code).
 *
 * A sampled kit is a folder under assets/sounds/kits/<dir>/ holding kit.json and Ogg Vorbis
 * samples, built by tools/build_sample_kit.py from a free multi-sample library (see
 * assets/sounds/README.md and NOTICE.md). kit.json:
 *   { "format": 1, "name", "notes": { "<GM note>": { "piece", "layers": [ { "lo": 1, "hi": 50,
 *     "files": ["snare_v1_a.ogg", ...], "ref"?: 25.5, "gain"?: 1 }, ... ], "gain"?: 1 } },
 *     "chokes"?: { "<GM note>": [<GM note>, ...] }, "gain"?: 1, "room"?: 1 }
 * Layers split the velocity range 1..127 (velocity layers); `files` are round-robins; a choke makes
 * one note cut another that is still ringing (a closed / pedal hi-hat cuts the open hi-hat).
 * Levelled layers (tools/kit_loudness.py) carry `ref`, the velocity the layer stands for, and a
 * `gain` that puts it on the velocity law (KIT_VEL_LAW) at ref. `room` (0..1) scales the generated
 * room for kits recorded with their own room mics. Note 23 is the semi-open hi-hat when a kit has
 * one (hi-hat pedal).
 *
 * Exported on window.DrumsKits (browser) and module.exports (Node tests). screen.js loads it on
 * first use of a sampled kit; everything here plays through plain AudioBufferSourceNodes for low
 * latency.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window) window.DrumsKits = api;
    else if (root) root.DrumsKits = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Folder and file names a kit may use (the assets route serves anything under assets/, so the
    // names are checked here before they become URLs).
    const KIT_FILE_RE = /^[a-z0-9][a-z0-9_-]{0,63}\.(?:ogg|webm|mp3)$/;
    const KIT_DIR_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
    // How loudness follows velocity, for every kit: level = 20 * LAW * log10(v / 127) dB
    // (velocity 64 -> -10 dB, 20 -> -28 dB, like a real drum from ff down to a ghost note).
    const KIT_VEL_LAW = 1.75;
    // Layers are blended across their boundaries: within LAYER_BLEND velocity of one, the hit takes
    // the upper or lower layer at random, weighted by how close it is, so there is no fixed
    // velocity where the tone suddenly changes.
    const LAYER_BLEND = 7;
    // Voices that may ring at once per piece (cymbals and the open hi-hat ring long and overlap
    // naturally; drums are dampened by the next stroke). The oldest fades out in ~30 ms.
    const CYMBAL_NOTES = new Set([23, 46, 49, 51, 52, 53, 55, 57, 59]);
    function voiceLimit(midi) { return CYMBAL_NOTES.has(midi) ? 6 : 4; }

    /**
     * Check + normalise a kit.json. Returns { notes: {midi: {layers, gain}}, chokes, gain, files } or
     * null when it is unusable. Bad layers / file names are dropped, layers sorted by velocity.
     */
    function validateKitManifest(m) {
        if (!m || typeof m !== 'object' || !m.notes || typeof m.notes !== 'object') return null;
        const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
        const clampVel = (v) => Math.max(1, Math.min(127, Math.round(v)));
        const clampGain = (v) => Math.max(0, Math.min(4, num(v, 1)));
        const room = typeof m.room === 'number' && Number.isFinite(m.room) ? Math.max(0, Math.min(1, m.room)) : null;
        const out = { notes: {}, chokes: {}, gain: clampGain(m.gain), room, files: [] };
        const files = new Set();
        for (const key of Object.keys(m.notes)) {
            const midi = Number(key);
            if (!Number.isInteger(midi) || midi < 0 || midi > 127) continue;
            const n = m.notes[key];
            if (!n || !Array.isArray(n.layers)) continue;
            const layers = [];
            for (const l of n.layers) {
                if (!l || !Array.isArray(l.files)) continue;
                const fl = l.files.filter((f) => typeof f === 'string' && KIT_FILE_RE.test(f));
                if (!fl.length) continue;
                let lo = clampVel(num(l.lo, 1)), hi = clampVel(num(l.hi, 127));
                if (hi < lo) { const t = lo; lo = hi; hi = t; }
                const ref = typeof l.ref === 'number' && l.ref >= 1 && l.ref <= 127 ? l.ref : null;
                layers.push({ lo, hi, files: fl, gain: clampGain(l.gain), ref });
                fl.forEach((f) => files.add(f));
            }
            if (!layers.length) continue;
            layers.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
            out.notes[midi] = { layers, gain: clampGain(n.gain) };
        }
        if (!Object.keys(out.notes).length) return null;
        if (m.chokes && typeof m.chokes === 'object') {
            for (const key of Object.keys(m.chokes)) {
                const midi = Number(key);
                const raw = Array.isArray(m.chokes[key]) ? m.chokes[key] : [];
                const list = raw.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 127);
                if (Number.isInteger(midi) && midi >= 0 && midi <= 127 && list.length) out.chokes[midi] = list;
            }
        }
        out.files = Array.from(files);
        return out;
    }

    /**
     * The layer for a velocity: the one whose range holds it, else the nearest range; near a
     * boundary, sometimes its neighbour (LAYER_BLEND). rnd: () -> [0, 1), default Math.random.
     */
    function pickKitLayer(layers, velocity, rnd) {
        if (!layers || !layers.length) return null;
        const v = Math.max(1, Math.min(127, Number(velocity) || 0));
        const vi = Math.round(v);
        let idx = -1, bestD = Infinity;
        for (let i = 0; i < layers.length; i++) {
            const l = layers[i];
            if (vi >= l.lo && vi <= l.hi) { idx = i; break; }
            const d = vi < l.lo ? l.lo - vi : vi - l.hi;
            if (d < bestD) { bestD = d; idx = i; }
        }
        const r = typeof rnd === 'function' ? rnd : Math.random;
        const l = layers[idx];
        if (vi >= l.lo && vi <= l.hi) {
            const up = layers[idx + 1], down = layers[idx - 1];
            const bUp = l.hi + 0.5, bDown = l.lo - 0.5;
            if (up && bUp - v < LAYER_BLEND) {
                if (r() < (LAYER_BLEND - (bUp - v)) / (2 * LAYER_BLEND)) return up;
            } else if (down && v - bDown < LAYER_BLEND) {
                if (r() < (LAYER_BLEND - (v - bDown)) / (2 * LAYER_BLEND)) return down;
            }
        }
        return l;
    }

    /**
     * Gain for a hit. Levelled layers (kit.json "ref"): the layer is on the velocity law at ref,
     * so scaling by (v / ref) ** LAW keeps loudness on one smooth curve whichever layer plays.
     * Older kits: a gentle slope across the layer (0.6 at its bottom .. 1 at its top).
     */
    function kitHitGain(layer, velocity) {
        if (!layer) return 0;
        const v = Math.max(1, Math.min(127, Number(velocity) || 0));
        const g = layer.gain == null ? 1 : layer.gain;
        if (layer.ref) return g * Math.pow(v / layer.ref, KIT_VEL_LAW);
        const span = layer.hi - layer.lo;
        const t = span > 0 ? Math.max(0, Math.min(1, (v - layer.lo) / span)) : 1;
        return (0.6 + 0.4 * t) * g;
    }

    /** The files to decode first: the first hit of every layer (the kit is playable then). */
    function firstFiles(manifest) {
        const first = new Set();
        for (const n of Object.values(manifest.notes)) for (const l of n.layers) first.add(l.files[0]);
        return first;
    }

    /**
     * Fetch + decode one kit folder: resolves to { manifest, buffers: {file: AudioBuffer},
     * complete: Promise, readyMs }. baseUrl ends with '/'; query (e.g. '?v=4.3.0') is appended to
     * every request. Playable sooner: the first hit of every layer decodes first (the promise
     * resolves then), the other round-robins in the background (`complete`; a hit uses whichever of
     * its layer's files are decoded). Samples that fail are skipped (warned); the kit fails only when
     * none of the first hits decodes.
     */
    async function loadKit(ctx, baseUrl, query) {
        query = query || '';
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const res = await fetch(baseUrl + 'kit.json' + query);
        if (!res.ok) throw new Error('kit.json HTTP ' + res.status);
        const manifest = validateKitManifest(await res.json());
        if (!manifest) throw new Error('kit.json is not a valid kit');
        const buffers = {};
        let failed = 0;
        const load = (list) => Promise.all(list.map(async (f) => {
            try {
                const r = await fetch(baseUrl + f + query);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                buffers[f] = await ctx.decodeAudioData(await r.arrayBuffer());
            } catch (e) {
                failed++;
                console.warn('[Drums] Kit sample ' + baseUrl + f + ' failed:', e);
            }
        }));
        const first = firstFiles(manifest);
        await load([...first]);
        if (failed === first.size) throw new Error('no samples decoded');
        const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const kit = { manifest, buffers, readyMs: now() - t0, completeMs: NaN, complete: null };
        kit.complete = load(manifest.files.filter((f) => !first.has(f))).then(() => { kit.completeMs = now() - t0; });
        return kit;
    }

    /**
     * A voice manager for one audio context: round-robins per note, the ringing voices chokes cut,
     * and a voice limit per piece. play(kit, midi, velocity, when, dest) schedules one hit (when =
     * AudioContext time) and returns its AudioBufferSourceNode (so a scheduled hit can be
     * cancelled), or null. choke(notes, t) cuts those notes' ringing voices at t (hi-hat pedal).
     * opts.rnd: random source for layer blending (tests).
     */
    function createPlayer(ctx, opts) {
        const rnd = opts && typeof opts.rnd === 'function' ? opts.rnd : Math.random;
        const rr = {};       // midi -> round-robin counter
        const voices = {};   // midi -> [{ src, gain, t0 }] still sounding
        function fade(v, t, tau, stopAfter) {
            try {
                v.gain.gain.cancelScheduledValues(t);
                v.gain.gain.setTargetAtTime(0, t, tau);
                v.src.stop(t + stopAfter);
            } catch (_) { /* already stopped */ }
        }
        function choke(notes, t) {
            for (const c of notes) {
                for (const v of (voices[c] || [])) {
                    if (v.t0 > t) continue;   // scheduled after this hit (Play test)
                    fade(v, t, 0.012, 0.1);
                }
            }
        }
        return {
            play(kit, midiNote, velocity, when, dest) {
                const n = kit && kit.manifest.notes[midiNote];
                if (!n) return null;
                const layer = pickKitLayer(n.layers, velocity, rnd);
                if (!layer) return null;
                const t = Math.max(when || 0, ctx.currentTime);
                // Chokes: e.g. a closed hi-hat cuts the open hi-hat still ringing.
                const choked = kit.manifest.chokes[midiNote];
                if (choked) choke(choked, t);
                // Round-robin over the layer's files that decoded.
                const k = (rr[midiNote] = ((rr[midiNote] || 0) + 1) % 1024);
                let buf = null;
                for (let i = 0; i < layer.files.length && !buf; i++) buf = kit.buffers[layer.files[(k + i) % layer.files.length]] || null;
                if (!buf) return null;
                const src = ctx.createBufferSource();
                src.buffer = buf;
                const g = ctx.createGain();
                g.gain.value = kitHitGain(layer, velocity) * n.gain * kit.manifest.gain;
                src.connect(g);
                g.connect(dest);
                src.start(t);
                const list = (voices[midiNote] = (voices[midiNote] || []));
                const voice = { src, gain: g, t0: t };
                list.push(voice);
                // Voice limit: on a fast roll the oldest ring fades out (no click) instead of
                // piling up into mud.
                while (list.length > voiceLimit(midiNote)) fade(list.shift(), t, 0.01, 0.06);
                src.onended = () => {
                    const l = voices[midiNote];
                    const i = l ? l.indexOf(voice) : -1;
                    if (i >= 0) l.splice(i, 1);
                    try { g.disconnect(); } catch (_) { /* gone */ }
                };
                return src;
            },
            choke,
        };
    }

    return {
        KIT_FILE_RE, KIT_DIR_RE, KIT_VEL_LAW, LAYER_BLEND, voiceLimit,
        validateKitManifest, pickKitLayer, kitHitGain, firstFiles, loadKit, createPlayer,
    };
});
