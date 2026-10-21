/*
 * gamepad.js: drum controller profiles, input mapper, setup recorder and bindings/settings storage
 * for the feedBack drums plugin. Names raw gamepad-input events (button/axis) as drum actions.
 * Copyright (c) the feedBack drums plugin contributors. MIT license (see README.md).
 *
 * Adapted from the feedBack five-fret plugin's assets/profiles.js at commit 686bb98 (MIT, same
 * author): the event reading, the hysteresis mapper, controllerKey and the setup recorder. The
 * whammy-only branches are dropped and the actions, profiles and storage keys are the drums'.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window) window.DrumsGamepad = api;
    else if (typeof module !== 'object' && root) root.DrumsGamepad = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const ACTIONS = Object.freeze(['red_pad', 'yellow_pad', 'blue_pad', 'green_pad', 'kick',
        'yellow_cymbal', 'blue_cymbal', 'green_cymbal', 'star_power', 'pause']);

    // Pad numbers are DrumsEngine.PAD (a test checks they match).
    const pad = (n, cymbal) => Object.freeze({ pad: n, cymbal });
    const PADS = Object.freeze({
        red_pad: pad(1, false), yellow_pad: pad(2, false), blue_pad: pad(3, false), green_pad: pad(4, false),
        kick: pad(0, false),
        yellow_cymbal: pad(2, true), blue_cymbal: pad(3, true), green_cymbal: pad(4, true),
    });

    const PRESS_AT = 0.5;
    const RELEASE_AT = 0.3;
    const HAT_TOLERANCE = 0.1;   // a hat binding's default match window around its value

    const BINDINGS_KEY = 'drums.gamepad.bindings.v1';
    const SETTINGS_KEY = 'drums.gamepad.settings.v1';

    const b = (index) => Object.freeze({ type: 'button', index });
    const STANDARD_GAMEPAD = Object.freeze({
        kind: 'gamepad',
        map: Object.freeze({
            red_pad: b(4), yellow_pad: b(5), blue_pad: b(6), green_pad: b(7), kick: b(0),
            star_power: b(3), pause: b(9),
        }),
    });

    function isBound(binding, action) {
        return !!binding && !!binding.map && typeof binding.map === 'object' && !!binding.map[action];
    }

    // A binding has cymbals when it binds at least one *_cymbal action.
    function hasCymbals(binding) {
        return isBound(binding, 'yellow_cymbal') || isBound(binding, 'blue_cymbal') || isBound(binding, 'green_cymbal');
    }

    // The engine hit for an action, or null for star_power, pause and unknown actions. Without
    // cymbals on the binding every hit is a pad hit.
    function hitFor(action, binding) {
        if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(PADS, action)) return null;
        const p = PADS[action];
        return { pad: p.pad, cymbal: p.cymbal && hasCymbals(binding) };
    }

    // Same format as core's gamepad-input claim key: `${id}#${n}`, n from 1 among identical ids.
    function controllerKey(info, nth) {
        if (!info || typeof info.id !== 'string' || !info.id) return null;
        const n = Number.isInteger(nth) && nth > 0 ? nth : 1;
        return `${info.id}#${n}`;
    }

    // Short display name: the id up to its first " (", trimmed to 24 characters, numbered from 2nd.
    function controllerName(id, nth) {
        let s = String(id == null ? '' : id);
        const cut = s.indexOf(' (');
        if (cut >= 0) s = s.slice(0, cut);
        s = s.trim().slice(0, 24);
        return Number.isInteger(nth) && nth > 1 ? `${s} ${nth}` : s;
    }

    function isBinding(x) {
        return !!x && typeof x === 'object' && !!x.map && typeof x.map === 'object' && !Array.isArray(x.map);
    }

    function resolveBinding(info, stored) {
        if (isBinding(stored)) return stored;
        if (info && info.mapping === 'standard') return STANDARD_GAMEPAD;
        return null;
    }

    // Reading of one event for one binding, or null if the event is not the binding's input.
    // Buttons read 0..1 (value, else the pressed flag); axes read their own direction (sign) or
    // the absolute value when no sign is given. A hat-switch binding ({ type: 'axis', index, value,
    // tolerance? }) reads 1 while the axis is within tolerance (default 0.1) of its value, else 0.
    function reading(spec, ev) {
        if (!spec || spec.type !== ev.type || spec.index !== ev.index) return null;
        if (spec.type === 'axis' && Number.isFinite(spec.value)) {
            const tol = Number.isFinite(spec.tolerance) && spec.tolerance > 0 ? spec.tolerance : HAT_TOLERANCE;
            const raw = Number(ev.value);
            return Number.isFinite(raw) && Math.abs(raw - spec.value) <= tol + 1e-9 ? 1 : 0;
        }
        let v = Number(ev.value);
        if (!Number.isFinite(v)) v = ev.pressed ? 1 : 0;
        if (spec.type === 'axis') v = spec.sign ? v * (spec.sign < 0 ? -1 : 1) : Math.abs(v);
        return Math.min(1, Math.max(0, v));
    }

    // Press at >= 0.5, release at <= 0.3 (a half-held trigger doesn't machine-gun). Every action is
    // press/release. reset() forgets held state, so a trigger held through a disconnect reads as a
    // fresh press afterwards.
    function createMapper(binding) {
        const map = (binding && binding.map) || {};
        const actions = Object.keys(map);   // hoisted: an event allocates only the returned array
        let down = Object.create(null);
        return {
            map(ev) {
                const out = [];
                if (!ev) return out;
                for (let i = 0; i < actions.length; i++) {
                    const action = actions[i];
                    const v = reading(map[action], ev);
                    if (v === null) continue;
                    const was = !!down[action];
                    const now = was ? v > RELEASE_AT : v >= PRESS_AT;
                    if (now !== was) {
                        down[action] = now;
                        out.push({ action, value: now ? 1 : 0 });
                    }
                }
                return out;
            },
            reset() { down = Object.create(null); },
        };
    }

    // ── Storage (every access guarded: localStorage can be absent or throw) ──────
    function readJSON(key) {
        try {
            const raw = globalThis.localStorage.getItem(key);
            if (raw === null || raw === undefined) return null;
            const v = JSON.parse(raw);
            return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
        } catch (_) { return null; }
    }
    function writeJSON(key, value) {
        try { globalThis.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
    }

    function loadBindings() { return readJSON(BINDINGS_KEY) || {}; }
    function saveBinding(key, binding) {
        const all = loadBindings();
        all[key] = binding;
        return writeJSON(BINDINGS_KEY, all);
    }
    function forgetBinding(key) {
        const all = loadBindings();
        if (!(key in all)) return true;
        delete all[key];
        return writeJSON(BINDINGS_KEY, all);
    }

    function isPlainObject(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
    function normaliseSettings(raw) {
        const offsetMs = {};
        if (isPlainObject(raw) && isPlainObject(raw.offsetMs)) {
            for (const k of Object.keys(raw.offsetMs)) {
                if (typeof raw.offsetMs[k] === 'number' && Number.isFinite(raw.offsetMs[k])) offsetMs[k] = raw.offsetMs[k];
            }
        }
        return { offsetMs };
    }
    function loadSettings() { return normaliseSettings(readJSON(SETTINGS_KEY)); }
    // Merges one controller's offset into the stored offsets. Returns what was stored.
    function setOffset(key, ms) {
        const s = loadSettings();
        if (typeof ms === 'number' && Number.isFinite(ms)) s.offsetMs[key] = ms;
        writeJSON(SETTINGS_KEY, s);
        return s;
    }

    // ── Setup (the controls card) ─────────────────────────────────────────────

    const SETUP_ACTIONS = Object.freeze({
        kit: ACTIONS,
        gamepad: Object.freeze(Object.keys(STANDARD_GAMEPAD.map)),
    });
    // The card's Skip may leave these unbound.
    const OPTIONAL_ACTIONS = Object.freeze(['yellow_cymbal', 'blue_cymbal', 'green_cymbal', 'star_power']);

    const SETUP_AXIS_MOVE = 0.5;   // an axis counts once it is this far from rest
    const AT_REST = 0.05;          // this close to rest counts as at rest
    const FULL_SCALE = 0.15;       // this close to ±1 is a normal axis's full travel, not a hat value

    // A control's identities: a button, one direction of an axis, or one value of a hat axis. A
    // sign-less axis binding is both directions.
    function controlIds(spec) {
        if (spec.type !== 'axis') return [`button:${spec.index}`];
        if (Number.isFinite(spec.value)) return [`axis:${spec.index}:=${spec.value.toFixed(2)}`];
        if (!spec.sign) return [`axis:${spec.index}:1`, `axis:${spec.index}:-1`];
        return [`axis:${spec.index}:${spec.sign < 0 ? -1 : 1}`];
    }

    // Walks `actions`, taking for each the first new button press or an axis moving more than 0.5
    // from rest (recorded with its sign), and ignoring a control already used (by this walk or
    // opts.used). opts.rest = { [axisIndex]: restValue }; an axis with no rest given takes the first
    // value it reports as its rest. A hat switch (an axis resting outside [-1, 1], or one that jumps
    // from rest straight to a value short of full scale) is recorded by value instead:
    // { type: 'axis', index, value, tolerance: 0.1 }, each direction its own control.
    // A second newly pressed control stamped with the same ev.t as the press just accepted is
    // ignored (a kit's colour + flag buttons arriving in one poll bind only one action).
    // Pure: feed(ev) -> { done, next, binding, recorded }, where binding is { map } once done (else
    // null) and recorded is { action, spec } when ev recorded one.
    function createSetupRecorder(actions, opts) {
        const list = Array.isArray(actions) ? actions.slice() : [];
        const o = opts || {};
        const used = new Set();
        if (Array.isArray(o.used)) {
            for (const s of o.used) {
                if (s && (s.type === 'button' || s.type === 'axis') && Number.isInteger(s.index)) {
                    for (const id of controlIds(s)) used.add(id);
                }
            }
        }
        const rest = Object.create(null);
        if (o.rest && typeof o.rest === 'object') {
            for (const k of Object.keys(o.rest)) if (Number.isFinite(o.rest[k])) rest[k] = o.rest[k];
        }
        const down = new Set();   // buttons held now
        const last = Object.create(null);   // each axis's previous value
        const hats = new Set();             // axes found to be hat switches
        const map = {};
        let i = 0;
        let acceptedT = null;     // ev.t of the press just accepted

        const result = (recorded) => {
            const done = i >= list.length;
            return { done, next: done ? null : list[i], binding: done ? { map: Object.assign({}, map) } : null, recorded };
        };
        function take(spec, ev) {
            if (Number.isFinite(ev.t) && ev.t === acceptedT) return result(null);
            const ids = controlIds(spec);
            if (ids.some((id) => used.has(id))) return result(null);
            for (const id of ids) used.add(id);
            map[list[i]] = spec;
            acceptedT = Number.isFinite(ev.t) ? ev.t : null;
            const recorded = { action: list[i], spec };
            i++;
            return result(recorded);
        }

        return {
            get next() { return i < list.length ? list[i] : null; },
            feed(ev) {
                if (!ev || !Number.isInteger(ev.index) || ev.index < 0) return result(null);
                if (ev.type === 'button') {
                    const v = Number(ev.value);
                    const pressed = typeof ev.pressed === 'boolean' ? ev.pressed : (Number.isFinite(v) && v >= PRESS_AT);
                    if (!pressed) { down.delete(ev.index); return result(null); }
                    if (down.has(ev.index)) return result(null);
                    down.add(ev.index);
                    if (i >= list.length) return result(null);
                    return take({ type: 'button', index: ev.index }, ev);
                }
                if (ev.type === 'axis') {
                    const v = Number(ev.value);
                    if (!Number.isFinite(v)) return result(null);
                    const k = ev.index;
                    if (!(k in rest)) { rest[k] = v; last[k] = v; return result(null); }
                    const r = rest[k];
                    const prev = k in last ? last[k] : r;
                    last[k] = v;
                    if (!hats.has(k) && (Math.abs(r) > 1 + AT_REST
                        || (Math.abs(prev - r) < AT_REST && Math.abs(v - prev) > SETUP_AXIS_MOVE
                            && Math.abs(Math.abs(v) - 1) > FULL_SCALE))) hats.add(k);
                    if (i >= list.length) return result(null);
                    if (hats.has(k)) {
                        if (Math.abs(v - r) < AT_REST) return result(null);
                        return take({ type: 'axis', index: k, value: Math.round(v * 1000) / 1000, tolerance: HAT_TOLERANCE }, ev);
                    }
                    const d = v - r;
                    if (Math.abs(d) <= SETUP_AXIS_MOVE) return result(null);
                    return take({ type: 'axis', index: k, sign: d < 0 ? -1 : 1 }, ev);
                }
                return result(null);
            },
            // Leave the current action unbound and move on.
            skip() {
                if (i < list.length) i++;
                return result(null);
            },
        };
    }

    return {
        ACTIONS,
        PADS,
        STANDARD_GAMEPAD,
        SETUP_ACTIONS,
        OPTIONAL_ACTIONS,
        BINDINGS_KEY,
        SETTINGS_KEY,
        hasCymbals,
        hitFor,
        controllerKey,
        controllerName,
        resolveBinding,
        createMapper,
        createSetupRecorder,
        loadBindings,
        saveBinding,
        forgetBinding,
        loadSettings,
        setOffset,
    };
});
