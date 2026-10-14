/*
 * kits.js: sampled drum kits for the feedBack drums plugin's synth (MIT, original code).
 *
 * A sampled kit is a folder under assets/sounds/kits/<dir>/ holding kit.json and Ogg Vorbis
 * samples, built by tools/build_sample_kit.py from a free multi-sample library (see
 * assets/sounds/README.md and NOTICE.md). kit.json:
 *   { "format": 1, "name", "notes": { "<GM note>": { "piece", "layers": [ { "lo": 1, "hi": 50,
 *     "files": ["snare_v1_a.ogg", ...] }, ... ], "gain"?: 1 } }, "chokes"?: { "<GM note>": [<GM note>, ...] },
 *     "gain"?: 1 }
 * Layers split the velocity range 1..127 (velocity layers); `files` are round-robins; a choke makes
 * one note cut another that is still ringing (a closed / pedal hi-hat cuts the open hi-hat).
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
    const MAX_VOICES = 12;   // per note, for chokes

    /**
     * Check + normalise a kit.json. Returns { notes: {midi: {layers, gain}}, chokes, gain, files } or
     * null when it is unusable. Bad layers / file names are dropped, layers sorted by velocity.
     */
    function validateKitManifest(m) {
        if (!m || typeof m !== 'object' || !m.notes || typeof m.notes !== 'object') return null;
        const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
        const clampVel = (v) => Math.max(1, Math.min(127, Math.round(v)));
        const clampGain = (v) => Math.max(0, Math.min(4, num(v, 1)));
        const out = { notes: {}, chokes: {}, gain: clampGain(m.gain), files: [] };
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
                layers.push({ lo, hi, files: fl, gain: clampGain(l.gain) });
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

    /** The layer for a velocity: the one whose range holds it, else the nearest range. */
    function pickKitLayer(layers, velocity) {
        if (!layers || !layers.length) return null;
        const v = Math.max(1, Math.min(127, Math.round(Number(velocity) || 0)));
        let best = null, bestD = Infinity;
        for (const l of layers) {
            if (v >= l.lo && v <= l.hi) return l;
            const d = v < l.lo ? l.lo - v : v - l.hi;
            if (d < bestD) { bestD = d; best = l; }
        }
        return best;
    }

    /**
     * Gain for a hit inside its layer: the layer's samples already carry the loudness of that
     * dynamic, so only a gentle slope across the layer's range (0.6 at its bottom .. 1 at its top)
     * smooths the step between layers.
     */
    function kitHitGain(layer, velocity) {
        if (!layer) return 0;
        const v = Math.max(1, Math.min(127, Number(velocity) || 0));
        const span = layer.hi - layer.lo;
        const t = span > 0 ? Math.max(0, Math.min(1, (v - layer.lo) / span)) : 1;
        return (0.6 + 0.4 * t) * (layer.gain == null ? 1 : layer.gain);
    }

    /**
     * Fetch + decode one kit folder: resolves to { manifest, buffers: {file: AudioBuffer} }.
     * baseUrl ends with '/'; query (e.g. '?v=4.3.0') is appended to every request. Samples that
     * fail are skipped (warned); the kit fails only when none decodes.
     */
    async function loadKit(ctx, baseUrl, query) {
        query = query || '';
        const res = await fetch(baseUrl + 'kit.json' + query);
        if (!res.ok) throw new Error('kit.json HTTP ' + res.status);
        const manifest = validateKitManifest(await res.json());
        if (!manifest) throw new Error('kit.json is not a valid kit');
        const buffers = {};
        let failed = 0;
        await Promise.all(manifest.files.map(async (f) => {
            try {
                const r = await fetch(baseUrl + f + query);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                buffers[f] = await ctx.decodeAudioData(await r.arrayBuffer());
            } catch (e) {
                failed++;
                console.warn('[Drums] Kit sample ' + baseUrl + f + ' failed:', e);
            }
        }));
        if (failed === manifest.files.length) throw new Error('no samples decoded');
        return { manifest, buffers };
    }

    /**
     * A voice manager for one audio context: round-robins per note and the ringing voices chokes
     * cut. play(kit, midi, velocity, when, dest) schedules one hit (when = AudioContext time).
     */
    function createPlayer(ctx) {
        const rr = {};       // midi -> round-robin counter
        const voices = {};   // midi -> [{ src, gain, t0 }] still sounding
        return {
            play(kit, midiNote, velocity, when, dest) {
                const n = kit && kit.manifest.notes[midiNote];
                if (!n) return false;
                const layer = pickKitLayer(n.layers, velocity);
                if (!layer) return false;
                const t = Math.max(when || 0, ctx.currentTime);
                // Chokes: e.g. a closed hi-hat cuts the open hi-hat still ringing.
                const choked = kit.manifest.chokes[midiNote];
                if (choked) {
                    for (const c of choked) {
                        for (const v of (voices[c] || [])) {
                            if (v.t0 > t) continue;   // scheduled after this hit (Play test)
                            try {
                                v.gain.gain.cancelScheduledValues(t);
                                v.gain.gain.setTargetAtTime(0, t, 0.012);
                                v.src.stop(t + 0.1);
                            } catch (_) { /* already stopped */ }
                        }
                    }
                }
                // Round-robin over the layer's files that decoded.
                const k = (rr[midiNote] = ((rr[midiNote] || 0) + 1) % 1024);
                let buf = null;
                for (let i = 0; i < layer.files.length && !buf; i++) buf = kit.buffers[layer.files[(k + i) % layer.files.length]] || null;
                if (!buf) return false;
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
                if (list.length > MAX_VOICES) list.shift();
                src.onended = () => {
                    const l = voices[midiNote];
                    const i = l ? l.indexOf(voice) : -1;
                    if (i >= 0) l.splice(i, 1);
                    try { g.disconnect(); } catch (_) { /* gone */ }
                };
                return true;
            },
        };
    }

    return { KIT_FILE_RE, KIT_DIR_RE, validateKitManifest, pickKitLayer, kitHitGain, loadKit, createPlayer };
});
