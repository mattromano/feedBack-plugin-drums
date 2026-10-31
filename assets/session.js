/*
 * session.js: chart model, difficulty levels and the scoring session for the feedBack drums plugin
 * (MIT, original code).
 *
 * Shared by both views (screen.js loads it lazily as a plain script). No DOM, no THREE. Exported on
 * window.DrumsSession (browser) and module.exports (Node tests):
 *  - Pure helpers: chart flattening, gem classification, drum_tab gameplay metadata (star power,
 *    fills, solos, difficulty levels: feedpak 1.20.0), difficulty availability / fallback / labels,
 *    auto lanes, HUD formatting, MIDI -> pad mapping, timing helpers.
 *  - createSession(DrumsEngine, opts): owns the engine (engine.js, LGPL-3.0, used only through its
 *    public API) for one chart. Builds it from wire notes, applies star power / fill metadata,
 *    rebuilds on seeks, adds the bonus score (spot-on timing, rolls, drum solos) and queues engine
 *    events for the view.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window) window.DrumsSession = api;
    else if (root) root.DrumsSession = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ── Constants ───────────────────────────────────────────────────────────

    // Engine pads (engine.js PAD). Lane index = pad - 1 for the four pad lanes; the kick has no lane.
    const PAD = Object.freeze({ KICK: 0, RED: 1, YELLOW: 2, BLUE: 3, GREEN: 4 });
    const LANE_NAMES = Object.freeze(['red', 'yellow', 'blue', 'green']);

    // Lane / gem colours (0xRRGGBB). One place to tweak the look (both views).
    const LANE_COLORS = Object.freeze({
        red: 0xff2b3d,
        yellow: 0xffcc1f,
        blue: 0x2b8bff,
        green: 0x27d65c,
    });
    const COLORS = Object.freeze({
        kick: 0xff8a14,
        kick2x: 0xff4fc8,
        starPowerGem: 0xdcf1ff,     // silver-white with a blue tint
        starPowerEdge: 0x86ddff,
        activator: 0x6dffb6,
        fill: 0x38ffa8,
        miss: 0xff2424,
        missedGem: 0x3b3b48,
        background: 0x05060c,
        track: 0x0c0f1c,
        rail: 0x3a4a78,
        beat: 0x8090c0,
        measure: 0xd0dcff,
        strike: 0xe8ecff,
    });

    // screen.js lane ids (Learn / custom mapping) -> engine pad.
    const LANE_ID_TO_PAD = Object.freeze({
        kick: { pad: PAD.KICK, cymbal: false },
        snare: { pad: PAD.RED, cymbal: false },
        hihat: { pad: PAD.YELLOW, cymbal: true },
        tom1: { pad: PAD.YELLOW, cymbal: false },
        tom2: { pad: PAD.BLUE, cymbal: false },
        tom3: { pad: PAD.GREEN, cymbal: false },
        ride: { pad: PAD.BLUE, cymbal: true },
        crash: { pad: PAD.GREEN, cymbal: true },
    });

    // Seeks: a jump larger than this (seconds) rebuilds the engine from the new position.
    // GM pedal hi-hat. Rock Band has no pedal note, so the engine leaves it out unless
    // asked (the "Play pedal notes" hi-hat pedal setting).
    const HAT_PEDAL_MIDI = 44;
    const SEEK_BACK = 0.25;
    const SEEK_FORWARD = 1.5;
    // The engine runs this far (s) behind the frame clock, so a pad hit stamped with its MIDI
    // arrival time (before the last frame, but delivered after it) is judged at its own time
    // instead of being moved forward to the frame time (see createSession update()).
    const INPUT_GRACE = 0.06;
    // Early/late meter: how many recent hits it keeps, and the "on time" dead zone (ms).
    const TIMING_SAMPLES = 24;
    const TIMING_DEAD_MS = 10;
    // Kick vs hands timing: samples kept per side, how many each side needs, and the gap (ms) worth fixing.
    const PAD_TIMING_SAMPLES = 64, PAD_TIMING_MIN = 8, PAD_TIMING_GAP_MS = 15;
    // Input offset range (ms), same as the settings panel.
    const INPUT_OFFSET_MIN = -250, INPUT_OFFSET_MAX = 250;

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function defaultNow() {
        return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
            ? performance.now() : Date.now();
    }

    // ── Pure helpers: chart ─────────────────────────────────────────────────

    /**
     * Flatten bundle.notes + bundle.chords into one wire-note list. Chord notes take the chord's
     * time. Visual-only notes (drum_tab flam graces, `_noScore`) are left out.
     */
    function collectWireNotes(notes, chords) {
        const out = [];
        if (Array.isArray(notes)) {
            for (const n of notes) if (n && typeof n === 'object' && !n._noScore) out.push(n);
        }
        if (Array.isArray(chords)) {
            for (const c of chords) {
                if (!c || !Array.isArray(c.notes)) continue;
                for (const cn of c.notes) {
                    if (!cn || typeof cn !== 'object' || cn._noScore) continue;
                    const t = Number.isFinite(+cn.t) ? +cn.t : +c.t;
                    out.push(cn.t === t ? cn : Object.assign({}, cn, { t }));
                }
            }
        }
        return out;
    }

    /**
     * Classify a decoded drum note (DrumsEngine.decodeNotes output: {pad, cymbal, kick2x, dyn}) into
     * its gem: kind 'kick' | 'kick2x' | 'pad' | 'cymbal', lane 0..3 (-1 for the kick), dynamics and
     * the base colour.
     */
    function classifyNote(n, opts) {
        if (!n || typeof n !== 'object') return null;
        const pro = !(opts && opts.pro === false);
        const pad = n.pad | 0;
        if (pad < 0 || pad > 4) return null;
        const accent = n.dyn === 'accent';
        const ghost = n.dyn === 'ghost';
        if (pad === PAD.KICK) {
            const kick2x = !!n.kick2x;
            return { kind: kick2x ? 'kick2x' : 'kick', lane: -1, cymbal: false, kick2x, accent, ghost,
                color: kick2x ? COLORS.kick2x : COLORS.kick };
        }
        const lane = pad - 1;
        // Non-pro drums (opts.pro === false): no cymbals, every Y/B/G note is a plain pad.
        const cymbal = pro && !!n.cymbal && pad !== PAD.RED;
        return { kind: cymbal ? 'cymbal' : 'pad', lane, cymbal, kick2x: false, accent, ghost,
            color: LANE_COLORS[LANE_NAMES[lane]] };
    }

    /**
     * Render model: one gem per decoded note, sorted by time, keyed by the engine note id.
     * opts.pro === false (non-pro drums) draws cymbals as pads and, like the engine, keeps one
     * gem when a tom and a cymbal of the same colour land together (< 1 ms apart).
     */
    function buildGems(decoded, opts) {
        const notes = decoded && Array.isArray(decoded.notes) ? decoded.notes : [];
        const pro = !(opts && opts.pro === false);
        const gems = [];
        for (const n of notes) {
            const c = classifyNote(n, opts);
            if (!c) continue;
            c.id = n.id;
            c.t = n.t;
            c.pad = n.pad | 0;
            c.chartCymbal = !!n.cymbal;   // the chart's cymbal marking, even when non-pro draws it as a pad
            c.pedal = n.midi === HAT_PEDAL_MIDI;   // a hi-hat pedal note (only decoded when pedal notes are played)
            c.auto = isAutoNote(c.pad, c.chartCymbal, opts && opts.auto);
            gems.push(c);
        }
        gems.sort((a, b) => a.t - b.t);
        if (pro) return gems;
        const out = [];
        for (const g of gems) {
            let dup = false;
            for (let i = out.length - 1; i >= 0 && g.t - out[i].t < 0.001; i--) {
                if (out[i].lane === g.lane && out[i].kind === g.kind) { dup = true; break; }
            }
            if (!dup) out.push(g);
        }
        return out;
    }

    /** [i0, i1) of the gems with t0 <= t < t1 (gems sorted by t). */
    function visibleRange(gems, t0, t1) {
        let lo = 0, hi = gems.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (gems[m].t < t0) lo = m + 1; else hi = m; }
        const i0 = lo;
        hi = gems.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (gems[m].t < t1) lo = m + 1; else hi = m; }
        return [i0, lo];
    }

    /** bundle.beats ([{time, measure}] or numbers) -> [{t, measure: bool}] sorted. */
    function normalizeBeats(beats) {
        if (!Array.isArray(beats)) return [];
        const out = [];
        for (const b of beats) {
            if (b == null) continue;
            if (typeof b === 'number') { if (Number.isFinite(b)) out.push({ t: b, measure: false }); continue; }
            const t = +(b.time != null ? b.time : b.t);
            if (!Number.isFinite(t)) continue;
            out.push({ t, measure: b.measure != null && +b.measure >= 0 });
        }
        out.sort((a, b) => a.t - b.t);
        return out;
    }

    // ── Pure helpers: auto lanes (accessibility) ────────────────────────────
    //
    // Auto kick / auto cymbals take those notes off the player: they are left out of the chart the
    // engine scores (YARG "no kicks" style, so score / accuracy / streak only count what you play),
    // still drawn (dimmed) and flash at the strikeline as if played, and pad hits on them are ignored.
    // The setting is a difficulty ceiling: 'off' | 'easy' | 'medium' | 'hard' | 'all' = on at that
    // difficulty and the ones below it.

    const AUTO_LEVELS = Object.freeze(['off', 'easy', 'medium', 'hard', 'all']);

    function normalizeAutoLevel(raw) {
        return typeof raw === 'string' && AUTO_LEVELS.includes(raw) ? raw : 'off';
    }

    /** Is an auto setting on at this difficulty? */
    function autoAppliesAt(level, difficultyId) {
        level = normalizeAutoLevel(level);
        if (level === 'off') return false;
        if (level === 'all') return true;
        return DIFFICULTIES.indexOf(normalizeDifficulty(difficultyId)) <= DIFFICULTIES.indexOf(level);
    }

    /** {kick, cymbals} booleans for the difficulty being played. */
    function autoFor(settings, difficultyId) {
        settings = settings || {};
        return {
            kick: autoAppliesAt(settings.kick, difficultyId),
            cymbals: autoAppliesAt(settings.cymbals, difficultyId),
        };
    }

    function normalizeAuto(auto) {
        return { kick: !!(auto && auto.kick), cymbals: !!(auto && auto.cymbals) };
    }

    /** A chart note (engine pad + the chart's cymbal marking) the player does not have to hit. */
    function isAutoNote(pad, cymbal, auto) {
        if (!auto) return false;
        if (auto.kick && pad === PAD.KICK) return true;
        return !!(auto.cymbals && cymbal && pad >= PAD.YELLOW);
    }

    /** First index of a gem with g.t > t (gems sorted by t). */
    function firstAfter(gems, t) {
        let lo = 0, hi = gems.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (gems[m].t <= t) lo = m + 1; else hi = m; }
        return lo;
    }

    // ── Pure helpers: drum_tab gameplay metadata (feedpak 1.20.0) ───────────

    /** A drum_tab range list ([{start_time, end_time}]) -> sorted [{start, end}], malformed entries dropped. */
    function _ranges(list) {
        if (!Array.isArray(list)) return [];
        const out = [];
        for (const p of list) {
            if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
            const start = +p.start_time, end = +p.end_time;
            if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
            out.push({ start, end });
        }
        out.sort((a, b) => a.start - b.start);
        return out;
    }

    /**
     * The gameplay metadata of a drum tab (bundle.drumTab, as core streams it): star power, fills
     * (star power activation), solos and the easier difficulty levels. `toNotes` converts drum_tab
     * hits into wire notes (screen.js _drumTabHitsToNotes) so a level plays exactly like the Expert
     * chart. Returns null when the tab carries none of it (a pre-1.20.0 tab, or a core that does not
     * stream it yet): the song then plays without star power (lower levels: withGeneratedLevels).
     * Output is in DrumsEngine.create option shape: starPower / activation as [{start, end}].
     */
    function parseDrumTabMeta(tab, toNotes) {
        if (!tab || typeof tab !== 'object' || Array.isArray(tab)) return null;
        const starPower = _ranges(tab.star_power);
        const activation = _ranges(tab.fills);
        const solos = _ranges(tab.solos);
        let levels = null;
        const generated = [];
        const raw = tab.levels;
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof toNotes === 'function') {
            for (const id of LOWER_LEVELS) {
                const lv = Object.prototype.hasOwnProperty.call(raw, id) ? raw[id] : null;
                if (!lv || typeof lv !== 'object' || !Array.isArray(lv.hits)) continue;
                const notes = toNotes(lv.hits);
                if (!Array.isArray(notes) || !notes.length) continue;
                (levels || (levels = {}))[id] = notes;
                if (lv.generated === true) generated.push(id);
            }
        }
        if (!starPower.length && !activation.length && !solos.length && !levels) return null;
        return {
            pro: true,                    // drum_tab pieces always say cymbal vs tom
            starPower,
            activation,
            solos,
            levels,                       // {easy?, medium?, hard?}: wire notes, or null
            levelsGenerated: generated,   // lower levels reduced by software rather than hand-charted
        };
    }

    // ── Pure helpers: difficulty levels ─────────────────────────────────────
    //
    // The drum tab's `hits[]` (or the legacy GM-encoded notes) are the full chart. Expert+ = all of
    // it; plain Expert drops the double-kick notes (drum_tab `x2`, GM 35 on the wire). Easy / Medium /
    // Hard come from the tab's `levels` (parseDrumTabMeta) when the chart has them, otherwise they are
    // generated from Expert (withGeneratedLevels, below).

    const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard', 'expert', 'expert_plus']);
    const LOWER_LEVELS = Object.freeze(['easy', 'medium', 'hard']);
    const DEFAULT_DIFFICULTY = 'expert';
    const DIFFICULTY_LABELS = Object.freeze({
        easy: 'EASY', medium: 'MEDIUM', hard: 'HARD', expert: 'EXPERT', expert_plus: 'EXPERT+',
    });
    const DIFFICULTY_NAMES = Object.freeze({
        easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', expert_plus: 'Expert+',
    });
    const DIFFICULTY_COLORS = Object.freeze({
        easy: '#4be37a', medium: '#ffd23f', hard: '#ff8a3d', expert: '#ff4b5c', expert_plus: '#ff4fc8',
    });
    const KICK2X_MIDI = 35;

    /** A stored / user-supplied difficulty id, or the default ('expert') when it is not a known id. */
    function normalizeDifficulty(raw) {
        return typeof raw === 'string' && DIFFICULTIES.includes(raw) ? raw : DEFAULT_DIFFICULTY;
    }

    function _wireGm(n) {
        if (n.midi != null && Number.isFinite(+n.midi)) return +n.midi;
        return ((n.s | 0) * 24) + (n.f | 0);
    }

    /** True when the wire chart (notes + chords) has 2x kick (GM 35) notes. */
    function hasKick2x(notes, chords) {
        if (Array.isArray(notes)) {
            for (const n of notes) if (n && typeof n === 'object' && _wireGm(n) === KICK2X_MIDI) return true;
        }
        if (Array.isArray(chords)) {
            for (const c of chords) {
                if (!c || !Array.isArray(c.notes)) continue;
                for (const n of c.notes) if (n && typeof n === 'object' && _wireGm(n) === KICK2X_MIDI) return true;
            }
        }
        return false;
    }

    /** Notes / chords without the 2x kick notes. Returns the same arrays when there are none. */
    function stripKick2x(notes, chords) {
        if (!hasKick2x(notes, chords)) return { notes, chords };
        const keep = (n) => !(n && typeof n === 'object' && _wireGm(n) === KICK2X_MIDI);
        const outNotes = Array.isArray(notes) ? notes.filter(keep) : notes;
        let outChords = chords;
        if (Array.isArray(chords)) {
            outChords = [];
            for (const c of chords) {
                if (!c || !Array.isArray(c.notes)) { outChords.push(c); continue; }
                const cn = c.notes.filter(keep);
                if (cn.length === c.notes.length) outChords.push(c);
                else if (cn.length) outChords.push(Object.assign({}, c, { notes: cn }));
            }
        }
        return { notes: outNotes, chords: outChords };
    }

    /**
     * Which difficulties the loaded chart offers.
     *   ctx.meta   parseDrumTabMeta() output (or null)
     *   ctx.has2x  the full chart has double-kick notes (hasKick2x)
     * -> [{id, label, name, available, reason, generated}] in DIFFICULTIES order. Expert is always
     * available; Expert+ needs double-kick notes; Easy/Medium/Hard need the tab's levels.
     */
    function difficultyOptions(ctx) {
        ctx = ctx || {};
        const meta = ctx.meta || null;
        const levels = meta && meta.levels ? meta.levels : null;
        const gen = meta && Array.isArray(meta.levelsGenerated) ? meta.levelsGenerated : [];
        return DIFFICULTIES.map((id) => {
            const o = { id, label: DIFFICULTY_LABELS[id], name: DIFFICULTY_NAMES[id], available: true, reason: '', generated: false };
            if (id === 'expert') return o;
            if (id === 'expert_plus') {
                if (!ctx.has2x) {
                    o.available = false;
                    o.reason = 'No double-kick notes in this chart';
                }
                return o;
            }
            const lv = levels && Array.isArray(levels[id]) ? levels[id] : null;
            if (lv && lv.length) {
                o.generated = gen.includes(id);
                return o;
            }
            o.available = false;
            if (!levels) o.reason = 'This chart only has Expert';
            else o.reason = 'This chart has no ' + o.name + ' part';
            return o;
        });
    }

    /**
     * Pick the difficulty to play: the saved choice when the chart has it, otherwise Expert
     * (the saved preference itself is left alone). -> {id, requested, fallback, reason}.
     */
    function resolveDifficulty(saved, options) {
        const requested = normalizeDifficulty(saved);
        const opts = Array.isArray(options) ? options : [];
        const want = opts.find(o => o && o.id === requested);
        if (!want || want.available) return { id: requested, requested, fallback: false, reason: '' };
        return { id: DEFAULT_DIFFICULTY, requested, fallback: true, reason: want.reason || '' };
    }

    /** The next available difficulty up (dir > 0) or down (dir < 0), wrapping around. */
    function nextDifficulty(current, options, dir) {
        const avail = DIFFICULTIES.filter(id => {
            const o = Array.isArray(options) ? options.find(x => x && x.id === id) : null;
            return !o || o.available;
        });
        if (!avail.length) return normalizeDifficulty(current);
        const step = dir < 0 ? -1 : 1;
        let i = DIFFICULTIES.indexOf(normalizeDifficulty(current));
        for (let k = 0; k < DIFFICULTIES.length; k++) {
            i = (i + step + DIFFICULTIES.length) % DIFFICULTIES.length;
            if (avail.includes(DIFFICULTIES[i])) return DIFFICULTIES[i];
        }
        return normalizeDifficulty(current);
    }

    /** 'hard' -> 'HARD'; generated levels get an AUTO marker ('HARD · AUTO'). */
    function difficultyLabel(id, generated) {
        const base = DIFFICULTY_LABELS[normalizeDifficulty(id)];
        return generated ? base + ' · AUTO' : base;
    }

    /**
     * HUD badge for a resolved difficulty: {id, text, sub, color, title}. `sub` is 'AUTO' for an
     * auto-generated level; `title` explains a fallback.
     */
    function difficultyBadge(resolved, options) {
        const id = resolved ? normalizeDifficulty(resolved.id) : DEFAULT_DIFFICULTY;
        const o = Array.isArray(options) ? options.find(x => x && x.id === id) : null;
        const generated = !!(o && o.generated);
        let title = 'Drum difficulty: ' + DIFFICULTY_NAMES[id] + (generated ? ' (auto-generated from Expert)' : '');
        if (resolved && resolved.fallback) {
            title += '. ' + DIFFICULTY_NAMES[resolved.requested] + ' is not available for this song'
                + (resolved.reason ? ' (' + resolved.reason + ')' : '');
        }
        return {
            id,
            text: DIFFICULTY_LABELS[id],
            sub: generated ? 'AUTO' : null,
            color: DIFFICULTY_COLORS[id],
            fallback: !!(resolved && resolved.fallback),
            title,
        };
    }

    /**
     * Wire chart for a difficulty: Expert+ = the chart's notes/chords as they are, Expert = the same
     * without double-kick notes, Easy/Medium/Hard = the tab's level (no chords). Unknown /
     * unavailable lower levels fall back to Expert.
     */
    function difficultyChart(id, notes, chords, meta) {
        id = normalizeDifficulty(id);
        if (id === 'expert_plus') return { id, notes, chords };
        if (LOWER_LEVELS.includes(id)) {
            const lv = meta && meta.levels && Array.isArray(meta.levels[id]) ? meta.levels[id] : null;
            if (lv && lv.length) return { id, notes: lv, chords: [] };
            id = 'expert';
        }
        const s = stripKick2x(notes, chords);
        return { id, notes: s.notes, chords: s.chords };
    }

    // ── Pure helpers: generated difficulty levels ───────────────────────────
    //
    // A chart without hand-charted Easy / Medium / Hard (drums encoded as guitar notes in a "Drums"
    // arrangement, or a drum tab without `levels`) gets them by reducing Expert. Port of core's
    // lib/drumchart_gen.py reduce_level: feedBack's own rules, fitted on 136 hand-authored Rock Band /
    // Clone Hero charts (not from YARG / Harmonix). Keep the two in step.

    // level: grid in beats, max gems per chord, kick kept together with hand gems.
    const REDUCE = Object.freeze({
        hard: Object.freeze({ grid: 0.5, maxGems: 3, kickWithHands: true }),
        medium: Object.freeze({ grid: 1.0, maxGems: 2, kickWithHands: true }),
        easy: Object.freeze({ grid: 1.0, maxGems: 2, kickWithHands: false }),
    });

    // Hand gems kept first when a chord has too many (core _HAND_PRIORITY): snare, yellow / green /
    // blue cymbal, then yellow / blue / green tom. Indexed by pad * 2 + cymbal.
    const _HAND_PRIORITY = Object.freeze([9, 9, 0, 9, 4, 1, 5, 3, 6, 2]);

    function _handRank(h) {
        const r = _HAND_PRIORITY[h.pad * 2 + (h.cymbal ? 1 : 0)];
        return r === undefined ? 9 : r;
    }

    /** Fractional beat index of time t on the strictly increasing beat times bt (core _beat_pos). */
    function _beatPos(bt, t) {
        if (bt.length < 2) return t / 0.5;
        let lo = 0, hi = bt.length;   // bisect_right
        while (lo < hi) { const m = (lo + hi) >> 1; if (bt[m] <= t) lo = m + 1; else hi = m; }
        const i = clamp(lo - 1, 0, bt.length - 2);
        return i + (t - bt[i]) / (bt[i + 1] - bt[i]);
    }

    /**
     * Reduce the full drum chart (wire notes + chords, as difficultyChart takes them) to 'easy' |
     * 'medium' | 'hard'. `beats` is bundle.beats; `padFromMidi` maps a GM note to {pad, cymbal}
     * (DrumsEngine.padFromMidi, so the level is judged on the same pads the engine scores).
     * Drops 2x kicks (GM 35, as stripKick2x) and ghost notes (`mt` without `ac`, as the engine
     * decodes them); keeps chords on the level's grid (8ths / quarters) first, then off-grid ones
     * that leave a full grid step to both neighbours; caps gems per chord (snare and cymbals before
     * toms; a kick is kept with the hands except on Easy). -> wire notes sorted by time (the chart's
     * own note objects), [] for an unknown level.
     */
    function reduceLevel(notes, chords, beats, level, padFromMidi) {
        const rule = Object.prototype.hasOwnProperty.call(REDUCE, level) ? REDUCE[level] : null;
        if (!rule || typeof padFromMidi !== 'function') return [];
        const { grid, maxGems, kickWithHands } = rule;
        // Strictly increasing grid: a beat map can repeat a time (zero-length beat).
        const bt = [];
        for (const b of normalizeBeats(beats)) if (!bt.length || b.t - bt[bt.length - 1] > 1e-6) bt.push(b.t);
        // Chords keyed by time rounded to the millisecond.
        const groups = new Map();
        for (const n of collectWireNotes(notes, chords)) {
            const t = +n.t;
            if (!Number.isFinite(t)) continue;
            const midi = _wireGm(n);
            if (midi === KICK2X_MIDI || (n.mt && !n.ac)) continue;   // 2x kick, ghost note
            const p = padFromMidi(midi);
            if (!p) continue;                                        // not a scored drum note
            const key = Math.round(t * 1000);
            let g = groups.get(key);
            if (!g) groups.set(key, (g = []));
            g.push({ n, pad: p.pad | 0, cymbal: !!p.cymbal && (p.pad | 0) !== PAD.RED });
        }
        const ts = Array.from(groups.keys()).sort((a, b) => a - b);
        const pos = new Map();
        for (const k of ts) pos.set(k, _beatPos(bt, k / 1000));
        const kept = [];
        for (const k of ts) {
            const q = pos.get(k) / grid;
            if (Math.abs(q - Math.round(q)) < 0.12) kept.push(k);
        }
        const on = new Set(kept);
        for (const k of ts) {   // off-grid chords where they don't crowd the grid
            if (on.has(k)) continue;
            let lo = 0, hi = kept.length;   // bisect_left
            while (lo < hi) { const m = (lo + hi) >> 1; if (kept[m] < k) lo = m + 1; else hi = m; }
            const p = pos.get(k);
            const prevOk = lo === 0 || p - pos.get(kept[lo - 1]) >= grid - 0.05;
            const nextOk = lo === kept.length || pos.get(kept[lo]) - p >= grid - 0.05;
            if (prevOk && nextOk) kept.splice(lo, 0, k);
        }
        const out = [];
        for (const k of kept) {
            // One gem per pad + cymbal (the chord's last such note, at the first one's place).
            const hands = new Map();
            let kick = null;
            for (const h of groups.get(k)) {
                if (h.pad === PAD.KICK) { if (!kick) kick = h; continue; }
                hands.set(h.pad * 2 + (h.cymbal ? 1 : 0), h);
            }
            const hs = Array.from(hands.values()).sort((a, b) => _handRank(a) - _handRank(b));
            if (kick && hs.length && kickWithHands) {
                out.push(kick.n);
                for (let i = 0; i < maxGems - 1 && i < hs.length; i++) out.push(hs[i].n);
            } else if (hs.length) {
                for (let i = 0; i < maxGems && i < hs.length; i++) out.push(hs[i].n);
            } else if (kick) {
                out.push(kick.n);
            }
        }
        return out;
    }

    /**
     * The chart's difficulty metadata with every missing lower level generated from Expert
     * (reduceLevel) and listed in levelsGenerated, so difficultyOptions offers it (badge AUTO) and
     * difficultyChart plays it. Hand-charted levels in `meta` always win. Returns `meta` itself when
     * nothing was added; otherwise a copy (null meta -> {levels, levelsGenerated}). Not for
     * session.setMeta: star power and fills stay the tab's.
     */
    function withGeneratedLevels(meta, notes, chords, beats, padFromMidi) {
        const have = meta && meta.levels && typeof meta.levels === 'object' ? meta.levels : null;
        const gen = meta && Array.isArray(meta.levelsGenerated) ? meta.levelsGenerated.slice() : [];
        let levels = null;
        for (const id of LOWER_LEVELS) {
            if (have && Array.isArray(have[id]) && have[id].length) continue;
            const lv = reduceLevel(notes, chords, beats, id, padFromMidi);
            if (!lv.length) continue;
            if (!levels) levels = Object.assign({}, have);
            levels[id] = lv;
            if (!gen.includes(id)) gen.push(id);
        }
        if (!levels) return meta;
        return Object.assign({}, meta, { levels, levelsGenerated: gen });
    }

    // ── Pure helpers: input ─────────────────────────────────────────────────

    /**
     * Difficulty shortcut: D = next harder difficulty, Shift+D = next easier (both views). D is not a
     * drum key and not a core player shortcut. -> {dir: 1 | -1} or null.
     */
    function isDifficultyKey(e) {
        if (!e || e.ctrlKey || e.metaKey || e.altKey) return null;
        const code = typeof e.code === 'string' ? e.code : '';
        const key = typeof e.key === 'string' ? e.key : '';
        if (code !== 'KeyD' && !(code === '' && key.toLowerCase() === 'd')) return null;
        return { dir: e.shiftKey ? -1 : 1 };
    }

    /**
     * MIDI note -> engine pad. A Learn / custom mapping entry for the note wins (its lane id is
     * translated with LANE_ID_TO_PAD); otherwise the General MIDI map (DrumsEngine.padFromMidi).
     * The 2D lane preset is ignored on purpose: scoring always uses the 4-lane pro-drums layout.
     */
    function midiToPad(midi, customMapping, padFromMidi) {
        midi = midi | 0;
        if (midi < 0 || midi > 127) return null;
        if (customMapping && typeof customMapping === 'object'
            && Object.prototype.hasOwnProperty.call(customMapping, midi)) {
            const m = LANE_ID_TO_PAD[customMapping[midi]];
            if (m) return { pad: m.pad, cymbal: m.cymbal };
        }
        return typeof padFromMidi === 'function' ? (padFromMidi(midi) || null) : null;
    }

    /** True for elements that take typed text (keyboard drumming must not steal their keys). */
    function isTypingTarget(el) {
        if (!el || typeof el !== 'object') return false;
        if (el.isContentEditable) return true;
        const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
        if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (tag === 'INPUT') {
            const type = String(el.type || 'text').toLowerCase();
            return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color'].includes(type);
        }
        return false;
    }

    /**
     * Song time of an input event that arrived between frames. bundle.currentTime only advances once
     * per frame, so extrapolate from the last two frames while playback is running (up to 60 ms).
     */
    function estimateTime(clock, nowWall) {
        if (!clock || !Number.isFinite(clock.time)) return NaN;
        const { time, wall, prevTime, prevWall } = clock;
        if (!Number.isFinite(prevTime) || !Number.isFinite(wall) || !Number.isFinite(prevWall)) return time;
        const dw = (wall - prevWall) / 1000;
        const dt = time - prevTime;
        if (!(dw > 0) || dw > 0.25 || !(dt > 0)) return time; // paused, stalled or seeking
        const rate = clamp(dt / dw, 0.1, 4);
        const ahead = clamp((nowWall - wall) / 1000, 0, 0.06);
        return time + ahead * rate;
    }

    /**
     * A frame clock for one highway: bundle.currentTime is sampled by core's 60 Hz timer, up to a
     * frame before the draw and in uneven steps, so gems drawn straight from it judder. tick(raw,
     * perfNow, isPlaying) returns the render time for this frame: the newest sample extrapolated to
     * now at the observed rate (capped at 100 ms), raw while paused / seeking. Same idea as core's
     * 3D highway smoothNow().
     */
    function createFrameClock() {
        let anchorT = NaN, anchorP = NaN, rate = 1;
        return {
            tick(raw, p, isPlaying) {
                raw = +raw;
                if (!Number.isFinite(raw)) return raw;
                if (isPlaying === false || !Number.isFinite(anchorP)) {
                    anchorT = raw; anchorP = p; rate = 1;
                    return raw;
                }
                if (raw !== anchorT) {
                    const dP = (p - anchorP) / 1000;
                    if (dP > 0.001 && dP < 0.5) {
                        const r = (raw - anchorT) / dP;
                        rate = (r > 0.05 && r < 5) ? r : 1;   // seek / loop: start over
                    } else if (dP >= 0.5) rate = 1;
                    anchorT = raw; anchorP = p;
                    return raw;
                }
                const dt = (p - anchorP) / 1000;
                if (dt <= 0 || dt > 0.1) return raw;
                return anchorT + rate * dt;
            },
            reset() { anchorT = NaN; anchorP = NaN; rate = 1; },
        };
    }

    /**
     * The early/late meter from recent hit offsets (ms, + = late): median, a word for it and the
     * input offset that would centre the hits (suggest, once there are 6 hits off by >= 10 ms).
     */
    function timingSummary(offsets, currentOffsetMs) {
        const offs = Array.isArray(offsets) ? offsets.filter(Number.isFinite) : [];
        const cur = Number.isFinite(currentOffsetMs) ? currentOffsetMs : 0;
        if (!offs.length) return { count: 0, median: null, word: null, late: null, suggest: null, ok: false };
        const srt = offs.slice().sort((a, b) => a - b), mid = srt.length >> 1;
        const med = srt.length % 2 ? srt[mid] : (srt[mid - 1] + srt[mid]) / 2;
        const onTime = Math.abs(med) < TIMING_DEAD_MS;
        const word = onTime ? 'ON TIME' : (med > 0 ? '+' : '') + Math.round(med) + ' ms ' + (med < 0 ? 'EARLY' : 'LATE');
        const enough = offs.length >= 6;
        return {
            count: offs.length, median: med, word, late: onTime ? null : med > 0,
            suggest: enough && !onTime ? clamp(Math.round(cur + med), -250, 250) : null,
            ok: enough && onTime,
        };
    }

    /**
     * Kick vs hands timing. samples: {kick, hands} strike offsets (ms, + = late). Each side's count and
     * median, the gap (kick - hands) once both have PAD_TIMING_MIN samples, and the kick offset that
     * would close it (suggestKick, when the gap is >= PAD_TIMING_GAP_MS; currentKickMs: the kick
     * offset the samples were measured with).
     */
    function padTimingSummary(samples, currentKickMs) {
        const side = (arr) => {
            const v = Array.isArray(arr) ? arr.filter(Number.isFinite).sort((a, b) => a - b) : [];
            const m = v.length >> 1;
            return { count: v.length, median: !v.length ? null : Math.round(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) };
        };
        const kick = side(samples && samples.kick), hands = side(samples && samples.hands);
        const both = kick.count >= PAD_TIMING_MIN && hands.count >= PAD_TIMING_MIN;
        const gap = both ? kick.median - hands.median : null;
        const cur = Number.isFinite(currentKickMs) ? currentKickMs : 0;
        return { kick, hands, kickVsHands: gap,
            suggestKick: gap !== null && Math.abs(gap) >= PAD_TIMING_GAP_MS ? clamp(Math.round(cur + gap), INPUT_OFFSET_MIN, INPUT_OFFSET_MAX) : null };
    }

    /** True when the playhead jumped (seek, loop restart) and the engine must be rebuilt. */
    function isSeek(prevTime, time) {
        if (!Number.isFinite(prevTime) || !Number.isFinite(time)) return false;
        return time < prevTime - SEEK_BACK || time > prevTime + SEEK_FORWARD;
    }

    // ── Pure helpers: HUD ───────────────────────────────────────────────────

    function formatScore(n) {
        n = Math.max(0, Math.floor(+n || 0));
        return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function formatAccuracy(acc) {
        if (!Number.isFinite(+acc)) return '--';
        return (clamp(+acc, 0, 1) * 100).toFixed(1) + '%';
    }

    /** Multiplier badge colour: x1 grey, x2 yellow, x3 green, x4 violet, star power (x>4 or SP) cyan. */
    function multiplierColor(mult, spActive) {
        if (spActive || mult > 4) return '#7fe6ff';
        if (mult >= 4) return '#c77dff';
        if (mult === 3) return '#4be37a';
        if (mult === 2) return '#ffd23f';
        return '#c8ccd8';
    }

    /** Stars earned and progress toward the next one (0..1). 6 stars = gold. */
    function starProgress(state) {
        const th = state && Array.isArray(state.starThresholds) ? state.starThresholds : [];
        const score = state ? +state.score || 0 : 0;
        let count = 0;
        while (count < th.length && score >= th[count]) count++;
        if (count >= th.length) return { count, frac: 1, gold: th.length > 0 && count >= 6 };
        const prev = count > 0 ? th[count - 1] : 0;
        const next = th[count];
        const frac = next > prev ? clamp((score - prev) / (next - prev), 0, 1) : 0;
        return { count, frac, gold: false };
    }

    /** Strings + numbers the HUD draws, from DrumsEngine.getState() (null state -> zeros). */
    function hudModel(state) {
        const s = state || {};
        const sp = s.starPower || {};
        const mult = s.multiplier || 1;
        const notesPerMult = 10;
        const maxBase = s.maxMultiplier || 4;
        const baseMult = sp.active ? mult / 2 : mult;
        const progress = baseMult >= maxBase ? 1 : ((s.combo || 0) % notesPerMult) / notesPerMult;
        const stars = starProgress(s);
        return {
            score: formatScore(s.score),
            multiplier: mult,
            multiplierText: 'x' + mult,
            multiplierColor: multiplierColor(mult, !!sp.active),
            multiplierProgress: progress,
            streak: s.combo || 0,
            streakText: String(s.combo || 0),
            accuracy: formatAccuracy(s.accuracy != null ? s.accuracy : 1),
            hitsText: (s.notesHit || 0) + ' / ' + (s.totalNotes || 0),
            stars: stars.count,
            starFrac: stars.frac,
            gold: stars.gold,
            spAmount: clamp(+sp.amount || 0, 0, 1),
            spActive: !!sp.active,
            spReady: !!sp.canActivate,
            fullCombo: !!s.fullCombo,
        };
    }

    /**
     * Star power hint for the HUD: how the player activates star power when it is ready, or null.
     * With fills in the chart the fill-end note activates it; without fills (manual activation) the
     * Enter key or the configured star power pad does. spPadName: that pad's name, or ''.
     */
    function starPowerHint(meta, state, spPadName) {
        const sp = state && state.starPower;
        if (!sp || !sp.canActivate || sp.active) return null;
        if (meta && Array.isArray(meta.activation) && meta.activation.length) return 'Hit the marked note at the end of the fill to activate';
        return 'Press Enter' + (spPadName ? ' or hit ' + spPadName : '') + ' to activate star power';
    }

    // ── Pure helpers: hit feedback ──────────────────────────────────────────
    // Visual only: the words and callouts the views flash. Scoring stays in engine.js.

    const JUDGE = Object.freeze({
        perfectMs: 25,          // |offset| within this is PERFECT (the perfect-timing bonus window)
        greatFrac: 0.5,         // within this share of the half hit window is GREAT, the rest GOOD
        greatMinMs: 35,
        defaultHalfMs: 70,      // engine default window 0.14 s
        streakFull: 16,         // streak at which feedback reaches full size
        hotStreak: 50,          // streak at which feedback turns flame-coloured
    });

    /** Half the hit window in ms for engine params ({hitWindow: {maxWindow}}), or the default. */
    function halfWindowMs(params) {
        const w = params && params.hitWindow && +params.hitWindow.maxWindow;
        return w > 0 ? w * 500 : JUDGE.defaultHalfMs;
    }

    /**
     * The word a hit `offsetMs` from its note (+ = late) earns: {word, color, tag}. tag is '' on
     * PERFECT, else 'EARLY' / 'LATE'.
     */
    function judgmentFor(offsetMs, halfMs) {
        const a = Number.isFinite(offsetMs) ? Math.abs(offsetMs) : 0;
        const half = halfMs > 0 ? halfMs : JUDGE.defaultHalfMs;
        const tag = a <= JUDGE.perfectMs ? '' : (offsetMs < 0 ? 'EARLY' : 'LATE');
        if (a <= JUDGE.perfectMs) return { word: 'PERFECT', color: '#5dffa8', tag };
        if (a <= Math.max(JUDGE.greatMinMs, half * JUDGE.greatFrac)) return { word: 'GREAT', color: '#8fe0ff', tag };
        return { word: 'GOOD', color: '#ffd27a', tag };
    }

    /** 0..1: how big hit feedback gets at this streak (full at JUDGE.streakFull). */
    function streakIntensity(combo) {
        return clamp((combo | 0) / JUDGE.streakFull, 0, 1);
    }

    /** True on the streaks that get a callout: 50, 100, then every 100. */
    function isStreakMilestone(combo) {
        combo = combo | 0;
        return combo === 50 || (combo >= 100 && combo % 100 === 0);
    }

    /**
     * The big centre callout for a session event, or null: streak milestones, a multiplier going
     * up, a lost streak of 25+, and star power. ctx: {maxMultiplier, spActive}.
     * Returns {text, sub?, color, rank}; a higher rank replaces a lower one still on screen.
     */
    function calloutFor(ev, ctx) {
        if (!ev) return null;
        const c = ctx || {};
        switch (ev.type) {
            case 'hit': {
                if (ev.auto) return null;
                const combo = ev.combo | 0;
                if (isStreakMilestone(combo)) return { text: combo + ' NOTE STREAK!', color: '#ffd23f', rank: 3 };
                const maxM = c.maxMultiplier > 0 ? c.maxMultiplier : 4;
                const base = Math.floor(combo / 10) + 1;
                if (combo > 0 && combo % 10 === 0 && base <= maxM) {
                    const m = base * (c.spActive ? 2 : 1);
                    return { text: 'x' + m + ' MULTIPLIER', color: multiplierColor(m, !!c.spActive), rank: 1 };
                }
                return null;
            }
            case 'combo-break':
                return (ev.combo | 0) >= 25 ? { text: 'STREAK LOST', sub: (ev.combo | 0) + ' notes', color: '#ff6b6b', rank: 2 } : null;
            case 'sp-ready': return { text: 'STAR POWER READY', color: '#8fe6ff', rank: 2 };
            case 'sp-activate': return { text: 'STAR POWER!', color: '#8fe6ff', rank: 4 };
            case 'sp-phrase': return { text: 'PHRASE COMPLETE', color: '#dff3ff', rank: 1 };
            default: return null;
        }
    }

    // ── Freestyle: in time with the song, not note by note ──────────────────

    // Grades (ms from the nearest target), how much each moves the groove level, when the meter
    // goes idle without hits (s) and how long a new state must hold before it shows (s).
    const GROOVE = Object.freeze({ lockedMs: 20, inMs: 45, idleSec: 4, holdSec: 0.6, leanMs: 25 });

    // Index of the first entry with time >= t in a sorted list (get(i) -> seconds).
    function _lowerBound(n, get, t) {
        let lo = 0, hi = n;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (get(mid) < t) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    /**
     * How close a hit at `t` (s) lands to the song's pulse, whatever pad it was: the nearest of
     * the 8th-note grid from `beats` ([{t}], sorted) and any chart note time (`noteTimes`, sorted
     * seconds). Returns {offsetMs (+ = late), grade: 'locked'|'in'|'off'}, or null with no targets.
     */
    function grooveTap(t, beats, noteTimes, o) {
        o = o || GROOVE;
        if (!Number.isFinite(t)) return null;
        let best = null;
        const take = (target) => {
            if (Number.isFinite(target) && (best === null || Math.abs(t - target) < Math.abs(t - best))) best = target;
        };
        if (beats && beats.length) {
            const i = _lowerBound(beats.length, k => beats[k].t, t);
            for (let k = Math.max(0, i - 1); k <= Math.min(beats.length - 1, i); k++) {
                take(beats[k].t);
                if (k + 1 < beats.length) take((beats[k].t + beats[k + 1].t) / 2);
            }
        }
        if (noteTimes && noteTimes.length) {
            const i = _lowerBound(noteTimes.length, k => noteTimes[k], t);
            if (i > 0) take(noteTimes[i - 1]);
            if (i < noteTimes.length) take(noteTimes[i]);
        }
        if (best === null) return null;
        const offsetMs = Math.round((t - best) * 1000) || 0;
        const a = Math.abs(offsetMs);
        return { offsetMs, grade: a <= o.lockedMs ? 'locked' : (a <= o.inMs ? 'in' : 'off') };
    }

    function newGroove() {
        return { level: 0, lean: 0, offRate: 0, lastTap: -Infinity, at: null, state: 'idle', changedAt: 0, pending: null, pendingAt: 0 };
    }

    /**
     * The freestyle groove meter. m: the previous state (or null), tap: a grooveTap result just
     * played (or null), now: seconds. Returns m updated: level 0..1 (rises while in time, up to
     * 0.7 on loose hits and on to 1 on tight ones; falls while off; fades out after GROOVE.idleSec without hits), lean (ms, + = late) and state
     * 'idle' | 'warming' | 'drifting' | 'grooving' | 'locked', which only changes after the new
     * state held for GROOVE.holdSec (changedAt: when it last did).
     */
    function grooveMeter(m, tap, now, o) {
        o = o || GROOVE;
        m = m || newGroove();
        const dt = m.at == null ? 0 : clamp(now - m.at, 0, 1);
        m.at = now;
        const idle = now - m.lastTap > o.idleSec;
        m.level = clamp(m.level - dt * (idle ? 0.5 : 0.04), 0, 1);
        if (tap) {
            const off = tap.grade === 'off';
            // Loose hits ('in') keep you in the pocket but never lock you in: that takes tight ones.
            if (tap.grade === 'locked') m.level = clamp(m.level + 0.09, 0, 1);
            else if (off) m.level = clamp(m.level - 0.08, 0, 1);
            else m.level = Math.max(m.level, Math.min(m.level + 0.05, 0.7));
            m.offRate = m.offRate * 0.85 + (off ? 0.15 : 0);
            m.lean = m.lean * 0.8 + (tap.grade === 'locked' ? 0 : tap.offsetMs * 0.2);
            m.lastTap = now;
        }
        const target = now - m.lastTap > o.idleSec ? 'idle'
            : m.offRate > 0.5 ? 'drifting'
            : m.level >= 0.75 ? 'locked'
            : m.level >= 0.4 ? 'grooving' : 'warming';
        if (target === m.state) m.pending = null;
        else if (target === 'idle') { m.state = 'idle'; m.pending = null; m.changedAt = now; }
        else if (m.pending !== target) { m.pending = target; m.pendingAt = now; }
        else if (now - m.pendingAt >= o.holdSec) { m.state = target; m.pending = null; m.changedAt = now; }
        return m;
    }

    /** The word a groove state shows, or null: LOCKED IN, IN THE POCKET, RUSHING / DRAGGING / DRIFTING. */
    function grooveWord(state, leanMs, o) {
        o = o || GROOVE;
        if (state === 'locked') return { word: 'LOCKED IN', color: '#5dffa8' };
        if (state === 'grooving') return { word: 'IN THE POCKET', color: '#8fe0ff' };
        if (state === 'drifting') {
            if (leanMs >= o.leanMs) return { word: 'DRAGGING', color: '#ffb46b' };
            if (leanMs <= -o.leanMs) return { word: 'RUSHING', color: '#8fb8ff' };
            return { word: 'DRIFTING', color: '#ffd27a' };
        }
        return null;
    }

    // ── Session: the engine for one chart ───────────────────────────────────

    function normalizeInputOffset(ms) {
        const n = Math.round(Number(ms));
        return Number.isFinite(n) ? clamp(n, INPUT_OFFSET_MIN, INPUT_OFFSET_MAX) : 0;
    }

    /**
     * createSession(DrumsEngine, {now, inputOffsetMs, ...}) -> session. load() a chart (wire notes
     * + beats), optionally setMeta() the drums block, then update(time) every frame and
     * hit()/activate() on input. drainEvents() hands queued visual events ({type, pad, cymbal, sp,
     * wall}) to the view.
     *
     * Times passed to update(), hit() and activate() are on the highway's clock (what the player
     * sees). The session subtracts the input offset from all of them alike, so with a positive
     * offset a hit that registers late is compared against an engine that has not yet moved past
     * its note.
     */
    function createSession(Engine, opts) {
        opts = opts || {};
        const now = typeof opts.now === 'function' ? opts.now : defaultNow;
        const MAX_EVENTS = 256;
        const s = {
            decoded: null, gems: [], beats: [], rawBeats: null, meta: null, engine: null,
            lastTime: null, lastFrame: null, events: [], builds: 0,
            proWanted: opts.proDrums !== false,   // the player's "Pro cymbals" setting
            auto: normalizeAuto(opts.auto),       // {kick, cymbals}: lanes played for the player
            params: opts.params || null,          // engine params override (hit window)
            bonus: null,                          // Rock Band-style extras on top of the engine score
            offset: normalizeInputOffset(opts.inputOffsetMs) / 1000,   // input offset (s)
            kickOffset: normalizeInputOffset(opts.kickOffsetMs) / 1000,  // extra offset for kick hits (s)
            padSamples: { kick: [], hands: [] },  // recent strike offsets (ms, + = late), kick vs the rest
            hatPedalNotes: opts.hatPedalNotes === true,   // score the chart's hi-hat pedal notes
            wire: null,                           // the loaded chart's wire notes (re-decoded on a pedal change)
            freestyle: opts.freestyle === true,   // Freestyle: no judging, only "in time with the song?"
            noteTimes: [],                        // sorted chart note times (freestyle targets)
            groove: null,                         // grooveMeter state (freestyle)
        };
        // Highway time -> player time (the input offset applied).
        const playerTime = (t) => +t - s.offset;

        // ── Bonus score (on top of the engine's score) ──
        //  - timing: +10 x multiplier for a hit within 25 ms of the note;
        //  - rolls: snare/tom notes in a fast run (>= 4 within +-0.25 s, i.e. 8 per
        //    second) earn +25 x multiplier; a run of >= 8 pops "ROLL h/n +pts";
        //  - solos (meta.solos): live % of the solo's notes hit, and at the end
        //    100 per note hit (x2 when perfect) with a Rock Band-style rating.
        // The engine already scores dynamics (accent/ghost) and star power.
        const ROLL_WIN = 0.25, ROLL_N = 4, ROLL_MIN = 8, ROLL_GAP = 0.6;
        const noteKey = (t, pad) => Math.round(t * 1000) * 8 + (pad | 0);
        function newBonus() {
            const rolls = new Set();
            if (s.decoded) {
                const toms = s.decoded.notes.filter(n => n.pad >= 1 && n.pad <= 4 && !n.cymbal)
                    .map(n => ({ t: s.decoded.chords[n.chord].t, pad: n.pad })).sort((a, b) => a.t - b.t);
                for (let i = 0, lo = 0, hi = 0; i < toms.length; i++) {
                    while (toms[lo].t < toms[i].t - ROLL_WIN) lo++;
                    while (hi + 1 < toms.length && toms[hi + 1].t <= toms[i].t + ROLL_WIN) hi++;
                    if (hi - lo + 1 >= ROLL_N) rolls.add(noteKey(toms[i].t, toms[i].pad));
                }
            }
            const solos = ((s.meta && s.meta.solos) || []).map(r => ({ start: r.start, end: r.end, h: 0, n: 0, done: false }));
            return { total: 0, timing: 0, rolls: 0, solo: 0, perfect: 0, dynamics: 0, rollSet: rolls, run: null,
                offsets: s.bonus ? s.bonus.offsets : [], runs: [], solos, soloDone: [], feed: [] };
        }
        function bonusFeed(text, color) {
            const b = s.bonus;
            b.feed.push({ text, color, wall: now() });
            if (b.feed.length > 4) b.feed.shift();
        }
        function soloOf(t) { return s.bonus.solos.find(x => t >= x.start - 0.05 && t < x.end); }
        function bonusHit(e) {
            const b = s.bonus;
            const mult = e.multiplier || 1;
            const nt = Number.isFinite(e.noteTime) ? e.noteTime : e.time;
            // Early/late meter: hit time minus note time (ms, + = late), last TIMING_SAMPLES hits.
            b.offsets.push(Math.round((e.time - nt) * 1000) || 0);   // || 0: no -0
            if (b.offsets.length > TIMING_SAMPLES) b.offsets.shift();
            let pts = 0;
            if (Math.abs(e.time - nt) <= 0.025) { pts += 10 * mult; b.timing += 10 * mult; b.perfect++; }
            if (b.rollSet.has(noteKey(nt, e.pad))) {
                const r = 25 * mult;
                pts += r; b.rolls += r;
                if (!b.run || nt - b.run.last > ROLL_GAP) b.run = { h: 0, n: 0, pts: 0, last: nt };
                b.run.h++; b.run.n++; b.run.pts += r; b.run.last = nt;
            }
            if (e.bonus) { b.dynamics++; bonusFeed('+' + (e.velocityBonus || 25) * mult + ' dynamics', '#b77bff'); }
            const so = soloOf(nt);
            if (so && !so.done) { so.h++; so.n++; }
            b.total += pts;
            return pts;
        }
        function bonusMiss(e) {
            const b = s.bonus;
            const nt = Number.isFinite(e.noteTime) ? e.noteTime : e.time;
            if (b.rollSet.has(noteKey(nt, e.pad)) && b.run && nt - b.run.last <= ROLL_GAP) { b.run.n++; b.run.last = nt; }
            const so = soloOf(nt);
            if (so && !so.done) so.n++;
        }
        function bonusTick(time) {
            const b = s.bonus;
            if (!b) return;
            if (b.run && time - b.run.last > ROLL_GAP + 0.2) {
                const r = b.run; b.run = null;
                if (r.n >= ROLL_MIN) {
                    b.runs.push({ h: r.h, n: r.n, pts: r.pts });
                    push({ type: 'bonus-pop', text: 'ROLL ' + r.h + '/' + r.n + '  +' + formatScore(r.pts), color: r.h === r.n ? '#ffc531' : '#ff9a40' });
                }
            }
            for (const so of b.solos) {
                if (so.done || time < so.end + 0.3) continue;
                so.done = true;
                if (!so.n) continue;
                const pct = 100 * so.h / so.n, perfect = so.h === so.n;
                const pts = so.h * 100 * (perfect ? 2 : 1);
                b.solo += pts; b.total += pts;
                const rating = perfect ? 'PERFECT SOLO!' : pct >= 95 ? 'AWESOME SOLO!' : pct >= 90 ? 'GREAT SOLO!' : pct >= 80 ? 'GOOD SOLO!'
                    : pct >= 70 ? 'SOLID SOLO' : pct >= 60 ? 'OKAY SOLO' : 'MESSY SOLO';
                b.soloDone.push({ h: so.h, n: so.n, pct: Math.round(pct * 100) / 100, bonus: pts, rating });
                push({ type: 'solo-end', text: rating, sub: pct.toFixed(2) + '%  ·  solo bonus +' + formatScore(pts), perfect });
                // The paid bonus for listeners (band ledger): points only, not queued for the view.
                if (s.engine) tell(s.engine, { type: 'bonus', points: pts, reason: 'solo', time });
            }
        }

        function gemsFor() {
            const gems = buildGems(s.decoded, { pro: effectivePro(), auto: s.auto });
            const times = [];
            for (const g of gems) if (!times.length || g.t - times[times.length - 1] > 0.0005) times.push(g.t);
            s.noteTimes = times;
            return gems;
        }

        // Pro drums only when the player wants it and the chart has cymbal markings.
        function effectivePro() {
            return s.proWanted && !(s.meta && s.meta.pro === false);
        }

        // Rebuild from where the song is now (mid-song changes keep the score from here on).
        function rebuildHere() {
            build(s.lastTime != null && s.lastTime > (s.gems.length ? s.gems[0].t - 0.5 : 0)
                ? s.lastTime : undefined);
        }

        function push(ev) {
            ev.wall = now();
            s.events.push(ev);
            if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
            return ev;
        }

        // Public judgment listener (setOnEvent): the recorded event without its wall clock, plus
        // the engine's state after it. A throwing listener never reaches the engine.
        function tell(eng, ev, extra) {
            if (!s.onEvent) return;
            try {
                const st = eng.getState();
                const d = Object.assign({}, ev, extra);
                delete d.wall;
                d.multiplier = st.multiplier;
                d.score = st.score;
                d.stars = st.stars;
                d.combo = st.combo;
                d.spActive = !!st.starPower.active;
                d.spAmount = st.starPower.amount;
                d.proDrums = effectivePro();
                s.onEvent(d);
            } catch (_) { /* listener only */ }
        }

        // Advance the groove meter on the wall clock; a state change is queued for the views.
        function grooveTick(tap) {
            const prev = s.groove ? s.groove.state : 'idle';
            s.groove = grooveMeter(s.groove, tap, now() / 1000);
            const g = s.groove;
            if (g.state !== prev) {
                const w = grooveWord(g.state, g.lean);
                push({ type: 'groove', state: g.state, word: w ? w.word : null, color: w ? w.color : null });
            }
            return g;
        }

        function build(fromTime) {
            if (!s.decoded) { s.engine = null; return; }
            let chart = s.decoded;
            const auto = s.auto.kick || s.auto.cymbals;
            if (Number.isFinite(fromTime) || auto) {
                // Auto lanes are left out of the scored chart (chords regroup from the notes).
                chart = { notes: s.decoded.notes.filter(n => (!Number.isFinite(fromTime) || n.t >= fromTime - 0.001)
                    && !(auto && isAutoNote(n.pad, n.cymbal, s.auto))), chords: [] };
            }
            const m = s.meta;
            const eopts = { beats: s.rawBeats || [], proDrums: effectivePro() };
            if (s.params) eopts.params = s.params;
            // Freestyle: an engine with no star power or fills that is never fed hits or time, so
            // the views see plain gems, nothing judged and an empty score.
            if (m && !s.freestyle) {
                eopts.starPower = m.starPower;
                eopts.activation = m.activation;
            }
            const eng = Engine.create(chart, eopts);
            s.bonus = newBonus();   // a new engine starts its score over, and so do the bonuses
            if (s.freestyle) { s.engine = eng; s.builds++; return; }
            let scoreAtHit = 0;   // engine score after the previous hit (a hit's points for the view's pop)
            eng.on('hit', e => {
                const nt = Number.isFinite(e.noteTime) ? e.noteTime : e.time;
                const offsetMs = Math.round((e.time - nt) * 1000) || 0;
                const ev = { type: 'hit', pad: e.pad, cymbal: e.cymbal, id: e.id, sp: eng.isStarPowerNote(e.id), bonus: !!e.bonus, time: e.time,
                    combo: e.combo | 0, offsetMs, points: 0, judge: judgmentFor(offsetMs, halfWindowMs(s.params)) };
                push(ev);
                const extra = bonusHit(e);
                // Visual only: what this hit added (engine score since the last hit + its bonuses).
                const sc = Number.isFinite(e.score) ? e.score : scoreAtHit;
                ev.points = Math.max(0, sc - scoreAtHit) + extra;
                scoreAtHit = sc;
                if (s.onHit) {
                    try { s.onHit({ time: e.time, noteTime: nt, pad: e.pad }); } catch (_) { /* listener only */ }
                }
                tell(eng, ev, { noteTime: nt });
            });
            eng.on('miss', e => {
                const ev = push({ type: 'miss', pad: e.pad, cymbal: e.cymbal, id: e.id, time: e.time });
                bonusMiss(e);
                tell(eng, ev, { noteTime: e.noteTime });
            });
            eng.on('overhit', e => tell(eng, push({ type: 'overhit', pad: e.pad, cymbal: e.cymbal, time: e.time })));
            eng.on('sp-phrase', e => tell(eng, push({ type: 'sp-phrase', time: e.time })));
            eng.on('sp-phrase-fail', e => tell(eng, push({ type: 'sp-phrase-fail', time: e.time })));
            eng.on('sp-ready', e => tell(eng, push({ type: 'sp-ready', time: e.time })));
            eng.on('sp-activate', e => tell(eng, push({ type: 'sp-activate', time: e.time })));
            eng.on('sp-end', e => tell(eng, push({ type: 'sp-end', time: e.time })));
            eng.on('combo-break', e => push({ type: 'combo-break', combo: e.combo, time: e.time }));
            s.engine = eng;
            s.builds++;
        }

        const api = {
            /** Load a chart. notes/chords: wire arrays (drum_tab hits converted by screen.js, or legacy notes). */
            load(chart) {
                chart = chart || {};
                const wire = collectWireNotes(chart.notes, chart.chords);
                s.wire = wire;
                s.decoded = Engine.decodeNotes(wire, { kick2x: true, includeHatPedal: s.hatPedalNotes });
                s.gems = gemsFor();
                s.rawBeats = Array.isArray(chart.beats) ? chart.beats : [];
                s.beats = normalizeBeats(s.rawBeats);
                s.lastTime = null;
                s.events.length = 0;
                s.bonus = null;   // a new chart: the early/late meter starts over too
                s.padSamples = { kick: [], hands: [] };
                s.groove = null;
                build(undefined);
                return api;
            },
            /** Apply the gameplay metadata (parseDrumTabMeta output, or null). Rebuilds from the current time. */
            setMeta(meta) {
                s.meta = meta || null;
                if (s.decoded) {
                    s.gems = gemsFor();
                    rebuildHere();
                }
                return api;
            },
            /** Auto lanes ({kick, cymbals}); mid-song changes score from the current time. */
            setAuto(auto) {
                auto = normalizeAuto(auto);
                if (auto.kick === s.auto.kick && auto.cymbals === s.auto.cymbals) return api;
                s.auto = auto;
                if (s.decoded) {
                    s.gems = gemsFor();
                    rebuildHere();
                }
                return api;
            },
            /** Score the chart's hi-hat pedal notes (as hi-hat notes); mid-song changes score from the current time. */
            setHatPedalNotes(on) {
                on = on === true;
                if (on === s.hatPedalNotes) return api;
                s.hatPedalNotes = on;
                if (s.decoded && s.wire) {
                    s.decoded = Engine.decodeNotes(s.wire, { kick2x: true, includeHatPedal: on });
                    s.gems = gemsFor();
                    rebuildHere();
                }
                return api;
            },
            get hatPedalNotes() { return s.hatPedalNotes; },
            /** Freestyle on/off: no judging, only the groove meter. Mid-song changes start over from the current time. */
            setFreestyle(on) {
                on = on === true;
                if (on === s.freestyle) return api;
                s.freestyle = on;
                s.groove = null;
                if (s.decoded) rebuildHere();
                return api;
            },
            /** Engine params override (e.g. {hitWindow: {...}}), or null for the defaults. */
            setParams(params) {
                params = params || null;
                if (JSON.stringify(params) === JSON.stringify(s.params)) return api;
                s.params = params;
                if (s.decoded) rebuildHere();
                return api;
            },
            /** The player's "Pro cymbals" setting. false = non-pro drums (no cymbal lanes). */
            setProDrums(on) {
                on = on !== false;
                if (on === s.proWanted) return api;
                s.proWanted = on;
                if (s.decoded) {
                    s.gems = gemsFor();
                    rebuildHere();
                }
                return api;
            },
            /** Advance to the highway time of this frame (the input offset is applied here too). */
            update(frameTime) {
                frameTime = +frameTime;
                if (!Number.isFinite(frameTime) || !s.engine) return;
                const time = playerTime(frameTime);
                if (s.lastTime != null) {
                    if (isSeek(s.lastTime, time)) build(time);
                    else if (s.lastFrame != null && frameTime > s.lastFrame && (s.auto.kick || s.auto.cymbals)) {
                        // Auto notes crossing the strikeline this frame flash as if played
                        // (on the highway clock: that is when the player sees them arrive).
                        for (let i = firstAfter(s.gems, s.lastFrame); i < s.gems.length && s.gems[i].t <= frameTime; i++) {
                            const g = s.gems[i];
                            if (g.auto) push({ type: 'hit', pad: g.pad, cymbal: g.cymbal, id: g.id, sp: false, auto: true, time: g.t });
                        }
                    }
                }
                // First frame after a load that starts mid-song (view switched while playing,
                // renderer installed late): score from here instead of missing everything before.
                else if (s.gems.length && time > s.gems[0].t - SEEK_BACK) build(time);
                // The engine trails the frame clock by INPUT_GRACE: pad hits carry their MIDI
                // arrival time (back-dated to the strike), and the engine moves any input older
                // than its own time forward to it (YARG QueueInput). Advanced to the frame time,
                // every hit delivered just after a frame was late by up to a frame (measured
                // +9 ms median). Misses become final INPUT_GRACE later.
                if (s.freestyle) grooveTick(null);
                else {
                    s.engine.update(time - INPUT_GRACE);
                    bonusTick(time);
                }
                s.lastTime = time;
                s.lastFrame = frameTime;
            },
            /** A pad hit struck at highway time `time`. o: {cymbal, velocity (0..1)}. */
            hit(time, pad, o) {
                o = o || {};
                push({ type: 'press', pad: pad | 0, cymbal: !!o.cymbal });
                // Pads the game plays for you: no score, no overhit.
                if (isAutoNote(pad | 0, !!o.cymbal, s.auto)) return { type: 'ignored', reason: 'auto' };
                if (!s.engine || !Number.isFinite(+time)) return { type: 'ignored', reason: 'no-chart' };
                const kick = (pad | 0) === 0;
                const t = playerTime(time) - (kick ? s.kickOffset : 0);
                if (s.lastTime != null && isSeek(s.lastTime, t)) return { type: 'ignored', reason: 'seek' };
                if (s.freestyle) {
                    const tap = grooveTap(t, s.beats, s.noteTimes);
                    if (!tap) return { type: 'ignored', reason: 'no-beats' };
                    push({ type: 'tap', pad: pad | 0, cymbal: !!o.cymbal, time: t, offsetMs: tap.offsetMs, grade: tap.grade });
                    grooveTick(tap);
                    return { type: 'tap', offsetMs: tap.offsetMs, grade: tap.grade };
                }
                const r = s.engine.hit(t, pad, { cymbal: !!o.cymbal, velocity: o.velocity });
                // Per-pad timing: hits, and strikes that missed the window next to a note on their lane.
                const off = r.type === 'hit' ? r.offset : r.nearOffset;
                if (off != null && Number.isFinite(off)) {
                    const arr = s.padSamples[kick ? 'kick' : 'hands'];
                    arr.push(Math.round(off * 1000) || 0);
                    if (arr.length > PAD_TIMING_SAMPLES) arr.shift();
                }
                return r;
            },
            /**
             * Activate star power at highway time `time` (the Enter key / star power pad). Only
             * works on charts without fills (with fills, the fill-end note activates it).
             */
            activate(time) {
                if (s.freestyle) return false;
                if (!s.engine || !Number.isFinite(+time)) return false;
                return s.engine.activateStarPower(playerTime(time));
            },
            /** Input offset in ms (subtracted from every time above; + = hits register earlier). */
            setInputOffset(ms) {
                const v = normalizeInputOffset(ms) / 1000;
                if (v === s.offset) return api;
                s.offset = v;
                if (s.bonus) s.bonus.offsets = [];   // the meter measured the old offset
                s.padSamples = { kick: [], hands: [] };
                return api;
            },
            get inputOffsetMs() { return Math.round(s.offset * 1000); },
            /** Kick offset in ms: subtracted from kick hits on top of the input offset (- = kick lands early). */
            setKickOffset(ms) {
                const v = normalizeInputOffset(ms) / 1000;
                if (v === s.kickOffset) return api;
                s.kickOffset = v;
                s.padSamples.kick = [];
                return api;
            },
            get kickOffsetMs() { return Math.round(s.kickOffset * 1000); },
            /** Kick vs hands timing (padTimingSummary) from this chart's recent strikes. */
            padTiming() { return padTimingSummary(s.padSamples, Math.round(s.kickOffset * 1000)); },
            drainEvents() {
                if (!s.events.length) return [];
                const out = s.events.slice();
                s.events.length = 0;
                return out;
            },
            getState() { return s.engine ? s.engine.getState() : null; },
            /** Per-hit timing listener ({time, noteTime, pad}: player seconds) or null. */
            setOnHit(fn) { s.onHit = typeof fn === 'function' ? fn : null; return api; },
            /**
             * Judgment / star power listener, or null. After each hit, miss, overhit, sp-phrase,
             * sp-phrase-fail, sp-ready, sp-activate and sp-end: the recorded event (no `wall`) plus
             * {multiplier, score, stars, combo, spActive, spAmount} from getState() after it and
             * proDrums (the effective pro cymbals state); hits
             * and misses also carry noteTime, hits their points. A paid drum solo bonus comes as
             * {type: 'bonus', points, reason: 'solo', time} (the view's own event stays 'solo-end').
             */
            setOnEvent(fn) { s.onEvent = typeof fn === 'function' ? fn : null; return api; },
            /** Forget the early/late samples (after the input offset changed). */
            resetTiming() { if (s.bonus) s.bonus.offsets = []; return api; },
            /** The chart note behind an event id: {t, midi, pad, cymbal}, or null. */
            noteInfo(id) {
                const n = s.decoded && Number.isInteger(id) ? s.decoded.notes[id] : null;
                return n ? { t: n.t, midi: n.midi, pad: n.pad, cymbal: n.cymbal } : null;
            },
            /** True when the note (event / gem id) belongs to a star power phrase still alive. */
            isStarPowerNote(id) { return !!(s.engine && s.engine.isStarPowerNote(id)); },
            /** Bonus score on top of the engine's: totals, recent feed, the live solo. */
            getBonus() {
                const b = s.bonus;
                if (!b || s.freestyle) return null;
                const t = s.lastTime;
                const live = t == null ? null : b.solos.find(x => t >= x.start - 0.5 && t < x.end + 0.3);
                return { total: b.total, timing: b.timing, rolls: b.rolls, solo: b.solo, perfect: b.perfect, dynamics: b.dynamics,
                    feed: b.feed.slice(), rollActive: !!(b.run && b.run.n >= 3), runs: b.runs.slice(), solos: b.soloDone.slice(),
                    offsets: b.offsets.slice(),
                    soloLive: live ? { h: live.h, n: live.n, active: t >= live.start && t < live.end } : null };
            },
            /** Freestyle groove: {level, lean, state, changedAt (wall s), word}, or null when scored. */
            groove() {
                if (!s.freestyle) return null;
                const g = grooveTick(null);
                return { level: g.level, lean: g.lean, state: g.state, changedAt: g.changedAt, word: grooveWord(g.state, g.lean) };
            },
            get freestyle() { return s.freestyle; },
            get engine() { return s.engine; },
            get gems() { return s.gems; },
            get beats() { return s.beats; },
            get meta() { return s.meta; },
            get proDrums() { return effectivePro(); },
            get auto() { return { kick: s.auto.kick, cymbals: s.auto.cymbals }; },
            get builds() { return s.builds; },
            get lastTime() { return s.lastTime; },
        };
        return api;
    }

    return {
        PAD, LANE_NAMES, LANE_COLORS, COLORS, LANE_ID_TO_PAD, HAT_PEDAL_MIDI, SEEK_BACK, SEEK_FORWARD, INPUT_GRACE,
        collectWireNotes, classifyNote, buildGems, visibleRange, normalizeBeats,
        AUTO_LEVELS, normalizeAutoLevel, autoAppliesAt, autoFor, isAutoNote,
        parseDrumTabMeta,
        DIFFICULTIES, LOWER_LEVELS, DEFAULT_DIFFICULTY, DIFFICULTY_LABELS, DIFFICULTY_NAMES, DIFFICULTY_COLORS,
        normalizeDifficulty, hasKick2x, stripKick2x, difficultyOptions,
        resolveDifficulty, nextDifficulty, difficultyLabel, difficultyBadge, difficultyChart, isDifficultyKey,
        REDUCE, reduceLevel, withGeneratedLevels,
        midiToPad, isTypingTarget, estimateTime, isSeek, createFrameClock, timingSummary, TIMING_DEAD_MS,
        padTimingSummary, PAD_TIMING_MIN, PAD_TIMING_GAP_MS,
        formatScore, formatAccuracy, multiplierColor, starProgress, hudModel, starPowerHint,
        JUDGE, halfWindowMs, judgmentFor, streakIntensity, isStreakMilestone, calloutFor,
        GROOVE, grooveTap, grooveMeter, grooveWord,
        normalizeInputOffset, INPUT_OFFSET_MIN, INPUT_OFFSET_MAX,
        createSession,
    };
});
