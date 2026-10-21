/*
 * gamepad-source.js: claims a gamepad-input controller while a drum part plays and turns its
 * presses into drum hits for the feedBack drums plugin.
 * Copyright (c) the feedBack drums plugin contributors. MIT license (see README.md).
 *
 * The claim lifecycle follows the five-fret plugin's screen.js tryClaim/claimable at commit 686bb98
 * (MIT, same author): claim only while wanted, the claim's own controllerKey is the authority, a
 * re-entrancy guard around our own claim/release, and a parked state while released.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window) window.DrumsGamepadSource = api;
    else if (typeof module !== 'object' && root) root.DrumsGamepadSource = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const BACK_HOLD_MS = 1000;   // holding Back (button 8) this long, pinned, leaves the part
    const BACK_BUTTON = 8;

    // G is DrumsGamepad. gamepadInput is core's gamepad-input domain (or null).
    function createSource(opts) {
        const o = opts || {};
        const gi = o.gamepadInput || null;
        const G = o.G;
        const owner = o.owner || 'drums';
        const onHit = typeof o.onHit === 'function' ? o.onHit : null;
        const onActivate = typeof o.onActivate === 'function' ? o.onActivate : null;
        const onPause = typeof o.onPause === 'function' ? o.onPause : null;
        const onChange = typeof o.onChange === 'function' ? o.onChange : null;
        const onBackHold = typeof o.onBackHold === 'function' ? o.onBackHold : null;
        const setTimer = typeof o.setTimer === 'function' ? o.setTimer : (fn, ms) => setTimeout(fn, ms);
        const clearTimer = typeof o.clearTimer === 'function' ? o.clearTimer : (id) => clearTimeout(id);

        let wanted = false;
        let pinned = null;          // controllerKey, or null for free mode
        let handle = null, info = null, binding = null, mapper = null;
        let cymbals = false, standardPad = false, connected = false;
        let parked = false;         // released but current() still reports the last controller
        let claiming = false;       // our own claim/release fires change events synchronously
        let destroyed = false;
        let offChange = null;
        let backTimer = null, backDown = false;
        // What current() reports; kept while parked.
        let curKey = null, curKind = null;

        function clearBack() {
            if (backTimer !== null) { try { clearTimer(backTimer); } catch (_) { /* ignore */ } backTimer = null; }
            backDown = false;
        }
        function fireBackHold() {
            backTimer = null;
            if (onBackHold) onBackHold();
        }

        function onEvent(ev) {
            if (!ev) return;
            connected = true;   // events resume after a reconnect
            if (pinned !== null && standardPad && ev.type === 'button' && ev.index === BACK_BUTTON) {
                const v = Number(ev.value);
                const down = typeof ev.pressed === 'boolean' ? ev.pressed : (Number.isFinite(v) && v >= 0.5);
                if (down && !backDown) {
                    backDown = true;
                    if (backTimer === null) backTimer = setTimer(fireBackHold, BACK_HOLD_MS);
                } else if (!down) {
                    clearBack();
                }
            }
            if (!mapper) return;
            const out = mapper.map(ev);
            for (let i = 0; i < out.length; i++) {
                const a = out[i];
                if (a.value !== 1) continue;   // presses only
                const action = a.action;
                if (action === 'star_power') { if (onActivate) onActivate(ev.t * 1000); }
                else if (action === 'pause') { if (onPause) onPause(); }
                else {
                    const p = G.PADS[action];
                    if (p && onHit) onHit(p.pad, p.cymbal && cymbals, ev.t * 1000);
                }
            }
        }

        // Free connected controllers this source could claim, in claim order: a stored binding
        // first, then standard pads, each in slot order. Pinned: only the pinned key.
        function claimable() {
            if (!gi) return [];
            let list;
            try { list = gi.list(); } catch (_) { return []; }
            if (!Array.isArray(list)) return [];
            const bindings = G.loadBindings();
            const saved = [], standard = [];
            const nth = Object.create(null);
            for (const e of list) {
                if (!e || !e.connected) continue;
                nth[e.id] = (nth[e.id] || 0) + 1;
                if (e.claimedBy) continue;   // another plugin, or another drums instance
                const key = typeof e.controllerKey === 'string' && e.controllerKey ? e.controllerKey : G.controllerKey(e, nth[e.id]);
                if (pinned !== null && key !== pinned) continue;
                const stored = bindings[key];
                const b = G.resolveBinding(e, stored);
                if (b) (b === stored ? saved : standard).push(e);
            }
            return saved.concat(standard);
        }

        function adopt(h, e, b) {
            handle = h; info = e; binding = b;
            mapper = G.createMapper(b);
            cymbals = G.hasCymbals(b);
            standardPad = e.mapping === 'standard';
            connected = true;
            curKey = h.controllerKey; curKind = b.kind;
            parked = false;
            h.addListener(onEvent);
        }

        function tryClaim() {
            if (!gi || destroyed || handle || claiming || !wanted) return;
            claiming = true;
            try {
                const cands = claimable();
                const bindings = G.loadBindings();
                for (const e of cands) {
                    const h = gi.claim(e.index, owner);
                    if (!h) continue;
                    // The claim's controllerKey is the authority (it can differ after renumbering).
                    const key = h.controllerKey;
                    const b = G.resolveBinding(e, bindings[key]);
                    if (!b || (pinned !== null && key !== pinned)) { h.release(); continue; }
                    adopt(h, e, b);
                    return;
                }
            } finally {
                claiming = false;
            }
        }

        function dropHandle(park) {
            if (!handle) return;
            const h = handle;
            handle = null; mapper = null; if (!park) { info = null; connected = false; }
            clearBack();
            claiming = true;
            try { h.removeListener(onEvent); h.release(); } catch (_) { /* ignore */ } finally { claiming = false; }
            if (park) parked = true; else { binding = null; parked = false; curKey = null; curKind = null; cymbals = false; }
        }

        function onGiChange(ev) {
            if (!ev || destroyed || claiming) return;
            if (handle) {
                if (ev.index !== handle.index) return;
                if (ev.type === 'disconnect') {
                    connected = false;
                    clearBack();
                    // Start over so a still-down button reads as a fresh press when events resume.
                    if (mapper) mapper.reset();
                } else if (ev.type === 'connect') {
                    connected = true;
                } else {
                    return;
                }
            } else {
                tryClaim();   // a controller came, went, or was claimed or released
            }
            if (onChange) onChange();
        }

        if (gi && typeof gi.on === 'function') offChange = gi.on('change', onGiChange);

        return {
            setWanted(v) {
                v = !!v;
                if (destroyed || !gi || v === wanted) return;
                wanted = v;
                if (wanted) tryClaim(); else dropHandle(true);
            },
            setKey(k) {
                const next = typeof k === 'string' && k ? k : null;
                if (destroyed || next === pinned) return;
                pinned = next;
                dropHandle(false);
                parked = false; curKey = null; curKind = null; binding = null;
                tryClaim();
            },
            current() {
                if (!gi || curKey === null) return null;
                if (!handle && !parked) return null;
                return { controllerKey: curKey, kind: curKind, hasCymbals: cymbals, claimed: !!handle, connected };
            },
            // A binding was saved on the Controllers card: re-resolve ours, or drop and re-claim.
            refresh() {
                if (!gi || destroyed) return;
                if (!handle) {
                    if (parked && curKey !== null) {
                        const b = G.resolveBinding(info, G.loadBindings()[curKey]);
                        if (b) { binding = b; cymbals = G.hasCymbals(b); curKind = b.kind; }
                    }
                    tryClaim();
                    return;
                }
                const b = G.resolveBinding(info, G.loadBindings()[handle.controllerKey]);
                if (!b) { dropHandle(false); tryClaim(); return; }
                binding = b;
                mapper = G.createMapper(b);
                cymbals = G.hasCymbals(b);
                curKind = b.kind;
            },
            destroy() {
                if (destroyed) return;
                if (offChange) { try { offChange(); } catch (_) { /* ignore */ } offChange = null; }
                dropHandle(false);
                destroyed = true; wanted = false; parked = false; curKey = null; curKind = null; clearBack();
            },
        };
    }

    return { createSource, BACK_HOLD_MS };
});
